'use client';

import { useState } from 'react';
import { setFollow } from '@/lib/follows';

/**
 * Follow / Following toggle.
 *
 * Owns its own optimistic state so every surface that embeds it (Moments cards,
 * Discover cards, a member's public profile) behaves the same: the label flips
 * immediately, and reverts if the write is rejected. The actual write is
 * RLS-guarded — a member can only ever create or remove their own outbound edge.
 */
export interface FollowButtonProps {
  targetUserId: string;
  initialFollowing?: boolean;
  /** Called after a successful toggle, with the new state. */
  onChange?: (following: boolean) => void;
  size?: 'sm' | 'md';
}

export default function FollowButton({
  targetUserId,
  initialFollowing = false,
  onChange,
  size = 'sm',
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    if (pending) return;

    const next = !following;
    setFollowing(next);
    setPending(true);

    try {
      await setFollow(targetUserId, next);
      onChange?.(next);
    } catch (err) {
      // Revert: the write did not happen, so the label must not lie.
      console.error('[follow] toggle failed:', err);
      setFollowing(!next);
    } finally {
      setPending(false);
    }
  };

  const sizing = size === 'md' ? styles.md : styles.sm;

  return (
    <button
      type="button"
      onClick={(event) => {
        // Cards often wrap the button in a navigable element; the tap belongs
        // to the button, not the card.
        event.stopPropagation();
        void toggle();
      }}
      disabled={pending}
      aria-pressed={following}
      style={{
        ...styles.base,
        ...sizing,
        ...(following ? styles.following : styles.follow),
        opacity: pending ? 0.6 : 1,
      }}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

const styles = {
  base: {
    borderRadius: '20px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  sm: { padding: '6px 16px', fontSize: '12px' },
  md: { padding: '10px 24px', fontSize: '14px' },
  follow: { backgroundColor: '#D8B38A', color: '#131017', border: '1px solid #D8B38A' },
  following: { backgroundColor: 'transparent', color: '#D8B38A', border: '1px solid #D8B38A' },
};
