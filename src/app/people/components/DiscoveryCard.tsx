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
import ProfileDetailModal from './ProfileDetailModal';
import type { CasualIntent } from '@/lib/casual-intent';
import type { DiscoveryCandidate } from '@/lib/discovery';

const SWIPE_THRESHOLD = 120;
const ROTATION_MAX = 15;

interface DiscoveryCardProps {
  profile: DiscoveryCandidate & {
    distanceMeters: number | null;
    distanceText: string | null;
  };
  isModalOpen: boolean;
  onModalToggle: () => void;
  onLike: (targetId: string) => void;
  onPass: (targetId: string) => void;
  disabled?: boolean;
}

export default function DiscoveryCard({
  profile,
  isModalOpen,
  onModalToggle,
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
    [-ROTATION_MAX, -ROTATION_MAX, 0]
  );

  const rightOpacity = useTransform(
    x,
    [0, SWIPE_THRESHOLD / 2, SWIPE_THRESHOLD],
    [0, 1, 1]
  );
  const rightRotate = useTransform(
    x,
    [0, SWIPE_THRESHOLD / 2, SWIPE_THRESHOLD],
    [0, ROTATION_MAX, ROTATION_MAX]
  );

  const handleDragStart = useCallback(() => {
    if (disabled || isModalOpen) return;
  }, [disabled, isModalOpen]);

  const handleDrag = useCallback((_event: DragEvent, info: { point: { x: number; y: number } }) => {
    if (disabled || isModalOpen) return;
    setDragDirection(info.point.x > 0 ? 'right' : 'left');
  }, [disabled, isModalOpen]);

  const handleDragEnd = useCallback((_event: DragEvent, info: { point: { x: number; y: number }; velocity: { x: number; y: number } }) => {
    if (disabled || isModalOpen) return;

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
  }, [disabled, isModalOpen, profile.id, onPass, onLike]);

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
    <>
      <motion.div
        ref={cardRef}
        data-testid="people-swipe-card"
        className="w-full max-w-[420px] h-full max-h-[82vh] relative overflow-hidden rounded-3xl bg-[#17121A] shadow-2xl border border-[#34283F]/40"
        style={{ x, y, rotate, opacity: dragDirection ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        drag="x"
        dragConstraints={{ left: -300, right: 300 }}
        dragElastic={0.35}
        dragMomentum={false}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
      >
        {/* Photos — keyed by profile id so the carousel resets per profile */}
        <div className="w-full h-[70vh] max-h-[75vh] relative overflow-hidden rounded-t-3xl bg-[#1C1822] border-b border-[#34283F]/40">
          <ProfilePhotoCarousel
            key={profile.id}
            photos={profile.photos}
            avatarUrl={profile.avatarUrl}
            alt={profile.displayName}
            fullScreen={true}
          />
        </div>

        {/* Like/Pass swipe indicators */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <motion.div
            className="absolute left-6 top-1/3 -translate-y-1/2 flex items-center gap-2"
            style={{ opacity: leftOpacity, rotate: leftRotate }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <span className="w-3 h-3 rounded-full bg-[#10B981]"></span>
            <span className="text-sm font-bold text-[#10B981] tracking-tighter">LIKE</span>
          </motion.div>
          <motion.div
            className="absolute right-6 top-1/3 -translate-y-1/2 flex items-center gap-2"
            style={{ opacity: rightOpacity, rotate: rightRotate }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <span className="text-sm font-bold text-[#F3A7AD] tracking-tighter">PASS</span>
            <span className="w-3 h-3 rounded-full bg-[#F3A7AD]"></span>
          </motion.div>
        </div>

        {/* Details overlay at bottom */}
        <div className="people-details absolute bottom-0 left-0 right-0 p-6 pt-[30vh] z-30">
          <div className="flex items-center justify-between mb-3">
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
                onClick={onModalToggle}
                aria-label={isModalOpen ? 'Close profile details' : 'View profile details'}
                className="w-9 h-9 rounded-full bg-[#17121A]/80 backdrop-blur-sm border border-[#34283F]/40 flex items-center justify-center text-[#F2E9E4] hover:bg-[#17121A] transition-colors"
                disabled={disabled || isModalOpen}
              >
                <ChevronUp size={17} strokeWidth={2.5} />
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
      </motion.div>

      {/* Full-screen profile detail modal */}
      <ProfileDetailModal
        profile={{
          id: profile.id,
          displayName: profile.displayName,
          firstName: profile.firstName,
          lastName: profile.lastName,
          hasLastName: profile.hasLastName,
          username: profile.username,
          age: profile.age,
          gender: profile.gender,
          city: profile.city,
          country: profile.country,
          avatarUrl: profile.avatarUrl,
          photos: profile.photos,
          bio: profile.bio,
          intention: profile.intention,
          lookingFor: profile.lookingFor,
          hobbies: profile.hobbies,
          pets: profile.pets,
          mbti: profile.mbti,
          interests: profile.interests,
          casualIntent: profile.casualIntent,
          online: profile.online,
          isVerified: profile.isVerified,
          distanceText: profile.distanceText,
          distanceMeters: profile.distanceMeters,
        }}
        isOpen={isModalOpen}
        onClose={onModalToggle}
      />
    </>
  );
}
