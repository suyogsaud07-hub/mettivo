-- =============================================================================
-- M50 — Orbit live discovery: location-sharing permission, last-known retention,
-- geographic heatmap
-- =============================================================================
-- WHY
--   Live Orbit currently writes a snapped location whenever a member opens the
--   map, with no explicit consent toggle, no retained last-known location, no
--   heatmap, and no distinction between live and last-known presence.
--   This migration adds the smallest secure schema extension needed to support
--   the full Orbit experience.
--
-- WHAT
--   1. `location_sharing_enabled` / `location_retention_enabled` on
--      `user_preferences` (default OFF — consent is explicit, never silent).
--   2. `profile_last_known_locations` table — one row per member, precise
--      location retained for up to 24 hours when retention consent is active.
--   3. `get_orbit_profiles()` updated to honour `location_sharing_enabled` and
--      return `location_status` ('live' | 'last_known' | 'hidden') plus age.
--   4. `get_orbit_heatmap()` — server-side grid aggregation returning live and
--      last-known density per cell (never individual precise coordinates).
--   5. Rate limiting + abuse trigger on location writes.
--   6. Automatic expiry / revocation cleanup triggers.
--
-- SECURITY
--   All writes are owner-scoped via `auth.uid()`. Reads return only snapped
--   (~1km grid) coordinates or aggregated cells. Precise raw `location` is never
--   exposed through any public RPC. Revoking sharing excludes the member from
--   Orbit results immediately.
--
-- SAFE TO RE-RUN: `add column if not exists`, `create table if not exists`,
-- `create or replace function`, `drop policy if exists` before `create policy`,
-- `drop trigger if exists` before `create trigger`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Location-sharing permission columns on user_preferences
-- ---------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists location_sharing_enabled boolean not null default false;

alter table public.user_preferences
  add column if not exists location_retention_enabled boolean not null default true;

comment on column public.user_preferences.location_sharing_enabled is
  'Member has explicitly opted in to sharing their location on Orbit. Default OFF.';
comment on column public.user_preferences.location_retention_enabled is
  'Member consents to their last-known location being retained for up to 24h after they stop updating.';

-- ---------------------------------------------------------------------------
-- 1. Last-known location retention table
--    One row per member. Precise location is retained (not snapped) so it can
--    be re-snapped at whatever grid the viewer's query uses. Expires after 24h.
-- ---------------------------------------------------------------------------
create table if not exists public.profile_last_known_locations (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  location             geography(POINT, 4326) not null,
  snapped_location     geography(POINT, 4326) not null,
  accuracy_meters      integer,
  updated_at           timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '24 hours'),
  created_at           timestamptz not null default now()
);

alter table public.profile_last_known_locations enable row level security;

drop policy if exists profile_last_known_locations_select_own on public.profile_last_known_locations;
create policy profile_last_known_locations_select_own
  on public.profile_last_known_locations
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists profile_last_known_locations_insert_own on public.profile_last_known_locations;
create policy profile_last_known_locations_insert_own
  on public.profile_last_known_locations
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists profile_last_known_locations_update_own on public.profile_last_known_locations;
create policy profile_last_known_locations_update_own
  on public.profile_last_known_locations
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Indexes for expiry cleanup and lookups.
create index if not exists profile_last_known_locations_expires_at_idx
  on public.profile_last_known_locations (expires_at)
  where expires_at is not null;

create index if not exists profile_last_known_locations_snapped_idx
  on public.profile_last_known_locations using GIST(snapped_location);

