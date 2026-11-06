/* eslint-disable @next/next/no-img-element */

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
import { MapPin, X } from 'lucide-react';
import InterestChips from './InterestChips';

interface ProfileDetailModalProps {
  profile: {
    id: string;
    displayName: string;
    firstName: string | null;
    lastName: string | null;
    hasLastName: boolean;
    username: string | null;
    age: number | null;
    gender: string | null;
    city: string | null;
    country: string | null;
    avatarUrl: string | null;
    photos: string[];
    bio: string | null;
    intention: string | null;
    lookingFor: string[];
    hobbies: string[];
    pets: string[];
    mbti: string | null;
    interests: string[];
    casualIntent: string | null;
    online: boolean | null;
    isVerified: boolean | null;
    distanceText: string | null;
    distanceMeters: number | null;
  };
  isOpen: boolean;
  onClose: () => void;
  /** Navigates to the member's public profile. Supplied by the page so the
   *  modal stays free of the router context (and therefore testable). */
  onVisitProfile?: () => void;
}

function formatLocation(profile: ProfileDetailModalProps['profile']): string | null {
  const parts = [profile.city, profile.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Drop null, undefined, empty and whitespace-only photo entries. Legitimate
 *  Supabase storage paths (relative URLs) are preserved. */
function normalizePhotos(photos: string[]): string[] {
  return photos.filter((photo) => typeof photo === 'string' && photo.trim().length > 0);
}

export default function ProfileDetailModal({
  profile,
  isOpen,
  onClose,
  onVisitProfile,
}: ProfileDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const photos = normalizePhotos(profile.photos);
  const locationText = formatLocation(profile);

  // Lock body scroll while the modal is open; restore on close / unmount.
  const handleClose = useCallback(() => {
    setImageError(false);
    setCurrentIndex(0);
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

  const handleThumbClick = useCallback(
    (index: number) => {
      setImageError(false);
      setCurrentIndex(index);
    },
    []
  );

  const handleVisitProfile = useCallback(() => {
    if (onVisitProfile) {
      onVisitProfile();
    }
  }, [onVisitProfile]);

  const hasEssentials = Boolean(locationText || profile.distanceText || profile.gender);
  const hasLifestyle = profile.pets.length > 0;
  const hasBasics = Boolean(profile.mbti);

  const hasPhoto = photos.length > 0;

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
            {/* Header — single close control */}
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

            {/* Hero image + photo gallery */}
            <section className="relative">
              {hasPhoto ? (
                <>
                  <div
                    className="relative w-full h-[56vh] bg-[#1C1822]"
                    style={{ minHeight: 320 }}
                  >
                    {imageError ? (
                      <div
                        className="w-full h-full bg-[#211A28] flex items-center justify-center rounded-2xl border border-[#34283F]/40"
                      >
                        <span className="text-6xl">📷</span>
                      </div>
                    ) : (
                      <img
                        key={currentIndex}
                        src={photos[currentIndex]}
                        alt={`${profile.displayName}, photo ${currentIndex + 1} of ${photos.length}`}
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
                      </>
                    )}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
                      <span className="text-xs font-medium text-[#F2E9E4]">{currentIndex + 1}</span>
                      <span className="text-xs text-[#B58A83]">of</span>
                      <span className="text-xs font-medium text-[#F2E9E4]">{photos.length}</span>
                    </div>
                  </div>

                  {photos.length > 1 && (
                    <div className="mx-6 mt-4 overflow-x-auto flex flex-nowrap gap-2 pb-4">
                      {photos.map((photo, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleThumbClick(i);
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
                </>
              ) : (
                <div className="h-[56vh] w-full bg-[#1C1822] flex items-center justify-center rounded-2xl border border-[#34283F]/40">
                  <span className="text-6xl">👤</span>
                </div>
              )}
            </section>

            <div className="px-6 pb-12 space-y-6">
              {/* Section 1 — Profile identity */}
              <section>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl md:text-3xl font-bold text-[#F2E9E4] tracking-tight">
                      {profile.displayName}
                      {profile.age ? (
                        <span className="ml-3 text-[#D9B38C] text-xl md:text-2xl">{profile.age}</span>
                      ) : null}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {profile.isVerified === true && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[#D9B38C]/40 bg-[#D9B38C]/10 text-[#D9B38C] text-[11px] font-medium">
                          <span className="text-[11px]">&#x2705;</span>
                          <span>Verified</span>
                        </span>
                      )}
                      {profile.online === true && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-[#10B981]/40 bg-[#10B981]/10 text-[#10B981] text-[11px] font-medium">
                          <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
                          <span>Online</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right hidden md:block">
                    {locationText && (
                      <p className="text-[#B58A83] text-sm font-medium">{locationText}</p>
                    )}
                    {profile.distanceText && (
                      <p className="text-[#D9B38C] text-sm font-medium">
                        {profile.distanceText} away
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Section 2 — Looking for */}
              {Boolean(profile.intention) || profile.lookingFor.length > 0 ? (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    Looking for
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {profile.intention && (
                      <p className="text-[#F2E9E4] text-sm leading-relaxed">
                        {profile.intention}
                      </p>
                    )}
                    {profile.lookingFor.map((item, i) => (
                      <p key={i} className="text-[#F2E9E4] text-sm leading-relaxed">
                        {item}
                      </p>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Section 3 — About me */}
              {profile.bio && profile.bio.trim().length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    About me
                  </h3>
                  <p className="mt-1 text-[#F2E9E4] text-sm leading-relaxed">{profile.bio}</p>
                </section>
              )}

              {/* Section 4 — Essentials */}
              {hasEssentials && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    Essentials
                  </h3>
                  <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {locationText && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Location</dt>
                        <dd className="text-[#F2E9E4] text-sm">{locationText}</dd>
                      </>
                    )}
                    {profile.distanceText && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium flex items-center gap-1">
                          <MapPin size={12} strokeWidth={1.5} />
                          Distance
                        </dt>
                        <dd className="text-[#F2E9E4] text-sm">{profile.distanceText}</dd>
                      </>
                    )}
                    {profile.gender && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Gender</dt>
                        <dd className="text-[#F2E9E4] text-sm capitalize">{profile.gender}</dd>
                      </>
                    )}
                  </dl>
                </section>
              )}

              {/* Section 5 — Lifestyle */}
              {hasLifestyle && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    Lifestyle
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profile.pets.map((pet) => (
                      <span
                        key={pet}
                        className="rounded-full border border-[#34283F]/60 bg-[#17121A]/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-[#B58A83] capitalize"
                        aria-label={pet}
                      >
                        {pet}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Section 6 — Basics */}
              {hasBasics && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    Basics
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className="rounded-full border border-[#34283F]/60 bg-[#17121A]/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-[#B58A83]"
                      aria-label={profile.mbti ?? undefined}
                    >
                      {profile.mbti}
                    </span>
                  </div>
                </section>
              )}

              {/* Section 7 — Interests (interests live only in the detail modal) */}
              {profile.interests.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">
                    Interests
                  </h3>
                  <InterestChips interests={profile.interests} maxVisible={12} />
                </section>
              )}

              {/* Visit Profile action */}
              {onVisitProfile && (
                <button
                  type="button"
                  onClick={handleVisitProfile}
                  className="w-full px-6 py-3.5 rounded-xl bg-[#D9B38C] text-[#17121A] font-semibold text-sm shadow-lg hover:bg-[#cfab83] active:scale-[0.98] transition-all"
                >
                  Visit Profile
                </button>
              )}

              <p className="text-xs text-[#B58A83]/60 text-center">
                Tap outside or press Escape to close
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
