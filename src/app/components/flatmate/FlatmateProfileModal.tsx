'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AnimatePresence,
  motion,
} from 'framer-motion';
import { MapPin, X, Check, X as XIcon } from 'lucide-react';
import Link from 'next/link';
import type { FlatmateProfile } from '@/lib/flatmate';

interface FlatmateProfileModalProps {
  profile: FlatmateProfile;
  isOpen: boolean;
  onClose: () => void;
  onVisitProfile?: () => void;
  connectionStatus?: { interested: boolean; saved: boolean; skipped: boolean };
  onExpressInterest?: (targetId: string) => void;
  onSaveProfile?: (targetId: string, save: boolean) => void;
}

function formatCurrency(value: number | null): string | null {
  if (value === null) return null;
  return `$${value}`;
}

function formatMoveIn(date: string | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function statusLabel(value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    early_sleeper: 'Early sleeper',
    night_owl: 'Night owl',
    flexible: 'Flexible',
    irregular: 'Irregular',
    very_tidy: 'Very tidy',
    generally_tidy: 'Generally tidy',
    relaxed: 'Relaxed',
    comfortable_mess: 'Comfortable with mess',
    non_smoker: 'Non-smoker',
    smoker: 'Smoker',
    comfortable_smokers: 'Okay with smokers',
    prefers_smoke_free: 'Prefers smoke-free',
    has_pets: 'Has pets',
    likes_pets: 'Likes pets',
    comfortable_pets: 'Comfortable with pets',
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
    flexible_noise: 'Flexible',
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
    private: 'Private room',
    shared: 'Shared room',
    studio: 'Studio',
    entire_place: 'Entire place',
  };
  return labels[value] ?? value;
}

