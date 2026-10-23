'use client';

import { useAdmin } from './AdminContext';
import {
  BarChart,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  StatCard,
  formatDate,
  formatDay,
  formatMoney,
  formatNumber,
  useAdminResource,
} from './components/AdminUI';
import { fetchDashboardStats } from '@/lib/admin-console';

export default function AdminDashboardPage() {
  const { identity } = useAdmin();
  const resource = useAdminResource(fetchDashboardStats, []);
  const stats = resource.data;

  if (resource.loading && !stats) {
    return <LoadingBlock rows={8} />;
  }

  return (
    <div>
      <ErrorBanner message={resource.error} />

      {!stats ? (
        <Card>
          <EmptyState title="No dashboard data" detail="The aggregate query returned nothing." />
        </Card>
      ) : (
        <>
          <div className="admin-grid cols-4">
            <StatCard
              label="Registered members"
              value={formatNumber(stats.users.total)}
              foot="All profile records, including incomplete onboarding."
            />
            <StatCard
              label="Active in 24h"
              value={formatNumber(stats.users.dau)}
              foot={`WAU ${formatNumber(stats.users.wau)} · MAU ${formatNumber(stats.users.mau)}`}
            />
            <StatCard
              label="Active subscriptions"
              value={formatNumber(stats.subscriptions.active)}
              foot={`${formatNumber(stats.subscriptions.expired)} expired · ${formatNumber(stats.subscriptions.newPaid30d)} started in 30d`}
            />
            <StatCard
              label="Open reports"
              value={formatNumber(stats.moderation.openReports)}
              foot={`${formatNumber(stats.moderation.resolved7d)} resolved in 7d`}
            />
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card
              title="Registration growth"
              subtitle={
                stats.users.registrationGrowthAvailable
                  ? 'New accounts per day, last 30 days, from auth.users.created_at.'
                  : 'Registration dates are not exposed by this Supabase environment.'
              }
            >
              {stats.users.registrationGrowthAvailable ? (
                <>
                  <div className="admin-grid cols-3" style={{ gap: 10, marginBottom: 12 }}>
                    <div>
                      <p className="admin-stat-label">Today</p>
                      <p className="admin-stat-value" style={{ fontSize: 20 }}>
                        {formatNumber(stats.users.newToday)}
                      </p>
                    </div>
                    <div>
                      <p className="admin-stat-label">7 days</p>
                      <p className="admin-stat-value" style={{ fontSize: 20 }}>
                        {formatNumber(stats.users.newWeek)}
                      </p>
                    </div>
                    <div>
                      <p className="admin-stat-label">30 days</p>
                      <p className="admin-stat-value" style={{ fontSize: 20 }}>
                        {formatNumber(stats.users.newMonth)}
                      </p>
                    </div>
                  </div>
                  <BarChart
                    points={stats.growth.map((point) => ({
                      label: formatDay(point.day),
                      value: point.count,
                    }))}
                  />
                </>
              ) : (
                <EmptyState
                  title="Registration trend unavailable"
                  detail="This environment does not expose auth.users.created_at. Member totals remain accurate."
                />
              )}
            </Card>

            <Card
              title="Moderation workload"
              subtitle="Open reports by category, plus average resolution time."
            >
              {stats.moderation.categories.length === 0 ? (
                <EmptyState title="No open reports" detail="The safety queue is clear." />
              ) : (
                <ul className="admin-list">
                  {stats.moderation.categories.map((item) => (
                    <li key={item.label}>
                      <span className="admin-pill is-warning">{item.label.replace(/_/g, ' ')}</span>
                      <strong>{formatNumber(item.count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: 14 }} className="admin-key-value">
                <dt>Average resolution</dt>
                <dd>
                  {stats.moderation.avgResolutionHours === null
                    ? 'No resolved cases yet'
                    : `${stats.moderation.avgResolutionHours.toFixed(1)} hours`}
                </dd>
                <dt>Resolved in 7 days</dt>
                <dd>{formatNumber(stats.moderation.resolved7d)}</dd>
              </div>
            </Card>
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card
              title="Collections by currency"
              subtitle={stats.revenue.definition || 'Gross, refunds, fees and net in minor units.'}
            >
              {stats.revenue.byCurrency.length === 0 ? (
                <EmptyState
                  title="No verified payment events"
                  detail="Revenue appears only after a signed payment webhook is recorded."
                />
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Currency</th>
                        <th>Gross</th>
                        <th>Refunds</th>
                        <th>Fees</th>
                        <th>Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.revenue.byCurrency.map((entry) => (
                        <tr key={entry.currency}>
                          <td className="is-strong">{entry.currency}</td>
                          <td>{formatMoney(entry.gross, entry.currency)}</td>
                          <td>{formatMoney(entry.refunds, entry.currency)}</td>
                          <td>{formatMoney(entry.fees, entry.currency)}</td>
                          <td className="is-strong">{formatMoney(entry.net, entry.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Subscription distribution" subtitle="Active and trialing members by plan.">
              {stats.subscriptions.distribution.length === 0 ? (
                <EmptyState
                  title="No active subscriptions"
                  detail="Assign a plan from Subscriptions & plans, or wait for checkout to be configured."
                />
              ) : (
                <ul className="admin-list">
                  {stats.subscriptions.distribution.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <strong>{formatNumber(item.count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="admin-grid cols-4" style={{ marginTop: 16 }}>
            <StatCard
              label="Moments"
              value={formatNumber(stats.content.momentsTotal)}
              foot={`${formatNumber(stats.content.momentsPending)} pending · ${formatNumber(stats.content.momentsRejected)} rejected`}
            />
            <StatCard
              label="Messages"
              value={formatNumber(stats.messages.total)}
              foot={`${formatNumber(stats.messages.last24h)} in the last 24h`}
            />
            <StatCard
              label="Storage usage"
              value={stats.content.storageBytes === null ? 'Unavailable' : formatNumber(stats.content.storageBytes)}
              foot={stats.content.storageNote || 'Not exposed by the integration.'}
              unavailable={stats.content.storageBytes === null}
            />
            <StatCard
              label="Snapshot generated"
              value={formatDate(stats.generatedAt)}
              foot={`Signed in as ${identity.displayName ?? identity.email ?? 'administrator'}.`}
            />
          </div>

          <p className="admin-card-sub" style={{ marginTop: 18 }}>
            {stats.users.activityDefinition}
          </p>
        </>
      )}
    </div>
  );
}
