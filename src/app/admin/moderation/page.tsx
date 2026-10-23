'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ReportStatus } from '@/lib/types';
import {
  ModerationError,
  fetchProfilesByIds,
  fetchReportQueue,
  isCurrentUserModerator,
  requestTriage,
  resolveReport,
  suspendUser,
  unsuspendUser,
  type ModeratedProfile,
  type ReportQueueEntry,
} from '@/lib/admin';
import type { ReportRecord, TriageAssessment } from '@/lib/moderation/triage';

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
  const [triage, setTriage] = useState<Record<string, TriageAssessment>>({});
  const [triageBusy, setTriageBusy] = useState<string | null>(null);

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

  const toRecord = (entry: ReportQueueEntry): ReportRecord => ({
    reportId: entry.reportId,
    category: entry.reason,
    targetType: null,
    targetId: null,
    details: entry.details,
    hasEvidenceImage: false,
    reporterId: entry.reporterId,
    reportedId: entry.reportedId,
    status: entry.status,
    createdAt: entry.createdAt,
  });

  /**
   * Requests an AI-assisted assessment for one report. The server re-checks
   * moderator access, so a result here is proof the caller was authorised. The
   * assessment is advisory only: any action still goes through the audited RPCs.
   */
  const runTriage = async (entry: ReportQueueEntry, queue: ReportQueueEntry[]) => {
    if (triageBusy) return;
    setTriageBusy(entry.reportId);
    setError(null);
    try {
      const result = await requestTriage({
        report: toRecord(entry),
        relatedReports: queue
          .filter((other) => other.reportedId === entry.reportedId && other.reportId !== entry.reportId)
          .map(toRecord),
      });
      setTriage((prev) => ({ ...prev, [entry.reportId]: result.assessment }));
    } catch (err) {
      console.error('Triage failed:', err);
      setError(
        err instanceof ModerationError ? err.message : 'The assessment could not be produced.'
      );
    } finally {
      // Always clears the pending state.
      setTriageBusy(null);
    }
  };

  const styles = {
    container: {
      minHeight: 'auto',
      backgroundColor: 'transparent',
      color: '#F2E9E4',
      paddingBottom: '0',
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
    triagePanel: {
      marginTop: '14px',
      border: '1px solid #4A1828',
      borderRadius: '14px',
      padding: '14px',
      backgroundColor: '#160F1A',
    },
    triageRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, alignItems: 'center' },
    triageLabel: {
      fontSize: '10px',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
      color: '#D4B18A',
      margin: '12px 0 4px',
    },
    triageText: { fontSize: '12px', color: '#F2E9E4', margin: 0, lineHeight: 1.5 },
    triageList: {
      margin: '4px 0 0',
      paddingLeft: '18px',
      fontSize: '12px',
      color: '#B58A83',
      lineHeight: 1.5,
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
      minHeight: '40vh',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      backgroundColor: '#17121A',
      color: '#B58A83',
      padding: '24px',
      borderRadius: 16,
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
      <div style={{ ...styles.header, borderTop: '1px solid #29202D', borderRadius: 16, backgroundColor: '#17121A' }}>
        <h2 style={styles.title}>Report queue</h2>
        <div style={{ ...styles.subtitle, color: '#B58A83' }}>
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
            const assessment = triage[entry.reportId];

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

                <div style={{ ...styles.actions, marginTop: '10px' }}>
                  <button
                    type="button"
                    disabled={triageBusy !== null}
                    style={{ ...styles.btn, color: '#93C5FD', opacity: triageBusy ? 0.5 : 1 }}
                    onClick={() => void runTriage(entry, reports)}
                  >
                    {triageBusy === entry.reportId ? 'Assessing...' : 'AI assessment'}
                  </button>
                </div>

                {assessment && (
                  <div style={styles.triagePanel}>
                    <div style={styles.triageRow}>
                      <span
                        style={{
                          ...styles.badge,
                          backgroundColor: '#1E3A8A55',
                          color: '#93C5FD',
                        }}
                      >
                        {assessment.outcome.replace(/_/g, ' ')}
                      </span>
                      <span
                        style={{
                          ...styles.badge,
                          backgroundColor: '#4A182855',
                          color: '#D4B18A',
                        }}
                      >
                        {assessment.severity}
                      </span>
                      <span style={{ ...styles.meta }}>
                        confidence {assessment.confidence.toFixed(2)}
                      </span>
                    </div>

                    <p style={styles.triageLabel}>Recommendation</p>
                    <p style={styles.triageText}>
                      {assessment.recommendedAction
                        ? assessment.recommendedAction.replace(/_/g, ' ')
                        : 'none'}
                      {' · '}
                      {assessment.requiresHumanApproval
                        ? 'human approval required'
                        : 'policy allows without approval'}
                    </p>

                    <p style={styles.triageLabel}>Policy</p>
                    <p style={styles.triageText}>
                      {assessment.policyRefs.join(', ')} · v{assessment.policyVersion}
                    </p>

                    {assessment.reasons.length > 0 && (
                      <>
                        <p style={styles.triageLabel}>Reasoning</p>
                        <ul style={styles.triageList}>
                          {assessment.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {assessment.missingEvidence.length > 0 && (
                      <>
                        <p style={styles.triageLabel}>Missing evidence</p>
                        <ul style={styles.triageList}>
                          {assessment.missingEvidence.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {assessment.coordinatedReporting && (
                      <p style={{ ...styles.triageText, color: '#FCA5B5', marginTop: '8px' }}>
                        {assessment.distinctReporterCount} independent reporters in a short window —
                        check for coordinated reporting.
                      </p>
                    )}

                    {assessment.injectionSignals.length > 0 && (
                      <p style={{ ...styles.triageText, color: '#FCA5B5', marginTop: '8px' }}>
                        Report text contained instruction-like content; it was treated as data.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

    </div>
  );
}
