'use client';

import {
  useCallback,
  useRef,
  useState,
} from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
} from 'framer-motion';
import { ChevronUp } from 'lucide-react';
import ProfilePhotoCarousel from './ProfilePhotoCarousel';
import CasualIntentBadge from './CasualIntentBadge';
import InterestChips from './InterestChips';
import ProfileInfoSheet from './ProfileInfoSheet';
import type { CasualIntent } from '@/lib/casual-intent';

const CARD_WIDTH = 340;
const SWIPE_THRESHOLD = 120;
const ROTATION_MAX = 12;

interface DiscoveryCardProps {
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
    photos: string[];
    avatarUrl: string | null;
    distanceText: string | null;
    distanceMeters: number | null;
    isOnline: boolean | null;
    isVerified: boolean | null;
  };
  isSheetOpen: boolean;
  onSheetToggle: () => void;
  onLike: (targetId: string) => void;
  onPass: (targetId: string) => void;
  disabled?: boolean;
}

export default function DiscoveryCard({
  profile,
  isSheetOpen,
  onSheetToggle,
  onLike,
  onPass,
  disabled = false,
}: DiscoveryCardProps) {
  const [dragDirection, setDragDirection] = useState<'left' | 'right' | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

const x = useMotionValue(0);
const y = useMotionValue(0);
const rotate = useTransform(x, [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD], [-ROTATION_MAX, 0, ROTATION_MAX]);

  const leftOpacity = useTransform(
    x,
    [-SWIPE_THRESHOLD, -SWIPE_THRESHOLD / 2, 0],
    [1, 1, 0]
  );
  const leftRotate = useTransform(
    x,
    [-SWIPE_THRESHOLD, -SWIPE_THRESHOLD / 2, 0],
    [-15, -15, 0]
  );

  const rightOpacity = useTransform(
    x,
    [0, SWIPE_THRESHOLD / 2, SWIPE_THRESHOLD],
    [0, 1, 1]
  );
  const rightRotate = useTransform(
    x,
    [0, SWIPE_THRESHOLD / 2, SWIPE_THRESHOLD],
    [0, 15, 15]
  );

  const handleDragStart = useCallback(() => {
    if (disabled || isSheetOpen) return;
  }, [disabled, isSheetOpen]);

  const handleDrag = useCallback((event: DragEvent, info: { point: { x: number; y: number } }) => {
    if (disabled || isSheetOpen) return;
    setDragDirection(info.point.x > 0 ? 'right' : 'left');
  }, [disabled, isSheetOpen]);

  const handleDragEnd = useCallback((event: DragEvent, info: { point: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    if (disabled || isSheetOpen) return;

    const { point, velocity } = info;

    if (point.x < -SWIPE_THRESHOLD || velocity.x < -800) {
      setDragDirection('left');
      void onPass(profile.id);
    } else if (point.x > SWIPE_THRESHOLD || velocity.x > 800) {
      setDragDirection('right');
      void onLike(profile.id);
    } else {
      setDragDirection(null);
    }
  }, [disabled, isSheetOpen, profile.id, onPass, onLike]);

  const nameAgeLine = profile.age ? `${profile.displayName}, ${profile.age}` : profile.displayName;
  const distanceLine = profile.distanceText
    ? `${nameAgeLine} · ${profile.distanceText} away`
    : nameAgeLine;

  const bioPreview = profile.bio
    ? profile.bio.length > 140
      ? `${profile.bio.slice(0, 140)}…`
      : profile.bio
    : null;

  return (
    <motion.div
      ref={cardRef}
      className="w-full max-w-md mx-auto relative"
      style={{ x, y, rotate, opacity: dragDirection ? 0 : 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      drag="x"
      dragConstraints={{ left: -CARD_WIDTH, right: CARD_WIDTH }}
      dragElastic={0.35}
      dragMomentum={false}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <ProfilePhotoCarousel
        photos={profile.photos}
        avatarUrl={profile.avatarUrl}
        alt={profile.displayName}
      />

      <div
        className="absolute inset-0 bg-gradient-to-t from-[#17121A]/80 via-[#17121A]/30 to-transparent pointer-events-none"
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        <motion.div
          className="absolute left-6 top-1/2 -translate-y-1/2 flex items-center gap-2"
          style={{ opacity: leftOpacity, rotate: leftRotate }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
          <span className="text-[14px] font-bold text-[#10B981] tracking-tighter">LIKE</span>
        </motion.div>
        <motion.div
          className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2"
          style={{ opacity: rightOpacity, rotate: rightRotate }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <span className="text-[14px] font-bold text-[#F3A7AD] tracking-tighter">PASS</span>
          <span className="w-2 h-2 rounded-full bg-[#F3A7AD]"></span>
        </motion.div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6 pt-[200px] z-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-[#F2E9E4] leading-tight">
            {distanceLine}
          </h2>
          <div className="flex items-center gap-1.5">
            {profile.isVerified === true && (
              <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full border border-[#D9B38C]/40 bg-[#D9B38C]/10 text-[#D9B38C] text-[10px] font-medium">
                <span className="text-[10px]">&#x2705;</span>
                <span>Verified</span>
              </span>
            )}
            <button
              type="button"
              onClick={onSheetToggle}
              aria-label={isSheetOpen ? 'Close profile details' : 'View profile details'}
              className="w-8 h-8 rounded-full bg-[#17121A]/80 backdrop-blur-sm border border-[#34283F]/40 flex items-center justify-center text-[#F2E9E4] hover:bg-[#17121A] transition-all"
              disabled={disabled || isSheetOpen}
            >
              <ChevronUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {profile.casualIntent && (
          <div className="mb-3">
            <CasualIntentBadge intent={profile.casualIntent as CasualIntent} size="sm" />
          </div>
        )}

        <div className="space-y-3">
          {bioPreview && (
            <p className="text-[#B58A83] text-sm leading-relaxed line-clamp-2">
              {bioPreview}
            </p>
          )}
          {profile.interests.length > 0 && (
            <InterestChips interests={profile.interests} maxVisible={4} />
          )}
        </div>
      </div>

      <ProfileInfoSheet
        profile={{
          id: profile.id,
          displayName: profile.displayName,
          age: profile.age,
          city: profile.city,
          country: profile.country,
          bio: profile.bio,
          intention: profile.intention,
          casualIntent: profile.casualIntent,
          interests: profile.interests,
          distanceText: profile.distanceText,
          isOnline: profile.isOnline,
          isVerified: profile.isVerified,
        }}
        isOpen={isSheetOpen}
        onClose={onSheetToggle}
      />
    </motion.div>
  );
}
