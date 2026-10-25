import { supabase } from '@/lib/supabase';

/**
 * Verified donation leaderboard, client side.
 *
 * The table is RPC-only: `donation_leaderboard()` returns an allow-listed
 * projection after Stripe-signed webhook events have populated the ledger. This
 * module never accepts a contributor name or amount from the browser — it only
 * reads the database's verified aggregate.
 */

export interface DonationLeaderboardEntry {
  rank: number;
  displayName: string;
  totalMinor: number;
  currency: string;
  donationCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Narrows one RPC row, returning null rather than casting. */
export function parseLeaderboardEntry(row: unknown): DonationLeaderboardEntry | null {
  if (!isRecord(row)) return null;
  const displayName = textValue(row.display_name);
  const currency = textValue(row.currency)?.toUpperCase() ?? null;
  if (!displayName || !currency) return null;

  const rank = numberValue(row.rank);
  const totalMinor = numberValue(row.total_minor);
  const donationCount = numberValue(row.donation_count);
  if (rank < 1 || totalMinor <= 0 || donationCount < 1) return null;

  return {
    rank: Math.round(rank),
    displayName,
    totalMinor: Math.round(totalMinor),
    currency,
    donationCount: Math.round(donationCount),
  };
}

/** Top verified contributors, highest net contribution first. */
export async function fetchDonationLeaderboard(limit = 10): Promise<DonationLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('donation_leaderboard', {
    p_limit: Math.max(1, Math.min(limit, 50)),
  });

  if (error) {
    console.error('[donations] leaderboard load failed:', error.message);
    throw new Error('The supporters wall could not be loaded.');
  }

  return (Array.isArray(data) ? data : [])
    .map(parseLeaderboardEntry)
    .filter((entry): entry is DonationLeaderboardEntry => entry !== null);
}

/** Formats a minor-unit total in its stored currency. */
export function formatDonationTotal(totalMinor: number, currency: string): string {
  const amount = totalMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
