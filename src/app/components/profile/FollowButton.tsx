'use client';

import { useId } from 'react';
import { useFollow } from '@/context/FollowContext';

/**
 * Follow / Following toggle.
 *
 * The state lives in `FollowProvider`, not in this button: every card, list and
 * profile showing the same member agrees immediately. The provider applies the
 * optimistic change, rolls it back on failure, and exposes a member-safe error
 * here instead of silently reverting the label.
 */
export interface FollowButtonProps {
  targetUserId: string;
  /** Used only until the provider has hydrated the authoritative id set. */
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
  const { following, pending, errors, hydrated, setFollowing, clearError } = useFollow();
  const errorId = useId();

  const isPending = pending.has(targetUserId);
  const isFollowing = hydrated ? following.has(targetUserId) : initialFollowing;
  const error = errors[targetUserId];

  const toggle = async () => {
    if (isPending) return;
    clearError(targetUserId);

    const ok = await setFollowing(targetUserId, !isFollowing);
    if (ok) onChange?.(!isFollowing);
  };

  const sizing = size === 'md' ? styles.md : styles.sm;

  return (
    <span style={styles.wrapper}>
      <button
        type="button"
        onClick={(event) => {
          // Cards often wrap the button in a navigable surface; the tap belongs
          // to the button, not the card.
          event.stopPropagation();
          event.preventDefault();
          void toggle();
        }}
        disabled={isPending}
        aria-pressed={isFollowing}
        aria-busy={isPending}
        aria-describedby={error ? errorId : undefined}
        title={error ?? undefined}
        style={{
          ...styles.base,
          ...sizing,
          ...(isFollowing ? styles.following : styles.follow),
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? '…' : isFollowing ? 'Following' : 'Follow'}
      </button>
      {error ? (
        <span id={errorId} role="alert" style={styles.error}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

const styles = {
  wrapper: {
    display: 'inline-flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: '3px',
  },
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
  error: {
    maxWidth: '150px',
    color: '#FCA5B5',
    fontSize: '10px',
    lineHeight: 1.25,
  },
};
