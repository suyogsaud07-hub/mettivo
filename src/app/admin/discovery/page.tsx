'use client';

import { useAdmin } from '../AdminContext';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Notice,
  StatCard,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import RateLimitEditor from '../components/RateLimitEditor';
import { fetchDiscoveryStats } from '@/lib/admin-console';

export default function AdminDiscoveryPage() {
  const { can } = useAdmin();
  const resource = useAdminResource(fetchDiscoveryStats, []);
  const stats = resource.data;

  if (resource.loading && !stats) return <LoadingBlock rows={6} />;

  return (
    <div>
      <ErrorBanner message={resource.error} />
      <Notice>
        {stats?.note ??
          'Discovery ranking is deterministic and rule-based. This console configures platform limits; it never rewrites private relationship preferences.'}
      </Notice>

      {stats && (
        <>
          <div className="admin-grid cols-4">
            <StatCard
              label="Profiles"
              value={formatNumber(stats.profilesTotal)}
              foot={`${formatNumber(stats.profilesWithPhotos)} with photos · ${formatNumber(stats.verifiedProfiles)} verified`}
            />
            <StatCard label="Online now" value={formatNumber(stats.onlineNow)} foot="Presence heartbeat within 2 minutes." />
            <StatCard
              label="Likes / passes"
              value={`${formatNumber(stats.likes)} / ${formatNumber(stats.passes)}`}
              foot={`${formatNumber(stats.matches)} matches · ${formatNumber(stats.follows)} follows`}
            />
            <StatCard
              label="Abuse controls"
              value={formatNumber(stats.blocks)}
              foot={`${formatNumber(stats.suspended)} suspended · ${formatNumber(stats.reportsOpen)} open reports`}
            />
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card title="Discovery safety" subtitle="Platform-level controls with real database enforcement.">
              <ul className="admin-list">
                <li><span>Blocking</span><span className="admin-pill is-success">excluded from discovery</span></li>
                <li><span>Suspension</span><span className="admin-pill is-success">hidden from discovery</span></li>
                <li><span>Like / pass rate limit</span><span className="admin-pill is-info">trigger enforced</span></li>
                <li><span>Private preferences</span><span className="admin-pill is-neutral">never exposed</span></li>
              </ul>
              <p className="admin-card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
                The product does not promise matching outcomes. Compatibility scores are deterministic
                and explainable; there are no fabricated success metrics.
              </p>
            </Card>

            <Card title="Open reports by target" subtitle="Where current safety pressure sits.">
              {stats.reportTargets.length === 0 ? (
                <EmptyState title="No open reports" />
              ) : (
                <ul className="admin-list">
                  {stats.reportTargets.map((target) => (
                    <li key={target.label}>
                      <span className="admin-pill is-warning">{target.label.replace(/_/g, ' ')}</span>
                      <strong>{formatNumber(target.count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {can('settings.manage') && (
        <div style={{ marginTop: 16 }}>
          <RateLimitEditor actions={['likes', 'reports']} />
        </div>
      )}
    </div>
  );
}
