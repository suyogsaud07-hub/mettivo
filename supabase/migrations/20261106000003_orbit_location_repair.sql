-- =============================================================================
-- M48 — Repair Live Orbit location saving and nearby-discovery RPCs
-- =============================================================================

-- Ensure the geography columns exist (defensive; they are added by M44).
-- PostGIS types live in the public schema (CREATE EXTENSION postgis), not an
-- `extensions` schema, so use unqualified GEOGRAPHY/GEOMETRY types.
alter table public.profiles
  add column if not exists location GEOGRAPHY(POINT, 4326);

alter table public.profiles
  add column if not exists snapped_location GEOGRAPHY(POINT, 4326);

alter table public.profiles
  add column if not exists last_location_update timestamptz;

-- Spatial index for the proximity search in get_orbit_profiles().
create index if not exists profiles_snapped_location_idx
  on public.profiles using GIST(snapped_location);

create index if not exists profiles_last_location_update_idx
  on public.profiles (last_location_update)
  where last_location_update is not null;

-- ---------------------------------------------------------------------------
-- 0. Ensure snap_location_to_grid exists (M48 calls this but didn't define it)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snap_location_to_grid(
  p_location GEOGRAPHY,
  p_grid_size_meters numeric DEFAULT 1000
)
RETURNS GEOGRAPHY
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  grid_size_degrees numeric := p_grid_size_meters / 111111.0;
  snapped_geom GEOMETRY;
BEGIN
  snapped_geom := ST_SnapToGrid(
    p_location::GEOMETRY,
    grid_size_degrees,
    grid_size_degrees,
    0,
    0
  );
  RETURN snapped_geom::GEOGRAPHY;
END;
$$;


-- ---------------------------------------------------------------------------
-- 1. update_location_snapped() — owner-scoped, validated, no missing columns
-- ---------------------------------------------------------------------------
create or replace function public.update_location_snapped(
  p_user_id uuid,
  p_latitude numeric,
  p_longitude numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  -- A member may save only their own location; never another member's.
  if p_user_id <> me then
    raise exception 'You can only update your own location' using errcode = '42501';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'Latitude and longitude are required' using errcode = '22023';
  end if;

  if p_latitude < -90 or p_latitude > 90 then
    raise exception 'Latitude must be between -90 and 90' using errcode = '22023';
  end if;

  if p_longitude < -180 or p_longitude > 180 then
    raise exception 'Longitude must be between -180 and 180' using errcode = '22023';
  end if;

  update public.profiles
  set
    location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
    snapped_location = public.snap_location_to_grid(
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
      1000
    ),
    last_location_update = now()
  where id = p_user_id;
end;
$$;

revoke all on function public.update_location_snapped(uuid, numeric, numeric) from public, anon;
grant execute on function public.update_location_snapped(uuid, numeric, numeric) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. get_orbit_profiles() — actually returns eligible nearby profiles
-- ---------------------------------------------------------------------------
create or replace function public.get_orbit_profiles(
  p_lat float,
  p_lng float,
  p_radius_km float default 10,
  p_min_age integer default 18,
  p_max_age integer default 99,
  p_gender text default null,
  p_online_only boolean default false,
  p_country text default null
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text,
  age integer,
  gender text,
  city text,
  country text,
  intention text,
  casual_intent text,
  bio text,
  is_online boolean,
  snapped_lat float,
  snapped_lng float,
  distance_meters float
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  user_point GEOGRAPHY(POINT, 4326);
begin
  if p_lat is null or p_lng is null then
    return;
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return;
  end if;

  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY(POINT, 4326);

  return query
  with scored as (
    select
      p.id,
      p.display_name,
      p.username,
      p.avatar_url,
      p.age,
      p.gender,
      p.city,
      p.country,
      p.intention,
      p.casual_intent,
      p.bio,
      -- Derived online state: active session or recent heartbeat, honouring
      -- show_online_status. The raw `is_online` boolean is deliberately not used
      -- because it is a stale manually-maintained flag.
      case
        when coalesce(pref.show_online_status, true) = false then false
        when exists (
          select 1
          from public.presence_sessions ps
          where ps.user_id = p.id
            and ps.is_active = true
            and ps.expires_at > now()
        ) then true
        when p.last_seen_at is not null
          then p.last_seen_at >= now() - interval '2 minutes'
        else coalesce(p.is_online, false)
      end as derived_online,
      ST_Y(p.snapped_location::GEOMETRY)::float as snapped_lat,
      ST_X(p.snapped_location::GEOMETRY)::float as snapped_lng,
      ST_Distance(user_point, p.snapped_location)::float as distance_meters
    from public.profiles p
    left join public.user_preferences pref on pref.user_id = p.id
    where
      -- The member must have shared a snapped location (location-sharing gate).
      p.snapped_location is not null
      -- Account must be active and onboarded.
      and p.onboarding_completed = true
      and (p.is_suspended is null or p.is_suspended = false)
      and (p.banned_until is null or p.banned_until > now())
      -- Visibility gate: hidden members never appear in discovery.
      and coalesce(pref.profile_visibility, 'public') = 'public'
      -- Optional profile filters (NULL-tolerant: incomplete optional fields never
      -- exclude a member who has a valid snapped location).
      and (p.age is null or (p.age between p_min_age and p_max_age))
      and (p_gender is null or p.gender = p_gender)
      and (p_country is null or p.country = p_country)
      -- Global discovery (>= 20000 km covers the whole earth); otherwise radius.
      and (
        p_radius_km >= 20000
        or ST_DWithin(user_point, p.snapped_location, p_radius_km * 1000)
      )
      -- Symmetric blocking in both directions.
      and not public.is_blocked_pair(auth.uid(), p.id)
      -- Never return the caller.
      and p.id <> auth.uid()
  )
  select
    scored.id as id,
    scored.display_name as display_name,
    scored.username as username,
    scored.avatar_url as avatar_url,
    scored.age as age,
    scored.gender as gender,
    scored.city as city,
    scored.country as country,
    scored.intention as intention,
    scored.casual_intent as casual_intent,
    scored.bio as bio,
    scored.derived_online as is_online,
    scored.snapped_lat as snapped_lat,
    scored.snapped_lng as snapped_lng,
    scored.distance_meters as distance_meters
  from scored
  where (p_online_only = false or derived_online = true)
  order by
    derived_online desc,
    distance_meters
  limit 100;
end;
$$;

revoke all on function public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text) from public, anon;
grant execute on function public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text) to authenticated;

-- Posture report
do $$
begin
  raise notice 'M48: Live Orbit location and discovery RPCs repaired';
end $$;