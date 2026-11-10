-- ===========================================================================
-- 20261110010000_discover_performance.sql
-- M56 — Discovery engine performance optimization
--
-- WHY
--   discover_profiles() was the source of 4-6s Discovery load times and
--   occasional statement timeouts. Root causes:
--     1. The online-status CASE expression was duplicated 3x per row
--        (SELECT list, ORDER BY, p_online_only filter), each evaluating
--        a correlated EXISTS against presence_sessions.
--     2. auth.uid() was invoked inline 5+ times instead of being cached.
--     3. Multiple NOT EXISTS correlated subqueries against likes/matches
--        with no supporting indexes beyond the PK.
--     4. No pagination — load-more re-fetches from the start.
--     5. Missing indexes on profiles.age, gender, onboarding_completed,
--        is_suspended.
--
-- WHAT
--   1. Partial B-tree indexes on profiles for the discovery WHERE clause.
--   2. Index on blocked_users(blocker_id, blocked_user_id) for is_blocked_pair.
--   3. Refactor discover_profiles():
--        - Cache auth.uid() in a variable (single evaluation).
--        - Compute online status in a subquery (written once; referenced in
--          SELECT, ORDER BY, and the p_online_only filter — per-row evaluation
--          count depends on the planner, not guaranteed by the CTE alone).
--        - Add p_offset parameter for offset-based pagination.
--        - Preserve ALL existing business rules and return columns.
--   4. No RLS changes, no security mode changes.
--
-- SAFE TO RE-RUN: IF NOT EXISTS on indexes, DROP IF EXISTS + CREATE on function.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. PostGIS extension — required for geography type and ST_* functions
-- ---------------------------------------------------------------------------
-- M56 uses geography(Point, 4326), ST_SetSRID, ST_MakePoint and ST_Distance,
-- all provided by the PostGIS extension. Migration 20261105020000_postgis_location.sql
-- installs it, but we ensure it here so M56 is self-contained and idempotent.
-- PostGIS installs its types and functions into the public schema by default
-- (see 20261106000006_orbit_location_rpc_repair.sql), which is already on this
-- function's search_path (public, pg_temp). Guard creation so a Supabase project
-- without PostGIS available fails gracefully with a notice rather than a hard
-- error on the geography type declaration below.
do $$
begin
  create extension if not exists postgis;
exception when others then
  raise notice 'postgis extension unavailable in this environment - skipped';
end $$;

-- ---------------------------------------------------------------------------
-- 1. Indexes for discovery WHERE clause
-- ---------------------------------------------------------------------------

-- Age range filter: p.age between p_min_age and p_max_age
CREATE INDEX IF NOT EXISTS profiles_age_idx
  ON public.profiles (age)
  WHERE onboarding_completed = true
    AND coalesce(is_suspended, false) = false;

-- Gender filter: p.gender = any (p_genders)
CREATE INDEX IF NOT EXISTS profiles_gender_idx
  ON public.profiles (gender)
  WHERE onboarding_completed = true
    AND coalesce(is_suspended, false) = false;

-- Onboarding + suspension filter
CREATE INDEX IF NOT EXISTS profiles_onboarding_suspended_idx
  ON public.profiles (onboarding_completed, coalesce(is_suspended, false))
  WHERE onboarding_completed = true
    AND coalesce(is_suspended, false) = false;

-- Updated_at ordering: p.updated_at desc nulls last
CREATE INDEX IF NOT EXISTS profiles_updated_at_idx
  ON public.profiles (updated_at DESC NULLS LAST)
  WHERE onboarding_completed = true
    AND coalesce(is_suspended, false) = false;

-- ---------------------------------------------------------------------------
-- 2. Index for is_blocked_pair() — symmetric lookup on both directions
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS blocked_users_blocker_blocked_idx
  ON public.blocked_users (blocker_id, blocked_user_id);

CREATE INDEX IF NOT EXISTS blocked_users_blocked_blocker_idx
  ON public.blocked_users (blocked_user_id, blocker_id);

-- ---------------------------------------------------------------------------
-- 3. Refactored discover_profiles()
-- ---------------------------------------------------------------------------
--
-- NOTE: CREATE OR REPLACE FUNCTION cannot be used here. PostgreSQL rejects any
-- change to a function's parameter list under OR REPLACE, and this migration
-- adds a ninth parameter (p_offset). DROP FUNCTION is therefore required.
-- No database view, trigger, or other function depends on discover_profiles()
-- (it is invoked only as an RPC from the browser), so dropping and recreating
-- it breaks no dependent objects. Grants and the function comment are
-- re-established immediately after recreation.

drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float);
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer);

create function public.discover_profiles(
  p_min_age     integer default 18,
  p_max_age     integer default 99,
  p_genders     text[]  default null,
  p_limit       integer default 50,
  p_online_only boolean default false,
  p_exclude_ids uuid[]  default '{}',
  p_lat         float   default null,
  p_lng         float   default null,
  p_offset      integer default 0
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
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  user_point geography(Point, 4326);
begin
  -- Cache the caller's id once instead of invoking auth.uid() repeatedly.
  if me is null then
    return;
  end if;

  -- Only build the caller's geography point when both coordinates are supplied.
  if p_lat is not null and p_lng is not null then
    user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography(Point, 4326);
  end if;

  return query
  with candidate_online as (
    -- Compute online status in a subquery; referenced in SELECT, ORDER BY,
    -- and the p_online_only filter.
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
    case
      when user_point is not null and c.snapped_location is not null
      then ST_Distance(user_point, COALESCE(c.location, c.snapped_location))::float
    end as distance_meters
  from candidate_online c
  where coalesce(p_online_only, false) = false
     or c.computed_is_online = true
  order by
    c.computed_is_online desc,
    c.updated_at desc nulls last,
    c.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer) from public, anon;
grant execute on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer) to authenticated;

comment on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float, integer) is
  'Allow-listed discovery feed. Excludes already-decided/blocked/matched/non-public members, supports load-more exclusions and offset-based pagination (p_offset), ranks expiring online presence first, returns casual_intent and (optionally) distance_meters from the caller''s supplied location. Online status expression is written once in a CTE and referenced in SELECT, ORDER BY, and filter; whether the planner evaluates it once per candidate depends on the execution plan.';

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

do $$
begin
  raise notice 'M56: discover_profiles performance migration complete';
  raise notice '  Indexes added: profiles_age_idx, profiles_gender_idx, profiles_onboarding_suspended_idx, profiles_updated_at_idx';
  raise notice '  Indexes added: blocked_users_blocker_blocked_idx, blocked_users_blocked_blocker_idx';
  raise notice '  discover_profiles(): auth.uid() cached, online status computed in subquery, p_offset added';
end $$;
