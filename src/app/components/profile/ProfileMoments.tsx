'use client';

import type { ReactNode } from 'react';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import MomentCard from '../moments/MomentCard';

/**
 * The "User Feed" tab body: a member's Moments rendered with the shared
 * `MomentCard`.
 *
 * Presentational — the parent owns the data and the like/comment/share
 * handlers, so the own-profile feed and the public-profile feed cannot behave
 * differently.
 */
export interface ProfileMomentsProps {
  posts: MomentFeedRow[];
  author: MomentAuthor;
  /** Your own feed: hides the per-card Follow button. */
  isOwn: boolean;
  loading: boolean;
  error: string | null;
  title: string;
  /** Optional header trailing element, e.g. a "New Post" button. */
  action?: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  onLike: (post: MomentFeedRow) => void;
  onComment: (post: MomentFeedRow) => void;
  onShare: (post: MomentFeedRow) => void;
}

export default function ProfileMoments({
  posts,
  author,
  isOwn,
  loading,
  error,
  title,
  action,
  emptyTitle,
  emptyBody,
  onLike,
  onComment,
  onShare,
}: ProfileMomentsProps) {
  return (
    <div>
      <div style={styles.header}>
        <div style={styles.headerTitle}>{title}</div>
        {action}
      </div>

      {error && (
        <div role="alert" style={styles.error}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={styles.empty}>Loading posts...</div>
      ) : posts.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>{emptyTitle}</div>
          {emptyBody}
        </div>
      ) : (
        posts.map((post) => (
          <MomentCard
            key={post.id}
            post={post}
            author={author}
            isOwn={isOwn}
            currentUserId={author.id}
            onLike={onLike}
            onComment={onComment}
            onShare={onShare}
          />
        ))
      )}
    </div>
  );
}

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: '0 20px 16px 20px',
  },
  headerTitle: { fontSize: '15px', fontWeight: 700, color: '#EAE2F0' },
  error: {
    margin: '0 20px 16px 20px',
    backgroundColor: '#3B1220',
    border: '1px solid #7F1D2E',
    color: '#FCA5B5',
    borderRadius: '14px',
    padding: '12px 16px',
    fontSize: '13px',
  },
  empty: {
    margin: '0 20px',
    backgroundColor: '#211A28',
    border: '1px dashed #4A1828',
    borderRadius: '20px',
    padding: '40px 24px',
    textAlign: 'center' as const,
    color: '#B58A83',
    fontSize: '14px',
  },
  emptyTitle: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0', marginBottom: '8px' },
};
