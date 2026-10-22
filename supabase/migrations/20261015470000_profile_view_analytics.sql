-- =============================================================================
-- Profile Views — unique viewer analytics (TikTok-style)
-- =============================================================================
-- WHY
--   Members want to know who looked at their profile, and how often people come
--   back. Nothing in the schema recorded a profile visit: the `visitor`
--   notification type and the "Visitors" tab existed, but no producer. This adds
--   the single source of truth for it.
--
-- MODEL — one row per (viewer, owner) pair
--   `profile_viewers` is the unique relationship AND the repeat-visit history:
--
--       (viewer_id, viewed_id)  primary key   -> one row per distinct viewer
--       first_viewed_at                        -> first visit
--       last_viewed_at                         -> most recent visit
--       view_count                             -> total intentional visits
--
--   Unique viewers  = count(*)                      (distinct accounts)
--   Returning       = count(*) where view_count > 1
--   Total visits    = sum(view_count)
--
--   A repeat visit increments `view_count` and `last_viewed_at` on the SAME row;
--   it never creates a second unique-viewer row. `insert ... on conflict do
--   update` is atomic, so concurrent requests cannot duplicate the pair or lose
--   an increment.
--
-- PRIVACY / SECURITY
--   * The table has RLS enabled with NO policies and NO client privileges. Only
--     the SECURITY DEFINER functions below touch it, so a client cannot read,
--     forge, or enumerate viewer identities directly.
--   * `record_profile_view` derives the viewer from `auth.uid()` — it accepts no
--     viewer id. Self-views are rejected by a CHECK as well as the function.
--   * `profile_view_count(profile_id)` exposes only the aggregate number to any
--     signed-in member. It never exposes an identity.
--   * `profile_view_summary()` and `list_profile_viewers()` accept no owner id;
--     they derive the owner from `auth.uid()`, so changing an API parameter
--     cannot read someone else's analytics. Both filter blocked pairs and only
--     project allow-listed public fields (via `public_profiles`).
--   * `anon` is denied both the table and the functions.
--
-- NOTIFICATIONS
--   The first unique visit inserts one `visitor` notification for the owner.
--   Repeat visits do not, so the tab is useful rather than noisy. The insert is
--   exception-wrapped: a notification failure can never fail the profile view.
--
-- SAFE TO RE-RUN: table/index are `if not exists`, functions are replaced,
-- grants are idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The unique viewer relationship + repeat-visit counters
-- ---------------------------------------------------------------------------
create table if not exists public.profile_viewers (
  viewer_id       uuid        not null references auth.users(id) on delete cascade,
  viewed_id       uuid        not null references auth.users(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),
  view_count      integer     not null default 1,

  primary key (viewer_id, viewed_id),
  constraint profile_viewers_no_self check (viewer_id <> viewed_id),
  constraint profile_viewers_view_count_positive check (view_count > 0)
);

comment on table public.profile_viewers is
  'One row per (viewer, profile owner). Unique viewers = row count; repeat visits increment view_count. RPC-only: no client privileges.';
comment on column public.profile_viewers.view_count is
  'Total recorded visits by this viewer. Incremented atomically by record_profile_view().';
comment on column public.profile_viewers.last_viewed_at is
  'Most recent recorded visit; the analytics list sorts by this.';

-- Owner-facing list: "most recent visitors first".
create index if not exists profile_viewers_viewed_recent_idx
  on public.profile_viewers (viewed_id, last_viewed_at desc);

