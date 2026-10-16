import { NextResponse } from 'next/server';
import { buildChallengePhrase } from '@/lib/verification/phrase';
import { readAuthEnv, getUserIdFromRequest } from '@/lib/verification/server-auth';

/**
 * M24 — issues a fresh liveness phrase the member reads aloud.
 *
 * GET with the member's bearer token. Requiring a session keeps the endpoint
 * from being a free, cacheable phrase faucet; the phrase itself is not secret.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const userId = await getUserIdFromRequest(request, { env: readAuthEnv() });
  if (!userId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  return NextResponse.json({ phrase: buildChallengePhrase() }, { status: 200 });
}
