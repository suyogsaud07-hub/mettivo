'use client';

import { useEffect, useState } from 'react';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import { countryFlag, genderIcon } from '@/lib/moments';

/**
 * A single Moment rendered as a social feed card.
 *
 * Extracted from `/moments` so the profile dashboard's "Posts" tab can show a
 * member's own moments with the same affordances — view, like, comment, share —
 * without a second, drifting copy of the card markup.
 *
 * The card is presentational: the parent owns like/comment/share state and
 * passes the handlers in. That keeps the optimistic-update logic in one place
 * per screen and lets the card stay free of Supabase calls.
 */
export interface MomentCardProps {
  post: MomentFeedRow;
  author: MomentAuthor;
  /** The viewer's own id; hides the Follow button on your own posts. */
  currentUserId?: string | null;
  /** Hides the Follow button unconditionally (the profile Posts tab). */
  isOwn?: boolean;
  onLike: (post: MomentFeedRow) => void;
  onComment: (post: MomentFeedRow) => void;
  onShare: (post: MomentFeedRow) => void;
  onFollow?: (authorId: string) => void;
}

export default function MomentCard({
  post,
  author,
  currentUserId,
  isOwn = false,
  onLike,
  onComment,
  onShare,
  onFollow,
}: MomentCardProps) {
  // "Viewing" a post means opening its media full-screen. The lightbox is
  // self-contained here so every feed gets it for free.
  const [viewingMedia, setViewingMedia] = useState<string | null>(null);

  useEffect(() => {
    if (!viewingMedia) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewingMedia(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingMedia]);

  const showFollow = !isOwn && !!onFollow && post.author_id !== currentUserId;

  return (
    <div style={styles.postCard}>
      <div style={styles.postHeader}>
        {author.avatarUrl ? (
          <img src={author.avatarUrl} alt={author.displayName} style={styles.avatar} />
        ) : (
          <div style={styles.avatarFallback}>{genderIcon(author.gender)}</div>
        )}
        <div style={styles.postUserInfo}>
          <div style={styles.nameRow}>
            <span style={styles.flag}>{countryFlag(author.country)}</span>
            <span style={styles.name}>{author.displayName}</span>
            <span style={styles.genderIcon}>{genderIcon(author.gender)}</span>
          </div>
          <div style={styles.activeNow}>Active now</div>
        </div>
        {showFollow && (
          <button
            type="button"
            style={styles.followBtn}
            onClick={() => onFollow?.(post.author_id)}
          >
            Follow
          </button>
        )}
      </div>

      {post.caption && <div style={styles.caption}>{post.caption}</div>}

      {post.media.length > 0 && (
        <div style={post.media.length === 1 ? { padding: '0 16px' } : styles.mediaGrid}>
          {post.media.map((url, index) => (
            <img
              key={index}
              src={url}
              alt={`Post media ${index + 1}`}
              style={post.media.length === 1 ? styles.singleMedia : styles.mediaItem}
              onClick={() => setViewingMedia(url)}
            />
          ))}
        </div>
      )}

      <div style={styles.actionBar}>
        <button
          type="button"
          style={{ ...styles.actionBtn, ...(post.liked_by_me ? styles.actionBtnLiked : {}) }}
          onClick={() => onLike(post)}
          aria-label={post.liked_by_me ? 'Unlike' : 'Like'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={post.liked_by_me ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          {post.like_count}
        </button>

        <button type="button" style={styles.actionBtn} onClick={() => onComment(post)} aria-label="Comment">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          {post.comment_count}
        </button>

        <button type="button" style={styles.actionBtn} onClick={() => onShare(post)} aria-label="Share">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
            <polyline points="16 6 12 2 8 6"></polyline>
            <line x1="12" y1="2" x2="12" y2="15"></line>
          </svg>
          {post.shares}
        </button>
      </div>

      {viewingMedia && (
        <div style={styles.lightbox} onClick={() => setViewingMedia(null)}>
          <button
            type="button"
            style={styles.lightboxClose}
            onClick={() => setViewingMedia(null)}
            aria-label="Close"
          >
            ×
          </button>
          <img
            src={viewingMedia}
            alt="Expanded post media"
            style={styles.lightboxImage}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

const styles = {
  postCard: { backgroundColor: '#211A28', margin: '0 20px 20px 20px', borderRadius: '20px', border: '1px solid #34283F', overflow: 'hidden' as const },
  postHeader: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px' },
  avatar: { width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#34283F' },
  avatarFallback: { width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#34283F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' },
  postUserInfo: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: '2px' },
  nameRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  name: { fontSize: '15px', fontWeight: 700, color: '#EAE2F0' },
  flag: { fontSize: '14px' },
  genderIcon: { fontSize: '12px', color: '#D8B38A' },
  activeNow: { fontSize: '12px', color: '#B58A83' },
  followBtn: { padding: '6px 16px', borderRadius: '20px', backgroundColor: 'transparent', border: '1px solid #D8B38A', color: '#D8B38A', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  caption: { fontSize: '14px', color: '#EAE2F0', lineHeight: 1.5, padding: '0 16px 12px 16px' },
  mediaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' },
  mediaItem: { width: '100%', aspectRatio: '1/1', objectFit: 'cover' as const, backgroundColor: '#34283F', cursor: 'pointer' },
  singleMedia: { width: '100%', maxHeight: '400px', objectFit: 'cover' as const, backgroundColor: '#34283F', cursor: 'pointer' },
  actionBar: { display: 'flex', alignItems: 'center', gap: '20px', padding: '16px' },
  actionBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#B58A83', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  actionBtnLiked: { color: '#EF4444' },
  lightbox: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(8, 6, 10, 0.94)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' },
  lightboxImage: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const, borderRadius: '12px' },
  lightboxClose: { position: 'absolute' as const, top: '24px', right: '24px', width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.12)', color: '#EAE2F0', border: 'none', fontSize: '24px', cursor: 'pointer' },
};
