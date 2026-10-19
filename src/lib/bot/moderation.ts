/**
 * Subbu ban policy — the pure, shared parts of the moderation loop.
 *
 * Kept free of Supabase and `process.env` so the same functions are used by the
 * server route, the proxy and the chat UI, and can be unit-tested offline.
 *
 * THE CONTRACT
 *   The model is a *signal*, never the authority. It may ask for a 2-day
 *   verbal-harassment ban by emitting an exact JSON flag; it can never name a
 *   target. The database writer (`apply_self_ban`) only ever affects
 *   `auth.uid()`.
 */

/** Text moderation tier: severe harassment / hate speech / explicit profanity. */
export const SUBBU_TEXT_BAN_DAYS = 2;

/** Image moderation tier: explicit sexual content. */
export const SUBBU_IMAGE_BAN_DAYS = 30;

export interface ParsedBanFlag {
  days: number;
  reason: string;
}

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
 * Extracts the exact ban flag from Subbu's reply.
 *
 * The prompt requires the bare object, but models sometimes wrap it in a code
 * fence or a sentence. We accept those layouts, then validate strictly:
 * `action` must be `"ban"`, `duration` must be `"2_days"` and `reason` must be a
 * non-empty string. Anything else is not a ban instruction.
 */
export function parseBanFlag(reply: string): ParsedBanFlag | null {
  const trimmed = reply.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (parsed.action !== 'ban') continue;
    if (parsed.duration !== '2_days') continue;
    if (typeof parsed.reason !== 'string') continue;

    const reason = parsed.reason.trim();
    if (!reason) continue;
    return { days: SUBBU_TEXT_BAN_DAYS, reason: reason.slice(0, 120) };
  }

  return null;
}

/**
 * Normalises the shape returned by `my_ban_status()` / `apply_self_ban()`.
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

/** A short, local date/time for a ban end. */
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

/** The 403 body shown when an already-banned caller reaches the API. */
export function banDeniedMessage(until: string, reason: string | null): string {
  const suffix = reason ? ` Reason: ${reason.replace(/_/g, ' ')}.` : '';
  return `You are currently banned until ${formatBanDate(until)}.${suffix}`;
}

/** The prominent banner shown in the chat UI. */
export function suspensionBanner(until: string): string {
  return (
    'Your account has been suspended for violating community guidelines. ' +
    `Ban expires: ${formatBanDate(until)}.`
  );
}
