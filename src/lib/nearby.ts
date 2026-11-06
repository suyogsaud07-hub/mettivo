import { supabase } from './supabase';

/**
 * Profile data returned from the location-based RPCs.
 * Note: The RPC returns SNAPPED locations for privacy protection.
 */
export interface OrbitProfile {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  intention: string | null;
  casualIntent: string | null;
  bio: string | null;
  isOnline: boolean | null;
  snappedLat: number | null;
  snappedLon: number | null;
  distanceMeters: number;
}

/**
 * NearbyProfile is identical to OrbitProfile for now.
 */
export type NearbyProfile = OrbitProfile;

/**
 * Options for fetching nearby profiles (for the old map)
 */
export interface NearbyProfilesOptions {
  latitude: number;
  longitude: number;
  radiusKm?: number;
  limit?: number;
  casualIntent?: string | null;
}

/**
 * Options for fetching orbit profiles with advanced filters
 */
export interface OrbitProfilesOptions {
  latitude: number;
  longitude: number;
  radiusKm?: number | 'global';
  minAge?: number;
  maxAge?: number;
  gender?: string | null;
  onlineOnly?: boolean;
  country?: string | null;
  limit?: number;
}

/**
 * Fetch nearby profiles from the RPC
 */
export async function fetchNearbyProfiles(
  options: NearbyProfilesOptions
): Promise<{ profiles: NearbyProfile[]; error: string | null }> {
  const { latitude, longitude, radiusKm = 10, limit = 100, casualIntent } = options;

  try {
    const { data, error } = await supabase.rpc('get_nearby_profiles', {
      user_lat: latitude,
      user_lng: longitude,
      radius_km: radiusKm,
    });

    if (error) throw error;
    if (!data || !Array.isArray(data)) return { profiles: [], error: null };

    const profiles: NearbyProfile[] = data.map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      displayName: String(row.display_name ?? 'Member'),
      username: row.username ? String(row.username) : null,
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      age: typeof row.age === 'number' ? row.age : null,
      gender: row.gender ? String(row.gender) : null,
      city: row.city ? String(row.city) : null,
      country: row.country ? String(row.country) : null,
      intention: row.intention ? String(row.intention) : null,
      casualIntent: row.casual_intent ? String(row.casual_intent) : null,
      bio: row.bio ? String(row.bio) : null,
      isOnline: typeof row.is_online === 'boolean' ? row.is_online : null,
      snappedLat: typeof row.snapped_lat === 'number' ? row.snapped_lat : null,
      snappedLon: typeof row.snapped_lng === 'number' ? row.snapped_lng : null,
      distanceMeters: typeof row.distance_meters === 'number' ? row.distance_meters : 0,
    }));

    const filteredProfiles = casualIntent
      ? profiles.filter((p) => p.casualIntent === casualIntent)
      : profiles;

    return { profiles: filteredProfiles.slice(0, limit), error: null };
  } catch (err) {
    return { profiles: [], error: err instanceof Error ? err.message : 'Failed to fetch nearby profiles' };
  }
}

/**
 * Fetch orbit profiles with advanced filtering from the RPC
 */
export async function fetchOrbitProfiles(
  options: OrbitProfilesOptions
): Promise<{ profiles: OrbitProfile[]; error: string | null }> {
  const {
    latitude,
    longitude,
    radiusKm = 'global',
    minAge = 18,
    maxAge = 99,
    gender = null,
    onlineOnly = false,
    country = null,
    limit = 100,
  } = options;

  try {
    const { data, error } = await supabase.rpc('get_orbit_profiles', {
      p_lat: latitude,
      p_lng: longitude,
      p_radius_km: radiusKm === 'global' ? 20000 : radiusKm,
      p_min_age: minAge,
      p_max_age: maxAge,
      p_gender: gender,
      p_online_only: onlineOnly,
      p_country: country,
    });

    if (error) throw error;
    if (!data || !Array.isArray(data)) return { profiles: [], error: null };

    const profiles: OrbitProfile[] = data.map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      displayName: String(row.display_name ?? 'Member'),
      username: row.username ? String(row.username) : null,
      avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
      age: typeof row.age === 'number' ? row.age : null,
      gender: row.gender ? String(row.gender) : null,
      city: row.city ? String(row.city) : null,
      country: row.country ? String(row.country) : null,
      intention: row.intention ? String(row.intention) : null,
      casualIntent: row.casual_intent ? String(row.casual_intent) : null,
      bio: row.bio ? String(row.bio) : null,
      isOnline: typeof row.is_online === 'boolean' ? row.is_online : null,
      snappedLat: typeof row.snapped_lat === 'number' ? row.snapped_lat : null,
      snappedLon: typeof row.snapped_lng === 'number' ? row.snapped_lng : null,
      distanceMeters: typeof row.distance_meters === 'number' ? row.distance_meters : 0,
    }));

    return { profiles: profiles.slice(0, limit), error: null };
  } catch (err) {
    return { profiles: [], error: err instanceof Error ? err.message : 'Failed to fetch orbit profiles' };
  }
}

/**
 * Update the current user's location
 */
export async function updateUserLocation(
  latitude: number,
  longitude: number
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase.rpc('update_location_snapped', {
      p_user_id: user.id,
      p_latitude: latitude,
      p_longitude: longitude,
    });

    if (error) throw error;
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update location' };
  }
}

/**
 * Get the current user's snapped location from their profile.
 *
 * Only `snapped_location` is selected: `latitude` and `longitude` are not
 * granted to `authenticated` at column level (see migration
 * `20261105020000_postgis_location.sql`), so selecting them produces a 403/400.
 * Discovery data must come through `discover_profiles()` instead.
 */
export async function getUserLocation(): Promise<{
  snappedLatitude: number | null;
  snappedLongitude: number | null;
  error: string | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { snappedLatitude: null, snappedLongitude: null, error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('profiles')
      .select('snapped_location')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { snappedLatitude: null, snappedLongitude: null, error: null };

    // snapped_location is a GEOGRAPHY(POINT); PostGIS extraction requires SQL,
    // not JS. Return null here — callers should use discover_profiles() for
    // distance-annotated candidates.
    return { snappedLatitude: null, snappedLongitude: null, error: null };
  } catch (err) {
    return { snappedLatitude: null, snappedLongitude: null, error: err instanceof Error ? err.message : 'Failed to get location' };
  }
}

/**
 * Get current position from browser's Geolocation API
 */
export function getBrowserLocation(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

/**
 * Format distance in meters to a human-readable string
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}