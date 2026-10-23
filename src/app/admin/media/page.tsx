'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAdmin } from '../AdminContext';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Modal,
  Pagination,
  StatCard,
  StatusPill,
  formatDate,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import {
  AdminError,
  fetchMediaStats,
  fetchMoments,
  setMomentModeration,
  type MomentRow,
} from '@/lib/admin-console';

const FILTERS = ['', 'pending', 'approved', 'rejected', 'failed_review'];

interface PendingModeration {
  moment: MomentRow;
  status: 'approved' | 'rejected';
}

export default function AdminMediaPage() {
  const { can } = useAdmin();
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState<PendingModeration | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const limit = 25;

  const statsResource = useAdminResource(fetchMediaStats, []);
  const listResource = useAdminResource(
    () => fetchMoments({ status, limit, offset }),
    [status, offset]
  );

  const stats = statsResource.data;
  const rows = listResource.data ?? [];
  const total = rows[0]?.totalCount ?? 0;

  const applyModeration = async () => {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await setMomentModeration(pending.moment.momentId, pending.status);
      setPending(null);
      listResource.reload();
      statsResource.reload();
    } catch (err) {
      setActionError(err instanceof AdminError ? err.message : 'The moderation change failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner message={statsResource.error ?? listResource.error} />

      {stats && (
        <div className="admin-grid cols-4">
          <StatCard label="Published Moments" value={formatNumber(stats.momentsTotal)} foot={`${formatNumber(stats.posts)} posts · ${formatNumber(stats.reels)} reels`} />
          <StatCard label="Pending review" value={formatNumber(stats.pending)} />
          <StatCard label="Rejected" value={formatNumber(stats.rejected)} foot={`${formatNumber(stats.failedReview)} failed review`} />
          <StatCard label="Reported content" value={formatNumber(stats.reportedMoments)} />
        </div>
      )}

      <Card
        title="Media storage"
        subtitle={stats?.storageNote ?? 'Storage integration is not configured.'}
      >
        <dl className="admin-key-value">
          <dt>Storage usage</dt>
          <dd>{stats?.storageBytes === null || stats?.storageBytes === undefined ? 'Unavailable' : `${formatNumber(stats.storageBytes)} bytes`}</dd>
          <dt>Upload limits</dt>
          <dd>Enforced by Moments CHECK constraints (10 items per post, 120s reels).</dd>
          <dt>Video scanning</dt>
          <dd>First image only. Video frames are not sampled in the current runtime.</dd>
        </dl>
      </Card>

      <h2 className="admin-section-title">Reported and moderated content</h2>

      <div className="admin-toolbar">
        <select
          className="admin-select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
          aria-label="Filter moderation status"
        >
          {FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === '' ? 'All moderation states' : value.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {listResource.loading && !listResource.data ? (
        <LoadingBlock rows={7} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No content in this view" detail="Nothing matches the selected moderation state." />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Content</th>
                <th>Author</th>
                <th>Type</th>
                <th>Reports</th>
                <th>Status</th>
                <th>Created</th>
                {can('content.manage') && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.momentId}>
                  <td>
                    <div className="admin-person-name">{row.caption?.slice(0, 70) || 'Untitled Moment'}</div>
                    <div className="admin-person-sub">{formatNumber(row.mediaCount)} media item{row.mediaCount === 1 ? '' : 's'} · {row.momentId.slice(0, 8)}</div>
                  </td>
                  <td>
                    <Link href={`/profile/${row.authorId}`} className="admin-person-name" style={{ color: '#7d5a36' }}>
                      {row.authorName}
                    </Link>
                  </td>
                  <td><span className="admin-pill is-neutral">{row.contentKind}</span></td>
                  <td>{row.reportCount > 0 ? row.reportCount : '—'}</td>
                  <td><StatusPill status={row.moderationStatus} /></td>
                  <td className="is-muted">{formatDate(row.createdAt)}</td>
                  {can('content.manage') && (
                    <td>
                      <div className="admin-inline" style={{ gap: 6 }}>
                        {row.moderationStatus !== 'approved' && (
                          <button
                            type="button"
                            className="admin-btn is-small"
                            onClick={() => {
                              setActionError(null);
                              setPending({ moment: row, status: 'approved' });
                            }}
                          >
                            Approve
                          </button>
                        )}
                        {row.moderationStatus !== 'rejected' && (
                          <button
                            type="button"
                            className="admin-btn is-small is-danger"
                            onClick={() => {
                              setActionError(null);
                              setPending({ moment: row, status: 'rejected' });
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 10px' }}>
            <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
          </div>
        </div>
      )}

      {pending && (
        <Modal
          title={pending.status === 'approved' ? 'Approve this content?' : 'Remove this content?'}
          onClose={() => { if (!busy) setPending(null); }}
        >
          <p>
            {pending.status === 'approved'
              ? 'Approving makes the Moment visible under its existing privacy setting. Only approved content appears to other members.'
              : 'Rejecting removes the Moment from every feed. The author keeps the record, and the decision is recorded in the audit log.'}
          </p>
          <p className="admin-mono">{pending.moment.momentId}</p>
          <ErrorBanner message={actionError} />
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
            <button
              type="button"
              className={pending.status === 'rejected' ? 'admin-btn is-danger' : 'admin-btn is-primary'}
              disabled={busy}
              onClick={() => void applyModeration()}
            >
              {busy ? 'Applying…' : pending.status === 'approved' ? 'Approve' : 'Remove content'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
