'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MomentArchiveRow } from '@/lib/types';
import {
  ARCHIVE_LIMITS,
  MomentError,
  deleteMoment,
  fetchArchiveCounts,
  fetchArchivedMoments,
  restoreMoment,
  type ArchiveCounts,
} from '@/lib/moments';
import { formatCount, resolveMediaType } from '@/lib/media';

/**
 * The archive: every post the member has hidden from their profile.
 *
 * Self-contained — it loads its own rows and usage counts, because the archive
 * is a separate surface with its own caps. Restoring or deleting reports back
 * through `onChanged` so the profile page refreshes its post list and meters.
 */
export interface ArchivePanelProps {
  onClose: () => void;
  onChanged: () => void;
}

type Pending = 'restore' | 'delete' | null;

export default function ArchivePanel({ onClose, onChanged }: ArchivePanelProps) {
  const [rows, setRows] = useState<MomentArchiveRow[]>([]);
  const [counts, setCounts] = useState<ArchiveCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, usage] = await Promise.all([fetchArchivedMoments(), fetchArchiveCounts()]);
      setRows(list);
      setCounts(usage);
      setError(null);
    } catch (err) {
      console.error('[archive] load failed:', err);
      setError(err instanceof MomentError ? err.message : 'Could not load your archive.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (id: string, action: Pending) => {
    if (!action) return;
    setBusyId(id);
    setError(null);
    try {
      if (action === 'restore') {
        await restoreMoment(id);
      } else {
        await deleteMoment(id);
      }
      setConfirmId(null);
      await load();
      onChanged();
    } catch (err) {
      console.error('[archive] action failed:', err);
      setError(err instanceof MomentError ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const atLimit =
    !!counts && (counts.photoCount >= counts.photoLimit || counts.videoCount >= counts.videoLimit);

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Archive"
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.head}>
          <div>
            <div style={styles.title}>Archive</div>
            <div style={styles.subtitle}>Posts hidden from your profile</div>
          </div>
          <button type="button" style={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {counts && (
          <div style={styles.meterWrap}>
            <Meter label="Photos" used={counts.photoCount} limit={counts.photoLimit} />
            <Meter label="Videos" used={counts.videoCount} limit={counts.videoLimit} />
          </div>
        )}

        {atLimit && (
          <div style={styles.warning}>
            Your archive is full. Restore or delete a post before archiving another.
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {loading ? (
          <div style={styles.empty}>Loading archive…</div>
        ) : rows.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>Nothing archived</div>
            Use a post&apos;s “…” menu → Move to archive to hide it from your profile.
          </div>
        ) : (
          rows.map((row) => {
            const mediaUrl = row.media[0];
            const isVideo = resolveMediaType(row.media_type, mediaUrl) === 'video';
            return (
              <div key={row.id} style={styles.item} data-testid={`archive-item-${row.id}`}>
                <div style={styles.thumbWrap}>
                  {mediaUrl ? (
                    isVideo ? (
                      <span style={styles.thumbIcon} aria-hidden>🎬</span>
                    ) : (
                      <img src={mediaUrl} alt="" style={styles.thumb} />
                    )
                  ) : (
                    <span style={styles.thumbIcon} aria-hidden>📝</span>
                  )}
                </div>
                <div style={styles.itemBody}>
                  <div style={styles.itemCaption}>
                    {row.caption?.trim() || (isVideo ? 'Untitled video' : 'Untitled post')}
                  </div>
                  <div style={styles.itemMeta}>
                    {isVideo ? 'Video' : 'Photo'} · {formatCount(row.like_count)} likes ·{' '}
                    {formatCount(row.comment_count)} comments
                  </div>

                  {confirmId === row.id ? (
                    <div style={styles.confirmRow}>
                      <span style={styles.confirmText}>Delete permanently?</span>
                      <button
                        type="button"
                        style={styles.linkMuted}
                        onClick={() => setConfirmId(null)}
                        disabled={busyId === row.id}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        style={styles.linkDanger}
                        onClick={() => void run(row.id, 'delete')}
                        disabled={busyId === row.id}
                        data-testid={`archive-delete-confirm-${row.id}`}
                      >
                        {busyId === row.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ) : (
                    <div style={styles.itemActions}>
                      <button
                        type="button"
                        style={styles.restoreBtn}
                        onClick={() => void run(row.id, 'restore')}
                        disabled={busyId === row.id}
                        data-testid={`archive-restore-${row.id}`}
                      >
                        {busyId === row.id ? 'Working…' : 'Restore'}
                      </button>
                      <button
                        type="button"
                        style={styles.deleteBtn}
                        onClick={() => setConfirmId(row.id)}
                        disabled={busyId === row.id}
                        data-testid={`archive-delete-${row.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = used >= limit;
  return (
    <div style={styles.meter}>
      <div style={styles.meterTop}>
        <span style={styles.meterLabel}>{label}</span>
        <span style={styles.meterValue}>
          {used}/{limit}
        </span>
      </div>
      <div style={styles.meterTrack}>
        <div
          style={{
            ...styles.meterFill,
            width: `${pct}%`,
            backgroundColor: full ? '#C78C8D' : '#D8B38A',
          }}
        />
      </div>
    </div>
  );
}

/** Re-exported so the profile page can size its own archive affordance. */
export const ARCHIVE_CAPACITY = ARCHIVE_LIMITS;

const styles = {
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
    maxHeight: '85vh',
    overflowY: 'auto' as const,
  },
  head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
  title: { fontSize: '18px', fontWeight: 700, color: '#EAE2F0' },
  subtitle: { fontSize: '13px', color: '#B58A83', marginTop: '2px' },
  close: {
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#EAE2F0',
    fontSize: '20px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  meterWrap: { display: 'flex', gap: '16px', marginTop: '18px', marginBottom: '8px' },
  meter: { flex: 1 },
  meterTop: { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' },
  meterLabel: { fontSize: '12px', color: '#B58A83', fontWeight: 600 },
  meterValue: { fontSize: '12px', color: '#EAE2F0', fontWeight: 700 },
  meterTrack: { height: '6px', borderRadius: '999px', backgroundColor: '#131017', overflow: 'hidden' as const },
  meterFill: { height: '100%', borderRadius: '999px', transition: 'width 0.2s ease' },
  warning: {
    marginTop: '12px',
    backgroundColor: '#3B1220',
    border: '1px solid #7F1D2E',
    color: '#FCA5B5',
    borderRadius: '12px',
    padding: '10px 14px',
    fontSize: '13px',
  },
  error: { marginTop: '12px', color: '#F0A6A6', fontSize: '13px' },
  empty: {
    marginTop: '18px',
    backgroundColor: '#131017',
    border: '1px dashed #4A1828',
    borderRadius: '16px',
    padding: '28px 20px',
    textAlign: 'center' as const,
    color: '#B58A83',
    fontSize: '13px',
  },
  emptyTitle: { fontSize: '15px', fontWeight: 700, color: '#EAE2F0', marginBottom: '6px' },
  item: {
    display: 'flex',
    gap: '12px',
    marginTop: '14px',
    padding: '12px',
    borderRadius: '16px',
    backgroundColor: '#131017',
    border: '1px solid #34283F',
  },
  thumbWrap: {
    width: '56px',
    height: '56px',
    borderRadius: '12px',
    backgroundColor: '#34283F',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden' as const,
    flexShrink: 0,
  },
  thumb: { width: '100%', height: '100%', objectFit: 'cover' as const },
  thumbIcon: { fontSize: '24px' },
  itemBody: { flex: 1, minWidth: 0 },
  itemCaption: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#EAE2F0',
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    display: '-webkit-box' as const,
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  },
  itemMeta: { fontSize: '11px', color: '#B58A83', marginTop: '4px' },
  itemActions: { display: 'flex', gap: '10px', marginTop: '10px' },
  restoreBtn: {
    padding: '7px 16px',
    borderRadius: '999px',
    border: 'none',
    background: 'linear-gradient(135deg, #D8B38A, #C78C8D)',
    color: '#131017',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  deleteBtn: {
    padding: '7px 16px',
    borderRadius: '999px',
    border: '1px solid #7F1D2E',
    backgroundColor: 'transparent',
    color: '#F0A6A6',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  confirmRow: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', flexWrap: 'wrap' as const },
  confirmText: { fontSize: '12px', color: '#F0A6A6', fontWeight: 600 },
  linkMuted: { background: 'none', border: 'none', color: '#B58A83', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
  linkDanger: { background: 'none', border: 'none', color: '#FCA5B5', fontSize: '12px', fontWeight: 700, cursor: 'pointer' },
};
