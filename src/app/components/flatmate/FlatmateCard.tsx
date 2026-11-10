'use client';

import { useCallback, useMemo } from 'react';
import {
  Moon, Sun, Cloud, Flame, Droplet, Users, Coffee, Home, Bed, X, Check,
} from 'lucide-react';
import Link from 'next/link';
import { Link as LinkIcon } from 'lucide-react';
import type { FlatmateCandidate } from '@/lib/flatmate';

interface FlatmateCardProps {
  candidate: FlatmateCandidate;
  pending: boolean;
  onInterest: (targetId: string) => void;
  onSave: (targetId: string, save: boolean) => void;
  onSkip: (targetId: string) => void;
  onViewProfile: (targetId: string) => void;
  onMessage?: (targetId: string) => void;
  onOpenMenu?: (targetId: string) => void;
  menuOpen?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  early_sleeper: 'Early sleeper',
  night_owl: 'Night owl',
  flexible: 'Flexible schedule',
  irregular: 'Irregular schedule',
  very_tidy: 'Very tidy',
  generally_tidy: 'Generally tidy',
  relaxed: 'Relaxed',
  comfortable_mess: 'Comfortable with mess',
  non_smoker: 'Non-smoker',
  smoker: 'Smoker',
  comfortable_smokers: 'Okay with smokers',
  prefers_smoke_free: 'Smoke-free home',
  has_pets: 'Has pets',
  likes_pets: 'Likes pets',
  comfortable_pets: 'Okay with pets',
  no_pets: 'No pets',
  quiet_private: 'Quiet & private',
  occasionally_social: 'Occasionally social',
  frequently_social: 'Frequently social',
  enjoys_hosting: 'Enjoys hosting',
  cooks_regularly: 'Cooks regularly',
  occasionally_cooks: 'Occasionally cooks',
  orders_food: 'Orders food',
  shared_cooking: 'Shared cooking',
  occasional_guests: 'Occasional guests',
  frequently_hosts: 'Frequently hosts',
  limited_visitors: 'Limited visitors',
  no_visitors: 'No visitors',
  very_quiet: 'Very quiet',
  moderate_noise: 'Moderate noise',
  works_from_home: 'Works from home',
  studies_from_home: 'Studies from home',
  works_outside: 'Works outside',
  university_schedule: 'University schedule',
  mixed_schedule: 'Mixed schedule',
  shared_cleaning: 'Shared cleaning',
  rotating_cleaning: 'Rotating cleaning',
  individual_responsibilities: 'Individual chores',
  other_arrangements: 'Other arrangement',
  equal: 'Equal split',
  proportional: 'Proportional split',
  room_based: 'Room-based split',
  negotiated: 'Negotiated',
};

function statusIcon(value: string | null): React.ReactNode {
  if (!value) return <div className="w-5 h-5" />;
  const iconMap: Record<string, React.ReactNode> = {
    early_sleeper: <Moon className="w-5 h-5" />,
    night_owl: <Moon className="w-5 h-5" />,
    flexible: <Sun className="w-5 h-5" />,
    irregular: <Cloud className="w-5 h-5" />,
    very_tidy: <Check className="w-5 h-5" />,
    generally_tidy: <Check className="w-5 h-5" />,
    relaxed: <Cloud className="w-5 h-5" />,
    comfortable_mess: <Cloud className="w-5 h-5" />,
    non_smoker: <Droplet className="w-5 h-5" />,
    smoker: <Flame className="w-5 h-5" />,
    comfortable_smokers: <Flame className="w-5 h-5" />,
    prefers_smoke_free: <Droplet className="w-5 h-5" />,
    has_pets: <Home className="w-5 h-5" />,
    likes_pets: <Home className="w-5 h-5" />,
    comfortable_pets: <Home className="w-5 h-5" />,
    no_pets: <X className="w-5 h-5" />,
    quiet_private: <Users className="w-5 h-5" />,
    occasionally_social: <Users className="w-5 h-5" />,
    frequently_social: <Users className="w-5 h-5" />,
    enjoys_hosting: <Users className="w-5 h-5" />,
    cooks_regularly: <Coffee className="w-5 h-5" />,
    occasionally_cooks: <Coffee className="w-5 h-5" />,
    orders_food: <Coffee className="w-5 h-5" />,
    shared_cooking: <Coffee className="w-5 h-5" />,
    occasional_guests: <Users className="w-5 h-5" />,
    frequently_hosts: <Users className="w-5 h-5" />,
    limited_visitors: <Users className="w-5 h-5" />,
    no_visitors: <Users className="w-5 h-5" />,
    very_quiet: <Cloud className="w-5 h-5" />,
    moderate_noise: <Cloud className="w-5 h-5" />,
    works_from_home: <Home className="w-5 h-5" />,
    studies_from_home: <Home className="w-5 h-5" />,
    works_outside: <Home className="w-5 h-5" />,
    university_schedule: <Home className="w-5 h-5" />,
    mixed_schedule: <Home className="w-5 h-5" />,
    shared_cleaning: <Check className="w-5 h-5" />,
    rotating_cleaning: <Check className="w-5 h-5" />,
    individual_responsibilities: <Check className="w-5 h-5" />,
    other_arrangements: <Check className="w-5 h-5" />,
  };
  return iconMap[value] || <div className="w-5 h-5" />;
}

