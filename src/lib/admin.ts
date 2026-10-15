import { supabase } from '@/lib/supabase';
import type { ReportStatus } from '@/lib/types';

/**
 * Moderation data access.
 *
 * Every operation here is authorised in the database, not in this module:
 * `is_moderator()` gates the RLS policies and each RPC re-checks the caller's
 * role server-side. The checks below exist only to give a clean UI, never as the
 * security boundary.
 */

/** Raised for expected moderation failures. */
export class ModerationError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ModerationError';
    this.code = code;
  }
}

/**
 * The profile as it looked when the report was filed.
 *
 * M13 captures this inside the report INSERT, so a moderator still sees what the
 * reporter saw even if the reported member has since edited their profile.
 * `birth_date` is deliberately absent — see the migration.
 */
export interface ReportEvidenceProfile {
  displayName: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  bio: string | null;
  isOnline: boolean | null;
}

export interface ReportEvidence {
  capturedAt: string | null;
  reason: string | null;
  reportedProfile: ReportEvidenceProfile | null;
}

/** One row of the moderator worklist, as returned by `admin_report_queue()`. */
export interface ReportQueueEntry {
  reportId: string;
  status: ReportStatus;
  reason: string;
  details: string | null;
  createdAt: string;
  updatedAt: string;
  reporterId: string;
  reporterName: string | null;
  reportedId: string;
  reportedName: string | null;
  reportedAvatar: string | null;
  evidence: ReportEvidence | null;
}

const VALID_STATUSES: readonly ReportStatus[] = [
  'pending',
  'reviewed',
  'dismissed',
  'actioned',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseStatus(value: unknown): ReportStatus {
  return VALID_STATUSES.includes(value as ReportStatus) ? (value as ReportStatus) : 'pending';
}

/** Narrows the `jsonb` evidence column; unknown shapes become `null`. */
function parseEvidence(value: unknown): ReportEvidence | null {
  if (!isRecord(value)) return null;

  const rawProfile = value.reported_profile;
  const reportedProfile = isRecord(rawProfile)
    ? {
        displayName: str(rawProfile.display_name),
        age: num(rawProfile.age),
        gender: str(rawProfile.gender),
        city: str(rawProfile.city),
        country: str(rawProfile.country),
        avatarUrl: str(rawProfile.avatar_url),
        bio: str(rawProfile.bio),
        isOnline: bool(rawProfile.is_online),
      }
    : null;

  return {
    capturedAt: str(value.captured_at),
    reason: str(value.reason),
    reportedProfile,
  };
}

function parseQueueEntry(row: unknown): ReportQueueEntry | null {
  if (!isRecord(row)) return null;
  const reportId = str(row.report_id);
  const reportedId = str(row.reported_id);
  const reporterId = str(row.reporter_id);
  if (!reportId || !reportedId || !reporterId) return null;

  return {
    reportId,
    status: parseStatus(row.report_status),
    reason: str(row.reason) ?? 'unspecified',
    details: str(row.details),
    createdAt: str(row.created_at) ?? '',
    updatedAt: str(row.updated_at) ?? '',
    reporterId,
    reporterName: str(row.reporter_name),
    reportedId,
    reportedName: str(row.reported_name),
    reportedAvatar: str(row.reported_avatar),
    evidence: parseEvidence(row.evidence),
  };
}

/**
 * Loads the moderator worklist.
 *
 * Uses `admin_report_queue()` (M13), which is moderator-only in the database and
 * returns the reporter, the reported member and the evidence snapshot in one
 * round trip. Passing `null` returns every status.
 */
export async function fetchReportQueue(
  status: ReportStatus | null = 'pending',
  limit = 50
): Promise<ReportQueueEntry[]> {
  const { data, error } = await supabase.rpc('admin_report_queue', {
    p_status: status,
    p_limit: limit,
  });

  if (error) {
    console.error('[admin] admin_report_queue failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }

  return (Array.isArray(data) ? data : [])
    .map(parseQueueEntry)
    .filter((entry): entry is ReportQueueEntry => entry !== null);
}

/**
 * Records a triage decision with its reasoning and actor.
 *
 * `admin_resolve_report` (M13) supersedes `admin_set_report_status` (M14): it
 * stores the note, the deciding moderator and the timestamp, and writes an audit
 * entry, so a decision can be reviewed afterwards.
 */
export async function resolveReport(
  reportId: string,
  status: ReportStatus,
  note?: string
): Promise<void> {
  if (!reportId) throw new ModerationError('A report id is required.');
  if (!VALID_STATUSES.includes(status)) {
    throw new ModerationError(`Invalid status: ${status}`);
  }

  const { error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_status: status,
    p_note: note && note.trim().length > 0 ? note.trim() : null,
  });

  if (error) {
    console.error('[admin] admin_resolve_report failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }
}

/** True when the signed-in user holds a moderator or admin role. */
export async function isCurrentUserModerator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_moderator');

  if (error) {
    console.error('[admin] is_moderator failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }

  return data === true;
}

/**
 * Superseded by `fetchReportQueue()` above.
 *
 * This read `reports` directly, which worked but returned no evidence snapshot
 * and no joined names, and relied on an RLS policy rather than the moderator
 * gate. M13's `admin_report_queue()` does all three. Removed so there is exactly
 * one moderation read path.
 */

/** Suspends an account. Moderator-only, audited. */
export async function suspendUser(
  targetUserId: string,
  reason?: string
): Promise<void> {
  if (!targetUserId) throw new ModerationError('A target user is required.');

  const { error } = await supabase.rpc('admin_suspend_user', {
    p_target_user: targetUserId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[admin] suspend user failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }
}

/** Lifts a suspension. Moderator-only, audited. */
export async function unsuspendUser(targetUserId: string): Promise<void> {
  if (!targetUserId) throw new ModerationError('A target user is required.');

  const { error } = await supabase.rpc('admin_unsuspend_user', {
    p_target_user: targetUserId,
  });

  if (error) {
    console.error('[admin] unsuspend user failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }
}

export interface ModeratedProfile {
  displayName: string;
  isSuspended: boolean;
}

/**
 * Display data for the members referenced by the moderation queue — names for
 * readable rows, and suspension state so a moderator can see who is already
 * blocked from posting.
 */
export async function fetchProfilesByIds(
  userIds: string[]
): Promise<Record<string, ModeratedProfile>> {
  if (userIds.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_suspended')
    .in('id', userIds);

  if (error) {
    console.error('[admin] load moderated profiles failed:', error.message);
    throw new ModerationError(error.message, error.code);
  }

  const result: Record<string, ModeratedProfile> = {};
  for (const row of (data ?? []) as {
    id: string;
    display_name: string | null;
    is_suspended: boolean | null;
  }[]) {
    result[row.id] = {
      displayName: row.display_name ?? 'Unknown member',
      isSuspended: row.is_suspended === true,
    };
  }
  return result;
}
