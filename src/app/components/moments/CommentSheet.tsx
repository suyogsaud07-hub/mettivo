'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MomentAuthor, MomentCommentRow } from '@/lib/types';
import {
  MomentError,
  addMomentComment,
  countryFlag,
  fetchMomentAuthors,
  fetchMomentComments,
  genderIcon,
  subscribeToMomentComments,
} from '@/lib/moments';

/**
 * The comment drawer for one Moment.
 *
 * Lives inside `MomentCard`, so every surface that shows a card — the Moments
 * feed, the own-profile Posts tab and a public profile — gets the same thread
 * without each page re-implementing it. A Realtime subscription keeps the list
 * live while the drawer is open; it is torn down on close.
 */
export interface CommentSheetProps {
  momentId: string;
  currentUserId: string | null;
  /** Reports the thread length so the card's comment counter stays in step. */
  onCountChange: (count: number) => void;
  onClose: () => void;
}

export default function CommentSheet({
  momentId,
  currentUserId,
  onCountChange,
  onClose,
}: CommentSheetProps) {
  const [comments, setComments] = useState<MomentCommentRow[]>([]);
  const [authors, setAuthors] = useState<Record<string, MomentAuthor>>({});
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const authorIds = useMemo(
    () => Array.from(new Set(comments.map((comment) => comment.author_id))),
    [comments]
  );
  const authorKey = authorIds.join(',');

  const load = useCallback(async () => {
    try {
      const rows = await fetchMomentComments(momentId);
      setComments(rows);
      onCountChange(rows.length);
      setError(null);
    } catch (err) {
      console.error('[comments] load failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not load comments.');
    } finally {
      // Always leaves the spinner, even on failure.
      setLoading(false);
    }
  }, [momentId, onCountChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const unsubscribe = subscribeToMomentComments(momentId, () => {
      void load();
    });
    return unsubscribe;
  }, [load, momentId]);

  // Names/avatars for whoever appears in the thread, re-read only when the set of
  // authors actually changes (keyed on the joined ids, not the array identity).
  useEffect(() => {
    if (!authorKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const map = await fetchMomentAuthors(authorKey.split(','));
        if (!cancelled) setAuthors((prev) => ({ ...prev, ...map }));
      } catch (err) {
        console.error('[comments] authors failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the newest comment in view as the thread grows.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      await addMomentComment(momentId, body);
      setDraft('');
      await load();
    } catch (err) {
      console.error('[comments] send failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not post your comment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-label="Comments">
      <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.grabber} />
        <div style={styles.header}>
          <div style={styles.title}>Comments</div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close comments">
            ×
          </button>
        </div>

        <div ref={listRef} style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading comments…</div>
          ) : comments.length === 0 ? (
            <div style={styles.empty}>No comments yet. Be the first to reply.</div>
          ) : (
            comments.map((comment) => {
              const author = authors[comment.author_id];
              return (
                <div key={comment.id} style={styles.comment}>
                  {author?.avatarUrl ? (
                    <img src={author.avatarUrl} alt="" style={styles.avatar} />
                  ) : (
                    <div style={styles.avatarFallback}>{genderIcon(author?.gender ?? '')}</div>
                  )}
                  <div style={styles.commentBody}>
                    <div style={styles.commentMeta}>
                      <span style={styles.commentName}>
                        {author?.country ? `${countryFlag(author.country)} ` : ''}
                        {author?.displayName ?? 'Member'}
                      </span>
                      <span style={styles.commentTime}>{relativeTime(comment.created_at)}</span>
                    </div>
                    <div style={styles.commentText}>{comment.body}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <div role="alert" style={styles.error}>
            {error}
          </div>
        )}

        <div style={styles.composer}>
          <input
            style={styles.input}
            placeholder="Add a comment…"
            value={draft}
            maxLength={1000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            style={{ ...styles.sendBtn, opacity: draft.trim() && !sending ? 1 : 0.5 }}
            onClick={() => void handleSend()}
            disabled={sending || !draft.trim()}
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
        {currentUserId ? null : <div style={styles.empty}>Sign in to comment.</div>}
      </div>
    </div>
  );
}

/** Compact relative time: 10s, 4m, 3h, 2d, 5w. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(8, 6, 10, 0.72)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 1200,
  },
  sheet: {
    width: '100%',
    maxWidth: '560px',
    maxHeight: '78vh',
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#211A28',
    borderTopLeftRadius: '24px',
    borderTopRightRadius: '24px',
    border: '1px solid #34283F',
    borderBottom: 'none',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  grabber: {
    width: '44px',
    height: '4px',
    borderRadius: '999px',
    backgroundColor: '#34283F',
    margin: '10px auto 0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid #34283F',
  },
  title: { fontSize: '16px', fontWeight: 700, color: '#EAE2F0' },
  closeBtn: { background: 'none', border: 'none', color: '#B58A83', fontSize: '24px', cursor: 'pointer', lineHeight: 1 },
  list: { flex: 1, overflowY: 'auto' as const, padding: '8px 16px', minHeight: '120px' },
  empty: { padding: '32px 16px', textAlign: 'center' as const, color: '#B58A83', fontSize: '13px' },
  comment: { display: 'flex', gap: '10px', padding: '10px 0', alignItems: 'flex-start' },
  avatar: { width: '34px', height: '34px', borderRadius: '50%', objectFit: 'cover' as const, backgroundColor: '#34283F', flexShrink: 0 },
  avatarFallback: { width: '34px', height: '34px', borderRadius: '50%', backgroundColor: '#34283F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 },
  commentBody: { flex: 1, minWidth: 0 },
  commentMeta: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  commentName: { fontSize: '13px', fontWeight: 700, color: '#EAE2F0' },
  commentTime: { fontSize: '11px', color: '#7C6F86' },
  commentText: { fontSize: '14px', color: '#EAE2F0', lineHeight: 1.45, marginTop: '2px', overflowWrap: 'anywhere' as const },
  error: { margin: '0 16px 8px 16px', backgroundColor: '#3B1220', border: '1px solid #7F1D2E', color: '#FCA5B5', borderRadius: '12px', padding: '10px 14px', fontSize: '12px' },
  composer: { display: 'flex', gap: '10px', padding: '12px 16px', borderTop: '1px solid #34283F' },
  input: { flex: 1, padding: '12px 16px', borderRadius: '999px', border: '1px solid #34283F', backgroundColor: '#131017', color: '#EAE2F0', fontSize: '14px', outline: 'none' },
  sendBtn: { padding: '0 20px', borderRadius: '999px', border: 'none', background: 'linear-gradient(135deg, #D8B38A, #B58A83)', color: '#131017', fontSize: '14px', fontWeight: 800, cursor: 'pointer' },
};
