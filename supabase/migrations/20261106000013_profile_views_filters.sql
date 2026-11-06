-- =============================================================================
# 20261106000013_profile_views_filters.sql
-- M50 — Repair list_profile_viewers() and add p_filter (all / new / repeated).
--
-- ROOT CAUSE
--   list_profile_viewers() projected columns from `public.public_profiles pp`
--   (pp.first_name, pp.last_name, pp.has_last_name, pp.is_online). The
--   public_profiles view's column set depends on which migration version was
--   applied to a given database, so in some deployments pp.first_name does not
--   exist and the RPC returns 400 "column pp.first_name does not exist".
--
-- FIX
--   The function is SECURITY DEFINER and derives the owner from auth.uid()
--   (the same pattern record_profile_view() already uses when it reads
--   public.profiles directly). Re-point the join at public.profiles, which
--   unconditionally exposes first_name, last_name, has_last_name and avatar_url,
--   and derive is_online inline so the result no longer depends on the
--   public_profiles view's column set at all.
--
-- Also add p_filter text default 'all' (all | new | repeated) so the frontend
-- can page through first-time visitors (view_count = 1) and returning visitors
-- (view_count > 1) without fetching every row.
--
-- SAFE TO RE-RUN: drop+create is idempotent, grants are idempotent.
-- =============================================================================

drop function if exists public.list_profile_viewers(integer, integer, text);

create function public.list_profile_viewers(
  p_limit  integer default 30,
  p_offset integer default 0,
  p_search text    default null,
  p_filter text    default 'all'
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
  limit_value   integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  offset_value  integer := greatest(coalesce(p_offset, 0), 0);
  search_value  text := nullif(btrim(coalesce(p_search, '')), '');
  search_escaped text;
  filter_value  text := case
    when p_filter in ('all', 'new', 'repeated') then p_filter
    else 'all'
  end;
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
    p.first_name,
    p.last_name,
    coalesce(p.has_last_name, false),
    p.username,
    p.display_name,
    p.avatar_url,
    case
      when coalesce(pref.show_online_status, true) = false then false
      when exists (
        select 1
        from public.presence_sessions ps
        where ps.user_id = p.id
          and ps.is_active = true
          and ps.expires_at > now()
      ) then true
      else false
    end as is_online,
    v.first_viewed_at,
    v.last_viewed_at,
    v.view_count,
    exists (
      select 1
      from public.follows f
      where f.follower_id = me and f.following_id = v.viewer_id
    )
  from public.profile_viewers v
  join public.profiles p on p.id = v.viewer_id
  left join public.user_preferences pref on pref.user_id = p.id
  where v.viewed_id = me
    and not public.is_blocked_pair(me, v.viewer_id)
    and (filter_value = 'all'
         or (filter_value = 'new'  and v.view_count = 1)
         or (filter_value = 'repeated' and v.view_count > 1))
    and (
      search_value is null
      or p.display_name ilike '%' || search_escaped || '%' escape '\'
      or p.username     ilike '%' || search_escaped || '%' escape '\'
    )
  order by v.last_viewed_at desc, v.viewer_id
  limit limit_value offset offset_value;
end;
$$;

comment on function public.list_profile_viewers(integer, integer, text, text) is
  'Paginated viewer identities for the CALLER''s own profile only. p_filter in all/new/repeated. Public fields only; blocked pairs excluded. Joins public.profiles directly so the result never depends on the public_profiles view column set.';

-- ---------------------------------------------------------------------------
-- Grants: authenticated only, never anon
-- ---------------------------------------------------------------------------
revoke all on function public.list_profile_viewers(integer, integer, text, text) from public, anon;
grant execute on function public.list_profile_viewers(integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Posture report: the table must have no client privileges
-- ---------------------------------------------------------------------------
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'profile_viewers'
order by grantee, privilege_type;
