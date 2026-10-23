'use client';

import { useState } from 'react';
import {
  Card,
  ErrorBanner,
  LoadingBlock,
  Notice,
  StatusPill,
  useAdminResource,
} from '../components/AdminUI';
import RateLimitEditor from '../components/RateLimitEditor';
import {
  AdminError,
  fetchSettings,
  saveSetting,
  type AdminSettings,
} from '@/lib/admin-console';

const FLAG_LABELS: Record<string, string> = {
  moments: 'Moments feed',
  live: 'Live rooms',
  games: 'Game zone',
  subscriptions: 'Paid subscriptions',
};

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: AdminSettings;
  onSaved: () => void;
}) {
  const [maintenance, setMaintenance] = useState(settings.maintenanceMode);
  const [flags, setFlags] = useState<Record<string, boolean>>(settings.featureFlags);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const persist = async (key: string, value: unknown, message: string) => {
    setBusyKey(key);
    setError(null);
    setSaved(null);
    try {
      await saveSetting(key, value);
      setSaved(message);
      onSaved();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'The setting could not be saved.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      <ErrorBanner message={error} />
      {saved && <div className="admin-notice">{saved}</div>}

      <div className="admin-grid cols-2">
        <Card
          title="Maintenance notice"
          subtitle="Advisory platform switch. Public surfaces read this value; it does not drop database connections."
        >
          <ul className="admin-list">
            <li>
              <span>Maintenance mode</span>
              <StatusPill status={settings.maintenanceMode ? 'on' : 'off'} />
            </li>
          </ul>
          <div className="admin-inline" style={{ marginTop: 14 }}>
            <label className="admin-inline" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={maintenance}
                onChange={(event) => setMaintenance(event.target.checked)}
                aria-label="Enable maintenance mode"
              />
              <span>Enable maintenance mode</span>
            </label>
            <div className="admin-spacer" />
            <button
              type="button"
              className="admin-btn is-primary"
              disabled={busyKey !== null || maintenance === settings.maintenanceMode}
              onClick={() =>
                void persist(
                  'maintenance_mode',
                  { enabled: maintenance },
                  maintenance ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.'
                )
              }
            >
              {busyKey === 'maintenance_mode' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Card>

        <Card
          title="Webhook secret"
          subtitle="The shared secret is set with SQL and is never returned by the API."
        >
          <ul className="admin-list">
            <li>
              <span>Payment webhook secret</span>
              <StatusPill status={settings.webhookConfigured ? 'configured' : 'missing'} />
            </li>
            <li><span>Stripe signature verification</span><span className="admin-pill is-success">required by route</span></li>
            <li><span>Client writes to admin tables</span><span className="admin-pill is-success">denied</span></li>
          </ul>
          <p className="admin-card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            Set the same value as <code>STRIPE_WEBHOOK_SECRET</code> using the SQL in{' '}
            <code>docs/ADMIN_CONTROL_CENTER.md</code>. It is intentionally not editable here.
          </p>
        </Card>
      </div>

      <h2 className="admin-section-title">Feature flags</h2>
      <Card
        title="Product surface switches"
        subtitle="Disabling a flag hides the entry point; it does not delete member data."
      >
        <ul className="admin-list">
          {Object.keys(FLAG_LABELS).map((key) => {
            const enabled = flags[key] === true;
            return (
              <li key={key}>
                <span>
                  {FLAG_LABELS[key]}
                  <span className="admin-person-sub admin-mono">{key}</span>
                </span>
                <label className="admin-inline" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) =>
                      setFlags((prev) => ({ ...prev, [key]: event.target.checked }))
                    }
                    aria-label={`Enable ${FLAG_LABELS[key]}`}
                  />
                  <span className="admin-pill is-neutral">{enabled ? 'enabled' : 'disabled'}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="admin-inline" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            type="button"
            className="admin-btn is-primary"
            disabled={busyKey !== null}
            onClick={() => void persist('feature_flags', flags, 'Feature flags saved.')}
          >
            {busyKey === 'feature_flags' ? 'Saving…' : 'Save feature flags'}
          </button>
        </div>
        {settings.featureFlags.subscriptions === false && (
          <p className="admin-card-sub" style={{ marginBottom: 0 }}>
            Subscriptions stay hidden until Stripe checkout, webhook and plan prices are verified.
            Toggling this flag alone does not create a checkout flow.
          </p>
        )}
      </Card>

      <h2 className="admin-section-title">Discovery policy</h2>
      <Card
        title="Advisory values"
        subtitle="Not enforced directly. Hard limits are the rate-limit rows rendered below."
      >
        <pre className="admin-pre">{JSON.stringify(settings.discoveryPolicy, null, 2)}</pre>
        <p className="admin-card-sub" style={{ marginBottom: 0 }}>
          Member preferences and private attributes are never exposed through this console.
          Discovery ranking remains deterministic and explainable.
        </p>
      </Card>

      <h2 className="admin-section-title">Rate limits</h2>
      <RateLimitEditor />
    </>
  );
}

export default function AdminSettingsPage() {
  const resource = useAdminResource(fetchSettings, []);

  return (
    <div>
      <ErrorBanner message={resource.error} />
      <Notice>
        Every change is recorded in the audit log. Settings are data, not code: a dishonest toggle
        cannot make an unconfigured provider deliver messages.
      </Notice>

      {resource.loading && !resource.data ? (
        <LoadingBlock rows={6} />
      ) : !resource.data ? (
        <Card>
          <p className="admin-card-sub">Settings unavailable.</p>
        </Card>
      ) : (
        <SettingsForm settings={resource.data} onSaved={resource.reload} />
      )}
    </div>
  );
}
