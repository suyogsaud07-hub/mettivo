'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Heart, UserPlus } from 'lucide-react';

interface DiscoveryActionButtonsProps {
  current: {
    id: string;
    displayName: string;
  } | null;
  isLiked: boolean;
  isPassed: boolean;
  isFollowing: boolean;
  decisionPending: string | null;
  onLike: (targetId: string) => void;
  onPass: (targetId: string) => void;
  onFollow: (targetId: string) => void;
}

interface ButtonConfig {
  icon: React.ReactNode;
  iconColor: string;
  shadowColor: string;
}

const BUTTON_CONFIG: Record<'pass' | 'like' | 'follow', ButtonConfig> = {
  pass: {
    icon: <X size={28} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />,
    iconColor: '#F3A7AD',
    shadowColor: 'rgba(243, 167, 173, 0.25)',
  },
  like: {
    icon: <Heart size={30} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    iconColor: '#10B981',
    shadowColor: 'rgba(16, 185, 129, 0.35)',
  },
  follow: {
    icon: <UserPlus size={24} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />,
    iconColor: '#D9B38C',
    shadowColor: 'rgba(217, 179, 140, 0.25)',
  },
};

export default function DiscoveryActionButtons({
  current,
  isLiked,
  isPassed,
  isFollowing,
  decisionPending,
  onLike,
  onPass,
  onFollow,
}: DiscoveryActionButtonsProps) {
  const pending = decisionPending === current?.id;

  const handleLike = useCallback(() => {
    if (pending || !current) return;
    onLike(current.id);
  }, [current, onLike, pending]);

  const handlePass = useCallback(() => {
    if (pending || !current) return;
    onPass(current.id);
  }, [current, onPass, pending]);

  const handleFollow = useCallback(() => {
    if (pending || !current) return;
    onFollow(current.id);
  }, [current, onFollow, pending]);

  if (!current) return null;

  return (
    <div className="flex items-center justify-center gap-6 w-full max-w-md mx-auto">
      <motion.button
        type="button"
        onClick={handlePass}
        disabled={pending}
        aria-label={`Pass on ${current.displayName}`}
        aria-busy={pending}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-20 h-20 rounded-full border border-[#34283F]/40 bg-[#17121A] text-[#D9B38C] shadow-lg transition-all duration-200"
        style={{
          boxShadow: isPassed
            ? '0 0 0 4px rgba(217, 179, 140, 0.15)'
            : `0 0 20px ${BUTTON_CONFIG.pass.shadowColor}`,
          ...(isPassed
            ? { backgroundColor: '#34283F', borderColor: '#D9B38C' }
            : {}),
        }}
      >
        <AnimatePresence mode="wait">
          {isPassed ? (
            <motion.div
              key="passed"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              {BUTTON_CONFIG.pass.icon}
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              {BUTTON_CONFIG.pass.icon}
            </motion.div>
          )}
          {pending && (
            <motion.div
              key="pending"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute inset-0 flex items-center justify-center text-[#D9B38C]"
            >
              <X size={28} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <motion.button
        type="button"
        onClick={handleLike}
        disabled={pending}
        aria-label={`Like ${current.displayName}`}
        aria-busy={pending}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="relative w-24 h-24 rounded-full border border-[#34283F]/40 bg-[#17121A] text-[#D9B38C] shadow-2xl transition-all duration-200"
        style={{
          boxShadow: isLiked
            ? '0 0 0 5px rgba(217, 179, 140, 0.15)'
            : `0 0 28px ${BUTTON_CONFIG.like.shadowColor}`,
          ...(isLiked
            ? { backgroundColor: '#34283F', borderColor: '#D9B38C' }
            : {}),
        }}
      >
        <AnimatePresence mode="wait">
          {isLiked ? (
            <motion.div
              key="liked"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              {BUTTON_CONFIG.like.icon}
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              {BUTTON_CONFIG.like.icon}
            </motion.div>
          )}
          {pending && (
            <motion.div
              key="pending"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute inset-0 flex items-center justify-center text-[#10B981]"
            >
              <Heart size={30} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      <motion.button
        type="button"
        onClick={handleFollow}
        disabled={pending}
        aria-label={`Follow ${current.displayName}`}
        aria-pressed={isFollowing}
        aria-busy={pending}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative w-20 h-20 rounded-full border border-[#34283F]/40 bg-[#17121A] text-[#D9B38C] shadow-lg transition-all duration-200"
        style={{
          boxShadow: isFollowing
            ? '0 0 0 4px rgba(217, 179, 140, 0.15)'
            : `0 0 20px ${BUTTON_CONFIG.follow.shadowColor}`,
          ...(isFollowing
            ? { color: '#D9B38C', borderColor: '#D9B38C' }
            : {}),
        }}
      >
        <AnimatePresence mode="wait">
          {isFollowing ? (
            <motion.div
              key="following"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              <span className="text-[10px] font-semibold tracking-wide uppercase">Following</span>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              {BUTTON_CONFIG.follow.icon}
            </motion.div>
          )}
          {pending && (
            <motion.div
              key="pending"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute inset-0 flex items-center justify-center text-[#D9B38C]"
            >
              <UserPlus size={24} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
