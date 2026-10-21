'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '@/lib/supabase';
import { fetchMyFollowingIds, setFollow } from '@/lib/follows';

/**
 * One app-wide view of the signed-in member's outgoing follows.
 *
 * Every Follow button used to own a local boolean. Two cards for the same member
 * could disagree, and following somebody on Discover did not update the same
 * person on Moments or their public profile. This provider hydrates the full id
 * set once, then every surface reads and mutates that one set.
 *
 * Writes are optimistic and serialised per target: while a target is pending a
 * second toggle is ignored, so two taps cannot race into the wrong final state.
 * A failed write rolls the optimistic change back and leaves a member-safe error
 * for the button to show.
 */

export interface FollowContextValue {
  following: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>;
  hydrated: boolean;
  setFollowing: (targetUserId: string, follow: boolean) => Promise<boolean>;
  clearError: (targetUserId: string) => void;
}

const FollowContext = createContext<FollowContextValue | null>(null);

export function FollowProvider({ children }: { children: React.ReactNode }) {
  const [following, setFollowingState] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const pendingRef = useRef<Set<string>>(new Set());

  const hydrate = useCallback(async (isCancelled: () => boolean = () => false) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (isCancelled()) return;

    if (!user) {
      setFollowingState(new Set());
      setHydrated(true);
      return;
    }

    try {
      const ids = await fetchMyFollowingIds();
      if (isCancelled()) return;
      setFollowingState(ids);
    } catch (err) {
      // A failed hydration must not strand every Follow button in its loading
      // state; fall back to an empty set and let individual writes surface
      // their own errors.
      console.error('[follows] following list failed:', err);
    } finally {
      if (!isCancelled()) setHydrated(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    // Hydration resolves after an await, so this cannot set state during the
    // effect body itself; the rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void hydrate(isCancelled);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setFollowingState(new Set());
        setErrors({});
        setPending(new Set());
        pendingRef.current.clear();
        setHydrated(true);
        return;
      }

      if (event === 'SIGNED_IN') {
        void hydrate(isCancelled);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrate]);

  const setFollowing = useCallback(async (targetUserId: string, follow: boolean) => {
    if (!targetUserId || pendingRef.current.has(targetUserId)) return false;

    pendingRef.current.add(targetUserId);
    setPending((current) => new Set(current).add(targetUserId));
    setErrors((current) => {
      if (!(targetUserId in current)) return current;
      const next = { ...current };
      delete next[targetUserId];
      return next;
    });
    setFollowingState((current) => {
      const next = new Set(current);
      if (follow) next.add(targetUserId);
      else next.delete(targetUserId);
      return next;
    });

    try {
      await setFollow(targetUserId, follow);
      return true;
    } catch (err) {
      console.error('[follow] toggle failed:', err);
      setFollowingState((current) => {
        const next = new Set(current);
        if (follow) next.delete(targetUserId);
        else next.add(targetUserId);
        return next;
      });
      setErrors((current) => ({
        ...current,
        [targetUserId]: 'Could not update follow. Please try again.',
      }));
      return false;
    } finally {
      pendingRef.current.delete(targetUserId);
      setPending((current) => {
        const next = new Set(current);
        next.delete(targetUserId);
        return next;
      });
    }
  }, []);

  const clearError = useCallback((targetUserId: string) => {
    setErrors((current) => {
      if (!(targetUserId in current)) return current;
      const next = { ...current };
      delete next[targetUserId];
      return next;
    });
  }, []);

  const value = useMemo<FollowContextValue>(
    () => ({ following, pending, errors, hydrated, setFollowing, clearError }),
    [following, pending, errors, hydrated, setFollowing, clearError]
  );

  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

export function useFollow(): FollowContextValue {
  const context = useContext(FollowContext);
  if (!context) {
    throw new Error('useFollow must be used inside <FollowProvider>.');
  }
  return context;
}
