/**
 * Subbu restriction policy — the pure, shared parts of the moderation loop.
 *
 * Kept free of Supabase and `process.env` so the same functions are used by the
 * server route, the proxy and the chat UI, and can be unit-tested offline.
 *
 * THE CONTRACT
 *   Automated moderation is advisory. Subbu has no writer and no enforcement
 *   flag; only a moderator-confirmed report can apply a 2/6/12/24-hour
 *   read-only period.
 */

export interface BanStatus {
  banned: boolean;
  until: string | null;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the value only when it is a parseable ISO date string. */
function readIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * Normalises the shape returned by `my_ban_status()`.
 *
 * `banned` is derived from the timestamp rather than trusted from the payload,
 * so an expired ban can never keep an account locked (and a stale boolean can
 * never outvote the clock).
 */
export function parseBanStatus(value: unknown): BanStatus {
  if (!isRecord(value)) return { banned: false, until: null, reason: null };

  const until = readIso(value.banned_until);
  const reason =
    typeof value.ban_reason === 'string' && value.ban_reason.length > 0
      ? value.ban_reason
      : null;

  return {
    banned: until !== null && new Date(until).getTime() > Date.now(),
    until,
    reason,
  };
}

/** A short, local date/time for a restriction end. */
export function formatBanDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The 403 body shown when an already-restricted caller reaches the API. */
export function banDeniedMessage(until: string, reason: string | null): string {
  const suffix = reason ? ` Reason: ${reason.replace(/_/g, ' ')}.` : '';
  return `Your account is read-only until ${formatBanDate(until)}.${suffix}`;
}

/** The prominent banner shown in the chat UI. */
export function suspensionBanner(until: string): string {
  return `Your account is read-only after a confirmed community guidelines violation. Expires: ${formatBanDate(until)}.`;
}
