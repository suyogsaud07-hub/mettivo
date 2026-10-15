import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isAuthorisedBearer } from '@/lib/moderation/dispatch';
import { runModerationScanBatch } from '@/lib/moderation/worker';

/**
 * M21 — the AI moderation scan worker endpoint.
 *
 * POST, no body. Claims queued content scans, classifies them with the
 * configured model, and records verdicts. Intended to be called by a scheduler
 * (Vercel Cron, an external cron, a `curl` from an operator), never by a member.
 *
 * AUTHORISATION
 *   A shared `MODERATION_DISPATCH_SECRET`, presented as a bearer token. With no
 *   secret configured the endpoint is DISABLED (503) rather than open, so a
 *   forgotten environment variable can never expose the worker. The same secret
 *   lives only on the server; the browser never sees it.
 *
 * This handler runs on the server only, which is why it may read `process.env`
 * literally (the secrets scanner in `tests/security/security.test.ts` excludes
 * `route.ts` for exactly this reason).
 */

export const dynamic = 'force-dynamic';

function readDispatchSecret(): string | null {
  const value = (process.env.MODERATION_DISPATCH_SECRET ?? '').trim();
  return value || null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = readDispatchSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'disabled', message: 'The moderation worker is not configured.' },
      { status: 503 }
    );
  }

  if (!isAuthorisedBearer(request, secret)) {
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
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('moderation.scan_failed', 'Scan batch failed.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'worker_failed' }, { status: 502 });
  }
}