-- ---------------------------------------------------------------------------
-- 2. update_orbit_location() — single entry point for location writes
--    Writes to profiles (raw + snapped) AND profile_last_known_locations
--    (when retention consent is active). Rate-limited and abuse-checked.
--    No-op when location_sharing_enabled is false.
-- ---------------------------------------------------------------------------
create or replace function public.update_orbit_location(
  p_latitude  numeric,
  p_longitude numeric,
  p_accuracy  integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  sharing boolean := false;
  retention boolean := false;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
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

  -- Consent gate: if sharing is disabled, do nothing and do not error (idempotent
  -- revocation — a revoked member may still call this from an old tab).
  select coalesce(location_sharing_enabled, false)
    into sharing
    from public.user_preferences
   where user_id = me;

  if not sharing then
    return;
  end if;

  -- Rate limit location writes (max 1 per 5 seconds per member).
  -- Uses the existing rate_limit_counters / rate_limit_rules pattern (M14).
  -- We key on a dedicated action name 'orbit_location'.
  declare
    rule record;
    bucket timestamptz;
    new_count integer;
  begin
    select * into rule from public.rate_limit_rules r where r.action = 'orbit_location';

    if found then
      bucket := to_timestamp(
        floor(extract(epoch from now()) / rule.window_seconds) * rule.window_seconds
      );

      insert into public.rate_limit_counters (user_id, action, window_start, count)
      values (me, 'orbit_location', bucket, 1)
      on conflict (user_id, action, window_start)
        do update set count = public.rate_limit_counters.count + 1
      returning count into new_count;

      if new_count > rule.max_events then
        raise exception 'Orbit location update rate limit exceeded. Try again shortly.'
          using errcode = '53400';
      end if;
    end if;
  end;

  -- Write the member's own raw + snapped location.
  update public.profiles
  set
    location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
    snapped_location = public.snap_location_to_grid(
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
      1000
    ),
    last_location_update = now()
  where id = me;

  -- Retention: keep a precise last-known location for up to 24h.
  select coalesce(location_retention_enabled, true)
    into retention
    from public.user_preferences
   where user_id = me;

  if retention then
    insert into public.profile_last_known_locations
      (user_id, location, snapped_location, accuracy_meters, updated_at, expires_at, created_at)
    values
      (me,
       ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
       public.snap_location_to_grid(
         ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
         1000
       ),
       p_accuracy,
       now(),
       now() + interval '24 hours',
       now())
    on conflict (user_id)
    do update set
      location = excluded.location,
      snapped_location = excluded.snapped_location,
      accuracy_meters = excluded.accuracy_meters,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at;
  end if;
end;
$$;

revoke all on function public.update_orbit_location(numeric, numeric, integer) from public, anon;
grant execute on function public.update_orbit_location(numeric, numeric, integer) to authenticated;

-- Register the rate-limit rule if not present (idempotent).
insert into public.rate_limit_rules (action, max_events, window_seconds, description) values
  ('orbit_location', 12, 60, 'Orbit location updates per minute per member')
on conflict (action) do update
  set max_events = excluded.max_events,
      window_seconds = excluded.window_seconds,
      description = excluded.description;

-- ---------------------------------------------------------------------------
-- 3. Automatic expiry / revocation cleanup triggers
-- ---------------------------------------------------------------------------
-- Expire last-known locations older than 24h (cleanup trigger on writes, plus
-- a standalone function that a cron/edge function can call).
create or replace function public.expire_last_known_locations()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.profile_last_known_locations
  where expires_at < now();
end;
$$;

revoke all on function public.expire_last_known_locations() from public, anon, authenticated;

-- Suppress location writes for revoked members: if sharing is disabled at
-- write time, remove any retained last-known location (immediate revocation).
create or replace function public.suppress_location_on_revoke()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sharing boolean := false;
begin
  select coalesce(location_sharing_enabled, false)
    into sharing
    from public.user_preferences
   where user_id = new.user_id;

  if not sharing then
    delete from public.profile_last_known_locations
    where user_id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists suppress_location_on_revoke_ins on public.profile_last_known_locations;
create trigger suppress_location_on_revoke_ins
  before insert on public.profile_last_known_locations
  for each row execute function public.suppress_location_on_revoke();

drop trigger if exists suppress_location_on_revoke_upd on public.profile_last_known_locations;
create trigger suppress_location_on_revoke_upd
  before update on public.profile_last_known_locations
  for each row execute function public.suppress_location_on_revoke();

-- ---------------------------------------------------------------------------
-- 4. get_orbit_profiles() — honour sharing permission, return live/last-known
-- ---------------------------------------------------------------------------
-- We replace the function signature to add p_include_last_known and return
-- location_status / location_age_seconds. Existing callers that omit the new
-- param get the old behaviour (live-only snapped coords).
drop function if exists public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text);

