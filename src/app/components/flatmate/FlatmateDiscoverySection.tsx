'use client';

import { useCallback, useState } from 'react';
import {
  useFlatmateDiscovery,
  FlatmateFilters,
} from '@/hooks/use-flatmate-discovery';
import FlatmateCard from '@/app/components/flatmate/FlatmateCard';
import type { FlatmateCandidate } from '@/lib/flatmate';

interface FlatmateDiscoverySectionProps {
  candidates: FlatmateCandidate[];
  loading: boolean;
  error: string | null;
  canDiscover: boolean;
  completionPercentage: number;
  refresh: () => void;
}

export default function FlatmateDiscoverySection({
  candidates: passedCandidates,
  loading,
  error,
  canDiscover,
  completionPercentage,
  refresh,
}: FlatmateDiscoverySectionProps) {
  const [filterTab, setFilterTab] = useState<'have' | 'need' | 'all'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const {
    filters,
    setFilters,
    clearFilters,
    expressInterest,
    saveProfile,
    reportProfile,
    connectionStatus,
  } = useFlatmateDiscovery();

  // Category filter based on looking_for_room / offering_room
  const haveFlatCandidates = passedCandidates.filter((c) => c.offering_room);
  const needFlatCandidates = passedCandidates.filter(
    (c) => c.looking_for_room && !c.offering_room
  );

  const visibleCandidates =
    filterTab === 'have'
      ? haveFlatCandidates
      : filterTab === 'need'
        ? needFlatCandidates
        : passedCandidates;

  const hasFilters =
    filters.city !== '' ||
    filters.rentMin !== null ||
    filters.rentMax !== null ||
    filters.moveInAfter !== null ||
    filters.sleepingSchedule !== null ||
    filters.cleanliness !== null ||
    filters.smoking !== null ||
    filters.pets !== null;

  if (!canDiscover) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-3xl text-[#D9B38C]">
          <HomeIcon />
        </div>
        <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
          Complete your flatmate profile
        </h2>
        <p className="text-[#B58A83] text-sm max-w-xs leading-relaxed mb-6">
          You need to complete at least 50% of your flatmate profile before you can browse.
          Current completion: {completionPercentage}%
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = '/flatmate/settings';
          }}
          className="px-8 py-3 rounded-full bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-95 transition-all"
        >
          Complete profile
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="w-8 h-8 rounded-full border-4 border-[#D9B38C]/40 border-t-[#D9B38C] animate-spin" />
        <p className="mt-4 text-[#B58A83] text-sm">Loading flatmates…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <p className="text-[#F3A7AD] text-sm">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-4 px-4 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F3A7AD] text-xs font-semibold hover:bg-[#34283F]/40 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (visibleCandidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[#211A28] border border-[#34283F]/40 flex items-center justify-center mb-6 text-3xl text-[#D9B38C]">
          <HomeIcon />
        </div>
        <h2 className="text-xl font-bold text-[#F2E9E4] mb-2">
          {filterTab === 'have'
            ? 'No flats available'
            : filterTab === 'need'
              ? 'No flatmates looking'
              : 'No flatmates found'}
        </h2>
        <p className="text-[#B58A83] text-sm max-w-xs leading-relaxed mb-6">
          {hasFilters
            ? 'Try adjusting your filters to see more profiles.'
            : 'Check back soon — new flatmates join regularly.'}
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="px-6 py-2 rounded-md bg-[#D9B38C] text-[#17121A] font-semibold text-sm hover:bg-[#cfab83] transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Category tabs */}
      <div className="flex gap-1 rounded-xl bg-[#211A28]/60 backdrop-blur-md border border-[#34283F]/40 px-1.5 py-1.5">
        {[
          { key: 'all' as const, label: 'All' },
          { key: 'have' as const, label: 'Have a Flat' },
          { key: 'need' as const, label: 'Need a Flat' },
        ].map((tab) => {
          const isActive = filterTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterTab(tab.key)}
              aria-pressed={isActive}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-[#D9B38C] text-[#17121A] shadow-sm'
                  : 'text-[#B58A83] hover:text-[#F2E9E4] hover:bg-[#211A28]/40'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filters toggle */}
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-bold text-[#B58A83] uppercase tracking-wider">
          Filters ({hasFilters ? 'active' : 'inactive'})
        </h3>
        <button
          type="button"
          onClick={() => setFiltersOpen((prev) => !prev)}
          className="text-xs text-[#D9B38C] hover:text-[#F2E9E4] hover:underline"
        >
          {filtersOpen ? 'Hide' : 'Show'} filters
        </button>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <div className="mb-4 p-4 rounded-xl bg-[#211A28] border border-[#34283F]/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">City</label>
              <input
                type="text"
                value={filters.city}
                onChange={(e) => setFilters({ city: e.target.value })}
                placeholder="City"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-[#B58A83] block">Max rent</label>
              <input
                type="number"
                value={filters.rentMax ?? ''}
                onChange={(e) =>
                  setFilters({ rentMax: e.target.value ? Number(e.target.value) : null })}
                placeholder="Max"
                className="w-full px-3 py-2 rounded-md bg-[#211A28] border border-[#34283F]/40 text-[#F2E9E4] text-sm focus:border-[#D9B38C] focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-2 mt-2">
            <label className="text-xs text-[#B58A83] block">Sleep schedule</label>
            <select
              value={filters.sleepingSchedule ?? ''}
              onChange={(e) =>
                setFilters({ sleepingSchedule: e.target.value || null })}
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
            <label className="text-xs text-[#B58A83] block">Cleanliness</label>
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
            <label className="text-xs text-[#B58A83] block">Smoking</label>
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
            <label className="text-xs text-[#B58A83] block">Pets</label>
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
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                setFilters({
                  city: '',
                  rentMin: null,
                  rentMax: null,
                  moveInAfter: null,
                  sleepingSchedule: null,
                  cleanliness: null,
                  smoking: null,
                  pets: null,
                });
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
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {visibleCandidates.map((candidate) => (
          <FlatmateCard
            key={candidate.id}
            candidate={candidate}
            pending={false}
            onInterest={(id) => expressInterest(id)}
            onSave={(id, save) => saveProfile(id, save)}
            onSkip={(id) => {
              // Skip just removes from visible list
            }}
            onViewProfile={(id) => {
              // Open profile modal - handled by parent via onVisitProfile
            }}
          />
        ))}
      </div>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