export default function FlatmateCard({
  candidate,
  pending,
  onInterest,
  onSave,
  onSkip,
  onViewProfile,
  onMessage,
  onOpenMenu,
  menuOpen,
}: FlatmateCardProps) {
  const score = useMemo(() => candidate.compatibility_score, [candidate.compatibility_score]);
  const conflicts = useMemo(() => candidate.compatibility_breakdown.conflicts, [candidate.compatibility_breakdown]);
  const matches = useMemo(() => candidate.compatibility_breakdown.matches, [candidate.compatibility_breakdown]);

  const primaryPhoto = candidate.photos[0] ?? null;

  const budgetText = useMemo(() => {
    if (candidate.rent_budget_max) return `Up to $${candidate.rent_budget_max}/mo`;
    if (candidate.rent_budget_min) return `From $${candidate.rent_budget_min}/mo`;
    return 'Budget not set';
  }, [candidate.rent_budget_max, candidate.rent_budget_min]);

  const lookingForText = useMemo(() => {
    if (candidate.looking_for_room && candidate.offering_room) return 'Room & flatmate';
    if (candidate.looking_for_room) return 'Looking for a room';
    return 'Offering a room';
  }, [candidate.looking_for_room, candidate.offering_room]);

  const lifestyleBadges = useMemo(() => {
    const items: { label: string; icon: React.ReactNode }[] = [];
    if (candidate.sleeping_schedule) items.push({ label: STATUS_LABELS[candidate.sleeping_schedule] ?? candidate.sleeping_schedule, icon: statusIcon(candidate.sleeping_schedule) });
    if (candidate.cleanliness) items.push({ label: STATUS_LABELS[candidate.cleanliness] ?? candidate.cleanliness, icon: statusIcon(candidate.cleanliness) });
    if (candidate.smoking) items.push({ label: STATUS_LABELS[candidate.smoking] ?? candidate.smoking, icon: statusIcon(candidate.smoking) });
    if (candidate.pets) items.push({ label: STATUS_LABELS[candidate.pets] ?? candidate.pets, icon: statusIcon(candidate.pets) });
    return items;
  }, [candidate.sleeping_schedule, candidate.cleanliness, candidate.smoking, candidate.pets]);

  const handleInterest = useCallback(() => {
    if (pending || !candidate.id) return;
    onInterest(candidate.id);
  }, [pending, candidate.id, onInterest]);

  const handleSave = useCallback(() => {
    if (pending || !candidate.id) return;
    onSave(candidate.id, !candidate.already_saved);
  }, [pending, candidate.id, candidate.already_saved, onSave]);

  const handleSkip = useCallback(() => {
    if (pending || !candidate.id) return;
    onSkip(candidate.id);
  }, [pending, candidate.id, onSkip]);

  const handleMessage = useCallback(() => {
    if (pending || !candidate.id || !onMessage) return;
    onMessage(candidate.id);
  }, [pending, candidate.id, onMessage]);

  const scoreColor = useMemo(() => {
    if (score >= 70) return 'text-[#10B981]';
    if (score >= 40) return 'text-[#D9B38C]';
    return 'text-[#F3A7AD]';
  }, [score]);

  return (
    <article className="flatmate-card bg-[#17121A] border border-[#34283F]/40 rounded-3xl overflow-hidden shadow-2xl">
      {/* Photo */}
      <div className="relative h-72 bg-[#1C1822]">
        {primaryPhoto ? (
          <img
            src={primaryPhoto}
            alt={`${candidate.first_name}, ${candidate.age}`}
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#6B5B79] text-4xl">
            {candidate.first_name.slice(0, 1).toUpperCase()}
          </div>
        )}
        {/* Compatibility badge */}
        <div className="absolute top-4 right-4">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#17121A]/90 backdrop-blur border border-[#34283F]/40`}>
            <span className={`font-bold ${scoreColor}`}>{score}</span>
            <span className="text-xs text-[#B58A83]">match</span>
          </div>
        </div>
        {/* Looking for tag */}
        <div className="absolute bottom-4 left-4 z-20">
          <span className="px-2.5 py-1 rounded-full bg-[#D9B38C]/10 text-[#D9B38C] text-[10px] font-medium border border-[#D9B38C]/30">
            {lookingForText}
          </span>
        </div>
        {/* Reject button overlay */}
        <button
          type="button"
          onClick={handleSkip}
          aria-label="Skip profile"
          className="absolute top-4 left-4 z-20 w-10 h-10 rounded-full bg-[#17121A]/80 backdrop-blur-sm flex items-center justify-center text-[#F3A7AD] hover:bg-[#17121A] transition-colors disabled:opacity-50"
          disabled={pending}
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Info */}
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-[#F2E9E4] leading-tight">
              {candidate.first_name}
              {candidate.age ? <span className="ml-2 text-[#D9B38C] text-lg">{candidate.age}</span> : null}
            </h2>
            {candidate.occupation ? (
              <p className="text-xs text-[#B58A83]">{candidate.occupation}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onViewProfile(candidate.id)}
            aria-label={`View ${candidate.first_name}'s profile`}
            className="w-9 h-9 rounded-full bg-[#17121A]/80 backdrop-blur-sm border border-[#34283F]/40 flex items-center justify-center text-[#F2E9E4] hover:bg-[#17121A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={pending}
          >
            <LinkIcon size={18} strokeWidth={2.5} />
          </button>
        </div>

        {budgetText && (
          <p className="text-[#10B981] text-sm font-bold">{budgetText}</p>
        )}

        {candidate.move_in_date && (
          <p className="text-[#B58A83] text-sm">
            Moving {new Date(candidate.move_in_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>
        )}

        {/* Lifestyle badges */}
        {lifestyleBadges.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {lifestyleBadges.map((item, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-full border border-[#34283F]/40 bg-[#17121A]/60 backdrop-blur-sm text-[10px] font-medium text-[#B58A83]">
                {item.icon}
                <span>{item.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* Compatibility explanation */}
        <div className="pt-2 border-t border-[#34283F]/30">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className={scoreColor}>Compatibility</span>
            <span className="text-[#6B5B79]">breakdown</span>
          </div>
          {matches.length > 0 && (
            <div className="flex items-center gap-1 mb-2">
              <Check className="w-3 h-3 text-[#10B981]" />
              <span className="text-[#B58A83] text-[10px]">{matches[0]}</span>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="flex items-center gap-1">
              <X className="w-3 h-3 text-[#F3A7AD]" />
              <span className="text-[#F3A7AD] text-[10px]">{conflicts[0]}</span>
            </div>
          )}
          {(matches.length === 0 && conflicts.length === 0) && (
            <p className="text-[#6B5B79] text-[10px]">Building compatibility…</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 flex items-center gap-3 border-t border-[#34283F]/40">
        <button
          type="button"
          onClick={handleSave}
          aria-label={candidate.already_saved ? 'Unsave profile' : 'Save profile'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            candidate.already_saved
              ? 'bg-[#D9B38C] text-[#17121A]'
              : 'bg-[#17121A] border border-[#34283F]/40 text-[#F2E9E4] hover:bg-[#17121A]/60'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          disabled={pending}
        >
          <Check size={20} strokeWidth={2.5} />
        </button>

        <button
          type="button"
          onClick={handleInterest}
          aria-label={`Express interest in ${candidate.first_name}`}
          className={`w-20 h-12 rounded-xl flex items-center justify-center gap-2 transition-colors ${
            candidate.already_interested
              ? 'bg-[#10B981] text-[#17121A]'
              : 'bg-[#17121A] border border-[#34283F]/40 text-[#F2E9E4] hover:bg-[#17121A]/60'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          disabled={pending || candidate.already_interested}
        >
          <Flame size={16} strokeWidth={2.5} />
          <span className="text-[10px] font-bold">{candidate.already_interested ? 'Interested' : 'Interest'}</span>
        </button>

        {onMessage && (
          <button
            type="button"
            onClick={handleMessage}
            aria-label={`Message ${candidate.first_name}`}
            disabled={pending}
            className={`w-full rounded-xl flex items-center justify-center gap-2 transition-colors border border-[#D9B38C]/40 bg-[#D9B38C]/10 text-[#D9B38C] text-[10px] font-bold py-2 hover:bg-[#D9B38C]/20 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span className="flex items-center gap-1">Message</span>
          </button>
        )}
      </div>
    </article>
  );
}