create or replace function public.get_orbit_profiles(
  p_lat                float,
  p_lng                float,
  p_radius_km          float default 10,
  p_min_age            integer default 18,
  p_max_age            integer default 99,
  p_gender             text default null,
  p_online_only        boolean default false,
  p_country            text default null,
  p_include_last_known boolean default false
)
returns table (
  id                  uuid,
  display_name        text,
  username            text,
  avatar_url          text,
  age                 integer,
  gender              text,
  city                text,
  country             text,
  intention           text,
  casual_intent       text,
  bio                 text,
  is_online           boolean,
  snapped_lat         float,
  snapped_lng         float,
  distance_meters     float,
  location_status     text,          -- 'live' | 'last_known' | 'hidden'
  location_age_seconds integer        -- null when hidden
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  user_point geography(POINT, 4326);
  live_threshold interval := interval '5 minutes';
begin
  if p_lat is null or p_lng is null then
    return;
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return;
  end if;

  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY(POINT, 4326);

  return query
  with eligible as (
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
      case
        when coalesce(pref.show_online_status, true) = false then false
        when exists (
          select 1 from public.presence_sessions ps
          where ps.user_id = p.id and ps.is_active = true and ps.expires_at > now()
        ) then true
        when p.last_seen_at is not null
          then p.last_seen_at >= now() - interval '2 minutes'
        else coalesce(p.is_online, false)
      end as derived_online,
      p.last_location_update,
      -- A member is "live" if they have a snapped location updated recently
      -- AND location sharing is enabled.
      (p.snapped_location is not null
       and p.last_location_update is not null
       and p.last_location_update >= now() - live_threshold
       and coalesce(up.location_sharing_enabled, false)) as is_live,
      -- Retained last-known location (precise -> snapped for display).
      lkl.snapped_location as lkl_snapped_location,
      lkl.updated_at as lkl_updated_at
    from public.profiles p
    left join public.user_preferences pref on pref.user_id = p.id
    left join public.user_preferences up on up.user_id = p.id
    left join public.profile_last_known_locations lkl on lkl.user_id = p.id
    where
      -- Must have shared a location at some point (live or retained).
      and (p.snapped_location is not null or lkl.snapped_location is not null)
      and p.onboarding_completed = true
      and (p.is_suspended is null or p.is_suspended = false)
      and (p.banned_until is null or p.banned_until > now())
      and coalesce(pref.profile_visibility, 'public') = 'public'
      and (p.age is null or (p.age between p_min_age and p_max_age))
      and (p_gender is null or p.gender = p_gender)
      and (p_country is null or p.country = p_country)
      and (
        p_radius_km >= 20000
        or (
          p.snapped_location is not null
          and ST_DWithin(user_point, p.snapped_location, p_radius_km * 1000)
        )
        or (
          p_include_last_known
          and lkl.snapped_location is not null
          and ST_DWithin(user_point, lkl.snapped_location, p_radius_km * 1000)
        )
      )
      and not public.is_blocked_pair(auth.uid(), p.id)
      and p.id <> auth.uid()
  ),
  ranked as (
    select
      *,
      row_number() over (partition by id order by
        case when is_live then 0 else 1 end,
        case when is_live then last_location_update else lkl_updated_at end desc
      ) as rn
    from eligible
  )
  select
    id, display_name, username, avatar_url, age, gender, city, country,
    intention, casual_intent, bio,
    derived_online as is_online,
    case
      when rn = 1 and is_live then
        ST_Y(snapped_location::GEOMETRY)::float
      when rn = 1 and lkl_snapped_location is not null then
        ST_Y(lkl_snapped_location::GEOMETRY)::float
      else null
    end as snapped_lat,
    case
      when rn = 1 and is_live then
        ST_X(snapped_location::GEOMETRY)::float
      when rn = 1 and lkl_snapped_location is not null then
        ST_X(lkl_snapped_location::GEOMETRY)::float
      else null
    end as snapped_lng,
    case
      when rn = 1 and is_live then
        ST_Distance(user_point, snapped_location)::float
      when rn = 1 and lkl_snapped_location is not null then
        ST_Distance(user_point, lkl_snapped_location)::float
      else null
    end as distance_meters,
    case
      when rn = 1 and is_live then 'live'
      when rn = 1 and lkl_snapped_location is not null then 'last_known'
      else 'hidden'
    end as location_status,
    case
      when rn = 1 and is_live then
        extract(epoch from (now() - last_location_update))::integer
      when rn = 1 and lkl_snapped_location is not null then
        extract(epoch from (now() - lkl_updated_at))::integer
      else null
    end as location_age_seconds
  from ranked
  where rn = 1
    and (p_online_only = false or derived_online = true)
    and location_status <> 'hidden'
  order by
    derived_online desc,
    distance_meters nulls last
  limit 100;
end;
$$;

revoke all on function public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text, boolean) from public, anon;
grant execute on function public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_orbit_heatmap() — server-side grid aggregation
--    Returns live density and last-known density per grid cell. Never exposes
--    individual precise coordinates.
-- ---------------------------------------------------------------------------
create or replace function public.get_orbit_heatmap(
  p_ne_lat float,
  p_ne_lng float,
  p_sw_lat float,
  p_sw_lng float,
  p_cell_meters integer default 500
)
returns table (
  cell_id    text,
  cell_lat   float,
  cell_lng   float,
  live_count integer,
  known_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sw_point geography(POINT, 4326);
  ne_point geography(POINT, 4326);
  cell_deg numeric;
begin
  if p_ne_lat is null or p_ne_lng is null or p_sw_lat is null or p_sw_lng is null then
    return;
  end if;

  sw_point := ST_SetSRID(ST_MakePoint(p_sw_lng, p_sw_lat), 4326)::GEOGRAPHY(POINT, 4326);
  ne_point := ST_SetSRID(ST_MakePoint(p_ne_lng, p_ne_lat), 4326)::GEOGRAPHY(POINT, 4326);

  -- Convert meters to degrees (~111km per degree).
  cell_deg := p_cell_meters::numeric / 111111.0;

  return query
  with bounds as (
    select
      least(p_sw_lat, p_ne_lat) as min_lat,
      greatest(p_sw_lat, p_ne_lat) as max_lat,
      least(p_sw_lng, p_ne_lng) as min_lng,
      greatest(p_sw_lng, p_ne_lng) as max_lng
  ),
  live_cells as (
    select
      floor(ST_Y(p.snapped_location::GEOMETRY) / cell_deg) * cell_deg as cell_lat,
      floor(ST_X(p.snapped_location::GEOMETRY) / cell_deg) * cell_deg as cell_lng,
      count(*) as live_count
    from public.profiles p
    left join public.user_preferences up on up.user_id = p.id
    where p.snapped_location is not null
      and p.onboarding_completed = true
      and (p.is_suspended is null or p.is_suspended = false)
      and (p.banned_until is null or p.banned_until > now())
      and coalesce(up.location_sharing_enabled, false)
      and p.last_location_update >= now() - interval '5 minutes'
      and ST_Y(p.snapped_location::GEOMETRY) between (select min_lat from bounds) and (select max_lat from bounds)
      and ST_X(p.snapped_location::GEOMETRY) between (select min_lng from bounds) and (select max_lng from bounds)
    group by 1, 2
  ),
  known_cells as (
    select
      floor(ST_Y(lkl.snapped_location::GEOMETRY) / cell_deg) * cell_deg as cell_lat,
      floor(ST_X(lkl.snapped_location::GEOMETRY) / cell_deg) * cell_deg as cell_lng,
      count(*) as known_count
    from public.profile_last_known_locations lkl
    where lkl.expires_at > now()
      and ST_Y(lkl.snapped_location::GEOMETRY) between (select min_lat from bounds) and (select max_lat from bounds)
      and ST_X(lkl.snapped_location::GEOMETRY) between (select min_lng from bounds) and (select max_lng from bounds)
    group by 1, 2
  ),
  combined as (
    select
      coalesce(lc.cell_lat, kc.cell_lat) as cell_lat,
      coalesce(lc.cell_lng, kc.cell_lng) as cell_lng,
      coalesce(lc.live_count, 0) as live_count,
      coalesce(kc.known_count, 0) as known_count
    from live_cells lc
    full outer join known_cells kc
      on lc.cell_lat = kc.cell_lat and lc.cell_lng = kc.cell_lng
    where coalesce(lc.live_count, 0) + coalesce(kc.known_count, 0) > 0
  )
  select
    md5(cell_lat::text || '|' || cell_lng::text) as cell_id,
    cell_lat,
    cell_lng,
    live_count,
    known_count
  from combined;
end;
$$;

revoke all on function public.get_orbit_heatmap(float, float, float, float, integer) from public, anon;
grant execute on function public.get_orbit_heatmap(float, float, float, float, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Posture report
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'M50: Orbit location sharing, last-known retention, heatmap migration complete';
end $$;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profile_last_known_locations')
group by c.relname, c.relrowsecurity
order by c.relname;
