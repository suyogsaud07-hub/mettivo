'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import MobileNav from '@/app/components/layout/MobileNav';
import { useFlatmateDiscovery } from '@/hooks/use-flatmate-discovery';
import FlatmateCard from '@/app/components/flatmate/FlatmateCard';
import FlatmateProfileModal from '@/app/components/flatmate/FlatmateProfileModal';
import type { FlatmateCandidate, FlatmateFilters } from '@/lib/flatmate';
import { Home, Filter, X as XIcon, Flame, Check, Link as LinkIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function FlatmatePage() {
  const router = useRouter();

  const {
    candidates: hookCandidates,
    loading,
    error,
    refreshing,
    myProfile,
    myProfileLoading,
    filters,
    setFilters,
    clearFilters,
    refresh,
    expressInterest,
    saveProfile,
    reportProfile,
    connectionStatus,
    canDiscover,
    completionPercentage,
  } = useFlatmateDiscovery();

  // Local candidates state for skip filtering
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());

  // Compute local candidates by filtering out skipped ones
  const localCandidates = useMemo(() => {
    return hookCandidates.filter(c => !skippedIds.has(c.id));
  }, [hookCandidates, skippedIds]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<FlatmateCandidate | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Auth gate
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user && !cancelled) {
        router.replace('/auth');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleInterest = useCallback(
    async (targetId: string) => {
      try {
        const mutual = await expressInterest(targetId);
        if (mutual) {
          showToast('success', "It's a flatmate match!");
        } else {
          showToast('success', 'Interest expressed');
        }
      } catch {
        // error already set by hook
      }
    },
    [expressInterest, showToast]
  );

  const handleSave = useCallback(
    async (targetId: string, save: boolean) => {
      try {
        await saveProfile(targetId, save);
        showToast('success', save ? 'Saved profile' : 'Unsaved profile');
      } catch {
        // error set by hook
      }
    },
    [saveProfile, showToast]
  );

  const handleSkip = useCallback((targetId: string) => {
    setSkippedIds(prev => {
      const next = new Set(prev);
      next.add(targetId);
      return next;
    });
  }, []);

  const openModal = useCallback((profile: FlatmateCandidate) => {
    setSelectedProfile(profile);
    setModalOpen(true);
  }, []);

  const handleReport = useCallback(async (targetId: string) => {
    const reason = prompt('Why are you reporting this profile?');
    if (!reason) return;
    try {
      await reportProfile(targetId, reason);
      showToast('success', 'Report submitted');
      setSkippedIds(prev => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not submit report' });
      setTimeout(() => setToast(null), 3000);
    }
  }, [reportProfile, showToast]);

  if (!canDiscover && !myProfileLoading) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-3xl text-[#D9B38C]">
          <Home size={32} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </div>
        <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
          Flatmate profile incomplete
        </h2>
        <p className="text-[#B58A83] text-sm max-w-xs leading-relaxed mb-6">
          Complete your flatmate profile (at least 50%) before browsing. Fill in your accommodation preferences and lifestyle details.
        </p>
        <button
          type="button"
          onClick={() => router.push('/flatmate/settings')}
          className="px-8 py-3 rounded-full bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-95 transition-all"
        >
          Complete profile
        </button>
        <MobileNav />
      </div>
    );
  }

  if (loading && !myProfile) {
    return (
      <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] flex flex-col items-center justify-center p-6">
        <div className="w-8 h-8 rounded-full border-4 border-[#D9B38C]/40 border-t-[#D9B38C] animate-spin" />
        <p className="mt-4 text-[#B58A83] text-sm">Loading Flatmate Find…</p>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="h-screen dvh:h-[100dvh] bg-[#17121A] text-[#F2E9E4] relative overflow-hidden">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-30 p-6 flex justify-between items-center pointer-events-none">
        <div className="bg-[#211A28]/80 backdrop-blur-md rounded-xl px-4 py-2 pointer-events-auto">
          <h1 className="text-lg font-bold text-[#F2E9E4]">Flatmate Find</h1>
        </div>
        <div className="bg-[#211A28]/80 backdrop-blur-md rounded-xl px-4 py-2 pointer-events-auto flex items-center gap-3">
          <span className="text-xs text-[#B58A83]">{localCandidates.length} nearby</span>
          <button
            type="button"
            onClick={() => setFiltersOpen((prev) => !prev)}
            aria-label="Filters"
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#F2E9E4] hover:bg-[#211A28] transition-colors"
          >
            <Filter size={18} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </button>
        </div>
      </header>

      <main className="relative flex flex-col h-full w-full items-center justify-center pt-24 pb-20 px-4">
        {error && (
          <div className="px-4 text-center">
            <p className="text-[#F3A7AD] text-sm">{error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 px-4 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F3A7AD] text-xs font-semibold hover:bg-[#34283F]/40 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {localCandidates.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-3xl text-[#D9B38C]">
              <Home size={32} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </div>
            <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
              {filters.city || filters.rentMax || filters.sleepingSchedule || filters.cleanliness || filters.smoking || filters.pets
                ? 'No flatmates match your filters'
                : 'No flatmates nearby yet'}
            </h2>
            <p className="text-[#B58A83] text-sm max-w-xs leading-relaxed mb-6">
              {filters.city || filters.rentMax || filters.sleepingSchedule || filters.cleanliness || filters.smoking || filters.pets
                ? 'Try adjusting your filters to see more profiles.'
                : 'Check back soon — new flatmates join regularly.'}
            </p>
            {filters.city || filters.rentMax || filters.sleepingSchedule || filters.cleanliness || filters.smoking || filters.pets && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-6 py-2 rounded-md bg-[#D9B38C] text-[#17121A] font-semibold text-sm hover:bg-[#cfab83] transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {localCandidates.map((candidate) => (
          <FlatmateCard
            key={candidate.id}
            candidate={candidate}
            pending={false}
            onInterest={(id) => handleInterest(id)}
            onSave={(id, save) => handleSave(id, save)}
            onSkip={(id) => handleSkip(id)}
            onViewProfile={(id) => {
              const prof = localCandidates.find((c) => c.id === id);
              if (prof) openModal(prof);
            }}
          />
        ))}

        <div className="pb-20" />
      </main>

      {/* Filters sheet */}
      {filtersOpen && (
        <div className="fixed inset-0 z-[60] bg-[#17121A]/90 backdrop-blur-sm" onClick={() => setFiltersOpen(false)} />
      )}
      {filtersOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-[60] h-[85vh] bg-[#17121A] rounded-t-3xl shadow-2xl border-t border-[#34283F]/40 p-6"
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-[#F2E9E4]">Filters</h3>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="w-8 h-8 rounded-full bg-[#211A28] flex items-center justify-center text-[#F2E9E4] hover:bg-[#211A28]/60"
            >
              <XIcon size={18} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[#B58A83] block mb-1">City</label>
              <input
                type="text"
                value={filters.city}
                onChange={(e) => setFilters({ city: e.target.value })}
                placeholder="e.g. Copenhagen"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#B58A83] block mb-1">Min rent</label>
                <input
                  type="number"
                  value={filters.rentMin ?? ''}
                  onChange={(e) => setFilters({ rentMin: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Min"
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-[#B58A83] block mb-1">Max rent</label>
                <input
                  type="number"
                  value={filters.rentMax ?? ''}
                  onChange={(e) => setFilters({ rentMax: e.target.value ? Number(e.target.value) : null })}
                  placeholder="Max"
                  className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block mb-1">Sleep schedule</label>
              <select
                value={filters.sleepingSchedule ?? ''}
                onChange={(e) => setFilters({ sleepingSchedule: e.target.value || null })}
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              >
                <option value="">Any</option>
                <option value="early_sleeper">Early sleeper</option>
                <option value="night_owl">Night owl</option>
                <option value="flexible">Flexible</option>
                <option value="irregular">Irregular</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block mb-1">Cleanliness</label>
              <select
                value={filters.cleanliness ?? ''}
                onChange={(e) => setFilters({ cleanliness: e.target.value || null })}
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              >
                <option value="">Any</option>
                <option value="very_tidy">Very tidy</option>
                <option value="generally_tidy">Generally tidy</option>
                <option value="relaxed">Relaxed</option>
                <option value="comfortable_mess">Comfortable with mess</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block mb-1">Smoking</label>
              <select
                value={filters.smoking ?? ''}
                onChange={(e) => setFilters({ smoking: e.target.value || null })}
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              >
                <option value="">Any</option>
                <option value="non_smoker">Non-smoker</option>
                <option value="smoker">Smoker</option>
                <option value="comfortable_smokers">Okay with smokers</option>
                <option value="prefers_smoke_free">Prefers smoke-free</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block mb-1">Pets</label>
              <select
                value={filters.pets ?? ''}
                onChange={(e) => setFilters({ pets: e.target.value || null })}
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              >
                <option value="">Any</option>
                <option value="has_pets">Has pets</option>
                <option value="likes_pets">Likes pets</option>
                <option value="comfortable_pets">Comfortable with pets</option>
                <option value="no_pets">No pets</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setFiltersOpen(false);
                }}
                className="flex-1 px-4 py-2 rounded-md bg-transparent border border-[#34283F]/40 text-[#B58A83] text-sm hover:bg-[#34283F]/40 transition-colors"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 px-6 py-3 rounded-md bg-[#D9B38C] text-[#17121A] font-semibold hover:bg-[#cfab83] transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Modal */}
      {selectedProfile && modalOpen && (
        <FlatmateProfileModal
          profile={selectedProfile}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          connectionStatus={connectionStatus.get(selectedProfile.id)}
          onExpressInterest={(id) => {
            handleInterest(id);
            setModalOpen(false);
          }}
          onSaveProfile={(id, save) => {
            handleSave(id, save);
            setModalOpen(false);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-6 right-6 z-[70] flex items-center gap-3 rounded-xl bg-[#1C1822] border border-[#34283F]/60 p-4 shadow-2xl backdrop-blur-md text-[#F2E9E4]">
          <span className="text-xs text-[#B58A83]">{toast.type === 'success' ? '&#10003;' : '&#10007;'}</span>
          <span className="flex-1 text-sm">{toast.message}</span>
        </div>
      )}

      <MobileNav />
    </div>
  );
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
