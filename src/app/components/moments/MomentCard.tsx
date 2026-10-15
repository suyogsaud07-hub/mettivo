'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MomentAuthor, MomentFeedRow } from '@/lib/types';
import { countryFlag, genderIcon, recordMomentView, shareMoment } from '@/lib/moments';
import { formatCount, formatDuration, resolveMediaType } from '@/lib/media';
import { ReportButton } from '@/app/components/moderation/ReportButton';
import CommentSheet from './CommentSheet';

/**
 * A single Moment rendered as a social feed card.
 *
 * Extracted from `/moments` so the profile dashboard's Posts tab and a public
 * profile can show the same moments with the same affordances — video playback,
 * double-tap to like, live comments, share and view counts — without a second,
 * drifting copy of the card.
 *
 * Ownership split:
 *   * the parent owns the optimistic like state, because a list of cards agrees
 *     on like counts more cheaply than each card keeping its own;
 *   * the card owns comments, shares and views, which are per-card, server-
 *     authoritative and meaningless to share across a list.
 */
export interface MomentCardProps {
  post: MomentFeedRow;
  author: MomentAuthor;
  /** The viewer's own id; hides the Follow button on your own posts. */
  currentUserId?: string | null;
  /** Hides the Follow button unconditionally (the profile Posts tab). */
  isOwn?: boolean;
  onLike: (post: MomentFeedRow) => void;
  onFollow?: (authorId: string) => void;
}

/** How long a single tap waits to be sure a second one is not coming. */
const DOUBLE_TAP_WINDOW_MS = 300;

/** Captions longer than this collapse behind a "more" toggle. */
const CAPTION_PREVIEW_CHARS = 160;

