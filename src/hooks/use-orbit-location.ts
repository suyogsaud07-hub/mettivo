'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchOrbitProfiles,
  fetchLocationSharingPrefs,
  setLocationSharing,
  setLocationRetention,
  updateOrbitLocation,
  type OrbitProfile,
} from '@/lib/orbit-location';

/** Network state. */
export type NetworkState = 'online' | 'offline' | 'unknown';

/** Location-sharing lifecycle state. */
export type LocationSharingState =
  | 'disabled'
  | 'enabled'
  | 'enabling'
  | 'revoked';

/** Return type of useOrbitLocation. */
export interface UseOrbitLocationResult {
  /** Whether location sharing is enabled for this member. */
  sharingEnabled: boolean;
  /** Whether last-known retention is enabled. */
  retentionEnabled: boolean;
  /** Current lifecycle state of location sharing. */
  sharingState: LocationSharingState;
  /** Error, if any. */
  error: string | null;
  /** Current network state. */
  network: NetworkState;
  /** Whether location tracking is active (watchPosition running). */
  tracking: boolean;
  /** Last fetched orbit profiles. */
  profiles: OrbitProfile[];
  /** Whether profiles are loading. */
  profilesLoading: boolean;
  /** Enable location sharing (prompts for permission). */
  enableSharing: () => Promise<void>;
  /** Disable location sharing (revokes immediately). */
  disableSharing: () => Promise<void>;
  /** Toggle last-known retention. */
  setRetention: (enabled: boolean) => Promise<void>;
  /** Manually refresh the profile list. */
  refreshProfiles: () => Promise<void>;
  /** Start background location tracking (watchPosition). */
  startTracking: () => Promise<void>;
  /** Stop background location tracking. */
  stopTracking: () => Promise<void>;
}

/** Adaptive update thresholds. */
const MIN_UPDATE_INTERVAL_MS = 5_000; // max once per 5s
const MIN_DISTANCE_METERS = 50; // only send if moved 50m+

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined';
}

function hasGeolocation(): boolean {
  return isBrowser() && 'geolocation' in navigator;
}

function hasWatchPosition(): boolean {
  return hasGeolocation() && typeof navigator.geolocation!.watchPosition === 'function';
}

