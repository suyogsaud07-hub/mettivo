'use client';

import { useState } from 'react';
import { useAdmin } from '../AdminContext';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Modal,
  Notice,
  StatusPill,
  formatDate,
  roleLabel,
  useAdminResource,
} from '../components/AdminUI';
import {
  AdminError,
  fetchStaff,
  setStaffRole,
  type AdminRole,
} from '@/lib/admin-console';

const ROLE_MATRIX: { role: AdminRole; scope: string }[] = [
  { role: 'admin', scope: 'Full control: staff, plans, settings, audit, system, all operations.' },
  { role: 'moderator', scope: 'Reports, user warnings/suspensions/bans, content and campaign drafts.' },
  { role: 'support', scope: 'Read member accounts and subscriptions; no bans, refunds or role changes.' },
  { role: 'finance', scope: 'Payments, subscriptions and analytics; no moderation or security settings.' },
];

export default function AdminStaffPage() {
  const { identity } = useAdmin();
  const resource = useAdminResource(fetchStaff, []);
  const [target, setTarget] = useState<string | null>(null);
  const [role, setRole] = useState<AdminRole>('support');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<AdminRole>('moderator');

  const staff = resource.data ?? [];

  const saveRole = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await setStaffRole(target, role);
      setTarget(null);
      resource.reload();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'The role could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  const addStaff = async () => {
    if (!addUserId.trim()) {
      setError('A member user id is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setStaffRole(addUserId.trim(), addRole);
      setAddOpen(false);
      setAddUserId('');
      resource.reload();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'The staff role could not be assigned.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner message={resource.error} />
      <Notice>
        Staff roles are stored only in <code>user_roles</code>. The database rejects client writes to
        that table, and every grant or revocation below is audited. The last super admin cannot be
        demoted.
      </Notice>

      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title" style={{ fontSize: 20 }}>Authorised staff</h2>
          <p className="admin-page-desc">
            Assign the least privilege needed for the job. Support and finance roles cannot moderate
            content or change security configuration.
          </p>
        </div>
        <button type="button" className="admin-btn is-gold" onClick={() => { setError(null); setAddOpen(true); }}>
          Assign role
        </button>
      </div>

      {resource.loading && !resource.data ? (
        <LoadingBlock rows={5} />
      ) : staff.length === 0 ? (
        <Card>
          <EmptyState
            title="No staff roles recorded"
            detail="Bootstrap the first super admin with the documented SQL procedure."
          />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Granted</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div className="admin-person-name">{row.displayName}</div>
                    <div className="admin-person-sub">{row.email ?? row.userId}</div>
                  </td>
                  <td><StatusPill status={row.role} tone="gold" /></td>
                  <td className="is-muted">{formatDate(row.grantedAt)}</td>
                  <td className="is-muted">{formatDate(row.lastSeenAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn is-small"
                      disabled={row.userId === identity.userId}
                      title={row.userId === identity.userId ? 'You cannot change your own role' : undefined}
                      onClick={() => {
                        setError(null);
                        setRole(row.role);
                        setTarget(row.userId);
                      }}
                    >
                      Change role
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="admin-section-title">Role boundaries</h2>
      <div className="admin-grid cols-2">
        {ROLE_MATRIX.map((entry) => (
          <Card key={entry.role}>
            <div className="admin-card-head">
              <h3 className="admin-card-title">{roleLabel(entry.role)}</h3>
              <span className="admin-pill is-gold">{entry.role}</span>
            </div>
            <p className="admin-card-sub" style={{ margin: 0 }}>{entry.scope}</p>
          </Card>
        ))}
      </div>

      {target && (
        <Modal title="Change staff role" onClose={() => { if (!busy) setTarget(null); }}>
          <ErrorBanner message={error} />
          <div className="admin-field">
            <label htmlFor="staff-role">New role</label>
            <select
              id="staff-role"
              className="admin-select"
              value={role}
              onChange={(event) => setRole(event.target.value as AdminRole)}
            >
              <option value="moderator">Moderator</option>
              <option value="support">Support agent</option>
              <option value="finance">Finance manager</option>
              <option value="admin">Super admin</option>
              <option value="user">Remove staff access</option>
            </select>
          </div>
          <p className="admin-card-sub">
            Removing access sets the member back to an ordinary user. Existing audit history is
            retained.
          </p>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setTarget(null)}>Cancel</button>
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => void saveRole()}>
              {busy ? 'Saving…' : 'Apply role'}
            </button>
          </div>
        </Modal>
      )}

      {addOpen && (
        <Modal title="Assign a staff role" onClose={() => { if (!busy) setAddOpen(false); }}>
          <ErrorBanner message={error} />
          <div className="admin-field">
            <label htmlFor="add-user">Member user id</label>
            <input
              id="add-user"
              className="admin-input admin-mono"
              value={addUserId}
              onChange={(event) => setAddUserId(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="add-role">Role</label>
            <select
              id="add-role"
              className="admin-select"
              value={addRole}
              onChange={(event) => setAddRole(event.target.value as AdminRole)}
            >
              <option value="moderator">Moderator</option>
              <option value="support">Support agent</option>
              <option value="finance">Finance manager</option>
              <option value="admin">Super admin</option>
            </select>
          </div>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setAddOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => void addStaff()}>
              {busy ? 'Assigning…' : 'Assign role'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
