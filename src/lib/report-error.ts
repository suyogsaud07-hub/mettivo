import { errorContext } from '@/lib/logger';

/**
 * R-08 — client-side error reporting.
 *
 * Two rules, both learned the hard way in production systems:
 *
 *  1. **Reporting must never break the app.** Every path here is wrapped, and
 *     failures are swallowed. A reporter that throws while handling a throw is
 *     how a small bug becomes a blank screen.
 *  2. **A render loop must not become a request loop.** A component that throws
 *     on every render would otherwise POST forever. `MAX_PER_SESSION` bounds it.
 */

const ENDPOINT = '/api/observability';

/** Hard cap per page load. */
const MAX_PER_SESSION = 5;

let sent = 0;

export interface ClientErrorReport {
  /** Stable, greppable identifier, e.g. `app.error_boundary`. */
  event: string;
  message?: string;
  context?: Record<string, unknown>;
  route?: string;
}

/** True while this page load still has reporting budget. */
export function canReport(): boolean {
  return sent < MAX_PER_SESSION;
}

/** Resets the budget. Test-only. */
export function resetReportBudget(): void {
  sent = 0;
}

/**
 * Sends one redacted report. Resolves whether or not the send succeeded.
 *
 * `keepalive` matters: the most valuable reports come from a page that is being
 * torn down by the very error being reported.
 */
export async function reportClientError(report: ClientErrorReport): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!canReport()) return;
  sent += 1;

  try {
    const payload = {
      event: report.event.slice(0, 80),
      message: report.message?.slice(0, 300),
      context: report.context ?? {},
      route: (report.route ?? window.location.pathname).slice(0, 200),
    };

    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Never rethrow: the original error is the interesting one.
  }
}

/** Fire-and-forget convenience wrapper for a caught value. */
export function reportException(
  error: unknown,
  event = 'client.exception',
  extra: Record<string, unknown> = {}
): void {
  void reportClientError({
    event,
    context: { ...errorContext(error), ...extra },
  });
}