export default function MomentCard({
  post,
  author,
  currentUserId,
  isOwn = false,
  onLike,
  onFollow,
}: MomentCardProps) {
  const mediaUrl = post.media[0];
  const mediaType = resolveMediaType(post.media_type, mediaUrl);
  const isVideo = mediaType === 'video' && !!mediaUrl;

  const [viewingMedia, setViewingMedia] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Locally owned, server-seeded engagement. A feed reload replaces `post` and
  // these sync back to the authoritative figures.
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [shares, setShares] = useState(post.shares);
  const [views, setViews] = useState(post.views_count);
  const [uniqueViews, setUniqueViews] = useState(post.unique_views);

  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [heart, setHeart] = useState<{ x: number; y: number; id: number } | null>(null);
  const [heartPopped, setHeartPopped] = useState(false);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewRecorded = useRef(false);
  const lastTap = useRef(0);
  const singleTapTimer = useRef<number | null>(null);

  // Re-seed when the feed hands down a different row for this card. This is the
  // documented "reset derived state when a prop changes" case; React has no
  // render-time equivalent that also survives a same-id row refresh.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommentCount(post.comment_count);
    setShares(post.shares);
    setViews(post.views_count);
    setUniqueViews(post.unique_views);
    viewRecorded.current = false;
  }, [post.id, post.comment_count, post.shares, post.views_count, post.unique_views]);

  useEffect(() => {
    if (!viewingMedia) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewingMedia(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingMedia]);

  // A pending single-tap must not fire after the card unmounts.
  useEffect(
    () => () => {
      if (singleTapTimer.current) window.clearTimeout(singleTapTimer.current);
    },
    []
  );

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlaying(true);
    } catch {
      // Autoplay can be refused; the tap-to-play overlay remains.
      setPlaying(false);
    }
  }, []);

  // Scroll-into-view does two jobs: it counts a view once per mount, and it
  // starts/stops video so only the post in front of the member is playing.
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting) {
          if (!viewRecorded.current) {
            viewRecorded.current = true;
            void recordMomentView(post.id).then((counts) => {
              if (counts) {
                setViews(counts.views_count);
                setUniqueViews(counts.unique_views);
              }
            });
          }
          if (isVideo) void play();
        } else if (isVideo) {
          videoRef.current?.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.25 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [post.id, isVideo, play]);

  const triggerLike = useCallback(
    (position: { x: number; y: number }) => {
      setHeart({ ...position, id: Date.now() });
      setHeartPopped(false);
      window.requestAnimationFrame(() => setHeartPopped(true));
      window.setTimeout(() => setHeart(null), 700);
      if (!post.liked_by_me) onLike(post);
    },
    [onLike, post]
  );

  const handleMediaTap = (event: React.MouseEvent<HTMLElement>) => {
    const now = Date.now();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (now - lastTap.current < DOUBLE_TAP_WINDOW_MS) {
      lastTap.current = 0;
      if (singleTapTimer.current) {
        window.clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      triggerLike(position);
      return;
    }

    lastTap.current = now;
    singleTapTimer.current = window.setTimeout(() => {
      singleTapTimer.current = null;
      if (isVideo) {
        if (videoRef.current?.paused) void play();
        else {
          videoRef.current?.pause();
          setPlaying(false);
        }
      } else if (mediaUrl) {
        setViewingMedia(mediaUrl);
      }
    }, DOUBLE_TAP_WINDOW_MS);
  };

  const handleShare = async () => {
    setNotice(null);
    try {
      const total = await shareMoment(post.id);
      setShares(total);

      const url = `${window.location.origin}/moments?m=${post.id}`;
      const text = post.caption?.trim() || 'A Moment on Mettivo';
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: 'Mettivo', text, url });
          setNotice('Shared');
        } catch {
          // The member dismissed the share sheet; the counter still moved.
        }
      } else if (navigator?.clipboard) {
        await navigator.clipboard.writeText(url);
        setNotice('Link copied');
      }
    } catch (err) {
      console.error('[moments] share failed:', err);
      setNotice('Could not share');
    } finally {
      window.setTimeout(() => setNotice(null), 2000);
    }
  };

  const showFollow = !isOwn && !!onFollow && post.author_id !== currentUserId;
  const caption = post.caption ?? '';
  const captionTruncated = caption.length > CAPTION_PREVIEW_CHARS;
  const captionText =
    captionTruncated && !captionExpanded
      ? `${caption.slice(0, CAPTION_PREVIEW_CHARS).trimEnd()}…`
      : caption;

  return (
    <div ref={cardRef} style={styles.postCard}>
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

      {caption && (
        <div style={styles.captionRow}>
          <span style={styles.caption}>{captionText}</span>
          {captionTruncated && (
            <button
              type="button"
              style={styles.moreBtn}
              onClick={() => setCaptionExpanded((value) => !value)}
            >
              {captionExpanded ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}

      {post.media.length > 0 && (
        <div
          style={post.media.length === 1 ? styles.singleMediaWrap : styles.mediaGrid}
          onClick={handleMediaTap}
        >
          {isVideo ? (
            <>
              <video
                ref={videoRef}
                src={mediaUrl}
                style={styles.singleMedia}
                loop
                muted={muted}
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              />
              {!playing && (
                <div style={styles.playOverlay} aria-hidden>
                  <svg width="54" height="54" viewBox="0 0 24 24" fill="rgba(255,255,255,0.92)">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              )}
              <button
                type="button"
                style={styles.soundBtn}
                aria-label={muted ? 'Unmute' : 'Mute'}
                onClick={(event) => {
                  event.stopPropagation();
                  const next = !muted;
                  setMuted(next);
                  if (videoRef.current) videoRef.current.muted = next;
                  if (!next) void play();
                }}
              >
                {muted ? '🔇' : '🔊'}
              </button>
              <span style={styles.durationBadge}>{formatDuration(duration)}</span>
            </>
          ) : (
            post.media.map((url, index) => (
              <img
                key={index}
                src={url}
                alt={`Post media ${index + 1}`}
                style={post.media.length === 1 ? styles.singleMedia : styles.mediaItem}
              />
            ))
          )}

          {heart && (
            <svg
              viewBox="0 0 24 24"
              fill="#ff4d6d"
              style={{
                ...styles.heart,
                left: heart.x,
                top: heart.y,
                opacity: heartPopped ? 1 : 0,
                transform: `translate(-50%, -50%) scale(${heartPopped ? 1 : 0.4})`,
              }}
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          )}
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
          {formatCount(post.like_count)}
        </button>

        <button
          type="button"
          style={styles.actionBtn}
          onClick={() => setCommentOpen(true)}
          aria-label="Comment"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          {formatCount(commentCount)}
        </button>

        <button type="button" style={styles.actionBtn} onClick={() => void handleShare()} aria-label="Share">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
            <polyline points="16 6 12 2 8 6"></polyline>
            <line x1="12" y1="2" x2="12" y2="15"></line>
          </svg>
          {formatCount(shares)}
        </button>

        {!isOwn && post.author_id !== currentUserId && (
          <ReportButton
            targetUserId={post.author_id}
            targetType="moment"
            targetId={post.id}
            title="Report this Moment"
            ariaLabel="Report this Moment"
          />
        )}

        <div style={styles.viewsChip} title={`${formatCount(uniqueViews)} unique viewers`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          {formatCount(views)}
        </div>

        {notice && <span style={styles.notice}>{notice}</span>}
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

      {commentOpen && (
        <CommentSheet
          momentId={post.id}
          currentUserId={currentUserId ?? null}
          onCountChange={setCommentCount}
          onClose={() => setCommentOpen(false)}
        />
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
  captionRow: { display: 'block', padding: '0 16px 12px 16px' },
  caption: { fontSize: '14px', color: '#EAE2F0', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const },
  moreBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '13px', fontWeight: 700, cursor: 'pointer', padding: '0 4px' },
  singleMediaWrap: { position: 'relative' as const, padding: '0 16px' },
  mediaGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', position: 'relative' as const },
  mediaItem: { width: '100%', aspectRatio: '1/1', objectFit: 'cover' as const, backgroundColor: '#34283F', cursor: 'pointer' },
  singleMedia: { width: '100%', maxHeight: '460px', objectFit: 'cover' as const, backgroundColor: '#0B0910', cursor: 'pointer', display: 'block', borderRadius: '12px' },
  playOverlay: { position: 'absolute' as const, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none' as const, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' },
  soundBtn: { position: 'absolute' as const, top: '12px', right: '26px', width: '34px', height: '34px', borderRadius: '50%', border: 'none', backgroundColor: 'rgba(8,6,10,0.6)', color: '#EAE2F0', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  durationBadge: { position: 'absolute' as const, bottom: '12px', right: '26px', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(8,6,10,0.6)', color: '#EAE2F0', fontSize: '11px', fontWeight: 600 },
  heart: { position: 'absolute' as const, width: '96px', height: '96px', pointerEvents: 'none' as const, transition: 'opacity 160ms ease, transform 220ms ease', zIndex: 5 },
  actionBar: { display: 'flex', alignItems: 'center', gap: '18px', padding: '16px', flexWrap: 'wrap' as const },
  actionBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#B58A83', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  actionBtnLiked: { color: '#EF4444' },
  viewsChip: { display: 'flex', alignItems: 'center', gap: '6px', color: '#7C6F86', fontSize: '14px', fontWeight: 600, marginLeft: 'auto' },
  notice: { fontSize: '12px', color: '#D8B38A', fontWeight: 600 },
  lightbox: { position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(8, 6, 10, 0.94)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' },
  lightboxImage: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const, borderRadius: '12px' },
  lightboxClose: { position: 'absolute' as const, top: '24px', right: '24px', width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.12)', color: '#EAE2F0', border: 'none', fontSize: '24px', cursor: 'pointer' },
};
