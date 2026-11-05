/**
 * Nearby Location Functions
 *
 * Handles fetching nearby profiles and location-based operations.
 * Uses the PostGIS RPC functions with privacy-protected grid snapping.
 */

import { supabase } from './supabase';

/**
 * Profile data returned from get_nearby_profiles RPC
 */
export interface NearbyProfile {
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
 * Options for fetching nearby profiles
 */
export interface NearbyProfilesOptions {
  /** User's latitude */
  latitude: number;
  /** User's longitude */
  longitude: number;
  /** Search radius in kilometers (default: 10) */
  radiusKm?: number;
  /** Maximum number of results (default: 100) */
  limit?: number;
  /** Filter by casual intent (optional) */
  casualIntent?: string | null;
}

/**
 * Fetch nearby profiles from the RPC
 * 
 * IMPORTANT: The RPC returns SNAPPED locations for privacy protection.
 * Users' exact locations are never exposed to the frontend.
 */
export async function fetchNearbyProfiles(
  options: NearbyProfilesOptions
): Promise<{ profiles: NearbyProfile[]; error: string | null }> {
  const { latitude, longitude, radiusKm = 10, limit = 100, casualIntent } = options;

  try {
    // Call the RPC function
    const { data, error } = await supabase.rpc('get_nearby_profiles', {
      user_lat: latitude,
      user_lng: longitude,
      radius_km: radiusKm,
    });

    if (error) {
      throw error;
    }

    if (!data || !Array.isArray(data)) {
      return { profiles: [], error: null };
    }

    // Parse the results
    const profiles: NearbyProfile[] = data.map((row: Record<string, unknown>) => ({
      id: String(row.id ?? '') ,
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

    // Filter by casual intent if specified
    const filteredProfiles = casualIntent
      ? profiles.filter((p) => p.casualIntent === casualIntent)
      : profiles;

    // Limit results
    const limitedProfiles = filteredProfiles.slice(0, limit);

    return { profiles: limitedProfiles, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to fetch nearby profiles';
    return { profiles: [], error: errorMessage };
  }
}

/**
 * Update the current user's location
 * 
 * This will:
 * 1. Store the exact location in the database
 * 2. Automatically snap it to a 1km grid for privacy
 * 3. Update the last_location_update timestamp
 */
export async function updateUserLocation(
  latitude: number,
  longitude: number
): Promise<{ success: boolean; error: string | null }> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Call the update function
    const { error } = await supabase.rpc('update_location_snapped', {
      p_user_id: user.id,
      p_latitude: latitude,
      p_longitude: longitude,
    });

    if (error) {
      throw error;
    }

    return { success: true, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to update location';
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the current user's location from their profile
 */
export async function getUserLocation(): Promise<{
  latitude: number | null;
  longitude: number | null;
  snappedLatitude: number | null;
  snappedLongitude: number | null;
  error: string | null;
}> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { latitude: null, longitude: null, snappedLatitude: null, snappedLongitude: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('latitude, longitude, snapped_location')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return { latitude: null, longitude: null, snappedLatitude: null, snappedLongitude: null, error: null };
    }

    // Parse snapped_location if it exists
    let snappedLatitude: number | null = null;
    let snappedLongitude: number | null = null;

    if (data.snapped_location) {
      // The snapped_location is stored as a geography point
      // We need to extract the coordinates
      // For now, we'll use the latitude/longitude from the profile
      // In the future, we might need to parse the geography type
      snappedLatitude = typeof data.latitude === 'number' ? data.latitude : null;
      snappedLongitude = typeof data.longitude === 'number' ? data.longitude : null;
    }

    return {
      latitude: typeof data.latitude === 'number' ? data.latitude : null,
      longitude: typeof data.longitude === 'number' ? data.longitude : null,
      snappedLatitude,
      snappedLongitude,
      error: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to get user location';
    return { latitude: null, longitude: null, snappedLatitude: null, snappedLongitude: null, error: errorMessage };
  }
}

/**
 * Get current position from browser's Geolocation API
 */
export function getBrowserLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        resolve(null);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 5 * 60 * 1000, // 5 minutes
      }
    );
  });
}

/**
 * Format distance in meters to a human-readable string
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}
