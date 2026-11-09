'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFlatmateCandidates,
  fetchFlatmateProfile,
  saveFlatmateProfile,
  expressFlatmateInterest,
  saveFlatmateProfileConnection,
  getFlatmateConnectionStatus,
  reportFlatmateProfile,
  type FlatmateCandidate,
  type FlatmateProfile,
} from '@/lib/flatmate';

export interface FlatmateFilters {
  city: string;
  rentMin: number | null;
  rentMax: number | null;
  moveInAfter: string | null;
  sleepingSchedule: string | null;
  cleanliness: string | null;
  smoking: string | null;
  pets: string | null;
}

export interface UseFlatmateDiscoveryResult {
  candidates: FlatmateCandidate[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  myProfile: FlatmateProfile | null;
  myProfileLoading: boolean;
  filters: FlatmateFilters;
  setFilters: (updates: Partial<FlatmateFilters>) => void;
  clearFilters: () => void;
    refresh: () => void;
  expressInterest: (targetId: string) => Promise<boolean>;
  saveProfile: (targetId: string, save: boolean) => Promise<void>;
  reportProfile: (targetId: string, reason: string, details?: string) => Promise<void>;
  connectionStatus: Map<string, { interested: boolean; saved: boolean; skipped: boolean }>;
  canDiscover: boolean;
  completionPercentage: number;
}

const DEFAULT_FILTERS: FlatmateFilters = {
  city: '',
  rentMin: null,
  rentMax: null,
  moveInAfter: null,
  sleepingSchedule: null,
  cleanliness: null,
  smoking: null,
  pets: null,
};

const PAGE_SIZE = 20;

export function useFlatmateDiscovery(): UseFlatmateDiscoveryResult {
  const [candidates, setCandidates] = useState<FlatmateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [myProfile, setMyProfile] = useState<FlatmateProfile | null>(null);
  const [myProfileLoading, setMyProfileLoading] = useState(true);
  const [filters, setFilters] = useState<FlatmateFilters>(DEFAULT_FILTERS);
  const connectionMap = useMemo(() => {
    const next = new Map<string, { interested: boolean; saved: boolean; skipped: boolean }>();
    for (const c of candidates) {
      next.set(c.id, { interested: c.already_interested, saved: c.already_saved, skipped: false });
    }
    return next;
  }, [candidates]);

  const cursorRef = useRef<number>(0);
  const requestSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  // Load my profile on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMyProfileLoading(true);
      try {
        const profile = await fetchFlatmateProfile();
        if (!cancelled) {
          setMyProfile(profile);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[flatmate] load profile failed:', err);
          // Don't block discovery if profile load fails — user can still browse
        }
      } finally {
        if (!cancelled) setMyProfileLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchCandidates = useCallback(
    async (force = false) => {
      if (isMountedRef.current && force) {
        cursorRef.current = 0;
        setCandidates([]);
      }
      setLoading(true);
      setError(null);

      try {
        const page = await fetchFlatmateCandidates({
          city: filters.city || undefined,
          rentMin: filters.rentMin,
          rentMax: filters.rentMax,
          moveInAfter: filters.moveInAfter,
          sleepingSchedule: filters.sleepingSchedule,
          cleanliness: filters.cleanliness,
          smoking: filters.smoking,
          pets: filters.pets,
          limit: PAGE_SIZE,
          excludeIds: [myProfile?.id].filter((id): id is string => !!id),
        });

        if (!isMountedRef.current) return;
        setCandidates(page);
        cursorRef.current = page.length;
      } catch (err) {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load flatmate profiles.');
        setCandidates([]);
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    },
    [filters, myProfile],
  );

  const refresh = useCallback(() => {
    void fetchCandidates(true);
  }, [fetchCandidates]);

  const setFiltersState = useCallback((updates: Partial<FlatmateFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const expressInterest = useCallback(
    async (targetId: string) => {
      try {
        const { mutual } = await expressFlatmateInterest(targetId);
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === targetId ? { ...c, already_interested: true } : c
          )
        );
        return mutual;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not express interest.');
        throw err;
      }
    },
    []
  );

  const saveProfile = useCallback(
    async (targetId: string, save: boolean) => {
      try {
        await saveFlatmateProfileConnection(targetId, save);
        setCandidates((prev) =>
          prev.map((c) =>
            c.id === targetId ? { ...c, already_saved: save } : c
          )
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update saved profile.');
        throw err;
      }
    },
    []
  );

  const reportProfile = useCallback(
    async (targetId: string, reason: string, details?: string) => {
      try {
        await reportFlatmateProfile(targetId, reason, details);
        setCandidates((prev) => prev.filter((c) => c.id !== targetId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not submit report.');
        throw err;
      }
    },
    []
  );

  // Prefill connection map when candidates load

  const canDiscover = myProfile
    ? myProfile.is_active && myProfile.completion_percentage >= 50
    : false;
  const completionPercentage = myProfile?.completion_percentage ?? 0;

  return {
    candidates,
    loading,
    error,
    refreshing,
    myProfile,
    myProfileLoading,
    filters,
    setFilters: setFiltersState,
    clearFilters,
    refresh,
    expressInterest,
    saveProfile,
    reportProfile,
    connectionStatus: connectionMap,
    canDiscover,
    completionPercentage,
  };
}
