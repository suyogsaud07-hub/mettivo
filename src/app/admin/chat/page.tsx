'use client';

import Link from 'next/link';
import { useAdmin } from '../AdminContext';
import {
  Card,
  ErrorBanner,
  LoadingBlock,
  Notice,
  StatCard,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import RateLimitEditor from '../components/RateLimitEditor';
import { fetchChatStats } from '@/lib/admin-console';

export default function AdminChatPage() {
  const { can } = useAdmin();
  const resource = useAdminResource(fetchChatStats, []);
  const stats = resource.data;

  if (resource.loading && !stats) return <LoadingBlock rows={6} />;

  return (
    <div>
      <ErrorBanner message={resource.error} />

      <Notice>
        {stats?.privacyNote ??
          'This surface exposes aggregate counts only. Private conversations are never readable here.'}
        {' '}Reported messages are reviewed only through the authorised moderation workflow.
      </Notice>

      {stats && (
        <>
          <div className="admin-grid cols-4">
            <StatCard label="Messages all time" value={formatNumber(stats.messagesTotal)} />
            <StatCard label="Messages in 24h" value={formatNumber(stats.messages24h)} />
            <StatCard label="Matches" value={formatNumber(stats.matchesTotal)} />
            <StatCard
              label="Reported messages"
              value={formatNumber(stats.reportedMessagesOpen)}
              foot="Open cases awaiting moderation."
            />
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card title="Communication health">
              <ul className="admin-list">
                <li><span>Messages in the last 7 days</span><strong>{formatNumber(stats.messages7d)}</strong></li>
                <li><span>Disappearing media records</span><strong>{formatNumber(stats.chatMediaTotal)}</strong></li>
                <li><span>Blocked-contact enforcement</span><span className="admin-pill is-success">database enforced</span></li>
                <li><span>Private message browsing</span><span className="admin-pill is-neutral">not available</span></li>
              </ul>
              <p className="admin-card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
                Review reported messages in <Link href="/admin/moderation">Safety &amp; moderation</Link>.
                Access is limited to the evidence snapshot captured when the report was filed.
              </p>
            </Card>

            <Card title="Notification delivery">
              <ul className="admin-list">
                <li><span>In-app notifications</span><span className="admin-pill is-success">database-backed</span></li>
                <li><span>Email outbox</span><span className="admin-pill is-warning">Resend configuration required</span></li>
                <li><span>Push delivery</span><span className="admin-pill is-warning">provider not configured</span></li>
                <li><span>Unsubscribe handling</span><span className="admin-pill is-info">member preferences</span></li>
              </ul>
            </Card>
          </div>
        </>
      )}

      {can('settings.manage') && (
        <div style={{ marginTop: 16 }}>
          <RateLimitEditor actions={['messages']} />
        </div>
      )}
    </div>
  );
}
