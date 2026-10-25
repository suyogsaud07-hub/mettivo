'use client';

import { useEffect, useState } from 'react';
import {
  fetchDonationLeaderboard,
  formatDonationTotal,
  type DonationLeaderboardEntry,
} from '@/lib/donations';

/**
 * The public supporters wall.
 *
 * It renders only rows from `donation_leaderboard()`, which is populated by the
 * Stripe-signed webhook and excludes anonymous unnamed gifts. There is no
 * optimistic local insert and no claim path: a name cannot appear here merely
 * because a browser said so.
 */
export default function TopContributors() {
  const [entries, setEntries] = useState<DonationLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const rows = await fetchDonationLeaderboard(10);
        if (!cancelled) setEntries(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'The supporters wall could not be loaded.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby="top-contributors-heading"
      data-testid="top-contributors"
      className="w-full max-w-xl mx-auto"
    >
      <div className="text-center mb-6">
        <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#D4B18A] mb-2">
          Verified support
        </p>
        <h2
          id="top-contributors-heading"
          className="font-serif text-2xl md:text-3xl font-bold text-[#F2E9E4]"
        >
          Top Contributors
        </h2>
        <p className="mt-2 text-sm text-[#F2E9E4]/65">
          Every name below comes from a completed Stripe payment. Refunds are removed automatically.
        </p>
      </div>

      <div className="rounded-2xl border border-[#3a303d]/60 bg-[#29202D] overflow-hidden">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-[#B58A83]" role="status">
            Loading verified supporters…
          </p>
        ) : error ? (
          <p className="px-6 py-10 text-center text-sm text-[#F2E9E4]/70" role="alert">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#4A1828]/25 text-xl"
            >
              ♥
            </div>
            <p className="text-sm font-semibold text-[#F2E9E4]">No verified supporters yet.</p>
            <p className="mt-1 text-xs text-[#B58A83]">
              Be the first to support Mettivo — your name appears only after Stripe confirms the payment.
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-[#3a303d]/50">
            {entries.map((entry) => (
              <li
                key={`${entry.displayName}:${entry.currency}:${entry.rank}`}
                className="flex items-center gap-4 px-5 py-4"
              >
                <span
                  aria-label={`Rank ${entry.rank}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    entry.rank === 1
                      ? 'bg-[#D4B18A] text-[#17121C]'
                      : entry.rank <= 3
                        ? 'bg-[#4A1828] text-[#F2E9E4]'
                        : 'bg-[#17121C]/60 text-[#B58A83]'
                  }`}
                >
                  {entry.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#F2E9E4]">
                    {entry.displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-[#B58A83]">
                    {entry.donationCount === 1
                      ? '1 verified contribution'
                      : `${entry.donationCount} verified contributions`}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold text-[#D4B18A]">
                  {formatDonationTotal(entry.totalMinor, entry.currency)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
