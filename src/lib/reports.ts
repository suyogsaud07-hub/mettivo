import { supabase } from '@/lib/supabase';

/**
 * Reporting and self-restriction state, client side.
 *
 * WHY THIS MODULE EXISTS
 *   Before M21 the report form lived inline in `/report` and wrote a row
 *   straight into `reports`. That is now wrong twice over: the caller could pick
 *   a column value the schema does not accept, and the safety pipeline (content
 *   capture, threshold evaluation, AI queueing) only runs inside the
 *   `file_report` function. Everything that reports must go through that single
 *   entry point, so the category vocabulary and the call live in one place that
 *   every touchpoint imports.
 *
 * THE CATEGORIES ARE THE DATABASE'S
 *   `reports.category` has a CHECK of nudity | harassment | underage | spam
 *   (M21). The labels below are the human phrasing of exactly those four values
 *   — there is deliberately no fifth "other", because an unclassified report is
 *   one the enforcement triggers cannot route.
 */

/** The four categories the `reports.category` CHECK accepts. */
export const REPORT_CATEGORIES = [
  {
    value: 'harassment',
    label: 'Harassment or hate speech',
    hint: 'Threats, slurs, or repeated unwanted contact.',
  },
  {
    value: 'nudity',
    label: 'Nudity or sexual content',
    hint: 'Explicit images or sexual messages.',
  },
  {
    value: 'underage',
    label: 'Underage user',
    hint: 'Someone who appears to be under 17.',
  },
  {
    value: 'spam',
    label: 'Spam or scam',
    hint: 'Fake profiles, requests for money, or advertising.',
  },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value'];

/** What the member is pointing at when they report. */
export const REPORT_TARGET_TYPES = ['user', 'message', 'moment', 'comment', 'live'] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

/** Matches the `p_evidence_image` guard in `file_report`. */
export const EVIDENCE_IMAGE_MAX_CHARS = 600_000;

/** Raised for an expected failure while filing a report. */
export class ReportError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ReportError';
    this.code = code;
  }
}

export interface FileReportInput {
  /** The account being reported. Never the caller (the database rejects that). */
  targetUserId: string;
  category: ReportCategory;
  /** What part of the app the report is about. Defaults to `user`. */
  targetType?: ReportTargetType;
  /** The message/moment/comment id the report points at, when there is one. */
  targetId?: string | null;
  /** Free-text the member added. */
  details?: string | null;
  /** A live snapshot data URL. Only meaningful for `targetType: 'live'`. */
  evidenceImage?: string | null;
}

export interface FileReportResult {
  reportId: string;
  category: string;
  status: 'pending' | 'actioned';
}

/** The signed-in member's standing restrictions, as `my_restrictions()` reports. */
export interface MyRestrictions {
  chatBanned: boolean;
  chatUntil: string | null;
  videoBanned: boolean;
  videoUntil: string | null;
  suspended: boolean;
  suspendedUntil: string | null;
  suspendedReason: string | null;
}

/** The no-restriction default, so callers never branch on `null`. */
export const NO_RESTRICTIONS: MyRestrictions = {
  chatBanned: false,
  chatUntil: null,
  videoBanned: false,
  videoUntil: null,
  suspended: false,
  suspendedUntil: null,
  suspendedReason: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

/** The human label for a stored category value, falling back to the raw value. */
export function categoryLabel(value: string): string {
  return REPORT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** A short, local date/time for a restriction end. */
export function formatRestrictionDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A one-line description of the most serious restriction, or `null` when the
 * member is unrestricted. A suspension outranks a scoped ban.
 */
export function describeRestriction(restrictions: MyRestrictions): string | null {
  if (restrictions.suspended) {
    const until = formatRestrictionDate(restrictions.suspendedUntil);
    const reason = restrictions.suspendedReason
      ? restrictions.suspendedReason.replace(/_/g, ' ')
      : 'a safety review';
    return until
      ? `Your account is suspended until ${until} following ${reason}.`
      : `Your account is suspended following ${reason}.`;
  }
  if (restrictions.chatBanned) {
    const until = formatRestrictionDate(restrictions.chatUntil);
    return until
      ? `Messaging is paused on your account until ${until}.`
      : 'Messaging is paused on your account.';
  }
  if (restrictions.videoBanned) {
    const until = formatRestrictionDate(restrictions.videoUntil);
    return until
      ? `Mettivo Live is unavailable on your account until ${until}.`
      : 'Mettivo Live is unavailable on your account.';
  }
  return null;
}

/**
 * Files a report through `file_report`, which captures the content, evaluates
 * the enforcement thresholds and queues any AI work in one transaction.
 */
export async function fileReport(input: FileReportInput): Promise<FileReportResult> {
  const targetUserId = input.targetUserId?.trim();
  if (!targetUserId) {
    throw new ReportError('Choose someone to report.');
  }
  if (!REPORT_CATEGORIES.some((c) => c.value === input.category)) {
    throw new ReportError('Choose a reason for your report.');
  }
  const evidenceImage = input.evidenceImage?.trim() || null;
  if (evidenceImage && evidenceImage.length > EVIDENCE_IMAGE_MAX_CHARS) {
    throw new ReportError('That image is too large to attach.');
  }

  const { data, error } = await supabase.rpc('file_report', {
    p_target_user: targetUserId,
    p_category: input.category,
    p_target_type: input.targetType ?? 'user',
    p_target_id: input.targetId ?? null,
    p_details: input.details?.trim() || null,
    p_evidence_image: evidenceImage,
  });

  if (error) {
    console.error('[reports] file_report failed:', error.message);
    throw new ReportError(error.message, error.code);
  }
  if (!isRecord(data)) {
    throw new ReportError('Unexpected response from the safety service.');
  }

  const status = readString(data, 'status');
  return {
    reportId: readString(data, 'report_id'),
    category: readString(data, 'category') || input.category,
    status: status === 'actioned' ? 'actioned' : 'pending',
  };
}

/**
 * Reads the caller's own restrictions. Returns the unrestricted default when the
 * RPC is unavailable, so an older database cannot break the UI — the notice is
 * read-only and the database still enforces the ban regardless.
 */
export async function fetchMyRestrictions(): Promise<MyRestrictions> {
  const { data, error } = await supabase.rpc('my_restrictions');

  if (error) {
    console.warn('[reports] my_restrictions unavailable:', error.message);
    return NO_RESTRICTIONS;
  }
  if (!isRecord(data)) return NO_RESTRICTIONS;

  return {
    chatBanned: readBoolean(data, 'chat_banned'),
    chatUntil: readOptionalString(data, 'chat_until'),
    videoBanned: readBoolean(data, 'video_banned'),
    videoUntil: readOptionalString(data, 'video_until'),
    suspended: readBoolean(data, 'suspended'),
    suspendedUntil: readOptionalString(data, 'suspended_until'),
    suspendedReason: readOptionalString(data, 'suspended_reason'),
  };
}
