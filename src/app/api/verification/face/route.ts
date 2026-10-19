import { NextResponse } from 'next/server';
import { verifyFace } from '@/lib/verification/service';

/**
 * M24 — live face verification.
 *
 * POST { selfieUrl: data:image/...;base64,..., gender: 'Woman'|'Man'|'Nonbinary' }
 * with the member's Supabase access token as a bearer credential. Runs on the
 * server only, which is why `readVerificationEnv()` may read server secrets.
 */

// The pipeline is Node-only: `node:crypto` hashes the selfie reference and
// `Buffer` decodes audio blobs. Loading this route on the Edge runtime would
// throw at import time, so pin Node.js explicitly instead of trusting the
// framework default.
export const runtime = 'nodejs';

// A cold vision model can take tens of seconds. 60 s is the Vercel serverless
// ceiling and the same budget `ai.ts` allows the upstream fetch, so the function
// never dies mid-call at a lower default limit.
export const maxDuration = 60;

// A verdict is per-member and must never be prerendered or cached.
export const dynamic = 'force-dynamic';

/**
 * The AI provider call, its timeout/retry and the detailed error logging live
 * in `@/lib/verification/service` and `@/lib/verification/ai`, because all three
 * verification routes (face/photo/voice) share the same classifier. This handler
 * stays a thin transport wrapper whose only job is to never leak an unhandled
 * throw to the client as an HTML 500.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    // `verifyFace` returns a structured `{ status, body }` for every failure it
    // knows about; this pass-through is what the frontend actually reads.
    const { status, body } = await verifyFace(request);
    return NextResponse.json(body, { status });
  } catch (error) {
    // `verifyFace` now wraps its own body in a try/catch, so reaching here means
    // the handler itself failed. Return the same structured shape instead of an
    // opaque framework 500 the frontend cannot read.
    console.error("[VERIFY FACE ROUTE ERROR]", error);
    return NextResponse.json(
      {
        error: 'internal_server_error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
