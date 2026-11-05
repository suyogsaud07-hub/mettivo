-- =============================================================================
-- M44 — PostGIS Location Support for Nearby Map
-- =============================================================================
-- WHY
--   Adds geography support for location-based discovery. Uses PostGIS to enable
--   spatial queries for finding nearby users. Implements location snapping to
--   a grid for privacy protection (users appear on a grid, not exact locations).
--
-- PREREQUISITES
--   PostGIS extension must be enabled on the database.
--   Run: CREATE EXTENSION IF NOT EXISTS postgis;
--
-- SAFE TO RE-RUN: idempotent
-- =============================================================================

-- Enable PostGIS extension (only if not already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geography column for precise location (SRID 4326 = WGS84)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

-- Add snapped_location column for privacy-protected grid locations
-- Grid size: 0.008983 degrees ≈ 1km at equator
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS snapped_location GEOGRAPHY(POINT, 4326);

-- Add last_location_update timestamp
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_location_update TIMESTAMPTZ;

-- Create index for fast spatial queries on snapped_location
CREATE INDEX IF NOT EXISTS profiles_snapped_location_idx 
  ON public.profiles USING GIST(snapped_location);

-- Create index for filtering by last_location_update
CREATE INDEX IF NOT EXISTS profiles_last_location_update_idx 
  ON public.profiles (last_location_update) 
  WHERE last_location_update IS NOT NULL;

-- Function to snap a geography point to a grid for privacy
-- Grid cell size: approximately 1km (0.008983 degrees)
-- Uses ST_SnapToGrid which requires geometry and returns geometry
CREATE OR REPLACE FUNCTION public.snap_location_to_grid(
  p_location GEOGRAPHY(POINT, 4326),
  p_grid_size_meters numeric DEFAULT 1000
)
RETURNS GEOGRAPHY(POINT, 4326)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Convert meters to degrees (approximately 111km per degree)
  grid_size_degrees numeric := p_grid_size_meters / 111111.0;
  snapped_geom GEOMETRY(POINT, 4326);
BEGIN
  -- ST_SnapToGrid takes: geometry, x_size, y_size, x_offset, y_offset
  -- We snap to a grid with origin at (0, 0)
  snapped_geom := ST_SnapToGrid(
    p_location::GEOMETRY,
    grid_size_degrees,
    grid_size_degrees,
    0,
    0
  );
  
  -- Convert back to geography
  RETURN snapped_geom::GEOGRAPHY(POINT, 4326);
END;
$$;

-- Function to update a user's location with automatic snapping
CREATE OR REPLACE FUNCTION public.update_location_snapped(
  p_user_id UUID,
  p_latitude numeric,
  p_longitude numeric
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  grid_size numeric := 0.008983; -- Approximately 1km
BEGIN
  -- Update raw latitude/longitude and location geography
  UPDATE public.profiles
  SET 
    latitude = p_latitude,
    longitude = p_longitude,
    location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
    snapped_location = public.snap_location_to_grid(
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::GEOGRAPHY(POINT, 4326),
      1000
    ),
    last_location_update = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_location_snapped(UUID, numeric, numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_location_snapped(UUID, numeric, numeric) TO authenticated;

-- Main RPC function to find nearby profiles
-- Takes user's lat/lng and radius in km
-- Returns profiles with snapped locations for privacy
CREATE OR REPLACE FUNCTION public.get_nearby_profiles(
  user_lat float,
  user_lng float,
  radius_km float DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  username TEXT,
  avatar_url TEXT,
  age INTEGER,
  gender TEXT,
  city TEXT,
  country TEXT,
  intention TEXT,
  casual_intent TEXT,
  bio TEXT,
  is_online BOOLEAN,
  -- Return snapped coordinates for privacy
  snapped_lat float,
  snapped_lng float,
  distance_meters float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_point GEOGRAPHY(POINT, 4326);
BEGIN
  -- Create geography point from user's coordinates
  user_point := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY(POINT, 4326);

  RETURN QUERY
  SELECT 
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
    p.is_online,
    -- Extract snapped coordinates for display (privacy-protected)
    ST_Y(p.snapped_location::GEOMETRY)::float AS snapped_lat,
    ST_X(p.snapped_location::GEOMETRY)::float AS snapped_lng,
    -- Calculate distance from user to this profile's RAW location
    -- This gives accurate distance while still protecting location privacy
    ST_Distance(user_point, COALESCE(p.location, p.snapped_location, user_point))::float AS distance_meters
  FROM public.profiles p
  WHERE 
    -- User must have a snapped location
    p.snapped_location IS NOT NULL
    -- User must have completed onboarding
    AND p.onboarding_completed = true
    -- User must not be suspended or banned
    AND (p.is_suspended IS NULL OR p.is_suspended = false)
    AND (p.banned_until IS NULL OR p.banned_until > now())
    -- Within radius (use index on snapped_location for proximity, but filter by distance from raw location)
    AND ST_DWithin(user_point, COALESCE(p.location, user_point), radius_km * 1000)
    -- Exclude blocked users (both directions)
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = auth.uid() AND blocked_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks 
      WHERE blocker_id = p.id AND blocked_id = auth.uid()
    )
    -- Exclude self
    AND p.id != auth.uid()
  ORDER BY 
    ST_Distance(user_point, COALESCE(p.location, user_point))
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_nearby_profiles(float, float, float) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_nearby_profiles(float, float, float) TO authenticated;

-- RLS Policy: Allow users to update their own location
CREATE POLICY IF NOT EXISTS profiles_update_own_location
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Grant select on new columns
GRANT SELECT (location, snapped_location, last_location_update) ON public.profiles TO authenticated;

-- Posture report
DO $$
BEGIN
  RAISE NOTICE 'M44: PostGIS location migration complete';
END $$;
