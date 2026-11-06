'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchDiscoveryCandidates,
  type DiscoveryCandidate,
} from '@/lib/discovery';
import { recordLike, rewindLastLike, type RecordLikeResult } from '@/lib/likes';
import {
  setFollow,
  FollowError,
} from '@/lib/follows';
import { getBrowserLocation } from '@/lib/nearby';
import { startConversation } from '@/lib/conversations';
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
  const [isRewinding, setIsRewinding] = useState(false);
  const [rewindError, setRewindError] = useState<string | null>(null);
  const [hasRewindable, setHasRewindable] = useState(false);

  const isMountedRef = useRef(true);
  const processingRef = useRef(false);
  const profilesRef = useRef<DiscoveryProfile[]>([]);
  const pendingActionRef = useRef<{ targetId: string; isLike: boolean } | null>(null);
  const lastDecidedRef = useRef<DiscoveryProfile | null>(null);
  const rewindInProgressRef = useRef(false);

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
    [minAge, maxAge, genders, batchSize]
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

        // Remember the profile being decided so Rewind can restore it to the top.
        lastDecidedRef.current = profilesRef.current[index];
        setHasRewindable(true);

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
    [index, profiles.length, loadBatch, onMatch, setHasRewindable]
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

  const router = useRouter();

  /**
   * Rewinds the most recent discovery decision: deletes the caller's latest
   * like/pass row and restores that profile to the top of the stack. Safe
   * against concurrent decisions via optimistic concurrency on `updated_at`.
   */
  const handleRewind = useCallback(async (): Promise<boolean> => {
    if (rewindInProgressRef.current) return false;
    if (!lastDecidedRef.current) return false;

    rewindInProgressRef.current = true;
    setIsRewinding(true);
    setRewindError(null);

    try {
      const result = await rewindLastLike();
      if (!result) {
        setRewindError('Nothing to rewind yet.');
        return false;
      }

      // Restore the rewound profile to the top of the stack, avoiding duplicates.
      const targetId = result.targetUserId;
      setProfiles((prev) => {
        const filtered = prev.filter((p) => p.id !== targetId);
        const restored = lastDecidedRef.current;
        return restored ? [restored, ...filtered] : filtered;
      });
      setIndex(0);
      setDecisionPending(null);
      setHasRewindable(false);
      return true;
    } catch (err) {
      if (!isMountedRef.current) return false;
      const message =
        err instanceof Error ? err.message : 'Rewind failed. Please try again.';
      setRewindError(message);
      console.error('[discovery] rewind failed:', err);
      return false;
    } finally {
      if (isMountedRef.current) {
        rewindInProgressRef.current = false;
        setIsRewinding(false);
      }
    }
  }, []);

  /**
   * Super Like has no backend integration yet. It is a deliberate UI-only
   * placeholder with an explicit future-backend boundary: it never calls the
   * database and never reports a successful Super Like. The page layer owns the
   * user-facing "coming soon" notice.
   */
  const handleSuperLike = useCallback(() => {
    // Intentional no-op until a Super Like backend exists.
  }, []);

  /**
   * Opens (or returns) a conversation with the target member through the
   * existing `start_conversation()` RPC, which enforces matching, follow, and
   * blocking rules server-side.
   */
  const handleMessage = useCallback(
    async (targetId: string): Promise<boolean> => {
      if (!targetId || processingRef.current) return false;
      processingRef.current = true;
      setDecisionPending(targetId);

      try {
        const connection = await startConversation(targetId);
        if (!isMountedRef.current) return false;
        setError(null);
        // Navigate to the existing chat route. `conversationId` is the match id.
        void router.push(`/chat/${connection.conversationId}`);
        return true;
      } catch (err) {
        if (!isMountedRef.current) return false;
        const message =
          err instanceof Error ? err.message : 'Could not start conversation.';
        setError(message);
        console.error('[discovery] message failed:', err);
        return false;
      } finally {
        if (isMountedRef.current) {
          processingRef.current = false;
          setDecisionPending(null);
        }
      }
    },
    [router]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setIndex(0);
    setHasRewindable(false);
    await loadBatch(false);
  }, [loadBatch]);

  const empty = profiles.length === 0 && !loading;
  const canRewind = hasRewindable && !isRewinding;

  return {
    current,
    profiles,
    index,
    loading,
    refreshing,
    error,
    decisionPending,
    empty,
    canRewind,
    isRewinding,
    rewindError,
    hydrated,
    isFollowing: isFollowingTarget,
    handleLike,
    handlePass,
    handleFollow,
    handleRewind,
    handleSuperLike,
    handleMessage,
    refresh,
    userLat,
    userLng,
  };
}
