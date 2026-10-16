'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MomentFeedRow, MomentVisibility } from '@/lib/types';
import {
  MOMENT_VISIBILITIES,
  MOMENT_VISIBILITY_HELP,
  MOMENT_VISIBILITY_LABELS,
} from '@/lib/moments';

/**
 * The "…" menu on a post the signed-in member authored.
 *
 * Owns only its own open/closed and busy state; every mutation is delegated to
 * the profile page, which owns the list and therefore decides how a change is
 * reflected. A rejected mutation surfaces here rather than closing the sheet, so
 * the member sees why (e.g. an archive-capacity refusal).
 */
export interface PostOptionsMenuProps {
  post: MomentFeedRow;
  onEditCaption: (caption: string) => Promise<void>;
  onChangeVisibility: (visibility: MomentVisibility) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => Promise<void>;
}

type Stage = 'menu' | 'caption' | 'privacy' | 'confirm-delete';

export default function PostOptionsMenu({
  post,
  onEditCaption,
  onChangeVisibility,
  onArchive,
  onDelete,
}: PostOptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('menu');
  const [captionDraft, setCaptionDraft] = useState(post.caption ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setStage('menu');
    setError(null);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const openMenu = () => {
    setCaptionDraft(post.caption ?? '');
    setStage('menu');
    setError(null);
    setOpen(true);
  };

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
      setOpen(false);
      setStage('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        style={styles.trigger}
        onClick={(event) => {
          event.stopPropagation();
          openMenu();
        }}
        aria-label="Post options"
        data-testid={`post-options-${post.id}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && (
        <div style={styles.overlay} onClick={close}>
          <div
            style={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Post options"
            onClick={(event) => event.stopPropagation()}
          >
            {stage === 'menu' && (
              <>
                <div style={styles.title}>Post options</div>
                <button
                  type="button"
                  style={styles.row}
                  onClick={() => { setError(null); setStage('caption'); }}
                >
                  <span style={styles.rowIcon}>✏️</span> Edit caption
                </button>
                <button
                  type="button"
                  style={styles.row}
                  onClick={() => { setError(null); setStage('privacy'); }}
                >
                  <span style={styles.rowIcon}>🔒</span>
                  <span style={styles.rowLabel}>Privacy</span>
                  <span style={styles.rowValue}>{MOMENT_VISIBILITY_LABELS[post.visibility]}</span>
                </button>
                <button
                  type="button"
                  style={styles.row}
                  disabled={busy}
                  onClick={() => void run(onArchive)}
                  data-testid={`post-archive-${post.id}`}
                >
                  <span style={styles.rowIcon}>📦</span> Move to archive
                </button>
                <button
                  type="button"
                  style={{ ...styles.row, ...styles.rowDanger }}
                  onClick={() => { setError(null); setStage('confirm-delete'); }}
                >
                  <span style={styles.rowIcon}>🗑️</span> Delete post
                </button>
              </>
            )}

            {stage === 'caption' && (
              <>
                <div style={styles.title}>Edit caption</div>
                <textarea
                  style={styles.textarea}
                  value={captionDraft}
                  maxLength={2000}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  placeholder="Write a caption…"
                  autoFocus
                />
                <div style={styles.actions}>
                  <button type="button" style={styles.cancel} onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.save, opacity: busy ? 0.7 : 1 }}
                    disabled={busy}
                    onClick={() => void run(() => onEditCaption(captionDraft))}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}

            {stage === 'privacy' && (
              <>
                <div style={styles.title}>Who can see this?</div>
                <div style={styles.subtitle}>Applies to this post only.</div>
                {MOMENT_VISIBILITIES.map((visibility) => (
                  <button
                    key={visibility}
                    type="button"
                    style={{
                      ...styles.row,
                      ...(post.visibility === visibility ? styles.rowActive : {}),
                    }}
                    disabled={busy}
                    onClick={() => void run(() => onChangeVisibility(visibility))}
                  >
                    <span style={styles.rowIcon}>
                      {visibility === 'public' ? '🌐' : visibility === 'matches' ? '👥' : '🔒'}
                    </span>
                    <span style={styles.rowLabel}>
                      {MOMENT_VISIBILITY_LABELS[visibility]}
                      <span style={styles.rowHint}>{MOMENT_VISIBILITY_HELP[visibility]}</span>
                    </span>
                    {post.visibility === visibility && <span style={styles.check}>✓</span>}
                  </button>
                ))}
              </>
            )}

            {stage === 'confirm-delete' && (
              <>
                <div style={styles.title}>Delete this post?</div>
                <div style={styles.subtitle}>
                  This removes it from your profile and Moments permanently. It cannot be undone.
                </div>
                <div style={styles.actions}>
                  <button type="button" style={styles.cancel} onClick={close} disabled={busy}>
                    Keep
                  </button>
                  <button
                    type="button"
                    style={{ ...styles.danger, opacity: busy ? 0.7 : 1 }}
                    disabled={busy}
                    onClick={() => void run(onDelete)}
                    data-testid={`post-delete-confirm-${post.id}`}
                  >
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </>
            )}

            {error && <div style={styles.error}>{error}</div>}
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  trigger: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    border: 'none',
    background: 'none',
    color: '#B58A83',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(8, 6, 10, 0.72)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 120,
    padding: '16px',
  },
  sheet: {
    width: '100%',
    maxWidth: '440px',
    backgroundColor: '#211A28',
    borderRadius: '24px',
    padding: '20px',
    border: '1px solid #34283F',
    marginBottom: '16px',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
  },
  title: { fontSize: '17px', fontWeight: 700, color: '#EAE2F0', marginBottom: '4px' },
  subtitle: { fontSize: '13px', color: '#B58A83', marginBottom: '16px' },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 12px',
    borderRadius: '14px',
    border: '1px solid transparent',
    background: 'none',
    color: '#EAE2F0',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  rowActive: { backgroundColor: '#2A2133', border: '1px solid #4A1828' },
  rowDanger: { color: '#F0A6A6' },
  rowIcon: { fontSize: '18px', width: '24px', textAlign: 'center' as const },
  rowLabel: { display: 'flex', flexDirection: 'column' as const, flex: 1, gap: '2px' },
  rowHint: { fontSize: '12px', color: '#B58A83', fontWeight: 500 },
  rowValue: { fontSize: '12px', color: '#D8B38A', fontWeight: 600 },
  check: { color: '#D8B38A', fontSize: '16px', fontWeight: 800 },
  textarea: {
    width: '100%',
    backgroundColor: '#131017',
    border: '1px solid #34283F',
    borderRadius: '14px',
    padding: '14px',
    color: '#EAE2F0',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    minHeight: '110px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
  },
  actions: { display: 'flex', gap: '12px', marginTop: '20px' },
  cancel: {
    flex: 1,
    padding: '14px',
    borderRadius: '16px',
    border: '1px solid #34283F',
    backgroundColor: 'transparent',
    color: '#B58A83',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
  },
  save: {
    flex: 1,
    padding: '14px',
    borderRadius: '16px',
    border: 'none',
    background: 'linear-gradient(135deg, #D8B38A, #C78C8D)',
    color: '#131017',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
  },
  danger: {
    flex: 1,
    padding: '14px',
    borderRadius: '16px',
    border: 'none',
    backgroundColor: '#7F1D2E',
    color: '#FCE7EA',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
  },
  error: { marginTop: '14px', color: '#F0A6A6', fontSize: '13px' },
};