export default function FlatmateProfileModal({
  profile,
  isOpen,
  onClose,
  onVisitProfile,
  connectionStatus,
  onExpressInterest,
  onSaveProfile,
}: FlatmateProfileModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const photos = (profile.photos ?? []).filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  const hasPhoto = photos.length > 0;

  const handleClose = useCallback(() => {
    setCurrentIndex(0);
    setImageError(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      if (previousActiveRef.current) {
        previousActiveRef.current.focus({ preventScroll: true });
      }
    };
  }, [isOpen, handleClose]);

  const goToPrevious = useCallback(() => {
    if (photos.length <= 1) return;
    setImageError(false);
    setCurrentIndex((prev) => (prev === 0 ? photos.length - 1 : prev - 1));
  }, [photos.length]);

  const goToNext = useCallback(() => {
    if (photos.length <= 1) return;
    setImageError(false);
    setCurrentIndex((prev) => (prev === photos.length - 1 ? 0 : prev + 1));
  }, [photos.length]);

  const handleHeroClick = useCallback(
    (event: React.MouseEvent, side: 'left' | 'right') => {
      event.stopPropagation();
      if (side === 'left') goToPrevious();
      else goToNext();
    },
    [goToPrevious, goToNext]
  );

  const handleExpressInterest = useCallback(() => {
    if (!onExpressInterest) return;
    onExpressInterest(profile.id);
  }, [profile.id, onExpressInterest]);

  const handleSaveProfile = useCallback(() => {
    if (!onSaveProfile) return;
    onSaveProfile(profile.id, !connectionStatus?.saved);
  }, [profile.id, connectionStatus?.saved, onSaveProfile]);

  const isVerified = true; // placeholder - flatmate profiles don't have verification yet

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            className="fixed inset-0 z-50 bg-[#17121A]/90 backdrop-blur-sm"
          />
          <motion.div
            ref={modalRef}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(event) => event.stopPropagation()}
            className="fixed inset-0 z-50 bg-[#17121A] overflow-y-auto"
          >
            {/* Header */}
            <header className="relative z-10 px-6 pt-8 pb-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close profile"
                  className="w-10 h-10 rounded-full bg-[#17121A]/80 border border-[#34283F]/40 flex items-center justify-center text-[#F2E9E4] hover:bg-[#17121A] transition-colors"
                >
                  <X size={20} strokeWidth={2.5} />
                </button>
              </div>
            </header>

            {/* Hero */}
            <section className="relative">
              {hasPhoto ? (
                <>
                  <div className="relative w-full h-[56vh] bg-[#1C1822]" style={{ minHeight: 320 }}>
                    {imageError ? (
                      <div className="w-full h-full bg-[#211A28] flex items-center justify-center rounded-2xl border border-[#34283F]/40">
                        <span className="text-6xl">📷</span>
                      </div>
                    ) : (
                      <img
                        key={currentIndex}
                        src={photos[currentIndex]}
                        alt={`${profile.first_name}, photo ${currentIndex + 1} of ${photos.length}`}
                        className="w-full h-full object-cover"
                        loading={currentIndex === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        onError={() => setImageError(true)}
                      />
                    )}
                    {photos.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={(event) => handleHeroClick(event, 'left')}
                          aria-label="Previous photo"
                          className="absolute left-0 top-0 bottom-0 w-[35%] z-20 bg-transparent hover:bg-white/5 active:bg-white/10"
                        />
                        <button
                          type="button"
                          onClick={(event) => handleHeroClick(event, 'right')}
                          aria-label="Next photo"
                          className="absolute right-0 top-0 bottom-0 w-[65%] z-20 bg-transparent hover:bg-white/5 active:bg-white/10"
                        />
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
                          <span className="text-xs font-medium text-[#F2E9E4]">{currentIndex + 1}</span>
                          <span className="text-xs text-[#B58A83]">of</span>
                          <span className="text-xs font-medium text-[#F2E9E4]">{photos.length}</span>
                        </div>
                      </>
                    )}
                    {photos.length > 1 && (
                      <div className="mx-6 mt-4 overflow-x-auto flex flex-nowrap gap-2 pb-4">
                        {photos.map((photo, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCurrentIndex(i);
                            }}
                            aria-label={`View photo ${i + 1}`}
                            className={`shrink-0 w-16 h-20 rounded-xl overflow-hidden border ${
                              i === currentIndex ? 'border-[#D9B38C]' : 'border-[#34283F]/40'
                            } bg-[#1C1822]`}
                            style={{
                              backgroundImage: `url("${photo}")`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-[56vh] w-full bg-[#1C1822] flex items-center justify-center rounded-2xl border border-[#34283F]/40">
                  <span className="text-6xl">👤</span>
                </div>
              )}
            </section>

            <div className="px-6 pb-12 space-y-6">
              {/* Profile identity */}
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-[#F2E9E4] tracking-tight">
                      {profile.first_name}
                      {profile.age ? <span className="ml-2 text-[#D9B38C] text-xl md:text-2xl">{profile.age}</span> : null}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {isVerified && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[#D9B38C]/40 bg-[#D9B38C]/10 text-[#D9B38C] text-[11px] font-medium">
                          <span className="text-[11px]">&#x2705;</span>
                          <span>Flatmate verified</span>
                        </span>
                      )}
                      {profile.preferred_living_arrangement && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[#34283F]/40 bg-[#34283F]/40 text-[#B58A83] text-[11px] font-medium">
                          {statusLabel(profile.preferred_living_arrangement)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right hidden md:block">
                    {profile.preferred_city && (
                      <p className="text-[#B58A83] text-sm font-medium">{profile.preferred_city}</p>
                    )}
                    {profile.preferred_neighbourhood && (
                      <p className="text-[#B58A83] text-sm">{profile.preferred_neighbourhood}</p>
                    )}
                    {formatMoveIn(profile.move_in_date) && (
                      <p className="text-[#D9B38C] text-sm font-medium">Move-in {formatMoveIn(profile.move_in_date)}</p>
                    )}
                  </div>
                </div>
              </section>

              {/* About me */}
              {profile.introduction && profile.introduction.trim().length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">About me</h3>
                  <p className="mt-1 text-[#F2E9E4] text-sm leading-relaxed">{profile.introduction}</p>
                </section>
              )}

              {/* Accommodation requirements */}
              {(profile.preferred_city || profile.rent_budget_max || profile.move_in_date || profile.room_type) && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Accommodation</h3>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {profile.preferred_city && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Preferred city</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.preferred_city}</dd>
                      </>
                    )}
                    {profile.preferred_neighbourhood && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Neighbourhood</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.preferred_neighbourhood}</dd>
                      </>
                    )}
                    {profile.rent_budget_max && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Budget</dt>
                        <dd className="text-[#F2E9E4] text-sm">Up to ${profile.rent_budget_max}/mo</dd>
                      </>
                    )}
                    {profile.move_in_date && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Move-in</dt>
                        <dd className="text-[#F2E9E4] text-sm">{formatMoveIn(profile.move_in_date)}</dd>
                      </>
                    )}
                    {profile.room_type && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Room type</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.room_type)}</dd>
                      </>
                    )}
                    {profile.furnished !== undefined && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Furnished</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.furnished ? 'Yes' : 'No'}</dd>
                      </>
                    )}
                    {profile.utilities_included !== undefined && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Utilities</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.utilities_included ? 'Included' : 'Not included'}</dd>
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* Lifestyle */}
              {(profile.sleeping_schedule || profile.cleanliness || profile.smoking || profile.pets || profile.social_lifestyle || profile.cooking || profile.guests || profile.noise_tolerance || profile.work_study_routine || profile.household_responsibilities) && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Lifestyle</h3>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {profile.sleeping_schedule && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Sleep schedule</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.sleeping_schedule)}</dd>
                      </>
                    )}
                    {profile.cleanliness && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Cleanliness</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.cleanliness)}</dd>
                      </>
                    )}
                    {profile.smoking && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Smoking</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.smoking)}</dd>
                      </>
                    )}
                    {profile.pets && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Pets</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.pets)}</dd>
                      </>
                    )}
                    {profile.social_lifestyle && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Social</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.social_lifestyle)}</dd>
                      </>
                    )}
                    {profile.cooking && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Cooking</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.cooking)}</dd>
                      </>
                    )}
                    {profile.guests && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Guests</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.guests)}</dd>
                      </>
                    )}
                    {profile.noise_tolerance && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Noise</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.noise_tolerance)}</dd>
                      </>
                    )}
                    {profile.work_study_routine && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Work/study</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.work_study_routine)}</dd>
                      </>
                    )}
                    {profile.household_responsibilities && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Household</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.household_responsibilities)}</dd>
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* Financial */}
              {(profile.rent_sharing_arrangement || profile.utilities_budget || profile.deposit_expectations || profile.payment_frequency || profile.additional_expenses) && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Financial</h3>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {profile.rent_sharing_arrangement && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Rent sharing</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.rent_sharing_arrangement)}</dd>
                      </>
                    )}
                    {profile.utilities_budget && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Utilities budget</dt>
                        <dd className="text-[#F2E9E4] text-sm">${profile.utilities_budget}/mo</dd>
                      </>
                    )}
                    {profile.payment_frequency && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Pay frequency</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{statusLabel(profile.payment_frequency)}</dd>
                      </>
                    )}
                    {profile.deposit_expectations && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Deposit</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.deposit_expectations}</dd>
                      </>
                    )}
                    {profile.additional_expenses && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Other expenses</dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.additional_expenses}</dd>
                      </>
                    )}
                  </div>
                </section>
              )}

              {/* Completion indicator */}
              <section className="pt-2 border-t border-[#34283F]/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Profile completion</span>
                  <span className="text-xs text-[#F2E9E4] font-bold">{profile.completion_percentage}%</span>
                </div>
                <div className="w-full h-1.5 bg-[#34283F]/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#D9B38C] rounded-full transition-all duration-500"
                    style={{ width: Math.min(100, profile.completion_percentage) + '%' }}
                  />
                </div>
                {profile.completion_percentage < 50 && (
                  <p className="text-xs text-[#F3A7AD] mt-1">Complete your profile to appear in discovery.</p>
                )}
              </section>

              {/* Action buttons */}
              <div className="flex flex-col gap-3 pt-4">
                {connectionStatus?.interested ? (
                  <button
                    type="button"
                    disabled
                    className="w-full px-6 py-3.5 rounded-xl bg-[#10B981] text-[#17121A] font-semibold text-sm shadow-lg opacity-70 cursor-not-allowed"
                  >
                    Interest expressed
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleExpressInterest}
                    disabled={!onExpressInterest}
                    className={`w-full px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors ${
                      !onExpressInterest
                        ? 'bg-[#17121A] border border-[#34283F]/40 text-[#6B5B79] opacity-50 cursor-not-allowed'
                        : 'bg-[#10B981] text-[#17121A] font-semibold shadow-lg hover:bg-[#5EEAD4] active:scale-[0.98]'
                    }`}
                  >
                    <FlameIcon size={18} strokeWidth={2.5} />
                    <span>Express interest</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={!onSaveProfile}
                  className={`w-full px-6 py-3.5 rounded-xl mt-3 transition-colors ${
                    !onSaveProfile
                      ? 'bg-[#17121A] border border-[#34283F]/40 text-[#6B5B79] opacity-50 cursor-not-allowed'
                      : connectionStatus?.saved
                        ? 'bg-[#D9B38C] text-[#17121A] font-semibold shadow-lg hover:bg-[#cfab83] active:scale-[0.98]'
                        : 'bg-[#17121A] border border-[#34283F]/40 text-[#F2E9E4] font-semibold shadow-lg hover:bg-[#17121A]/60 active:scale-[0.98]'
                    }`}
                  >
                    <SaveIcon size={18} strokeWidth={2.5} />
                    <span>{connectionStatus?.saved ? 'Saved' : 'Save profile'}</span>
                  </button>
                {onVisitProfile && (
                  <Link
                    href="/profile/discovery"
                    onClick={(e) => {
                      e.preventDefault();
                      onVisitProfile();
                    }}
                    className="w-full px-6 py-3.5 rounded-xl bg-[#29202D] border border-[#D9B38C]/60 text-[#D9B38C] font-semibold text-sm shadow-lg hover:bg-[#D9B38C]/10 hover:text-[#F2E9E4] active:scale-[0.98] transition-all"
                  >
                    View full profile
                  </Link>
                )}
              </div>

              <p className="text-xs text-[#B58A83]/60 text-center">Tap outside or press Escape to close</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function FlameIcon({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2c-1.1 0-2 .9-2 2s.9 2 2 2c1.3 0 2.4 1 2.8 2.2.1.2.1.5-.1.7-.7 1-2 1.8-3.2 1.8-1.3 0-2.4-1-2.8-2.2-.1-.2-.1-.5.1-.7.7-1 2-1.8 3.2-1.8" />
    </svg>
  );
}

function SaveIcon({ size = 18, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    </svg>
  );
}
