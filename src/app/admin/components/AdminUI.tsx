'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminPermission, AdminRole } from '@/lib/admin-console';

/* ------------------------------------------------------------------------- */
/* Formatting                                                                */
/* ------------------------------------------------------------------------- */

const CURRENCY_ZERO_DECIMAL = new Set(['JPY', 'KRW']);

export function formatMoney(minor: number | null, currency: string | null): string {
  if (minor === null || !Number.isFinite(minor)) return 'Unavailable';
  const code = (currency ?? 'USD').toUpperCase();
  const amount = CURRENCY_ZERO_DECIMAL.has(code) ? minor : minor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: CURRENCY_ZERO_DECIMAL.has(code) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(5, 10);
}

export function roleLabel(role: AdminRole): string {
  switch (role) {
    case 'admin': return 'Super admin';
    case 'moderator': return 'Moderator';
    case 'support': return 'Support agent';
    case 'finance': return 'Finance manager';
    default: return 'Member';
  }
}

export function permissionLabel(permission: AdminPermission): string {
  return permission
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' · ');
}

/* ------------------------------------------------------------------------- */
/* Data loading                                                              */
/* ------------------------------------------------------------------------- */

export interface AdminResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads an admin resource and always terminates the loading state.
 *
 * `deps` is supplied by the caller (search text, filters, page). The loader is
 * held in a ref so an inline arrow does not retrigger the effect.
 */
export function useAdminResource<T>(
  load: () => Promise<T>,
  deps: ReadonlyArray<unknown>
): AdminResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    // A dependency change must show the loading state before the new request
    // resolves. This is a deliberate external-sync exception, mirroring the
    // existing data-loading hooks in the member app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const next = await loadRef.current();
        if (!cancelled) setData(next);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load this surface.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // The caller owns the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return {
    data,
    loading,
    error,
    reload: () => setNonce((value) => value + 1),
  };
}

/* ------------------------------------------------------------------------- */
/* Primitives                                                                */
/* ------------------------------------------------------------------------- */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'gold';

export function StatusPill({ status, tone }: { status: string; tone?: Tone }) {
  const resolved: Tone =
    tone ??
    (status === 'active' || status === 'approved' || status === 'processed' || status === 'sent'
      ? 'success'
      : status === 'pending' || status === 'trialing' || status === 'received' || status === 'draft' || status === 'past_due'
        ? 'warning'
        : status === 'banned' || status === 'rejected' || status === 'failed' || status === 'failed_review'
          ? 'danger'
          : status === 'suspended' || status === 'canceled' || status === 'expired'
            ? 'neutral'
            : 'info');
  return <span className={`admin-pill is-${resolved}`}>{status.replace(/_/g, ' ')}</span>;
}

export function StatCard({
  label,
  value,
  foot,
  unavailable,
}: {
  label: string;
  value: string;
  foot?: string;
  unavailable?: boolean;
}) {
  return (
    <div className="admin-card">
      <p className="admin-stat-label">{label}</p>
      <p className={`admin-stat-value${unavailable ? ' is-muted' : ''}`}>{value}</p>
      {foot && <p className="admin-stat-foot">{foot}</p>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-card">
      {(title || action) && (
        <div className="admin-card-head">
          <div>
            {title && <h2 className="admin-card-title">{title}</h2>}
            {subtitle && <p className="admin-card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="admin-error" role="alert">
      {message}
    </div>
  );
}

export function Notice({ children }: { children: React.ReactNode }) {
  return <div className="admin-notice">{children}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="admin-empty">
      <strong>{title}</strong>
      {detail}
    </div>
  );
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="admin-skeleton" style={{ height: 46 }} />
      ))}
    </div>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="admin-pagination">
      <span>
        Page {page} of {pages} · {formatNumber(total)} record{total === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        className="admin-btn is-small"
        disabled={offset <= 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <button
        type="button"
        className="admin-btn is-small"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </div>
  );
}

export function BarChart({
  points,
  height = 150,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  if (points.length === 0) {
    return <EmptyState title="No data yet" detail="This chart fills in as the activity occurs." />;
  }
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div>
      <div className="admin-bar-chart" style={{ height }}>
        {points.map((point, index) => (
          <div key={`${point.label}-${index}`} className="admin-bar-wrap" title={`${point.label}: ${point.value}`}>
            <div
              className="admin-bar"
              style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="admin-legend">
        <span>{points[0]?.label}</span>
        <span style={{ marginLeft: 'auto' }}>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="admin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-drawer-head">
          <h3>{title}</h3>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="admin-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="admin-drawer-head">
          <h2>{title}</h2>
          <button type="button" className="admin-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}
