/**
 * M24 — verification write path.
 *
 * SERVER ONLY. This is the only code that records a verification verdict, and it
 * does so exactly the way the M21 moderation worker records a scan: over
 * PostgREST with the public anon key plus a shared secret. The secret lives only
 * on the server (never `NEXT_PUBLIC_`, never in the browser), and the RPCs it
 * calls refuse without it. The member id is supplied by `server-auth.ts` after
 * the request's access token has been validated — never read from the body.
 *
 * AUTHORIZATION
 *   The Authorization header carries the CALLER'S access token, not the anon
 *   key. Inside a SECURITY DEFINER RPC, `auth.uid()` is read from that JWT, and
 *   every RLS policy on `profile_verifications` / `profile_photo_checks` is
 *   `user_id = auth.uid()`. Passing the anon key leaves `auth.uid()` NULL, the
 *   policy fails, and the write is rejected with `record_failed`. The anon key
 *   is still sent as `apikey` because PostgREST requires it.
 */

import { readWorkerEnv, type WorkerEnv } from '@/lib/moderation/worker';
import type { VerificationGender } from '@/lib/verification/ai';

export interface VerificationWriterDeps {
  env?: WorkerEnv;
  fetchImpl?: typeof fetch;
  /**
   * The caller's Supabase access token (JWT). Required for RLS to resolve
   * `auth.uid()`. When absent, the anon key is used — which only works for
   * privileged/system callers, never a member's own write.
   */
  accessToken?: string;
}

function writerEnv(deps: VerificationWriterDeps): WorkerEnv {
  return deps.env ?? readWorkerEnv();
}

async function callRpc(
  env: WorkerEnv,
  fetchImpl: typeof fetch,
  fn: string,
  body: Record<string, unknown>,
  accessToken?: string
): Promise<Record<string, unknown>> {
  // Use the member's own JWT when present so auth.uid() resolves inside the
  // RPC and the RLS policies `user_id = auth.uid()` pass. Fall back to the
  // anon key ONLY for system callers.
  const authorization = accessToken ? `Bearer ${accessToken}` : `Bearer ${env.anonKey}`;

  const response = await fetchImpl(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Capture the Postgres error body so the caller's log shows the REAL reason
    // instead of a generic `record_failed`. Bounded so a huge HTML error page
    // cannot flood the log.
    const errText = await response.text().catch(() => '');
    throw new Error(`rpc_${fn}_http_${response.status}:${errText.slice(0, 500)}`);
  }

  const text = await response.text();
  if (text.trim() === '') return {};
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export interface RecordVerificationInput {
  userId: string;
  kind: 'face' | 'voice';
  passed: boolean;
  gender?: VerificationGender;
  provider?: string | null;
  model?: string | null;
  score?: number | null;
  faceRefHash?: string | null;
  pitchHz?: number | null;
}

/** Records a face or voice verdict. Returns the database's JSON reply. */
export async function recordVerification(
  input: RecordVerificationInput,
  deps: VerificationWriterDeps = {}
): Promise<Record<string, unknown>> {
  const env = writerEnv(deps);
  if (!env.supabaseUrl || !env.anonKey || !env.workerSecret) {
    throw new Error('verification_writer_unconfigured');
  }

  return callRpc(
    env,
    deps.fetchImpl ?? fetch,
    'record_verification',
    {
      p_secret: env.workerSecret,
      p_user_id: input.userId,
      p_kind: input.kind,
      p_passed: input.passed,
      p_gender: input.gender ?? null,
      p_provider: input.provider ?? null,
      p_model: input.model ?? null,
      p_score: input.score ?? null,
      p_face_ref_hash: input.faceRefHash ?? null,
      p_pitch_hz: input.pitchHz ?? null,
    },
    deps.accessToken
  );
}

export interface RecordPhotoInput {
  userId: string;
  photoUrl: string;
  role: 'gallery' | 'avatar';
  human: boolean;
  genderMatch: boolean;
  passed: boolean;
  faceRefHash: string;
  provider?: string | null;
  model?: string | null;
  score?: number | null;
  reasons?: string[];
}

/** Records a single photo verdict. Returns the database's JSON reply. */
export async function recordPhotoCheck(
  input: RecordPhotoInput,
  deps: VerificationWriterDeps = {}
): Promise<Record<string, unknown>> {
  const env = writerEnv(deps);
  if (!env.supabaseUrl || !env.anonKey || !env.workerSecret) {
    throw new Error('verification_writer_unconfigured');
  }

  return callRpc(
    env,
    deps.fetchImpl ?? fetch,
    'record_photo_check',
    {
      p_secret: env.workerSecret,
      p_user_id: input.userId,
      p_photo_url: input.photoUrl,
      p_role: input.role,
      p_human: input.human,
      p_gender_match: input.genderMatch,
      p_passed: input.passed,
      p_face_ref_hash: input.faceRefHash,
      p_provider: input.provider ?? null,
      p_model: input.model ?? null,
      p_score: input.score ?? null,
      p_reasons: input.reasons ?? [],
    },
    deps.accessToken
  );
}