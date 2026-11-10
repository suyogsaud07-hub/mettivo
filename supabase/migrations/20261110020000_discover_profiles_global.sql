-- ===========================================================================
-- 20261110020000_discover_profiles_global.sql
-- M58 — Add GO GLOBAL to discover_profiles()
--
-- Extends `discover_profiles()` with two trailing parameters so callers can
-- opt out of the maximum-distance restriction:
--   p_max_distance_km float default null   -- distance cap in kilometres (local mode)
--   p_is_global   boolean default false    -- when true, bypasses the distance cap
--
-- LOCAL mode (p_is_global = false):
--   ST_DWithin(profile_location, caller_location, p_max_distance_km * 1000)
--   is applied against the profile's snapped (privacy-protected) location.
--   A missing caller location or missing distance cap fails closed (no rows)
--   so local discovery can never accidentally become a worldwide search.
--
-- GLOBAL mode (p_is_global = true):
--   The distance cap is bypassed; eligible profiles worldwide are returned.
--   Every non-geographic eligibility rule is unchanged: authentication,
--   profile visibility, onboarding, suspension, blocked-user exclusions,
--   already-swiped/liked exclusions, match exclusions, gender and age filters.
--   distance_meters is NULL when the caller's location is unavailable.
--
-- PostgreSQL does not allow CREATE OR REPLACE FUNCTION to change a function's
-- input parameter list, so the existing function is dropped and recreated.
-- No view, trigger, or other function depends on discover_profiles() (it is
-- invoked only as a browser RPC), so this breaks no dependent objects. Grants
-- and the function comment are re-established immediately after recreation.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

-- PostGIS is required for the geography type and ST_* functions. M56 ensures
-- it; we repeat it here so this file is self-contained. We never move or
-- reinstall PostGIS, and the search_path accounts for the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Remove any previously applied signature so re-running is a no-op. PostgreSQL
-- rejects CREATE OR REPLACE on a changed parameter list, so DROP + CREATE is
-- required; both the M56 9-parameter signature and this migration's 11-parameter
-- signature are dropped.
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer);
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer, float, boolean);

create function public.discover_profiles(
  p_min_age        integer default 18,
  p_max_age        integer default 99,
  p_genders        text[]  default null,
  p_limit          integer default 50,
  p_online_only    boolean default false,
  p_exclude_ids    uuid[]  default '{}',
  p_lat            float   default null,
  p_lng            float   default null,
  p_offset         integer default 0,
  p_max_distance_km float default null,
  p_is_global      boolean default false
)
returns table (
  id           uuid,
  first_name   text,
  last_name    text,
  username     text,
  display_name text,
  age          integer,
  gender       text,
  city         text,
  country      text,
  avatar_url   text,
  photos       text[],
  bio          text,
  intention    text,
  looking_for  text[],
  hobbies      text[],
  pets         text[],
  mbti         text,
  interests    text[],
  prompts      jsonb,
  casual_intent text,
  is_online    boolean,
  is_verified  boolean,
  distance_meters float
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  me uuid := auth.uid();
  user_point geography(Point, 4326);
begin
  if me is null then
    return;
  end if;

  -- Only build the caller's geography point when both coordinates are supplied.
  if p_lat is not null and p_lng is not null then
    user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography(Point, 4326);
  end if;

  return query
  with candidate_online as (
    -- Online status computed once per candidate in a subquery, referenced in
    -- SELECT, ORDER BY and the p_online_only filter.
    select
      p.*,
      case
        when coalesce(pref.show_online_status, true) = false then false
        when exists (
          select 1 from public.presence_sessions ps
          where ps.user_id = p.id
            and ps.is_active = true
            and ps.expires_at > now()
        ) then true
        when p.last_seen_at is not null
          then p.last_seen_at >= now() - interval '2 minutes'
        else coalesce(p.is_online, false)
      end as computed_is_online
    from public.profiles p
    left join public.user_preferences pref on pref.user_id = p.id
    where p.id <> me
      and p.onboarding_completed
      and coalesce(p.is_suspended, false) = false
      and coalesce(pref.profile_visibility, 'public') = 'public'
      and p.age between coalesce(p_min_age, 18) and coalesce(p_max_age, 99)
      and (p_genders is null or p.gender = any (p_genders))
      and not public.is_blocked_pair(me, p.id)
      and not (p.id = any (coalesce(p_exclude_ids, '{}'::uuid[])))
      and not exists (
        select 1 from public.likes l
        where l.liker_id = me and l.liked_id = p.id
      )
      and not exists (
        select 1 from public.matches m
        where (m.user_a = me and m.user_b = p.id)
           or (m.user_a = p.id and m.user_b = me)
      )
  )
  select
    c.id, c.first_name, c.last_name, c.username, c.display_name,
    c.age, c.gender, c.city, c.country, c.avatar_url, c.photos, c.bio,
    c.intention, c.looking_for, c.hobbies, c.pets, c.mbti, c.interests,
    c.prompts,
    c.casual_intent,
    c.computed_is_online as is_online,
    c.is_verified,
    -- Distance annotation only when both the caller and the profile have a
    -- location. NULL (never a failure) when location is unavailable.
    case
      when user_point is not null and c.snapped_location is not null
      then ST_Distance(user_point, COALESCE(c.location, c.snapped_location))::float
    end as distance_meters
  from candidate_online c
  where coalesce(p_online_only, false) = false
     or c.computed_is_online = true
    -- GO GLOBAL: local mode enforces the distance cap; global mode bypasses it.
    -- Local mode without a verifiable caller location or distance cap fails
    -- closed (no rows) -- it never silently becomes a worldwide search.
    and (
      p_is_global
      or (
        user_point is not null
        and p_max_distance_km is not null
        and ST_DWithin(COALESCE(c.location, c.snapped_location), user_point, p_max_distance_km * 1000)
      )
    )
  order by
    c.computed_is_online desc,
    c.updated_at desc nulls last,
    c.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer, float, boolean) from public, anon;
grant execute on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer, float, boolean) to authenticated;

comment on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer, float, boolean) is
  'Allow-listed discovery feed. Excludes already-decided/blocked/matched/non-public members, supports load-more exclusions and offset-based pagination (p_offset), ranks expiring online presence first, returns casual_intent and (optionally) distance_meters. p_max_distance_km caps the search radius in kilometres; p_is_global bypasses the distance cap for worldwide discovery. Local mode fails closed (no rows) when the caller location or distance cap is missing.';

do $$
begin
  raise notice 'M58: discover_profiles() extended with p_max_distance_km and p_is_global';
end $$;
