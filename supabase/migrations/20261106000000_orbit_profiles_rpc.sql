-- =============================================================================
-- M47 — Live Orbit Profiles RPC with Advanced Filtering
-- =============================================================================
-- WHY
--   Replaces the basic get_nearby_profiles with get_orbit_profiles that supports
--   comprehensive filtering: age range, gender, online status, country, and global search.
--
-- PREREQUISITES
--   PostGIS extension must be enabled
--   run: CREATE EXTENSION IF NOT EXISTS postgis;
--
-- SAFE TO RE-RUN: Drops old function and creates new one
-- =============================================================================

-- Drop the old function if it exists
DROP FUNCTION IF EXISTS public.get_nearby_profiles(float, float, float);

-- Create the new advanced filtering function for Live Orbit
CREATE OR REPLACE FUNCTION public.get_orbit_profiles(
  p_lat float,
  p_lng float,
  p_radius_km float DEFAULT 10,
  p_min_age integer DEFAULT 18,
  p_max_age integer DEFAULT 99,
  p_gender text DEFAULT NULL,
  p_online_only boolean DEFAULT false,
  p_country text DEFAULT NULL
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
  user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY(POINT, 4326);

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
    -- Extract snapped coordinates for privacy (already snapped in snapped_location)
    ST_Y(p.snapped_location::GEOMETRY)::float AS snapped_lat,
    ST_X(p.snapped_location::GEOMETRY)::float AS snapped_lng,
    -- Calculate distance from user to this profile's RAW location
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
    -- Age range filter
    AND (p.age IS NULL OR (p.age BETWEEN p_min_age AND p_max_age))
    -- Gender filter (if specified)
    AND (p_gender IS NULL OR p_gender = p_gender)
    -- Online status filter
    AND (p_online_only = false OR p.is_online = true)
    -- Country filter (if specified)
    AND (p_country IS NULL OR p.country = p_country)
    -- Within radius (use index on snapped_location for proximity)
    -- For global search (20000km), we skip the distance filter since it's essentially unlimited
    AND (
      p_radius_km >= 20000 
      OR ST_DWithin(user_point, COALESCE(p.location, p.snapped_location, user_point), p_radius_km * 1000)
    )
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
    -- Online users first
    CASE WHEN p.is_online THEN 0 ELSE 1 END,
    -- Then by distance
    ST_Distance(user_point, COALESCE(p.location, p.snapped_location, user_point))
  LIMIT 100;
END;
$$;

-- Grant execute permission to authenticated users only
REVOKE ALL ON FUNCTION public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_orbit_profiles(float, float, float, integer, integer, text, boolean, text) TO authenticated;

-- Posture report
DO $$
BEGIN
  RAISE NOTICE 'M47: Live Orbit profiles RPC migration complete';
END $$;
