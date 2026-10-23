'use client';

import { useState } from 'react';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  Notice,
  Pagination,
  StatCard,
  StatusPill,
  formatDate,
  formatMoney,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import {
  fetchPaymentSummary,
  fetchPayments,
} from '@/lib/admin-console';

export default function AdminPaymentsPage() {
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const summaryResource = useAdminResource(fetchPaymentSummary, []);
  const listResource = useAdminResource(() => fetchPayments({ limit, offset }), [offset]);

  const summary = summaryResource.data;
  const rows = listResource.data ?? [];
  const total = rows[0]?.totalCount ?? 0;

  return (
    <div>
      <ErrorBanner message={summaryResource.error ?? listResource.error} />

      <Notice>
        Revenue figures below are derived only from signed payment events stored in the ledger.
        No event means no revenue is shown — this console never estimates or fabricates collections.
        Refund execution remains a provider-side action until the Stripe refund workflow is
        configured and authorised.
      </Notice>

      {summaryResource.loading && !summary ? (
        <LoadingBlock rows={3} />
      ) : summary ? (
        <>
          <div className="admin-grid cols-4">
            <StatCard label="Processed events" value={formatNumber(summary.processed)} />
            <StatCard label="Received / unprocessed" value={formatNumber(summary.received)} />
            <StatCard label="Failed events" value={formatNumber(summary.failed)} />
            <StatCard
              label="Last event"
              value={summary.lastEventAt ? formatDate(summary.lastEventAt) : 'No events yet'}
              unavailable={!summary.lastEventAt}
            />
          </div>

          <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
            <Card title="Collections by currency" subtitle={summary.definition}>
              {summary.byCurrency.length === 0 ? (
                <EmptyState
                  title="No processed payments"
                  detail="Configure the Stripe webhook and complete a checkout to populate this ledger."
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
                      {summary.byCurrency.map((entry) => (
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

            <Card title="Payment pipeline" subtitle="Current operational readiness.">
              <ul className="admin-list">
                <li>
                  <span>Verified webhook writer</span>
                  <span className={`admin-pill ${summary.processed > 0 ? 'is-success' : 'is-warning'}`}>
                    {summary.processed > 0 ? 'receiving events' : 'no events recorded'}
                  </span>
                </li>
                <li>
                  <span>Refund execution</span>
                  <span className="admin-pill is-warning">provider configuration required</span>
                </li>
                <li>
                  <span>Reconciliation</span>
                  <span className="admin-pill is-info">event ledger ready</span>
                </li>
                <li>
                  <span>Card data storage</span>
                  <span className="admin-pill is-success">never stored</span>
                </li>
              </ul>
            </Card>
          </div>
        </>
      ) : null}

      <h2 className="admin-section-title">Verified payment events</h2>

      {listResource.loading && !listResource.data ? (
        <LoadingBlock rows={7} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            title="The payment ledger is empty"
            detail="Events appear only after Stripe signs a webhook and record_payment_event accepts it."
          />
        </Card>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Member</th>
                <th>Amount</th>
                <th>Fee</th>
                <th>Refunded</th>
                <th>Status</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="is-strong">{row.eventType}</div>
                    <div className="admin-person-sub admin-mono">{row.id}</div>
                  </td>
                  <td>
                    <div>{row.displayName ?? 'Unknown member'}</div>
                    <div className="admin-person-sub admin-mono">{row.userId ?? '—'}</div>
                  </td>
                  <td className="is-strong">{formatMoney(row.amountMinor, row.currency)}</td>
                  <td className="is-muted">{formatMoney(row.feeMinor, row.currency)}</td>
                  <td className="is-muted">{formatMoney(row.refundedMinor, row.currency)}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td className="is-muted">{formatDate(row.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 10px' }}>
            <Pagination total={total} limit={limit} offset={offset} onChange={setOffset} />
          </div>
        </div>
      )}
    </div>
  );
}
