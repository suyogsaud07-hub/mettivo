'use client';

import {
  useEffect,
  useRef,
} from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  type PanInfo,
} from 'framer-motion';
import { X } from 'lucide-react';
import CasualIntentBadge from './CasualIntentBadge';
import InterestChips from './InterestChips';
import type { CasualIntent } from '@/lib/casual-intent';

interface ProfileInfoSheetProps {
  profile: {
    id: string;
    displayName: string;
    age: number | null;
    city: string | null;
    country: string | null;
    bio: string | null;
    intention: string | null;
    casualIntent: string | null;
    interests: string[];
    distanceText: string | null;
    isOnline: boolean | null;
    isVerified: boolean | null;
  };
  isOpen: boolean;
  onClose: () => void;
}

export default function ProfileInfoSheet({
  profile,
  isOpen,
  onClose,
}: ProfileInfoSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  const y = useMotionValue(0);
  const ySpring = useSpring(y, { stiffness: 300, damping: 30 });
  const opacity = useTransform(y, [-400, 0, 400], [0, 1, 0]);
  const scale = useTransform(y, [-400, 0, 400], [0.95, 1, 0.95]);

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    y.set(info.point.y);
  };

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.point.y > 100) {
      onClose();
    } else {
      y.set(0);
    }
  };

  useEffect(() => {
    if (isOpen) {
      y.set(0);
    }
  }, [isOpen, y]);

  const locationParts = [profile.city, profile.country].filter(Boolean);
  const locationText = locationParts.length > 0 ? locationParts.join(', ') : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            ref={sheetRef}
            initial={{ y: 600 }}
            animate={{ y: 0 }}
            exit={{ y: 600 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 600 }}
            dragElastic={0.4}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#211A28] border-t border-[#34283F] rounded-t-3xl shadow-2xl min-h-[55vh] max-h-[65vh]"
            style={{ y: ySpring, opacity, scale }}
          >
            <div className="mx-auto w-12 h-1.5 rounded-full bg-[#34283F]/60 mt-3" role="separator" aria-label="Drag handle" />

            <div className="px-6 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-[#F2E9E4]">
                    {profile.displayName}
                    {profile.age ? (
                      <span className="ml-2 text-[#D9B38C] text-lg">{profile.age}</span>
                    ) : null}
                  </h2>
                  {profile.isVerified === true && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-[#D9B38C]/40 bg-[#D9B38C]/10 text-[#D9B38C] text-[10px] font-medium">
                      <span className="text-[10px]">&#x2705;</span> Verified
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close details"
                  className="w-8 h-8 rounded-full bg-[#17121A] flex items-center justify-center text-[#F2E9E4] hover:bg-[#34283F]"
                >
                  <X size={18} strokeWidth={2.5} />
                </button>
              </div>

              <div className="flex items-center gap-3 text-[#B58A83] text-sm mb-4">
                {locationText && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[14px]">📍</span>
                    <span>{locationText}</span>
                  </span>
                )}
                {profile.distanceText && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-[#D9B38C]">●</span>
                    <span>{profile.distanceText} away</span>
                  </span>
                )}
                {profile.isOnline === true && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
                    <span>Online</span>
                  </span>
                )}
              </div>
            </div>

            {profile.casualIntent && (
              <div className="px-6 mb-4">
                <CasualIntentBadge intent={profile.casualIntent as CasualIntent} size="md" />
              </div>
            )}

            {profile.intention && (
              <div className="px-6 mb-6">
                <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider mb-2">
                  Dating intention
                </h3>
                <span className="text-sm text-[#F2E9E4] bg-[#17121A]/40 px-3 py-1.5 rounded-full border border-[#34283F]/40 inline-block capitalize">
                  {profile.intention}
                </span>
              </div>
            )}

            {profile.bio && profile.bio.trim().length > 0 && (
              <div className="px-6 mb-6">
                <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider mb-2">
                  About me
                </h3>
                <p className="text-[#F2E9E4] leading-relaxed text-sm">{profile.bio}</p>
              </div>
            )}

            {profile.interests.length > 0 && (
              <div className="px-6 mb-6">
                <h3 className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider mb-3">
                  Interests
                </h3>
                <InterestChips interests={profile.interests} maxVisible={12} />
              </div>
            )}

            <div className="px-6 pb-8 text-center">
              <p className="text-xs text-[#B58A83]/60">Swipe down or tap outside to close</p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
