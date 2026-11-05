'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchDiscoveryCandidates,
  type DiscoveryCandidate,
} from '@/lib/discovery';
import { recordLike, type RecordLikeResult } from '@/lib/likes';
import {
  setFollow,
  FollowError,
} from '@/lib/follows';
import { getBrowserLocation, formatDistance } from '@/lib/nearby';
import { useFollow } from '@/context/FollowContext';

export interface DiscoveryProfile extends DiscoveryCandidate {
  distanceMeters: number | null;
  distanceText: string | null;
}

interface UseDiscoveryOptions {
  minAge?: number;
  maxAge?: number;
  genders?: string[] | null;
  batchSize?: number;
  radiusKm?: number;
}

/**
 * Manages the discovery stack: fetching batches, liking, passing, following,
 * and distance annotation. All eligibility is enforced server-side by
 * `discover_profiles()`; this hook only orchestrates UI state and remote
 * actions.
 */
export function useDiscovery(options: UseDiscoveryOptions = {}) {
  const {
    minAge = 18,
    maxAge = 99,
    genders = null,
    batchSize = 10,
    radiusKm = 10,
  } = options;

  const [profiles, setProfiles] = useState<DiscoveryProfile[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);

  const isMountedRef = useRef(true);
  const processingRef = useRef(false);

  const { following, hydrated } = useFollow();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const current = profiles[index];

  const isFollowingTarget = useCallback(
    (targetId: string): boolean => {
      if (!hydrated) return false;
      return following.has(targetId);
    },
    [following, hydrated]
  );

  /**
   * Resolve the signed-in member's location. Prefer the stored profile
   * location; fall back to browser geolocation.
   */
  const resolveLocation = useCallback(async () => {
    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('latitude, longitude')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && data) {
          if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            lat = data.latitude;
            lng = data.longitude;
          }
        }
      }
    } catch {
      // fall through to browser geolocation
    }

    if (lat === null || lng === null) {
      try {
        const browserPos = await getBrowserLocation();
        if (browserPos) {
          lat = browserPos.latitude;
          lng = browserPos.longitude;
        }
      } catch {
        // location unavailable
      }
    }

    if (lat !== null && lng !== null) {
      setUserLat(lat);
      setUserLng(lng);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void resolveLocation();
  }, [resolveLocation]);

  /**
   * Fetch a batch of eligible candidates and annotate with distance + casual
   * intent where available.
   */
  const fetchBatch = useCallback(
    async (excludeIds: string[]): Promise<DiscoveryProfile[]> => {
      const candidates = await fetchDiscoveryCandidates({
        minAge,
        maxAge,
        genders,
        limit: batchSize,
        excludeIds,
      });

      const distances = new Map<string, number>();

      if (userLat !== null && userLng !== null) {
        try {
          const { data: nearby, error: nearbyError } = await supabase.rpc(
            'get_nearby_profiles',
            {
              user_lat: userLat,
              user_lng: userLng,
              radius_km: radiusKm,
            }
          );

          if (!nearbyError && Array.isArray(nearby)) {
            for (const row of nearby) {
              const id = String(row.id ?? '');
              const meters = typeof row.distance_meters === 'number' ? row.distance_meters : 0;
              if (id) distances.set(id, meters);
            }
          } else {
            console.error('[discovery] get_nearby_profiles failed:', nearbyError?.message);
          }
        } catch (err) {
          console.error('[discovery] get_nearby_profiles threw:', err);
        }
      }

      return candidates.map((c) => {
        const meters = distances.get(c.id);
        return {
          ...c,
          distanceMeters: meters ?? null,
          distanceText: meters !== null && meters !== undefined ? formatDistance(meters) : null,
        };
      });
    },
    [minAge, maxAge, genders, batchSize, userLat, userLng, radiusKm]
  );

  const loadBatch = useCallback(
    async (append: boolean): Promise<void> => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const existingIds = append
          ? profiles.map((p) => p.id)
          : [];

        const next = await fetchBatch(existingIds);

        if (!isMountedRef.current) return;

        if (append) {
          setProfiles((prev) => [...prev, ...next]);
        } else {
          setProfiles(next);
          setIndex(0);
        }
        setError(null);
      } catch (err) {
        if (!isMountedRef.current) return;
        const message =
          err instanceof Error ? err.message : 'Failed to load profiles.';
        setError(message);
        console.error('[discovery] load batch failed:', err);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
          processingRef.current = false;
        }
      }
    },
    [profiles, fetchBatch]
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    await loadBatch(false);
  }, [loadBatch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInitial();
  }, [loadInitial]);

  /**
   * Background prefetch when the stack is running low.
   */
  useEffect(() => {
    if (profiles.length === 0 || index < profiles.length - 2) return;

    let cancelled = false;
    (async () => {
      const existing = profiles.map((p) => p.id);
      const next = await fetchBatch(existing);
      if (cancelled || !isMountedRef.current) return;
      setProfiles((prev) => [...prev, ...next]);
    })();

    return () => {
      cancelled = true;
    };
  }, [index, profiles.length, fetchBatch, profiles]);

  /**
   * Record a like or pass and advance the stack. Errors are surfaced but do
   * not silently discard the interaction: the card advances only after the
   * write succeeds, and a retry is offered on failure.
   */
  const decide = useCallback(
    async (targetId: string, isLike: boolean): Promise<RecordLikeResult | null> => {
      if (!targetId || processingRef.current) return null;
      setDecisionPending(targetId);
      processingRef.current = true;

      try {
        const result = await recordLike(targetId, isLike);

        if (!isMountedRef.current) return null;

        if (index + 1 < profiles.length) {
          setIndex((i) => i + 1);
        } else {
          await loadBatch(false);
          setIndex(0);
        }

        return result;
      } catch (err) {
        if (!isMountedRef.current) return null;
        const message =
          err instanceof Error ? err.message : 'Action failed. Please try again.';
        setError(message);
        console.error('[discovery] decide failed:', err);
        return null;
      } finally {
        if (isMountedRef.current) {
          setDecisionPending(null);
          processingRef.current = false;
        }
      }
    },
    [index, profiles.length, loadBatch]
  );

  const handleLike = useCallback(
    (targetId: string) => void decide(targetId, true),
    [decide]
  );

  const handlePass = useCallback(
    (targetId: string) => void decide(targetId, false),
    [decide]
  );

  /**
   * Toggle follow state using the existing FollowProvider. Independent of
   * like/pass: following never creates a like or match.
   */
  const handleFollow = useCallback(
    async (targetId: string): Promise<boolean> => {
      if (!targetId || processingRef.current) return false;
      const currentlyFollowing = isFollowingTarget(targetId);
      setDecisionPending(targetId);
      processingRef.current = true;

      try {
        await setFollow(targetId, !currentlyFollowing);
        if (!isMountedRef.current) return false;
        setError(null);
        return true;
      } catch (err) {
        if (!isMountedRef.current) return false;
        const message =
          err instanceof FollowError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not update follow. Please try again.';
        setError(message);
        console.error('[discovery] follow failed:', err);
        return false;
      } finally {
        if (isMountedRef.current) {
          setDecisionPending(null);
          processingRef.current = false;
        }
      }
    },
    [isFollowingTarget]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setIndex(0);
    await loadBatch(false);
  }, [loadBatch]);

  const empty = profiles.length === 0 && !loading;

  return {
    current,
    profiles,
    index,
    loading,
    refreshing,
    error,
    decisionPending,
    empty,
    hydrated,
    isFollowing: isFollowingTarget,
    handleLike,
    handlePass,
    handleFollow,
    refresh,
    userLat,
    userLng,
  };
}
