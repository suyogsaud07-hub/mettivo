'use client';

import { supabase } from '@/lib/supabase';
import { isMissingColumnError, isMissingRelationError } from '@/lib/postgrest-errors';

/** Status of a member's location visibility on Orbit. */
export type OrbitLocationStatus = 'live' | 'last_known' | 'hidden';

/** A single orbit member as returned by get_orbit_profiles(). */
export interface OrbitProfile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  intention: string | null;
  casual_intent: string | null;
  bio: string | null;
  is_online: boolean;
  snapped_lat: number | null;
  snapped_lng: number | null;
  distance_meters: number | null;
  location_status: OrbitLocationStatus;
  location_age_seconds: number | null;
}

/** A heatmap cell as returned by get_orbit_heatmap(). */
export interface OrbitHeatmapCell {
  cell_id: string;
  cell_lat: number;
  cell_lng: number;
  live_count: number;
  known_count: number;
}

/** Location-sharing preferences. */
export interface LocationSharingPrefs {
  location_sharing_enabled: boolean;
  location_retention_enabled: boolean;
}

/** Error raised by orbit-location operations. */
export class OrbitLocationError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OrbitLocationError';
    this.code = code;
  }
}

/**
 * Fetch the signed-in member's location-sharing preferences.
 * Degrades gracefully if the column has not been migrated yet.
 */
export async function fetchLocationSharingPrefs(): Promise<LocationSharingPrefs> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('location_sharing_enabled, location_retention_enabled')
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      // Not yet migrated: default to OFF (safe default).
      return { location_sharing_enabled: false, location_retention_enabled: true };
    }
    throw new OrbitLocationError(
      'We could not load your location-sharing preferences.',
      error.code,
    );
  }

  return {
    location_sharing_enabled:
      typeof data?.location_sharing_enabled === 'boolean'
        ? data.location_sharing_enabled
        : false,
    location_retention_enabled:
      typeof data?.location_retention_enabled === 'boolean'
        ? data.location_retention_enabled
        : true,
  };
}

/** Enable or disable location sharing for the signed-in member. */
export async function setLocationSharing(enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { location_sharing_enabled: enabled },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new OrbitLocationError(
      'We could not update your location-sharing preference.',
      error.code,
    );
  }
}

/**
 * Enable or disable last-known location retention for the signed-in member.
 */
export async function setLocationRetention(enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { location_retention_enabled: enabled },
      { onConflict: 'user_id' },
    );

  if (error) {
    throw new OrbitLocationError(
      'We could not update your location-retention preference.',
      error.code,
    );
  }
}

/**
 * Fetch eligible nearby orbit members.
 * Pass `includeLastKnown=true` to also include retained last-known locations.
 */
export async function fetchOrbitProfiles(opts: {
  lat: number;
  lng: number;
  radiusKm?: number;
  minAge?: number;
  maxAge?: number;
  gender?: string | null;
  onlineOnly?: boolean;
  country?: string | null;
  includeLastKnown?: boolean;
}): Promise<OrbitProfile[]> {
  const {
    lat,
    lng,
    radiusKm = 10,
    minAge = 18,
    maxAge = 99,
    gender = null,
    onlineOnly = false,
    country = null,
    includeLastKnown = false,
  } = opts;

  const { data, error } = await supabase.rpc('get_orbit_profiles', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radiusKm,
    p_min_age: minAge,
    p_max_age: maxAge,
    p_gender: gender,
    p_online_only: onlineOnly,
    p_country: country,
    p_include_last_known: includeLastKnown,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new OrbitLocationError(
      'We could not load nearby profiles.',
      error.code,
    );
  }

  return (data || []).map((row: unknown) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      display_name: String(r.display_name ?? ''),
      username: r.username ?? null,
      avatar_url: r.avatar_url ?? null,
      age: typeof r.age === 'number' ? r.age : null,
      gender: r.gender ?? null,
      city: r.city ?? null,
      country: r.country ?? null,
      intention: r.intention ?? null,
      casual_intent: r.casual_intent ?? null,
      bio: r.bio ?? null,
      is_online: typeof r.is_online === 'boolean' ? r.is_online : false,
      snapped_lat: typeof r.snapped_lat === 'number' ? r.snapped_lat : null,
      snapped_lng: typeof r.snapped_lng === 'number' ? r.snapped_lng : null,
      distance_meters:
        typeof r.distance_meters === 'number' ? r.distance_meters : null,
      location_status:
        (r.location_status as OrbitLocationStatus) ?? 'hidden',
      location_age_seconds:
        typeof r.location_age_seconds === 'number'
          ? r.location_age_seconds
          : null,
    };
  });
}

/**
 * Fetch heatmap density cells for a bounding box.
 */
export async function fetchOrbitHeatmap(opts: {
  neLat: number;
  neLng: number;
  swLat: number;
  swLng: number;
  cellMeters?: number;
}): Promise<OrbitHeatmapCell[]> {
  const { neLat, neLng, swLat, swLng, cellMeters = 500 } = opts;

  const { data, error } = await supabase.rpc('get_orbit_heatmap', {
    p_ne_lat: neLat,
    p_ne_lng: neLng,
    p_sw_lat: swLat,
    p_sw_lng: swLng,
    p_cell_meters: cellMeters,
  });

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new OrbitLocationError('We could not load the heatmap.', error.code);
  }

  return (data || []).map((row: unknown) => {
    const r = row as Record<string, unknown>;
    return {
      cell_id: String(r.cell_id ?? ''),
      cell_lat: typeof r.cell_lat === 'number' ? r.cell_lat : 0,
      cell_lng: typeof r.cell_lng === 'number' ? r.cell_lng : 0,
      live_count: typeof r.live_count === 'number' ? r.live_count : 0,
      known_count: typeof r.known_count === 'number' ? r.known_count : 0,
    };
  });
}

/** Save the member's current location via the update_orbit_location RPC. */
export async function updateOrbitLocation(opts: {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}): Promise<void> {
  const { latitude, longitude, accuracyMeters } = opts;

  const { error } = await supabase.rpc('update_orbit_location', {
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy: accuracyMeters ?? null,
  });

  if (error) {
    throw new OrbitLocationError(
      'We could not save your location.',
      error.code,
    );
  }
}
