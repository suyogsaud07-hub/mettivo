'use client';

import { useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Modal,
  Notice,
  StatusPill,
  formatDate,
  useAdminResource,
} from '../components/AdminUI';
import {
  AdminError,
  createCampaign,
  fetchCampaigns,
} from '@/lib/admin-console';

export default function AdminNotificationsPage() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [channel, setChannel] = useState('in_app');
  const [audience, setAudience] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resource = useAdminResource(fetchCampaigns, []);
  const campaigns = resource.data ?? [];

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError('A title and body are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCampaign({
        title: title.trim(),
        body: body.trim(),
        channel,
        audience: { segment: audience },
      });
      setOpen(false);
      setTitle('');
      setBody('');
      resource.reload();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'The campaign draft could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ErrorBanner message={resource.error} />
      <Notice>
        Campaign drafts are stored in the database. Sending is intentionally disabled until an email
        or push provider, consent handling and unsubscribe flow are configured. This console will not
        claim a campaign was delivered when no provider exists.
      </Notice>

      <div className="admin-page-head">
        <div>
          <h2 className="admin-page-title" style={{ fontSize: 20 }}>Campaign drafts</h2>
          <p className="admin-page-desc">
            Prepare announcements, welcome messages and re-engagement copy. Each audience segment is
            an advisory selector; delivery must still apply consent and opt-out preferences.
          </p>
        </div>
        <button type="button" className="admin-btn is-gold" onClick={() => { setError(null); setOpen(true); }}>
          New campaign draft
        </button>
      </div>

      <div className="admin-grid cols-3" style={{ marginBottom: 16 }}>
        <Card title="In-app">
          <p className="admin-card-sub" style={{ margin: 0 }}>
            In-app notifications are stored in the existing <code>notifications</code> table and remain
            member-scoped by RLS. Delivering a campaign in bulk is not enabled.
          </p>
        </Card>
        <Card title="Email">
          <p className="admin-card-sub" style={{ margin: 0 }}>
            Resend outbox exists for moderation mail. Marketing email requires a separate consent and
            unsubscribe configuration before it can be used.
          </p>
        </Card>
        <Card title="Push">
          <p className="admin-card-sub" style={{ margin: 0 }}>
            No push provider is configured. Campaign records can be prepared, but delivery is
            unavailable.
          </p>
        </Card>
      </div>

      {resource.loading && !resource.data ? (
        <LoadingBlock rows={5} />
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState title="No campaign drafts" detail="Create a draft to prepare a future announcement." />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th>Audience</th>
                <th>Status</th>
                <th>Created</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="is-strong">{campaign.title}</div>
                    <div className="admin-person-sub">{campaign.body.slice(0, 90)}</div>
                  </td>
                  <td><span className="admin-pill is-neutral">{campaign.channel}</span></td>
                  <td className="is-muted">
                    {typeof campaign.audience.segment === 'string' ? campaign.audience.segment : 'custom'}
                  </td>
                  <td><StatusPill status={campaign.status} /></td>
                  <td className="is-muted">{formatDate(campaign.createdAt)}</td>
                  <td className="is-muted">{formatDate(campaign.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="New campaign draft" onClose={() => { if (!busy) setOpen(false); }}>
          <ErrorBanner message={error} />
          <div className="admin-field">
            <label htmlFor="campaign-title">Title</label>
            <input
              id="campaign-title"
              className="admin-input"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A new chapter on Mettivo"
            />
          </div>
          <div className="admin-field">
            <label htmlFor="campaign-body">Body</label>
            <textarea
              id="campaign-body"
              className="admin-textarea"
              value={body}
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write the member-facing copy."
            />
          </div>
          <div className="admin-grid cols-2" style={{ gap: 10 }}>
            <div className="admin-field">
              <label htmlFor="campaign-channel">Channel</label>
              <select
                id="campaign-channel"
                className="admin-select"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="in_app">In-app</option>
                <option value="email">Email</option>
                <option value="push">Push</option>
              </select>
            </div>
            <div className="admin-field">
              <label htmlFor="campaign-audience">Audience segment</label>
              <select
                id="campaign-audience"
                className="admin-select"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="all">All members</option>
                <option value="active">Recently active</option>
                <option value="free">Free tier</option>
                <option value="paid">Paid tier</option>
                <option value="lapsed">Lapsed members</option>
              </select>
            </div>
          </div>
          <p className="admin-card-sub">
            The draft records the intended segment. Delivery remains disabled until provider and
            consent integration is complete.
          </p>
          <div className="admin-inline" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="admin-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="admin-btn is-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
