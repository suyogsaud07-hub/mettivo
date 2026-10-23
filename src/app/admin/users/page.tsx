'use client';

import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import {
  Card,
  Drawer,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Modal,
  Pagination,
  StatusPill,
  formatDate,
  formatNumber,
  roleLabel,
  useAdminResource,
} from '../components/AdminUI';
import {
  AdminError,
  fetchUserDetail,
  fetchUsers,
  setUserStatus,
  warnUser,
  type AccountStatus,
  type AdminUserRow,
} from '@/lib/admin-console';

interface PendingAction {
  kind: 'warn' | 'status';
  status?: AccountStatus;
  userId: string;
  name: string;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'banned', label: 'Banned' },
  { value: 'unverified', label: 'Unverified' },
];

export default function AdminUsersPage() {
  const { can } = useAdmin();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminUserRow | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const limit = 25;

  const list = useAdminResource(
    () => fetchUsers({ search: appliedSearch, status, limit, offset }),
    [appliedSearch, status, offset]
  );

  const detail = useAdminResource(
    () => (selected ? fetchUserDetail(selected.userId) : Promise.resolve(null)),
    [selected?.userId]
  );

  const rows = list.data ?? [];
  const total = rows[0]?.totalCount ?? 0;

  const submitAction = async () => {
    if (!action) return;
    if (!reason.trim()) {
      setActionError('A reason is required for every account action.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      if (action.kind === 'warn') {
        await warnUser(action.userId, reason.trim());
      } else if (action.status) {
        await setUserStatus(action.userId, action.status, reason.trim());
      }
      setAction(null);
      setReason('');
      list.reload();
      detail.reload();
    } catch (err) {
      setActionError(err instanceof AdminError ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner message={list.error} />

      <div className="admin-toolbar">
        <form
          className="admin-inline"
          style={{ flex: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setAppliedSearch(search.trim());
          }}
        >
          <input
            className="admin-input is-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search display name, username, name or email"
            aria-label="Search members"
          />
          <button type="submit" className="admin-btn is-gold">
            Search
          </button>
        </form>
        <select
          className="admin-select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
          aria-label="Filter by account status"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {list.loading && !list.data ? (
        <LoadingBlock rows={7} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No members match this view"
            detail="Try a different search term or account status."
          />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Reports</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div className="admin-person">
                      <div className="admin-avatar">
                        {row.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.avatarUrl} alt="" />
                        ) : (
                          row.displayName.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="admin-person-meta">
                        <div className="admin-person-name">{row.displayName}</div>
                        <div className="admin-person-sub">
                          {row.username ? `@${row.username} · ` : ''}
                          {row.email ?? 'Email hidden'}
                          {row.country ? ` · ${row.country}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={row.accountStatus} />
                    {row.isVerified && (
                      <span className="admin-pill is-info" style={{ marginLeft: 6 }}>
                        verified
                      </span>
                    )}
                  </td>
                  <td className="is-muted">{roleLabel(row.role)}</td>
                  <td className="is-muted">{row.planName ?? 'Free'}</td>
                  <td>{row.reportCount > 0 ? row.reportCount : '—'}</td>
                  <td className="is-muted">{formatDate(row.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn is-small"
                      onClick={() => {
                        setSelected(row);
                        setActionError(null);
                      }}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 10px' }}>
            <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
          </div>
        </div>
      )}

      {selected && (
        <Drawer title="Member review" onClose={() => setSelected(null)}>
          <ErrorBanner message={detail.error} />
          {detail.loading && !detail.data ? (
            <LoadingBlock rows={6} />
          ) : detail.data ? (
            <>
              <Card>
                <div className="admin-person" style={{ marginBottom: 14 }}>
                  <div className="admin-avatar" style={{ width: 48, height: 48, flexBasis: 48 }}>
                    {detail.data.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={detail.data.avatarUrl} alt="" />
                    ) : (
                      detail.data.displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <div className="admin-person-name" style={{ fontSize: 16 }}>
                      {detail.data.displayName}
                    </div>
                    <div className="admin-person-sub">
                      {detail.data.email ?? 'Email hidden'} · {roleLabel(detail.data.role)}
                    </div>
                  </div>
                </div>

                <dl className="admin-key-value">
                  <dt>Member id</dt>
                  <dd className="admin-mono">{detail.data.userId}</dd>
                  <dt>Account status</dt>
                  <dd>
                    <StatusPill
                      status={
                        detail.data.bannedUntil && new Date(detail.data.bannedUntil) > new Date()
                          ? 'banned'
                          : detail.data.isSuspended
                            ? 'suspended'
                            : 'active'
                      }
                    />
                  </dd>
                  <dt>Age / gender</dt>
                  <dd>
                    {detail.data.age ?? '—'} · {detail.data.gender ?? '—'}
                  </dd>
                  <dt>Location</dt>
                  <dd>{[detail.data.city, detail.data.country].filter(Boolean).join(', ') || '—'}</dd>
                  <dt>Intention</dt>
                  <dd>{detail.data.intention ?? '—'}</dd>
                  <dt>Onboarding</dt>
                  <dd>{detail.data.onboardingCompleted ? 'Complete' : 'Incomplete'}</dd>
                  <dt>Last seen</dt>
                  <dd>{formatDate(detail.data.lastSeenAt)}</dd>
                  <dt>Reports against</dt>
                  <dd>{formatNumber(detail.data.reportsAgainst.length)} shown</dd>
                  <dt>Reports filed</dt>
                  <dd>{formatNumber(detail.data.reportsBy)}</dd>
                  <dt>Subscription</dt>
                  <dd>
                    {detail.data.subscription
                      ? `${detail.data.subscription.planName ?? 'Plan'} · ${detail.data.subscription.status}` +
                        (detail.data.subscription.currentPeriodEnd
                          ? ` · ends ${formatDate(detail.data.subscription.currentPeriodEnd)}`
                          : '')
                      : 'No subscription record'}
                  </dd>
                  {detail.data.suspensionReason && (
                    <>
                      <dt>Suspension reason</dt>
                      <dd>{detail.data.suspensionReason}</dd>
                    </>
                  )}
                  {detail.data.banReason && (
                    <>
                      <dt>Ban reason</dt>
                      <dd>{detail.data.banReason}</dd>
                    </>
                  )}
                </dl>
              </Card>

              {detail.data.bio && (
                <Card title="Profile bio">
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: '#4b4149' }}>
                    {detail.data.bio}
                  </p>
                </Card>
              )}

              <Card title="Recent reports against this member">
                {detail.data.reportsAgainst.length === 0 ? (
                  <EmptyState title="No reports" detail="This member has no report history." />
                ) : (
                  <ul className="admin-list">
                    {detail.data.reportsAgainst.map((report) => (
                      <li key={report.id}>
                        <span>{report.category?.replace(/_/g, ' ') ?? 'report'}</span>
                        <span className="admin-inline" style={{ gap: 8 }}>
                          <StatusPill status={report.status ?? 'pending'} />
                          <span className="is-muted">{formatDate(report.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Recent moderation actions">
                {detail.data.moderationActions.length === 0 ? (
                  <EmptyState title="No actions recorded" />
                ) : (
                  <ul className="admin-list">
                    {detail.data.moderationActions.map((entry, index) => (
                      <li key={`${entry.action}-${index}`}>
                        <span>{entry.action.replace(/_/g, ' ')}</span>
                        <span className="is-muted">{formatDate(entry.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {detail.data.subscription === null && (
                <Card title="Privacy requests">
                  <p className="admin-card-sub" style={{ margin: 0 }}>
                    Account deletion is member-initiated from Settings. This console does not delete
                    <code> auth.users</code> directly, so retention and cascading deletion stay under the
                    documented erasure workflow.
                  </p>
                </Card>
              )}

              {can('users.manage') && (
                <Card title="Account actions" subtitle="Every action requires a reason and is audited.">
                  <div className="admin-inline">
                    <button
                      type="button"
                      className="admin-btn"
                      onClick={() => {
                        setReason('');
                        setActionError(null);
                        setAction({ kind: 'warn', userId: detail.data!.userId, name: detail.data!.displayName });
                      }}
                    >
                      Warn member
                    </button>
                    {detail.data.isSuspended || (detail.data.bannedUntil && new Date(detail.data.bannedUntil) > new Date()) ? (
                      <button
                        type="button"
                        className="admin-btn is-gold"
                        onClick={() => {
                          setReason('');
                          setActionError(null);
                          setAction({
                            kind: 'status',
                            status: 'active',
                            userId: detail.data!.userId,
                            name: detail.data!.displayName,
                          });
                        }}
                      >
                        Reinstate account
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="admin-btn"
                          onClick={() => {
                            setReason('');
                            setActionError(null);
                            setAction({
                              kind: 'status',
                              status: 'suspended',
                              userId: detail.data!.userId,
                              name: detail.data!.displayName,
                            });
                          }}
                        >
                          Suspend temporarily
                        </button>
                        <button
                          type="button"
                          className="admin-btn is-danger"
                          onClick={() => {
                            setReason('');
                            setActionError(null);
                            setAction({
                              kind: 'status',
                              status: 'banned',
                              userId: detail.data!.userId,
                              name: detail.data!.displayName,
                            });
                          }}
                        >
                          Ban permanently
                        </button>
                      </>
                    )}
                  </div>
                  <p className="admin-card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                    Duplicate-account detection is not automated. Review shared device, email and
                    report evidence manually before treating two accounts as the same person.
                  </p>
                </Card>
              )}
            </>
          ) : (
            <EmptyState title="Member not found" />
          )}
        </Drawer>
      )}

      {action && (
        <Modal
          title={
            action.kind === 'warn'
              ? `Warn ${action.name}`
              : action.status === 'active'
                ? `Reinstate ${action.name}`
                : action.status === 'suspended'
                  ? `Suspend ${action.name}`
                  : `Ban ${action.name}`
          }
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <p>
            {action.kind === 'warn'
              ? 'The member receives an in-app safety notice. The warning is recorded in the audit log.'
              : action.status === 'active'
                ? 'This clears the suspension and ban flags. The member can post and message again.'
                : action.status === 'suspended'
                  ? 'The member is paused until an administrator reinstates them.'
                  : 'The member is blocked permanently until an administrator reinstates them.'}
          </p>
          <ErrorBanner message={actionError} />
          <div className="admin-field">
            <label htmlFor="action-reason">Reason (required)</label>
            <textarea
              id="action-reason"
              className="admin-textarea"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Describe the evidence and the policy basis."
            />
          </div>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={action.status === 'banned' ? 'admin-btn is-danger' : 'admin-btn is-primary'}
              disabled={busy || !reason.trim()}
              onClick={() => void submitAction()}
            >
              {busy ? 'Applying…' : 'Confirm action'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
