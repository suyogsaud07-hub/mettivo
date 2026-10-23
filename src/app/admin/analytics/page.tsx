'use client';

import { useState } from 'react';
import {
  BarChart,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  StatCard,
  formatDay,
  formatMoney,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import { fetchAnalytics } from '@/lib/admin-console';

const WINDOWS = [7, 30, 90, 365];

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [currency, setCurrency] = useState('');
  const resource = useAdminResource(() => fetchAnalytics(days), [days]);
  const data = resource.data;

  const currencies = Array.from(new Set((data?.revenueTimeline ?? []).map((point) => point.currency)));
  const activeCurrency = currency || currencies[0] || '';

  const exportSummary = () => {
    if (!data) return;
    const rows: string[][] = [
      ['Metric', 'Value'],
      ['Window (days)', String(data.days)],
      ['DAU', String(data.activeUsers.dau)],
      ['WAU', String(data.activeUsers.wau)],
      ['MAU', String(data.activeUsers.mau)],
      ['Churn (30d)', String(data.churn30d)],
      ['Renewal window', String(data.renewalsWindow)],
      [],
      ['Plan', 'Code', 'Active', 'Canceled 30d'],
      ...data.plans.map((plan) => [plan.plan, plan.code, String(plan.active), String(plan.canceled30d)]),
      [],
      ['Day', 'Currency', 'Gross (minor)', 'Refunds (minor)', 'Fees (minor)', 'Net (minor)'],
      ...data.revenueTimeline.map((point) => [
        point.day,
        point.currency,
        String(point.gross),
        String(point.refunds),
        String(point.fees),
        String(point.net),
      ]),
      [],
      ['Report category', 'Open count'],
      ...data.reportsByCategory.map((item) => [item.label, String(item.count)]),
    ];
    downloadCsv(`mettivo-analytics-${data.days}d.csv`, rows);
  };

  if (resource.loading && !data) return <LoadingBlock rows={7} />;

  return (
    <div>
      <ErrorBanner message={resource.error} />

      <div className="admin-toolbar">
        <select
          className="admin-select"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          aria-label="Reporting window"
        >
          {WINDOWS.map((value) => (
            <option key={value} value={value}>Last {value} days</option>
          ))}
        </select>
        <div className="admin-spacer" />
        <button type="button" className="admin-btn" onClick={exportSummary} disabled={!data}>
          Export aggregate CSV
        </button>
      </div>

      {!data ? (
        <Card>
          <EmptyState title="No analytics data" />
        </Card>
      ) : (
        <>
          <div className="admin-grid cols-4">
            <StatCard label="Daily active" value={formatNumber(data.activeUsers.dau)} foot="profiles.last_seen_at within 24h" />
            <StatCard label="Weekly active" value={formatNumber(data.activeUsers.wau)} />
            <StatCard label="Monthly active" value={formatNumber(data.activeUsers.mau)} />
            <StatCard
              label="Churn (30d)"
              value={formatNumber(data.churn30d)}
              foot={`${formatNumber(data.renewalsWindow)} renewals in ${data.days}d`}
            />
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card
              title="Registration growth"
              subtitle={
                data.registrationGrowthAvailable
                  ? `New accounts per day over ${data.days} days.`
                  : 'Registration dates are not exposed by this environment.'
              }
            >
              {data.registrationGrowthAvailable ? (
                <BarChart
                  points={data.registrationGrowth.map((point) => ({
                    label: formatDay(point.day),
                    value: point.count,
                  }))}
                />
              ) : (
                <EmptyState title="Unavailable" detail="auth.users.created_at is not readable here." />
              )}
            </Card>

            <Card
              title="Revenue over time"
              subtitle="Net collections by day. Select a currency; amounts are never mixed."
              action={
                currencies.length > 1 ? (
                  <select
                    className="admin-select"
                    value={activeCurrency}
                    onChange={(event) => setCurrency(event.target.value)}
                    aria-label="Revenue currency"
                  >
                    {currencies.map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                ) : undefined
              }
            >
              {data.revenueTimeline.length === 0 ? (
                <EmptyState title="No verified payments" detail="Revenue appears after signed webhook events." />
              ) : (
                <>
                  <BarChart
                    points={data.revenueTimeline
                      .filter((point) => point.currency === activeCurrency)
                      .map((point) => ({ label: formatDay(point.day), value: point.net }))}
                  />
                  <p className="admin-card-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                    Values are minor units of {activeCurrency}. Net = gross − refunds − fees.
                  </p>
                </>
              )}
            </Card>
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card title="Plan performance" subtitle="Active subscriptions and cancellations in the last 30 days.">
              {data.plans.length === 0 ? (
                <EmptyState title="No subscription records" />
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Active</th>
                        <th>Canceled 30d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.plans.map((plan) => (
                        <tr key={plan.code || plan.plan}>
                          <td className="is-strong">{plan.plan}</td>
                          <td>{formatNumber(plan.active)}</td>
                          <td>{formatNumber(plan.canceled30d)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Moderation pressure" subtitle="Reports opened in the selected window.">
              {data.reportsByCategory.length === 0 ? (
                <EmptyState title="No reports in this window" />
              ) : (
                <ul className="admin-list">
                  {data.reportsByCategory.map((item) => (
                    <li key={item.label}>
                      <span className="admin-pill is-warning">{item.label.replace(/_/g, ' ')}</span>
                      <strong>{formatNumber(item.count)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {data.payments && (
            <Card
              title="Collections by currency"
              subtitle={data.payments.definition}
              action={<span className="admin-pill is-info">{formatNumber(data.payments.processed)} processed</span>}
            >
              {data.payments.byCurrency.length === 0 ? (
                <EmptyState title="No processed payments" />
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
                      {data.payments.byCurrency.map((entry) => (
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
          )}

          <p className="admin-card-sub" style={{ marginTop: 16 }}>
            CSV exports contain aggregate figures only — no member names, emails or private profile
            fields. Cash collections are not profit: infrastructure, payment and moderation costs are
            not included here.
          </p>
        </>
      )}
    </div>
  );
}