-- RPC-only. No policies, no grants: the SECURITY DEFINER functions below are
-- the only path in, and they derive the owner from auth.uid().
alter table public.profile_viewers enable row level security;
revoke all on public.profile_viewers from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Public aggregate count (any signed-in member; no identities)
-- ---------------------------------------------------------------------------
create or replace function public.profile_view_count(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or p_profile_id is null then 0
    else (
      select count(*)::int
      from public.profile_viewers v
      where v.viewed_id = p_profile_id
        and not public.is_blocked_pair(p_profile_id, v.viewer_id)
    )
  end;
$$;

comment on function public.profile_view_count(uuid) is
  'Public unique-viewer count for one profile. Aggregate only: never exposes a viewer identity.';

-- ---------------------------------------------------------------------------
-- 3. Record a visit (viewer derived from auth.uid(), never supplied)
-- ---------------------------------------------------------------------------
create or replace function public.record_profile_view(p_viewed_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me              uuid := auth.uid();
  inserted_count  integer := 0;
  is_new_viewer   boolean := false;
  unique_total    integer := 0;
  visit_total     integer := 0;
  my_visits       integer := 0;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Invalid / self / absent targets are not recorded, and are not errors: the
  -- page already handles a missing profile, and analytics must stay nonfatal.
  if p_viewed_id is null then
    return jsonb_build_object('recorded', false, 'reason', 'missing_profile');
  end if;

  if p_viewed_id = me then
    return jsonb_build_object('recorded', false, 'reason', 'self_view');
  end if;

  if not exists (select 1 from public.profiles where id = p_viewed_id) then
    return jsonb_build_object('recorded', false, 'reason', 'missing_profile');
  end if;

  if public.is_blocked_pair(me, p_viewed_id) then
    return jsonb_build_object('recorded', false, 'reason', 'blocked');
  end if;

  -- First visit for this pair inserts; every later visit updates the same row.
  -- Concurrent first visits: the loser's insert conflicts, then its UPDATE still
  -- adds exactly one visit. The PK guarantees at most one unique-viewer row.
  insert into public.profile_viewers (viewer_id, viewed_id)
  values (me, p_viewed_id)
  on conflict (viewer_id, viewed_id) do nothing;

  get diagnostics inserted_count = row_count;
  is_new_viewer := inserted_count > 0;

  if not is_new_viewer then
    update public.profile_viewers
      set view_count     = view_count + 1,
          last_viewed_at = now()
      where viewer_id = me and viewed_id = p_viewed_id;
  end if;

  -- One notification per NEW unique viewer, never per repeat visit.
  if is_new_viewer then
    begin
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (p_viewed_id, me, 'visitor', me);
    exception
      when others then
        null; -- never let a notification failure break profile viewing
    end;
  end if;

  -- Match the public count and the owner summary: visits from a pair that is
  -- blocked now (even if the visit predates the block) are not reported.
  select count(*)::int, coalesce(sum(view_count), 0)::int
    into unique_total, visit_total
  from public.profile_viewers v
  where v.viewed_id = p_viewed_id
    and not public.is_blocked_pair(p_viewed_id, v.viewer_id);

  select coalesce(view_count, 0)
    into my_visits
  from public.profile_viewers
  where viewer_id = me and viewed_id = p_viewed_id;

  return jsonb_build_object(
    'recorded',      true,
    'is_new_viewer', is_new_viewer,
    'unique_viewers', unique_total,
    'total_visits',  visit_total,
    'viewer_visits', my_visits
  );
end;
$$;

comment on function public.record_profile_view(uuid) is
  'Records a genuine profile visit for the caller. Self/blocked/missing targets are ignored. Atomic per-pair upsert.';

-- ---------------------------------------------------------------------------
-- 4. Owner-only summary (no owner id parameter)
-- ---------------------------------------------------------------------------
create or replace function public.profile_view_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  result jsonb;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'unique_viewers',    count(*)::int,
    'returning_viewers', count(*) filter (where v.view_count > 1)::int,
    'total_visits',      coalesce(sum(v.view_count), 0)::int,
    'most_recent_at',    max(v.last_viewed_at)
  )
  into result
  from public.profile_viewers v
  where v.viewed_id = me
    and not public.is_blocked_pair(me, v.viewer_id);

  return coalesce(
    result,
    jsonb_build_object(
      'unique_viewers', 0,
      'returning_viewers', 0,
      'total_visits', 0,
      'most_recent_at', null
    )
  );
end;
$$;

comment on function public.profile_view_summary() is
  'Unique/returning/total-visit aggregate for the CALLER''s own profile. No owner id is accepted.';

-- ---------------------------------------------------------------------------
-- 5. Owner-only viewer list (paginated, searchable; no owner id parameter)
-- ---------------------------------------------------------------------------
create or replace function public.list_profile_viewers(
  p_limit  integer default 30,
  p_offset integer default 0,
  p_search text    default null
)
returns table (
  viewer_id          uuid,
  first_name         text,
  last_name          text,
  has_last_name      boolean,
  username           text,
  display_name       text,
  avatar_url         text,
  is_online          boolean,
  first_viewed_at    timestamptz,
  last_viewed_at     timestamptz,
  view_count         integer,
  is_followed_by_me  boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me            uuid := auth.uid();
  limit_value    integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  offset_value   integer := greatest(coalesce(p_offset, 0), 0);
  search_value   text := nullif(btrim(coalesce(p_search, '')), '');
  search_escaped text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Treat LIKE metacharacters as literal text: searching "%" must not match
  -- everybody.
  search_escaped := replace(replace(replace(search_value, '\', '\\'), '%', '\%'), '_', '\_');

  return query
  select
    v.viewer_id,
    pp.first_name,
    pp.last_name,
    coalesce(pp.has_last_name, false),
    pp.username,
    pp.display_name,
    pp.avatar_url,
    coalesce(pp.is_online, false),
    v.first_viewed_at,
    v.last_viewed_at,
    v.view_count,
    exists (
      select 1
      from public.follows f
      where f.follower_id = me and f.following_id = v.viewer_id
    )
  from public.profile_viewers v
  join public.public_profiles pp on pp.id = v.viewer_id
  where v.viewed_id = me
    and not public.is_blocked_pair(me, v.viewer_id)
    and (
      search_value is null
      or pp.display_name ilike '%' || search_escaped || '%' escape '\'
      or pp.username     ilike '%' || search_escaped || '%' escape '\'
    )
  order by v.last_viewed_at desc, v.viewer_id
  limit limit_value offset offset_value;
end;
$$;

comment on function public.list_profile_viewers(integer, integer, text) is
  'Paginated viewer identities for the CALLER''s own profile only. Public fields only; blocked pairs excluded.';

-- ---------------------------------------------------------------------------
-- 6. Grants: authenticated only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.profile_view_count(uuid) from public, anon;
revoke all on function public.record_profile_view(uuid) from public, anon;
revoke all on function public.profile_view_summary() from public, anon;
revoke all on function public.list_profile_viewers(integer, integer, text) from public, anon;

grant execute on function public.profile_view_count(uuid) to authenticated;
grant execute on function public.record_profile_view(uuid) to authenticated;
grant execute on function public.profile_view_summary() to authenticated;
grant execute on function public.list_profile_viewers(integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Posture report: the table must have no client privileges
-- ---------------------------------------------------------------------------
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'profile_viewers'
order by grantee, privilege_type;
