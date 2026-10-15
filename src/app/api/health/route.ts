import { NextResponse } from 'next/server';
import { describeEnvHealth } from '@/lib/env';

/**
 * `/api/health` — M18 deployment readiness probe.
 *
 * WHAT IT IS FOR
 *   Answering "is this deployment correctly configured?" in one request, so a
 *   bad environment variable is caught by a monitor instead of by a member.
 *
 * WHAT IT MUST NEVER DO
 *   Return a secret, or any part of one. The response reports *presence* and
 *   *shape* only. This is why it does not echo a URL or a key — a health
 *   endpoint is frequently unauthenticated and its body frequently lands in
 *   logs and third-party dashboards.
 *
 * STATUS CODES
 *   200 — configuration present and well-formed.
 *   503 — degraded; the body lists exactly what is missing or malformed.
 */

// Never cached: a health check that returns a stale answer is worse than none.
export const dynamic = 'force-dynamic';

export async function GET() {
  const environment = describeEnvHealth();

  const body = {
    status: environment.configured ? 'ok' : 'degraded',
    checks: {
      environment: {
        configured: environment.configured,
        missing: environment.missing,
        problems: environment.problems,
      },
    },
    // Build metadata is safe: none of it is secret, and it is the first thing
    // anyone asks when a deploy looks wrong.
    build: {
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
    },
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: environment.configured ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
