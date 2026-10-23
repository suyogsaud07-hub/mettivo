'use client';

import { useEffect, useState } from 'react';
import { Card, ErrorBanner, LoadingBlock } from './AdminUI';
import {
  AdminError,
  fetchRateLimits,
  updateRateLimit,
  type RateLimitRule,
} from '@/lib/admin-console';

export default function RateLimitEditor({ actions }: { actions?: string[] }) {
  const [rules, setRules] = useState<RateLimitRule[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { max: number; window: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchRateLimits();
        if (cancelled) return;
        setRules(next);
        const initial: Record<string, { max: number; window: number }> = {};
        for (const rule of next) {
          initial[rule.action] = { max: rule.maxEvents, window: rule.windowSeconds };
        }
        setDrafts(initial);
      } catch (err) {
        if (!cancelled) setError(err instanceof AdminError ? err.message : 'Could not load rate limits.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (action: string) => {
    const draft = drafts[action];
    if (!draft) return;
    setError(null);
    setSaved(null);
    try {
      await updateRateLimit(action, draft.max, draft.window);
      setSaved(action);
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'The limit could not be updated.');
    }
  };

  const visible = (rules ?? []).filter((rule) => !actions || actions.includes(rule.action));

  return (
    <Card
      title="Enforced rate limits"
      subtitle="These are checked by a BEFORE INSERT trigger, so they apply even to direct API calls."
    >
      <ErrorBanner message={error} />
      {saved && <div className="admin-notice">Saved the {saved.replace(/_/g, ' ')} limit.</div>}
      {loading ? (
        <LoadingBlock rows={3} />
      ) : visible.length === 0 ? (
        <p className="admin-card-sub">No matching rate-limit rules.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table" style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th>Action</th>
                <th>Max events</th>
                <th>Window (seconds)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((rule) => {
                const draft = drafts[rule.action] ?? { max: rule.maxEvents, window: rule.windowSeconds };
                return (
                  <tr key={rule.action}>
                    <td>
                      <div className="is-strong">{rule.action}</div>
                      <div className="admin-person-sub">{rule.description ?? 'No description'}</div>
                    </td>
                    <td>
                      <input
                        className="admin-input"
                        style={{ width: 100, minHeight: 32, padding: '5px 8px' }}
                        type="number"
                        min={1}
                        max={100000}
                        value={draft.max}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.action]: { ...draft, max: Math.max(1, Number(event.target.value) || 1) },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="admin-input"
                        style={{ width: 120, minHeight: 32, padding: '5px 8px' }}
                        type="number"
                        min={1}
                        max={604800}
                        value={draft.window}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.action]: { ...draft, window: Math.max(1, Number(event.target.value) || 1) },
                          }))
                        }
                      />
                    </td>
                    <td>
                      <button type="button" className="admin-btn is-small" onClick={() => void save(rule.action)}>
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
