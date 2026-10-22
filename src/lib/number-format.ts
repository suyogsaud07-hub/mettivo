/**
 * Compact, human-readable counts for profile badges.
 *
 * The raw integer stays the source of truth; this only shortens the visible
 * label. Thresholds are explicit so 999,999 stays in K notation rather than
 * rounding up into an inaccurate "1M".
 */
export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';

  const count = Math.floor(value);
  if (count < 1_000) return String(count);

  if (count < 1_000_000) {
    // 999,999 rounds to 1000.0 at one decimal; clamp to the largest honest K
    // value instead of overflowing into an M label before one million.
    const amount = Math.min(999.9, Math.round((count / 1_000) * 10) / 10);
    return `${trimTrailingZero(amount)}K`;
  }

  return `${trimTrailingZero(Math.round((count / 1_000_000) * 10) / 10)}M`;
}

function trimTrailingZero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
