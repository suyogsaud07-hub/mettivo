'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  extractCity,
  extractCountry,
  formatLocationLabel,
  isLocationCheckStale,
  locationLabelDiffers,
  parseNominatimResponse,
  type DetectedLocation,
} from '@/lib/location';

/**
 * Location verification.
 *
 * Every `LOCATION_STALE_DAYS` (5) — or the first time a member is seen without a
 * confirmation — the app asks them to confirm where they are, so discovery does
 * not keep showing a stale city after a move.
 *
 * DESIGN NOTES
 *   * This hook only READS its own profile row and, on confirmation, writes its
 *     own row. The write is additionally fenced by RLS (`profiles_update_own`
 *     → `auth.uid() = id`); a denied write affects zero rows, which this hook
 *     treats as a failure rather than a silent success.
 *   * The geolocation prompt is expensive and intrusive, so the low-level
 *     detection runs at most ONCE per page session (module-level cache). A
 *     re-render, a remount under React StrictMode, or a second consumer all
 *     share the one request.
 *   * Nothing here throws at the caller. Every failure path degrades to a
 *     prompt WITHOUT a detected city, or to no prompt at all if the profile
 *     itself could not be read.
 *   * No `any`: geolocation is `GeolocationPosition`, Nominatim JSON is parsed
 *     as `unknown` in `@/lib/location`.
 */

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const GEOCODE_TIMEOUT_MS = 8_000;

/** The two columns this hook needs, kept narrow (M15 revoked `select *`). */
interface ProfileLocationRow {
  current_location: string | null;
  last_location_check: string | null;
}

export interface UseLocationVerificationResult {
  /** Whether the member should be asked to confirm their location right now. */
  needsVerification: boolean;
  /** The detected city, set only when it DIFFERS from the stored value. */
  detectedCity: string | null;
  /** The detected country, same "only when different" rule as `detectedCity`. */
  detectedCountry: string | null;
  /** True while the profile is read and detection is attempted. */
  loading: boolean;
  /** True while a confirmation/dismissal is being written. */
  updating: boolean;
  /** A user-facing message from the last failure, or `null`. */
  error: string | null;
  /** Save the detected location (or, if none, just acknowledge). */
  confirmLocation: () => Promise<void>;
  /** Keep the stored location and snooze the prompt for another cycle. */
  dismiss: () => Promise<void>;
}

// -----------------------------------------------------------------------------
// Geolocation + reverse geocoding (module scope, runs once per session)
// -----------------------------------------------------------------------------

function isGeolocationPositionError(value: unknown): value is GeolocationPositionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number'
  );
}

function describeLocationError(value: unknown): string {
  if (isGeolocationPositionError(value)) {
    switch (value.code) {
      case value.PERMISSION_DENIED:
        return 'Location access is off, so we could not detect your city. You can still confirm your current location.';
      case value.POSITION_UNAVAILABLE:
        return 'Your device could not determine a location. You can still confirm your current location.';
      case value.TIMEOUT:
        return 'Finding your location took too long. You can still confirm your current location.';
      default:
        return 'We could not detect your location. You can still confirm your current location.';
    }
  }
  return 'We could not detect your location. You can still confirm your current location.';
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 5 * 60_000,
    });
  });
}

async function reverseGeocode(latitude: number, longitude: number): Promise<DetectedLocation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const url =
      `${NOMINATIM_REVERSE}?format=json&addressdetails=1&zoom=10` +
      `&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Reverse geocoding failed (${response.status}).`);
    }

    const data: unknown = await response.json();
    const parsed = parseNominatimResponse(data);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    const city = extractCity(parsed.address);
    const country = extractCountry(parsed.address);
    return { city, country, label: formatLocationLabel(city, country) };
  } finally {
    clearTimeout(timeout);
  }
}

let detectionPromise: Promise<DetectedLocation> | null = null;

