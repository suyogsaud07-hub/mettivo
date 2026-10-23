'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  ErrorBanner,
  LoadingBlock,
  Notice,
  StatusPill,
  formatDate,
  formatNumber,
  useAdminResource,
} from '../components/AdminUI';
import { fetchSystemHealth } from '@/lib/admin-console';

interface EnvHealth {
  checkedAt: string;
  environment: string;
  variables: Record<string, boolean>;
  database: { urlConfigured: boolean; anonKeyConfigured: boolean };
}

const ENV_LABELS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'Supabase project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Supabase anon key',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'Stripe publishable key (client)',
  STRIPE_SECRET_KEY: 'Stripe secret key (server)',
  STRIPE_WEBHOOK_SECRET: 'Stripe webhook signing secret',
  RESEND_API_KEY: 'Resend API key (moderation email)',
  MODERATION_EMAIL_FROM: 'Moderation sender address',
};

export default function AdminSystemPage() {
  const resource = useAdminResource(fetchSystemHealth, []);
  const [env, setEnv] = useState<EnvHealth | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [envLoading, setEnvLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/admin/system-health', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Health endpoint returned ${response.status}.`);
        const body: unknown = await response.json();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('variables' in body) ||
          typeof body.variables !== 'object' ||
          body.variables === null
        ) {
          throw new Error('Health endpoint returned an unexpected payload.');
        }
        if (!cancelled) setEnv(body as EnvHealth);
      } catch (err) {
        if (!cancelled) setEnvError(err instanceof Error ? err.message : 'Environment check failed.');
      } finally {
        if (!cancelled) setEnvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const health = resource.data;

  return (
    <div>
      <ErrorBanner message={resource.error} />
      <Notice>
        Nothing here can prove a third-party integration is delivering messages. Presence of a key is
        configuration evidence, not a delivery guarantee. Send a real test transaction before launch.
      </Notice>

      <div className="admin-toolbar">
        <button type="button" className="admin-btn" onClick={() => { resource.reload(); window.location.reload(); }}>
          Refresh checks
        </button>
        <div className="admin-spacer" />
        {health?.databaseTime && (
          <span className="admin-card-sub" style={{ margin: 0 }}>
            Database clock: {formatDate(health.databaseTime)}
          </span>
        )}
      </div>

      <div className="admin-grid cols-2">
        <Card title="Database surface" subtitle="Row counts from the live schema.">
          {resource.loading && !health ? (
            <LoadingBlock rows={6} />
          ) : !health ? (
            <p className="admin-card-sub">Health data unavailable.</p>
          ) : (
            <ul className="admin-list">
              {Object.entries(health.counts).map(([table, count]) => (
                <li key={table}>
                  <span className="admin-mono">{table}</span>
                  <strong>{formatNumber(count)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Operational queues" subtitle="Anything non-zero needs attention.">
          {!health ? (
            <p className="admin-card-sub">Health data unavailable.</p>
          ) : (
            <ul className="admin-list">
              <li>
                <span>Open reports</span>
                <StatusPill status={health.openReports > 0 ? 'pending' : 'clear'} />
              </li>
              <li>
                <span>Failed payment events</span>
                <StatusPill status={health.failedPaymentEvents > 0 ? 'failed' : 'clear'} />
              </li>
              <li>
                <span>Unprocessed payment events</span>
                <StatusPill status={health.unprocessedPaymentEvents > 0 ? 'pending' : 'clear'} />
              </li>
              <li><span>Last payment event</span><strong>{formatDate(health.lastPaymentEventAt)}</strong></li>
              <li><span>Last audited action</span><strong>{formatDate(health.lastAuditAt)}</strong></li>
            </ul>
          )}
        </Card>
      </div>

      <div className="admin-grid cols-2" style={{ marginTop: 16 }}>
        <Card
          title="Environment readiness"
          subtitle={
            envLoading
              ? 'Checking server configuration…'
              : env
                ? `Presence only · ${env.environment} · checked ${formatDate(env.checkedAt)}`
                : 'Configuration check unavailable.'
          }
        >
          <ErrorBanner message={envError} />
          {envLoading ? (
            <LoadingBlock rows={4} />
          ) : env ? (
            <ul className="admin-list">
              {Object.entries(env.variables).map(([key, configured]) => (
                <li key={key}>
                  <span>
                    {ENV_LABELS[key] ?? key}
                    <span className="admin-person-sub admin-mono">{key}</span>
                  </span>
                  <StatusPill status={configured ? 'configured' : 'missing'} />
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="Database limits" subtitle="Rate limits enforced by trigger, not by the UI.">
          {!health ? (
            <p className="admin-card-sub">Rate limits unavailable.</p>
          ) : (
            <ul className="admin-list">
              {health.rateLimits.map((rule) => (
                <li key={rule.action}>
                  <span className="admin-mono">{rule.action}</span>
                  <strong>
                    {formatNumber(rule.maxEvents)} / {formatNumber(rule.windowSeconds)}s
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Deployment and rollback" subtitle="No destructive operation is available from this console.">
        <ul className="admin-list">
          <li><span>Schema changes</span><span>Forward-only, idempotent migrations in <code>supabase/migrations</code>.</span></li>
          <li><span>Rollback strategy</span><span>Deploy the previous build; database migrations are additive.</span></li>
          <li><span>Secret rotation</span><span>Rotate in the host, then set the webhook secret with SQL.</span></li>
          <li><span>Backups</span><span>Use the managed Supabase backup and point-in-time recovery settings.</span></li>
        </ul>
      </Card>
    </div>
  );
}
