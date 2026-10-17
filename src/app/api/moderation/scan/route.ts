import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { runModerationScanBatch } from '@/lib/moderation/worker';

/**
 * M21 — the AI moderation scan worker endpoint.
 *
 * GET, because the scheduler is the Vercel Cron in `vercel.json`, and Vercel
 * invokes a cron path with a GET request. The previous POST-only handler
 * answered the cron with a 405, which Vercel surfaced as ERR_INVALID_RESPONSE.
 *
 * AUTHORISATION
 *   Vercel presents `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is
 *   set. With no secret configured the endpoint is DISABLED (503) rather than
 *   open, so a forgotten environment variable can never expose the worker.
 *
 * This handler runs on the server only, which is why it may read `process.env`
 * literally (the secrets scanner in `tests/security/security.test.ts` excludes
 * `route.ts` for exactly this reason).
 */

export const dynamic = 'force-dynamic';

function readCronSecret(): string | null {
  const value = (process.env.CRON_SECRET ?? '').trim();
  return value || null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = readCronSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'disabled', message: 'The moderation worker is not configured.' },
      { status: 503 }
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    logger.warn('moderation.scan_unauthorised', 'Rejected an unauthorised scan request.');
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    const result = await runModerationScanBatch();
    logger.info('moderation.scan_batch', 'Scan batch complete.', {
      claimed: result.claimed,
      flagged: result.flagged,
      scanned: result.scanned,
      failed: result.failed,
      skipped: result.skipped,
    });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    logger.error('moderation.scan_failed', 'Scan batch failed.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'worker_failed' }, { status: 502 });
  }
}
