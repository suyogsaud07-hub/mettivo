'use client';

import { useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Pagination,
  formatDate,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import { fetchAuditLog } from '@/lib/admin-console';

const KNOWN_ACTIONS = [
  'admin.user.suspend',
  'admin.user.ban',
  'admin.user.reinstate',
  'admin.user.warn',
  'admin.role.set',
  'admin.plan.upsert',
  'admin.subscription.assign',
  'admin.moment.moderate',
  'admin.campaign.create',
  'admin.settings.set',
  'admin.rate_limit.update',
];

function summarise(details: Record<string, unknown> | null): string {
  if (!details) return '—';
  const reason = details.reason;
  if (typeof reason === 'string' && reason.trim()) return reason;
  const keys = Object.keys(details);
  if (keys.length === 0) return '—';
  return keys.slice(0, 4).join(', ');
}

export default function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const resource = useAdminResource(
    () => fetchAuditLog({ action: query, limit, offset }),
    [query, offset]
  );
  const rows = resource.data ?? [];
  const total = rows[0]?.totalCount ?? 0;

  return (
    <div>
      <ErrorBanner message={resource.error} />

      <form
        className="admin-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(action.trim());
          setOffset(0);
        }}
      >
        <input
          className="admin-input"
          style={{ maxWidth: 340 }}
          value={action}
          list="audit-actions"
          onChange={(event) => setAction(event.target.value)}
          placeholder="Filter by action, e.g. admin.user.ban"
          aria-label="Filter audit log by action"
        />
        <datalist id="audit-actions">
          {KNOWN_ACTIONS.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <button type="submit" className="admin-btn">Apply filter</button>
        {query && (
          <button
            type="button"
            className="admin-btn"
            onClick={() => {
              setAction('');
              setQuery('');
              setOffset(0);
            }}
          >
            Clear
          </button>
        )}
        <div className="admin-spacer" />
        <span className="admin-card-sub" style={{ margin: 0 }}>{formatNumber(total)} entries</span>
      </form>

      {resource.loading && !resource.data ? (
        <LoadingBlock rows={8} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No audit entries"
            detail="Every privileged action writes an immutable record here."
          />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="is-muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.createdAt)}</td>
                  <td><code className="admin-mono">{row.action}</code></td>
                  <td>
                    <div className="admin-person-name">{row.actorName ?? 'System'}</div>
                    <div className="admin-person-sub">{row.actorId?.slice(0, 8) ?? '—'}</div>
                  </td>
                  <td>
                    <div className="admin-person-name">{row.targetName ?? '—'}</div>
                    <div className="admin-person-sub">
                      {row.targetReportId ? `report ${row.targetReportId.slice(0, 8)}` : row.targetUserId?.slice(0, 8) ?? ''}
                    </div>
                  </td>
                  <td className="is-muted">{summarise(row.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 10px' }}>
            <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
          </div>
        </div>
      )}

      <p className="admin-card-sub" style={{ marginTop: 14 }}>
        Update and delete are not granted on the audit table. Records are append-only.
      </p>
    </div>
  );
}