/** Runs geolocation + reverse geocoding once per page session, memoised. */
function detectLocationOnce(): Promise<DetectedLocation> {
  detectionPromise ??= (async () => {
    const position = await getCurrentPosition();
    return reverseGeocode(position.coords.latitude, position.coords.longitude);
  })();
  return detectionPromise;
}

// -----------------------------------------------------------------------------
// The hook
// -----------------------------------------------------------------------------

export function useLocationVerification(
  userId: string | null | undefined,
): UseLocationVerificationResult {
  const [needsVerification, setNeedsVerification] = useState(false);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept in refs so `confirmLocation`/`dismiss` do not need to re-create
  // themselves (and re-run the effect) when detection finishes.
  const storedLocationRef = useRef<string | null>(null);
  const detectedLabelRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Signed out: clear everything and stop. Held inside the async run so the
      // effect body itself performs no synchronous setState
      // (react-hooks/set-state-in-effect); an async function still executes this
      // synchronously up to its first await, so the reset is immediate.
      if (!userId) {
        setNeedsVerification(false);
        setDetectedCity(null);
        setDetectedCountry(null);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const { data, error: readError } = await supabase
          .from('profiles')
          .select('current_location, last_location_check')
          .eq('id', userId)
          .maybeSingle();

        if (cancelled) return;

        if (readError) {
          // Do not nag when we cannot even read the stored value.
          setError('We could not check your saved location right now.');
          return;
        }
        if (!data) return; // No profile row yet (still onboarding).

        const row = data as ProfileLocationRow;
        storedLocationRef.current = row.current_location;

        if (!isLocationCheckStale(row.last_location_check)) {
          return; // Confirmed within the last 5 days.
        }

        // Stale: prompt immediately, then try to enrich with a detected city.
        setNeedsVerification(true);
        setDetectedCity(null);
        setDetectedCountry(null);

        try {
          const detected = await detectLocationOnce();
          detectedLabelRef.current = detected.label;

          if (cancelled) return;

          if (locationLabelDiffers(row.current_location, detected.label)) {
            setDetectedCity(detected.city);
            setDetectedCountry(detected.country);
          }
        } catch (detectError) {
          if (!cancelled) setError(describeLocationError(detectError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * Writes `last_location_check` (always) and optionally `current_location`.
   *
   * `.select('id')` is appended deliberately — see `persistProfile` in the
   * dashboard: with RLS a denied UPDATE returns no error but zero rows, so a
   * zero-row result is treated as a failure, never as success.
   */
  const persist = useCallback(
    async (nextLocation: string | null): Promise<void> => {
      if (!userId) return;
      setUpdating(true);
      setError(null);
      try {
        const patch: { last_location_check: string; current_location?: string } = {
          last_location_check: new Date().toISOString(),
        };
        if (nextLocation && nextLocation.trim()) {
          patch.current_location = nextLocation;
        }

        const { data, error: writeError } = await supabase
          .from('profiles')
          .update(patch)
          .eq('id', userId)
          .select('id');

        if (writeError) throw new Error(writeError.message);
        if (!data || data.length === 0) {
          throw new Error('We could not save your location. Please try again.');
        }

        storedLocationRef.current = patch.current_location ?? storedLocationRef.current;
        setNeedsVerification(false);
      } catch (persistError) {
        setError(
          persistError instanceof Error
            ? persistError.message
            : 'We could not save your location. Please try again.',
        );
      } finally {
        setUpdating(false);
      }
    },
    [userId],
  );

  const confirmLocation = useCallback(async (): Promise<void> => {
    // Prefer the freshly detected label; fall back to what is already stored so
    // a permission-denied "Update" still refreshes the acknowledgement.
    await persist(detectedLabelRef.current ?? storedLocationRef.current);
  }, [persist]);

  const dismiss = useCallback(async (): Promise<void> => {
    // Snooze WITHOUT changing the stored city: the member is telling us the
    // value on file is still correct.
    await persist(null);
  }, [persist]);

  return {
    needsVerification,
    detectedCity,
    detectedCountry,
    loading,
    updating,
    error,
    confirmLocation,
    dismiss,
  };
}
