import { NextResponse } from 'next/server';
import { verifyFace } from '@/lib/verification/service';

/**
 * M24 — live face verification.
 *
 * POST { selfieUrl: data:image/...;base64,..., gender: 'Woman'|'Man'|'Nonbinary' }
 * with the member's Supabase access token as a bearer credential. Runs on the
 * server only, which is why `readVerificationEnv()` may read server secrets.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const { status, body } = await verifyFace(request);
  return NextResponse.json(body, { status });
}
