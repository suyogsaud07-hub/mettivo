'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import MobileNav from '../components/layout/MobileNav';
import { supabase } from '@/lib/supabase';
import type { ReportStatus } from '@/lib/types';
import {
  ModerationError,
  fetchProfilesByIds,
  fetchReportQueue,
  isCurrentUserModerator,
  resolveReport,
  suspendUser,
  unsuspendUser,
  type ModeratedProfile,
  type ReportQueueEntry,
} from '@/lib/admin';

type AccessState = 'checking' | 'denied' | 'granted';

const STATUS_ACTIONS: { status: ReportStatus; label: string; colour: string }[] = [
  { status: 'reviewed', label: 'Reviewed', colour: '#60A5FA' },
  { status: 'dismissed', label: 'Dismiss', colour: '#B58A83' },
  { status: 'actioned', label: 'Action', colour: '#F87171' },
];

const STATUS_COLOURS: Record<ReportStatus, string> = {
  pending: '#D4B18A',
  reviewed: '#60A5FA',
  dismissed: '#B58A83',
  actioned: '#F87171',
};

const FILTERS: { label: string; value: ReportStatus | null }[] = [
  { label: 'Pending', value: 'pending' },
  { label: 'Actioned', value: 'actioned' },
  { label: 'All', value: null },
];

/** `YYYY-MM-DD HH:mm` UTC — deterministic, so it cannot differ between renders. */
function formatUtc(value: string | null): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Moderator console at `/admin`.
 *
 * M13: the worklist comes from `admin_report_queue()`, which is moderator-gated
 * in the database and returns the reporter, the reported member **and the
 * evidence snapshot captured at report time**. The snapshot is the point: a
 * member can edit their profile between the report and the triage, and without
 * it the decision becomes an unresolvable dispute.
 *
 * Access is decided by the database, not by this page: every RPC re-verifies the
 * caller's role server-side. The `access` state below only decides what renders.
 */
