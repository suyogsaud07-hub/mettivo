import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { isAuthorisedBearer } from '@/lib/moderation/dispatch';
import { runModerationEmailBatch } from '@/lib/moderation/worker';

/**
 * M21 — the moderation email outbox worker endpoint.
 *
 * POST, no body. Claims pending warning emails and sends them through the
 * configured provider (Resend). Same shared-secret discipline as
 * `/api/moderation/scan`: disabled when unconfigured, 401 on a bad token.
 *
 * It only ever sends what the database already composed — the recipient was
 * resolved from `auth.users`, never from a request — so this endpoint cannot be
 * pointed at an arbitrary address.
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
      { error: 'disabled', message: 'The moderation email worker is not configured.' },
      { status: 503 }
    );
  }

  if (!isAuthorisedBearer(request, secret)) {
    logger.warn('moderation.email_unauthorised', 'Rejected an unauthorised email request.');
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  try {
    const result = await runModerationEmailBatch();
    logger.info('moderation.email_batch', 'Email batch complete.', {
      claimed: result.claimed,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('moderation.email_failed', 'Email batch failed.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return NextResponse.json({ error: 'worker_failed' }, { status: 502 });
  }
}
