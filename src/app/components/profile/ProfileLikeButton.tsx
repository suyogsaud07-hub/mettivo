'use client';

import { useEffect, useId, useState } from 'react';
import { likeProfile, unlikeProfile, LikeError } from '@/lib/likes';

/**
 * Like / Liked toggle for another member's profile.
 *
 * Reuses the existing profile-like system (`likes` table + `record_like` RPC):
 * the unique (liker, liked) pair makes repeated clicks idempotent, the database
 * rejects self-likes and blocked pairs, and the counters are maintained by the
 * existing trigger. This component only owns the optimistic UI and its rollback.
 */
export interface ProfileLikeButtonProps {
  targetUserId: string;
  initialLiked: boolean;
  /** Called after a successful change, with the new state. */
  onLikedChange?: (liked: boolean) => void;
  size?: 'sm' | 'md';
}

export default function ProfileLikeButton({
  targetUserId,
  initialLiked,
  onLikedChange,
  size = 'md',
}: ProfileLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // The existing like is resolved asynchronously after the profile loads, and
  // navigating between profiles resets it. Follow the prop unless a click is
  // mid-flight; otherwise the button would keep showing the first render.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pending) setLiked(initialLiked);
    }, 0);
    return () => clearTimeout(timer);
  }, [initialLiked, pending]);

  const toggle = async () => {
    if (pending) return;

    const next = !liked;
    // Optimistic, with a deterministic rollback below.
    setLiked(next);
    setPending(true);
    setError(null);

    try {
      if (next) await likeProfile(targetUserId);
      else await unlikeProfile(targetUserId);

      onLikedChange?.(next);
    } catch (err) {
      setLiked(!next);
      console.error('[profile-like] toggle failed:', err);
      setError(
        err instanceof LikeError
          ? err.message
          : 'We could not update your like. Please try again.'
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <span style={styles.wrapper}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          void toggle();
        }}
        disabled={pending}
        aria-pressed={liked}
        aria-busy={pending}
        aria-describedby={error ? errorId : undefined}
        title={error ?? undefined}
        style={{
          ...styles.base,
          ...(size === 'md' ? styles.md : styles.sm),
          ...(liked ? styles.liked : styles.unliked),
          opacity: pending ? 0.6 : 1,
        }}
      >
        <svg
          width={size === 'md' ? 16 : 13}
          height={size === 'md' ? 16 : 13}
          viewBox="0 0 24 24"
          fill={liked ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z" />
        </svg>
        {pending ? '…' : liked ? 'Liked' : 'Like Profile'}
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
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    borderRadius: '20px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    lineHeight: 1.2,
  },
  sm: { padding: '6px 16px', fontSize: '12px' },
  md: { padding: '10px 22px', fontSize: '14px' },
  unliked: {
    backgroundColor: 'transparent',
    color: '#D8B38A',
    border: '1px solid #D8B38A',
  },
  liked: {
    backgroundColor: 'rgba(216, 179, 138, 0.16)',
    color: '#F2E9E4',
    border: '1px solid #D8B38A',
  },
  error: {
    maxWidth: '180px',
    color: '#FCA5B5',
    fontSize: '10px',
    lineHeight: 1.25,
  },
};
