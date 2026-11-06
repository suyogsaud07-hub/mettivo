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
import { X } from 'lucide-react';
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
}

function formatLocation(profile: ProfileDetailModalProps['profile']): string | null {
  const parts = [profile.city, profile.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export default function ProfileDetailModal({
  profile,
  isOpen,
  onClose,
}: ProfileDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  const locationText = formatLocation(profile);

  // Lock body scroll while the modal is open; restore on close / unmount.
  useEffect(() => {
    if (!isOpen) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeydown);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      // Restore focus to the element that opened the modal.
      if (previousActiveRef.current) {
        previousActiveRef.current.focus({ preventScroll: true });
      }
    };
  }, [isOpen, onClose]);

  const handleClose = useCallback(() => {
    setZoomedPhoto(null);
    onClose();
  }, [onClose]);

  const lookingFor = profile.lookingFor.length > 0 ? profile.lookingFor : null;
  const lifestylePets = profile.pets;
  const basicsMbti = profile.mbti ? profile.mbti : null;

  const hasEssentials = Boolean(locationText || profile.gender);
  const hasLifestyle = lifestylePets.length > 0;
  const hasBasics = Boolean(basicsMbti);

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
            onClick={(e) => e.stopPropagation()}
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

            {/* Photo gallery */}
            <section className="relative">
              {profile.photos.length > 0 ? (
                <>
                  <div className="relative h-[56vh] w-full bg-[#1C1822]">
                    {zoomedPhoto ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-[#17121A]">
                        <button
                          type="button"
                          onClick={() => setZoomedPhoto(null)}
                          aria-label="Close enlarged photo"
                          className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-[#17121A]/80 flex items-center justify-center text-[#F2E9E4] hover:bg-[#17121A]"
                        >
                          <X size={20} strokeWidth={2.5} />
                        </button>
                        <img
                          src={zoomedPhoto}
                          alt={profile.displayName}
                          className="max-h-[85vh] max-w-[85vw] object-contain rounded-2xl border border-[#34283F]/40"
                          loading="eager"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <>
                        <div
                          className="w-full h-full object-cover"
                          style={{ backgroundImage: `url("${profile.photos[0]}")` }}
                        />
                        {profile.photos.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setZoomedPhoto(profile.photos[0])}
                            aria-label="Enlarge photo"
                            className="absolute inset-0 z-10 bg-gradient-to-t from-black/60 via-transparent to-transparent"
                          />
                        )}
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
                          <span className="text-xs font-medium text-[#F2E9E4]">1</span>
                          <span className="text-xs text-[#B58A83]">of</span>
                          <span className="text-xs font-medium text-[#F2E9E4]">{profile.photos.length}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {profile.photos.length > 1 && (
                    <div className="mx-6 mt-4 grid grid-cols-4 gap-2">
                      {profile.photos.map((photo, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setZoomedPhoto(photo)}
                          aria-label={`View photo ${i + 1}`}
                          className={`aspect-[4/5] rounded-xl overflow-hidden border ${
                            i === 0 ? 'border-[#D9B38C]' : 'border-[#34283F]/40'
                          } bg-[#1C1822]`}
                          style={{ backgroundImage: `url("${photo}")`, backgroundSize: 'cover', backgroundPosition: 'center' }}
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

              {/* Section 2 — Looking For */}
              {lookingFor && lookingFor.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Looking for</h3>
                  <p className="mt-1 text-[#F2E9E4] text-sm leading-relaxed">
                    {lookingFor.join(', ')}
                  </p>
                </section>
              )}

              {/* Section 3 — About Me */}
              {profile.bio && profile.bio.trim().length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">About me</h3>
                  <p className="mt-1 text-[#F2E9E4] text-sm leading-relaxed">{profile.bio}</p>
                </section>
              )}

              {/* Section 4 — Essentials */}
              {hasEssentials && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Essentials</h3>
                  <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {locationText && (
                      <>
                        <dt className="text-[#B58A83] text-xs font-medium">Location</dt>
                        <dd className="text-[#F2E9E4] text-sm">{locationText}</dd>
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
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Lifestyle</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lifestylePets.map((pet) => (
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
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Basics</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      className="rounded-full border border-[#34283F]/60 bg-[#17121A]/60 backdrop-blur-sm px-3 py-1.5 text-xs font-medium text-[#B58A83]"
                      aria-label={basicsMbti as string}
                    >
                      {basicsMbti}
                    </span>
                  </div>
                </section>
              )}

              {/* Section 7 — Interests */}
              {profile.interests.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Interests</h3>
                  <InterestChips interests={profile.interests} maxVisible={12} />
                </section>
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