export function useOrbitLocation(): UseOrbitLocationResult {
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [retentionEnabled, setRetentionEnabled] = useState(true);
  const [sharingState, setSharingState] = useState<LocationSharingState>('disabled');
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkState>('unknown');
  const [tracking, setTracking] = useState(false);
  const [profiles, setProfiles] = useState<OrbitProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // ------------------------------------------------------------------
  // Network state
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isBrowser()) return;

    const updateNetwork = () =>
      setNetwork(navigator.onLine ? 'online' : 'offline');

    updateNetwork();
    window.addEventListener('online', () => setNetwork('online'));
    window.addEventListener('offline', () => setNetwork('offline'));

    return () => {
      window.removeEventListener('online', () => setNetwork('online'));
      window.removeEventListener('offline', () => setNetwork('offline'));
    };
  }, []);

  // ------------------------------------------------------------------
  // Load sharing prefs on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await fetchLocationSharingPrefs();
        if (!cancelled) {
          setSharingEnabled(prefs.location_sharing_enabled);
          setRetentionEnabled(prefs.location_retention_enabled);
          setSharingState(prefs.location_sharing_enabled ? 'enabled' : 'disabled');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load preferences.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------------
  // Presence heartbeat: start a session and heartbeat every 30s while online
  // ------------------------------------------------------------------
  useEffect(() => {
    async function ensureSession() {
      if (!isBrowser()) return;
      const { data } = await supabase.auth.getUser();
      if (!data?.user) return;

      // Reuse an existing session id if we have one.
      if (!sessionIdRef.current) {
        sessionIdRef.current = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }

      const { error } = await supabase.rpc('start_presence_session', {
        p_session_id: sessionIdRef.current,
        p_device_type: 'web',
        p_user_agent: navigator.userAgent,
      });
      if (error) {
        // Non-fatal: heartbeat will still attempt to update an existing row.
        console.error('[orbit] start_presence_session failed:', error.message);
      }
    }

    async function heartbeat() {
      if (!sessionIdRef.current) return;
      const { error } = await supabase.rpc('heartbeat_presence_session', {
        p_session_id: sessionIdRef.current,
      });
      if (error) {
        console.error('[orbit] heartbeat failed:', error.message);
      }
    }

    void ensureSession();
    void heartbeat();

    const hb = setInterval(heartbeat, 30_000);
    return () => {
      clearInterval(hb);
    };
  }, []);

  // ------------------------------------------------------------------
  // Fetch profiles
  // ------------------------------------------------------------------
  const fetchProfiles = useCallback(async (): Promise<void> => {
    if (navigator.onLine === false) {
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }

    let pos: { lat: number; lng: number } | null = null;

    // Prefer the last known watch position; otherwise getCurrentPosition.
    if (lastPositionRef.current) {
      pos = lastPositionRef.current;
    } else if (hasGeolocation()) {
      try {
        const g = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation!.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 60_000,
          });
        });
        pos = { lat: g.coords.latitude, lng: g.coords.longitude };
      } catch {
        // No position available — send empty list.
        setProfiles([]);
        setProfilesLoading(false);
        return;
      }
    }

    if (!pos) {
      setProfiles([]);
      setProfilesLoading(false);
      return;
    }

    setProfilesLoading(true);
    setError(null);
    try {
      const next = await fetchOrbitProfiles({
        lat: pos.lat,
        lng: pos.lng,
        radiusKm: 10,
        includeLastKnown: true,
      });
      if (!abortRef.current?.signal.aborted) {
        setProfiles(next);
      }
    } catch (err) {
      if (!abortRef.current?.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to load profiles.');
        setProfiles([]);
      }
    } finally {
      if (!abortRef.current?.signal.aborted) {
        setProfilesLoading(false);
      }
    }
  }, []);

  const refreshProfiles = useCallback(async (): Promise<void> => {
    void fetchProfiles();
  }, [fetchProfiles]);

  // ------------------------------------------------------------------
  // Adaptive location upload
  // ------------------------------------------------------------------
  const uploadLocation = useCallback(
    async (lat: number, lng: number, accuracy?: number | null) => {
      const now = Date.now();
      const sinceLast = now - lastUpdateRef.current;
      const movedFar =
        !lastPositionRef.current ||
        haversineMeters(
          lastPositionRef.current.lat,
          lastPositionRef.current.lng,
          lat,
          lng,
        ) >= MIN_DISTANCE_METERS;

      // Adaptive: only send if enough time has passed AND we moved far enough.
      if (sinceLast < MIN_UPDATE_INTERVAL_MS && movedFar === false) return;
      if (!navigator.onLine) return;

      try {
        await updateOrbitLocation({ latitude: lat, longitude: lng, accuracyMeters: accuracy });
        lastUpdateRef.current = now;
        lastPositionRef.current = { lat, lng };
        setError(null);
      } catch (err) {
        // Don't spam: surface once, then wait for next position.
        setError(err instanceof Error ? err.message : 'Location upload failed.');
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Start / stop tracking (watchPosition)
  // ------------------------------------------------------------------
  const startTracking = useCallback(async (): Promise<void> => {
    if (!sharingEnabled) {
      setError('Location sharing is disabled.');
      return;
    }
    if (!hasWatchPosition()) {
      setError('Your browser does not support background location tracking.');
      return;
    }
    if (watchIdRef.current !== null) return;

    setTracking(true);
    setError(null);

    watchIdRef.current = navigator.geolocation!.watchPosition(
      (g) => {
        void uploadLocation(g.coords.latitude, g.coords.longitude, g.coords.accuracy);
        // Refresh profiles when we get a fresh position (debounced inside uploadLocation).
        void refreshProfiles();
      },
      (err) => {
        setError(err.message);
        setTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15_000,
      },
    );
  }, [sharingEnabled, uploadLocation, refreshProfiles]);

  const stopTracking = useCallback(async (): Promise<void> => {
    if (watchIdRef.current !== null) {
      navigator.geolocation!.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
  }, []);

  // ------------------------------------------------------------------
  // Sharing enable / disable
  // ------------------------------------------------------------------
  const enableSharing = useCallback(async (): Promise<void> => {
    if (!hasGeolocation()) {
      setError('Your browser does not support geolocation.');
      return;
    }
    setSharingState('enabling');
    try {
      await setLocationSharing(true);
      setSharingEnabled(true);
      setSharingState('enabled');
      await startTracking();
      await refreshProfiles();
    } catch (err) {
      setSharingState('disabled');
      setError(err instanceof Error ? err.message : 'Failed to enable sharing.');
    }
  }, [startTracking, refreshProfiles]);

  const disableSharing = useCallback(async (): Promise<void> => {
    await stopTracking();
    try {
      await setLocationSharing(false);
      setSharingEnabled(false);
      setSharingState('disabled');
      setProfiles([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable sharing.');
    }
  }, [stopTracking]);

  const setRetention = useCallback(
    async (enabled: boolean): Promise<void> => {
      try {
        await setLocationRetention(enabled);
        setRetentionEnabled(enabled);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update retention.');
      }
    },
    []
  );

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation!.clearWatch(watchIdRef.current);
      }
      const abort = abortRef.current;
      if (abort) abort.abort();
    };
  }, []);

  return {
    sharingEnabled,
    retentionEnabled,
    sharingState,
    error,
    network,
    tracking,
    profiles,
    profilesLoading,
    enableSharing,
    disableSharing,
    setRetention,
    refreshProfiles,
    startTracking,
    stopTracking,
  };
}

/** Haversine distance in meters between two lat/lng points. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