export default function AdminPage() {
  const router = useRouter();
  const [access, setAccess] = useState<AccessState>('checking');
  const [reports, setReports] = useState<ReportQueueEntry[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ModeratedProfile>>({});
  const [statusFilter, setStatusFilter] = useState<ReportStatus | null>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConsole = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/auth');
        return;
      }

      const moderator = await isCurrentUserModerator();
      if (!moderator) {
        setAccess('denied');
        return;
      }

      setAccess('granted');

      const queue = await fetchReportQueue(statusFilter);
      setReports(queue);

      // Suspension state is not part of the evidence snapshot (it changes), so
      // it is read live for the members currently in the worklist.
      const involved = Array.from(
        new Set(queue.flatMap((entry) => [entry.reporterId, entry.reportedId]))
      );
      setProfiles(await fetchProfilesByIds(involved));
    } catch (err) {
      console.error('Failed to load moderation console:', err);
      setError(
        err instanceof ModerationError ? err.message : 'Could not load the moderation console.'
      );
    } finally {
      // Always leaves the loading state, even on failure.
      setLoading(false);
    }
  }, [router, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConsole();
  }, [loadConsole]);

  const pendingCount = useMemo(
    () => reports.filter((entry) => entry.status === 'pending').length,
    [reports]
  );

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      await loadConsole();
    } catch (err) {
      console.error('Moderation action failed:', err);
      setError(
        err instanceof ModerationError ? err.message : 'That action could not be completed.'
      );
    } finally {
      // Guarantees buttons never stay stuck in a pending state.
      setBusy(null);
    }
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#0D0A10',
      color: '#F2E9E4',
      paddingBottom: '100px',
    },
    header: { padding: '20px', borderBottom: '1px solid #29202D' },
    title: { fontSize: '20px', fontWeight: 700, margin: 0 },
    subtitle: { fontSize: '13px', color: '#B58A83', marginTop: '6px' },
    filters: { display: 'flex', gap: '8px', padding: '16px 20px 0' },
    filter: {
      padding: '6px 14px',
      borderRadius: '16px',
      border: '1px solid #4A1828',
      backgroundColor: 'transparent',
      color: '#B58A83',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'pointer',
    },
    filterActive: { backgroundColor: '#D4B18A', color: '#17121C', borderColor: '#D4B18A' },
    list: { padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '14px' },
    card: {
      backgroundColor: '#1C1822',
      border: '1px solid #29202D',
      borderRadius: '16px',
      padding: '16px',
    },
    row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },
    badge: {
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      padding: '4px 10px',
      borderRadius: '12px',
    },
    who: { fontSize: '14px', fontWeight: 600 },
    meta: { fontSize: '11px', color: '#B58A83' },
    reason: { fontSize: '13px', marginTop: '10px', color: '#D4B18A', fontWeight: 600 },
    details: { fontSize: '13px', color: '#F2E9E4', marginTop: '4px', lineHeight: 1.5 },
    evidence: {
      marginTop: '12px',
      backgroundColor: '#0D0A10',
      border: '1px solid #29202D',
      borderRadius: '12px',
      padding: '12px',
    },
    evidenceTitle: {
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      color: '#D4B18A',
      margin: 0,
    },
    evidenceLine: { fontSize: '12px', color: '#F2E9E4', margin: '6px 0 0 0', lineHeight: 1.5 },
    noteInput: {
      width: '100%',
      marginTop: '12px',
      padding: '10px 12px',
      borderRadius: '12px',
      border: '1px solid #4A1828',
      backgroundColor: '#0D0A10',
      color: '#F2E9E4',
      fontSize: '13px',
      boxSizing: 'border-box' as const,
    },
    actions: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' as const },
    btn: {
      padding: '8px 14px',
      borderRadius: '20px',
      border: '1px solid #4A1828',
      backgroundColor: 'transparent',
      color: '#F2E9E4',
      fontSize: '12px',
      fontWeight: 600,
      cursor: 'pointer',
    },
    error: {
      margin: '0 20px',
      backgroundColor: '#3B1220',
      border: '1px solid #7F1D2E',
      color: '#FCA5B5',
      borderRadius: '14px',
      padding: '12px 16px',
      fontSize: '13px',
    },
    centred: {
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      backgroundColor: '#0D0A10',
      color: '#B58A83',
      padding: '24px',
      textAlign: 'center' as const,
    },
  };

  if (loading || access === 'checking') {
    return <div style={styles.centred}>Checking moderator access...</div>;
  }

  if (access === 'denied') {
    return (
      <div style={styles.centred}>
        <div style={{ fontSize: '40px' }}>🔒</div>
        <p style={{ margin: 0, fontSize: '15px', color: '#F2E9E4' }}>
          Moderator access required
        </p>
        <p style={{ margin: 0, fontSize: '13px' }}>
          This area is restricted to authorised moderators.
        </p>
        <Link
          href="/discover"
          style={{
            backgroundColor: '#D4B18A',
            color: '#17121C',
            padding: '12px 28px',
            borderRadius: '30px',
            fontSize: '14px',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Back to Mettivo
        </Link>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Moderation</h1>
        <div style={styles.subtitle}>
          {pendingCount} pending · {reports.length} shown
        </div>
      </div>

      <div style={styles.filters}>
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            style={{
              ...styles.filter,
              ...(statusFilter === filter.value ? styles.filterActive : {}),
            }}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" style={{ ...styles.error, marginTop: '20px' }}>
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div style={{ ...styles.centred, minHeight: '40vh' }}>
          <div style={{ fontSize: '36px' }}>✅</div>
          <p style={{ margin: 0, fontSize: '14px' }}>Nothing in this queue.</p>
        </div>
      ) : (
        <ul style={{ ...styles.list, listStyle: 'none', margin: 0 }}>
          {reports.map((entry) => {
            const subject = profiles[entry.reportedId];
            const isSuspended = subject?.isSuspended === true;
            const snapshot = entry.evidence?.reportedProfile ?? null;
            const note = notes[entry.reportId] ?? '';

            return (
              <li key={entry.reportId} style={styles.card}>
                <div style={styles.row}>
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: `${STATUS_COLOURS[entry.status]}22`,
                      color: STATUS_COLOURS[entry.status],
                    }}
                  >
                    {entry.status}
                  </span>
                  {isSuspended && (
                    <span
                      style={{
                        ...styles.badge,
                        backgroundColor: '#7F1D2E55',
                        color: '#FCA5B5',
                      }}
                    >
                      suspended
                    </span>
                  )}
                </div>

                <p style={styles.reason}>{entry.reason.replace(/_/g, ' ')}</p>
                {entry.details && <p style={styles.details}>{entry.details}</p>}

                <p style={{ ...styles.meta, marginTop: '10px' }}>
                  Reported: {subject?.displayName ?? entry.reportedName ?? entry.reportedId} · by{' '}
                  {entry.reporterName ?? entry.reporterId}
                </p>
                <p style={styles.meta}>Filed: {formatUtc(entry.createdAt)}</p>

                {snapshot && (
                  <div style={styles.evidence}>
                    <p style={styles.evidenceTitle}>As reported — snapshot</p>
                    <p style={styles.evidenceLine}>
                      {snapshot.displayName ?? 'Unknown'}
                      {snapshot.age !== null ? ` · ${snapshot.age}` : ''}
                      {snapshot.gender ? ` · ${snapshot.gender}` : ''}
                    </p>
                    <p style={{ ...styles.evidenceLine, color: '#B58A83' }}>
                      {[snapshot.city, snapshot.country].filter(Boolean).join(', ') || 'Location not set'}
                      {snapshot.isOnline === true ? ' · online then' : ''}
                    </p>
                    <p style={{ ...styles.evidenceLine, color: '#B58A83' }}>
                      Captured {formatUtc(entry.evidence?.capturedAt ?? null)}
                    </p>
                    {snapshot.bio && (
                      <p style={{ ...styles.evidenceLine, color: '#B58A83' }}>
                        “{snapshot.bio.slice(0, 240)}”
                      </p>
                    )}
                  </div>
                )}

                <input
                  style={styles.noteInput}
                  placeholder="Resolution note (recorded with your decision)"
                  value={note}
                  maxLength={1000}
                  onChange={(e) =>
                    setNotes((prev) => ({ ...prev, [entry.reportId]: e.target.value }))
                  }
                />

                <div style={styles.actions}>
                  {STATUS_ACTIONS.filter((a) => a.status !== entry.status).map((action) => (
                    <button
                      key={action.status}
                      type="button"
                      disabled={busy !== null}
                      style={{ ...styles.btn, color: action.colour, opacity: busy ? 0.5 : 1 }}
                      onClick={() =>
                        void runAction(`${entry.reportId}:${action.status}`, () =>
                          resolveReport(entry.reportId, action.status, note)
                        )
                      }
                    >
                      {busy === `${entry.reportId}:${action.status}` ? 'Working...' : action.label}
                    </button>
                  ))}

                  {isSuspended ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      style={{ ...styles.btn, color: '#34D399', opacity: busy ? 0.5 : 1 }}
                      onClick={() =>
                        void runAction(`${entry.reportId}:unsuspend`, () =>
                          unsuspendUser(entry.reportedId)
                        )
                      }
                    >
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      style={{ ...styles.btn, color: '#F87171', opacity: busy ? 0.5 : 1 }}
                      onClick={() =>
                        void runAction(`${entry.reportId}:suspend`, () =>
                          suspendUser(entry.reportedId, entry.reason)
                        )
                      }
                    >
                      Suspend
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <MobileNav />
    </div>
  );
}
