'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Heart, Star, RefreshCw, Send } from 'lucide-react';

interface DiscoveryActionButtonsProps {
  current: {
    id: string;
    displayName: string;
  } | null;
  decisionPending: string | null;
  canRewind: boolean;
  isRewinding: boolean;
  onRewind: () => void;
  onPass: (targetId: string) => void;
  onSuperLike: () => void;
  onLike: (targetId: string) => void;
  onMessage: (targetId: string) => void;
}

interface ButtonConfig {
  icon: React.ReactNode;
  iconColor: string;
  shadowColor: string;
  label: string;
}

const BUTTON_CONFIG: Record<
  'rewind' | 'pass' | 'superlike' | 'like' | 'message',
  ButtonConfig
> = {
  rewind: {
    icon: <RefreshCw size={22} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />,
    iconColor: '#D9B38C',
    shadowColor: 'rgba(217, 179, 140, 0.25)',
    label: 'Rewind',
  },
  pass: {
    icon: <X size={28} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />,
    iconColor: '#F3A7AD',
    shadowColor: 'rgba(243, 167, 173, 0.25)',
    label: 'Pass',
  },
  superlike: {
    icon: <Star size={24} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    iconColor: '#3B82F6',
    shadowColor: 'rgba(59, 130, 246, 0.3)',
    label: 'Super Like',
  },
  like: {
    icon: <Heart size={32} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    iconColor: '#10B981',
    shadowColor: 'rgba(16, 185, 129, 0.35)',
    label: 'Like',
  },
  message: {
    icon: <Send size={22} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />,
    iconColor: '#D9B38C',
    shadowColor: 'rgba(217, 179, 140, 0.25)',
    label: 'Message',
  },
};

const SIZE: Record<'rewind' | 'pass' | 'superlike' | 'like' | 'message', string> = {
  rewind: 'w-16 h-16',
  pass: 'w-20 h-20',
  superlike: 'w-16 h-16',
  like: 'w-24 h-24',
  message: 'w-16 h-16',
};

export default function DiscoveryActionButtons({
  current,
  decisionPending,
  canRewind,
  isRewinding,
  onRewind,
  onPass,
  onSuperLike,
  onLike,
  onMessage,
}: DiscoveryActionButtonsProps) {
  const pending = decisionPending === current?.id || isRewinding;

  const handleRewind = useCallback(() => {
    if (pending || !canRewind) return;
    onRewind();
  }, [pending, canRewind, onRewind]);

  const handlePass = useCallback(() => {
    if (pending || !current) return;
    onPass(current.id);
  }, [pending, current, onPass]);

  const handleSuperLike = useCallback(() => {
    if (pending || !current) return;
    onSuperLike();
  }, [pending, current, onSuperLike]);

  const handleLike = useCallback(() => {
    if (pending || !current) return;
    onLike(current.id);
  }, [pending, current, onLike]);

  const handleMessage = useCallback(() => {
    if (pending || !current) return;
    onMessage(current.id);
  }, [pending, current, onMessage]);

  if (!current) return null;

  const renderButton = (
    key: keyof typeof BUTTON_CONFIG,
    onClick: () => void,
    disabled: boolean,
    busy: boolean
  ) => {
    const config = BUTTON_CONFIG[key];
    const size = SIZE[key];
    return (
      <motion.button
        key={key}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={disabled ? `${config.label} unavailable` : `${config.label} on ${current.displayName}`}
        aria-busy={busy}
        whileHover={disabled ? {} : { scale: 1.06 }}
        whileTap={disabled ? {} : { scale: 0.94 }}
        className={`relative ${size} rounded-full border border-[#34283F]/40 bg-[#17121A] shadow-lg transition-all duration-200 flex items-center justify-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        style={{
          boxShadow: `0 0 20px ${config.shadowColor}`,
        }}
      >
        <AnimatePresence mode="wait">
          {busy ? (
            <motion.div
              key="busy"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="absolute inset-0 flex items-center justify-center text-[#F2E9E4]"
            >
              <RefreshCw size={20} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="flex items-center justify-center w-full h-full"
            >
              <span className={`text-[16px] ${config.iconColor}`}>{config.icon}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center gap-6 w-full px-6 pb-10">
      <div className="flex items-center gap-4 w-full max-w-[420px] mx-auto">
        {renderButton('rewind', handleRewind, !canRewind || pending, isRewinding)}
        {renderButton('pass', handlePass, pending, false)}
        {renderButton('like', handleLike, pending, false)}
        {renderButton('superlike', handleSuperLike, pending, false)}
        {renderButton('message', handleMessage, pending, false)}
      </div>
    </div>
  );
}
