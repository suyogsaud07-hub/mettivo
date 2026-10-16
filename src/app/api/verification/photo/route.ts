import { NextResponse } from 'next/server';
import { verifyPhoto } from '@/lib/verification/service';

/**
 * M24 — gallery/avatar photo verification.
 *
 * POST { photoUrl, selfieUrl, role: 'gallery'|'avatar', gender } with the
 * member's bearer token. The selfie must be the same one that passed the live
 * face check; the RPC rejects a photo judged against any other reference.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const { status, body } = await verifyPhoto(request);
  return NextResponse.json(body, { status });
}
