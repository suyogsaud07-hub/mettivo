import { NextResponse } from 'next/server';
import { verifyVoice } from '@/lib/verification/service';

/**
 * M24 — live voice verification.
 *
 * POST { audioUrl: data:audio/...;base64,..., phrase, pitchHz } with the
 * member's bearer token. Speech-to-text must confirm the phrase was spoken; the
 * measured pitch is recorded as an advisory signal and must be within a
 * plausible human range or the check fails outright.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const { status, body } = await verifyVoice(request);
  return NextResponse.json(body, { status });
}
