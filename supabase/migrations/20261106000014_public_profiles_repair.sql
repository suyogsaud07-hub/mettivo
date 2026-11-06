-- =============================================================================
# 20261106000014_public_profiles_repair.sql
-- M51 — Repair public.public_profiles so it exposes first_name / last_name /
-- has_last_name.
--
-- ROOT CAUSE
--   `public.public_profiles` is recreated by several migrations (M6, M29, M43,
--   M44, M66, M67). The M6 and M29 definitions predate the `first_name`,
--   `last_name` and `has_last_name` columns, so on any deployment whose view is
--   stuck at one of those older shapes, a `select ... first_name ... from
--   public_profiles` fails with `42703 undefined_column` (PostgREST surfaces it
--   as a 400 "column public_profiles.first_name does not exist"). The
--   `list_profile_viewers()` RPC (M47) projected `pp.first_name` / `pp.last_name`
--   / `pp.has_last_name` / `pp.is_online` from the view, which is exactly where
--   the reported 400 originates.
--
--   The frontend (`src/lib/public-profiles.ts`) already degrades gracefully via
--   `isMissingColumnError` fallbacks, but a missing-column failure still turns
--   every public profile into a degraded load with null names — the view itself
--   must be corrected.
--
-- FIX
--   1. Make `list_profile_viewers()` read from `public.profiles` directly
--      (the same pattern `record_profile_view()` already uses), removing its
--      dependency on the view so the view can be dropped/recreated safely.
--      This is idempotent with the prior `20261106000013` migration and adds
--      the `p_filter` (all / new / repeated) parameter.
--   2. Recreate `public.public_profiles` with `first_name`, `last_name`,
--      `has_last_name` plus every column the current consumers read
--      (`PUBLIC_PROFILE_COLUMNS` in src/lib/public-profiles.ts). Modelled on
--      the latest view definition (M67), including session-based `is_online`.
--   3. Re-apply `grant select to authenticated` / `revoke all from anon`.
--
-- SAFE TO RE-RUN: `drop function if exists`, `drop view if exists`,
-- `create or replace function`, `create view`, grants are all idempotent.
-- `DROP VIEW` (no CASCADE) is safe here because step 1 removes the only SQL
-- object that depends on the view (`list_profile_viewers`); frontend reads go
-- through the PostgREST client, not a database function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove list_profile_viewers' dependency on the public_profiles view.
--    The M47 signature (integer, integer, text) projected pp.* from the view.
--    Replace it with a signature that reads public.profiles directly and add
--    p_filter. Idempotent with 20261106000013.
-- ---------------------------------------------------------------------------
drop function if exists public.list_profile_viewers(integer, integer, text);

create or replace function public.list_profile_viewers(
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
  'Paginated viewer identities for the CALLER''s own profile only. p_filter in all/new/repeated. Public fields only; blocked pairs excluded. Reads public.profiles directly so the result never depends on the public_profiles view column set.';

revoke all on function public.list_profile_viewers(integer, integer, text, text) from public, anon;
grant execute on function public.list_profile_viewers(integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Repair the view: expose first_name / last_name / has_last_name plus every
--    column the public-profile consumers read. With step 1 complete, no SQL
--    object depends on this view, so DROP VIEW (no CASCADE) is safe.
-- ---------------------------------------------------------------------------
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  p.id,
  p.first_name,
  p.last_name,
  p.has_last_name,
  p.username,
  p.display_name,
  p.age,
  p.gender,
  p.city,
  p.country,
  p.avatar_url,
  p.photos,
  p.bio,
  p.intention,
  p.looking_for,
  p.hobbies,
  p.pets,
  p.mbti,
  p.religion,
  p.drinking,
  p.smoking,
  p.interests,
  p.prompts,
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
  p.is_verified,
  p.onboarding_completed,
  p.updated_at,
  p.followers_count,
  p.following_count,
  p.matches_count,
  p.profile_likes_count
from public.profiles p
left join public.user_preferences pref on pref.user_id = p.id;

comment on view public.public_profiles is
  'Allow-listed public projection of profiles. Exposes first_name / last_name / has_last_name. Excludes birth_date and other private fields. Includes the aggregate social counters. Reads public.profiles directly.';

-- Only signed-in members may read the projection.
grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- ---------------------------------------------------------------------------
-- 3. Posture report
-- ---------------------------------------------------------------------------
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'public_profiles'
order by grantee, privilege_type;

select count(*) as dependent_objects
from pg_depend d
join pg_class c on c.oid = d.refobjid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'public_profiles'
  and d.deptype in ('n', 'i');
