'use client';

import type { ReactNode } from 'react';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import MomentCard from '../moments/MomentCard';

/**
 * The "User Feed" tab body: a member's Moments rendered with the shared
 * `MomentCard`. Presentational — the parent owns the data and the like handler,
 * so the own-profile and public-profile feeds cannot behave differently.
 */
export interface ProfileMomentsProps {
  posts: MomentFeedRow[];
  author: MomentAuthor;
  /** Your own feed: hides the per-card Follow button. */
  isOwn: boolean;
  /** The signed-in viewer, so comments know who is writing. */
  currentUserId: string | null;
  loading: boolean;
  error: string | null;
  title: string;
  /** Optional header trailing element, e.g. a "New Post" button. */
  action?: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  onLike: (post: MomentFeedRow) => void;
  /**
   * Renders a trailing control in each card's header (the owner's per-post
   * options menu). Omitted on a public profile and while previewing as a
   * visitor, which is how owner-only controls are kept off that surface.
   */
  headerAction?: (post: MomentFeedRow) => ReactNode;
}

function EmptyFeedIcon() {
  return (
    <span className="pf-empty-icon" aria-hidden="true">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="18" height="16" rx="4" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="m21 15-4.2-4.2a2 2 0 0 0-2.8 0L5 20" />
      </svg>
    </span>
  );
}

export default function ProfileMoments({
  posts,
  author,
  isOwn,
  currentUserId,
  loading,
  error,
  title,
  action,
  emptyTitle,
  emptyBody,
  onLike,
  headerAction,
}: ProfileMomentsProps) {
  return (
    <div>
      <div className="pf-feed-head">
        <h2 className="pf-feed-title">{title}</h2>
        {action}
      </div>

      {error && (
        <div role="alert" className="pf-alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="pf-empty" role="status">
          <span className="pf-spinner" aria-hidden="true" />
          <p className="pf-muted" style={{ marginTop: 14 }}>
            Loading posts…
          </p>
        </div>
      ) : posts.length === 0 ? (
        <div className="pf-empty">
          <EmptyFeedIcon />
          <h3 className="pf-empty-title">{emptyTitle}</h3>
          <p className="pf-empty-body">{emptyBody}</p>
        </div>
      ) : (
        posts.map((post) => (
          <MomentCard
            key={post.id}
            post={post}
            author={author}
            isOwn={isOwn}
            currentUserId={currentUserId}
            onLike={onLike}
            headerAction={headerAction?.(post)}
          />
        ))
      )}
    </div>
  );
}
