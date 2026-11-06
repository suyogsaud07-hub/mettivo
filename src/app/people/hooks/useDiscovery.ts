'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  fetchDiscoveryCandidates,
  type DiscoveryCandidate,
} from '@/lib/discovery';
import { recordLike, type RecordLikeResult } from '@/lib/likes';
import {
  setFollow,
  FollowError,
} from '@/lib/follows';
import { getBrowserLocation } from '@/lib/nearby';
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
  onMatch?: (match: { matchId: string; matchedUserId: string }) => void;
}

interface PrefetchQueue {
  urls: string[];
  loaded: Set<string>;
  images: Map<string, HTMLImageElement>;
}

const prefetchQueue: PrefetchQueue = {
  urls: [],
  loaded: new Set(),
  images: new Map(),
};

function preloadImage(url: string): Promise<void> {
  if (prefetchQueue.loaded.has(url) || prefetchQueue.images.has(url)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      prefetchQueue.loaded.add(url);
      prefetchQueue.images.set(url, img);
      resolve();
    };
    img.onerror = () => {
      prefetchQueue.loaded.add(url);
      resolve();
    };
    img.src = url;
  });
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
    onMatch,
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
  const profilesRef = useRef<DiscoveryProfile[]>([]);
  const pendingActionRef = useRef<{ targetId: string; isLike: boolean } | null>(null);

  const { following, hydrated } = useFollow();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  const current = profiles[index];

  const isFollowingTarget = useCallback(
    (targetId: string): boolean => {
      if (!hydrated) return false;
      return following.has(targetId);
    },
    [following, hydrated]
  );

  /**
   * Resolve the signed-in member's location via browser geolocation.
   * Profile discovery eligibility is enforced server-side by `discover_profiles()`.
   */
  const resolveLocation = useCallback(async () => {
    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const browserPos = await getBrowserLocation();
      if (browserPos) {
        lat = browserPos.latitude;
        lng = browserPos.longitude;
      }
    } catch {
      // location unavailable
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

      // Preload primary photos of the first candidate in the batch
      if (candidates.length > 0 && candidates[0].photos.length > 0) {
        void preloadImage(candidates[0].photos[0]);
      }

      return candidates.map((c) => ({
        ...c,
        distanceMeters: null,
        distanceText: null,
      }));
    },
    [minAge, maxAge, genders, batchSize, radiusKm]
  );

  const loadBatch = useCallback(
    async (append: boolean): Promise<void> => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const existingIds = append
          ? profilesRef.current.map((p) => p.id)
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
    [fetchBatch]
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
   * Background prefetch when the stack is running low (2 profiles remain).
   */
  useEffect(() => {
    if (profilesRef.current.length === 0 || index < profilesRef.current.length - 2) return;

    let cancelled = false;
    (async () => {
      const existing = profilesRef.current.map((p) => p.id);
      const next = await fetchBatch(existing);
      if (cancelled || !isMountedRef.current) return;
      setProfiles((prev) => [...prev, ...next]);
    })();

    return () => {
      cancelled = true;
    };
  }, [index, fetchBatch]);

  /**
   * Record a like or pass and advance the stack. Errors are surfaced but do
   * not silently discard the interaction: the card advances only after the
   * write succeeds, and a retry is offered on failure.
   */
  const decide = useCallback(
    async (targetId: string, isLike: boolean): Promise<RecordLikeResult | null> => {
      if (!targetId || processingRef.current) return null;
      // Prevent duplicate rapid actions
      if (pendingActionRef.current?.targetId === targetId) return null;
      pendingActionRef.current = { targetId, isLike };

      setDecisionPending(targetId);
      processingRef.current = true;

      try {
        const result = await recordLike(targetId, isLike);

        if (!isMountedRef.current) return null;

        // Handle mutual match
        if (result.matched && result.match_id && result.matched_user_id && onMatch) {
          onMatch({ matchId: result.match_id, matchedUserId: result.matched_user_id });
        }

        // Advance to next profile or load more
        if (index + 1 < profiles.length) {
          setIndex((i) => i + 1);
        } else {
          await loadBatch(false);
          setIndex(0);
        }

        pendingActionRef.current = null;
        return result;
      } catch (err) {
        if (!isMountedRef.current) return null;
        const message =
          err instanceof Error ? err.message : 'Action failed. Please try again.';
        setError(message);
        console.error('[discovery] decide failed:', err);
        pendingActionRef.current = null;
        return null;
      } finally {
        if (isMountedRef.current) {
          setDecisionPending(null);
          processingRef.current = false;
        }
      }
    },
    [index, profiles.length, loadBatch, onMatch]
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
