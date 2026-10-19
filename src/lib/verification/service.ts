/**
 * M24 — the verification request pipeline.
 *
 * SERVER ONLY. Each route handler is a thin wrapper over one function here.
 * The pipeline is deliberately ordered and fail-closed:
 *
 *   1. validate the request body (shape and size),
 *   2. identify the caller from their access token (never from the body),
 *   3. classify with the AI (a `null` verdict refuses — it never verifies),
 *   4. record the verdict through the secret-gated RPC.
 *
 * Nothing is recorded unless a real, positive verdict came back from the model.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  VERIFICATION_THRESHOLD,
  VerificationUpstreamError,
  analyzeFace,
  analyzePhoto,
  matchesSelectedGender,
  readVerificationEnv,
  transcribeVoice,
  type FaceVerdict,
  type VerificationEnv,
  type VerificationGender,
} from '@/lib/verification/ai';
import {
  readAuthEnv,
  bearerToken,
  getUserIdFromRequest,
  type AuthEnv,
} from '@/lib/verification/server-auth';
import {
  recordPhotoCheck,
  recordVerification,
  type VerificationWriterDeps,
} from '@/lib/verification/writer';
import { readWorkerEnv, type WorkerEnv } from '@/lib/moderation/worker';
import { logger, errorContext } from '@/lib/logger';

export interface VerificationResult {
  status: number;
  body: Record<string, unknown>;
}

const MAX_IMAGE_CHARS = 4_000_000;
const MAX_AUDIO_CHARS = 6_000_000;
const MAX_PHRASE_CHARS = 200;

const GENDERS: readonly VerificationGender[] = ['Woman', 'Man', 'Nonbinary'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function dataUrlWithPrefix(value: string, prefix: string): boolean {
  return value.startsWith(prefix);
}

function genderOf(source: Record<string, unknown>): VerificationGender | null {
  const gender = readString(source, 'gender');
  return gender && (GENDERS as readonly string[]).includes(gender)
    ? (gender as VerificationGender)
    : null;
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

export interface ServiceDeps {
  authEnv?: AuthEnv;
  writerEnv?: WorkerEnv;
  verificationEnv?: VerificationEnv;
  fetchImpl?: typeof fetch;
  aiFetchImpl?: typeof fetch;
}

function authDeps(deps: ServiceDeps) {
  const env = deps.authEnv ?? readAuthEnv();
  return { env, fetchImpl: deps.fetchImpl ?? fetch };
}

/**
 * Builds writer deps and forwards the caller's JWT so the RPC sees auth.uid().
 * The token is optional in the type but every real request carries one — a
 * member's own write must be attributed to that member for RLS to allow it.
 */
function writerDeps(deps: ServiceDeps, accessToken?: string): VerificationWriterDeps {
  return {
    env: deps.writerEnv ?? readWorkerEnv(),
    fetchImpl: deps.fetchImpl ?? fetch,
    accessToken,
  };
}

function aiDeps(deps: ServiceDeps) {
  return {
    env: deps.verificationEnv ?? readVerificationEnv(),
    fetchImpl: deps.aiFetchImpl ?? deps.fetchImpl ?? fetch,
  };
}

/**
 * True only when the AI provider has an API key.
 *
 * A missing key is a deployment/operator mistake (HTTP 500), not a provider
 * outage (HTTP 503): returning the two as the same generic `ai_unavailable`
 * hides the real reason a route is refusing every request. The verdict itself
 * is still fail-closed either way — no key, no verification.
 */
function aiIsConfigured(deps: ServiceDeps): boolean {
  return aiDeps(deps).env.apiKey !== null;
}

/**
 * Turns a thrown face-classifier failure into a response, preserving the
 * upstream status and category in the server log.
 *
 * A rejected credential (HTTP 401/403) is an operator misconfiguration — the
 * same class of problem as a missing key — so it answers 500 `ai_misconfigured`
 * and stops the client advising a pointless retry. Everything else (a
 * throttle, a provider 5xx, a timeout, an unparseable reply) stays 503
 * `ai_unavailable`, which is genuinely retryable. Every response carries a
 * `requestId` that also appears in the log line, so one failing attempt can be
 * traced end-to-end.
 */
function faceAiFailure(error: unknown, deps: ServiceDeps): VerificationResult {
  const requestId = randomUUID();
  const message = error instanceof Error ? error.message : 'unknown error';
  const upstreamStatus = error instanceof VerificationUpstreamError ? error.status : null;
  const category = error instanceof VerificationUpstreamError ? error.category : 'unknown';

  console.error('[FACE VERIFICATION ERROR]', message, error instanceof Error ? error.stack : undefined);
  logger.error(
    'verification.face_ai_threw',
    'The face classifier threw instead of returning a verdict.',
    {
      ...errorContext(error),
      requestId,
      aiKeyPresent: aiIsConfigured(deps),
      upstreamStatus,
      category,
    }
  );

  if (category === 'auth') {
    return {
      status: 500,
      body: {
        error: 'ai_misconfigured',
        details: `The AI provider rejected the verification credentials (HTTP ${upstreamStatus ?? 401}).`,
        requestId,
      },
    };
  }

  return { status: 503, body: { error: 'ai_unavailable', details: message, requestId } };
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Shared prologue: parse the body and authenticate the caller. */
type BeginResult =
  | { ok: true; body: Record<string, unknown>; userId: string; accessToken: string | null }
  | { ok: false; result: VerificationResult };

async function begin(request: Request, deps: ServiceDeps): Promise<BeginResult> {
  const body = await parseJsonBody(request);
  if (!body) {
    return { ok: false, result: { status: 400, body: { error: 'invalid_body' } } };
  }

  const userId = await getUserIdFromRequest(request, authDeps(deps));
  if (!userId) {
    return { ok: false, result: { status: 401, body: { error: 'unauthorised' } } };
  }

  // Same bearer the Auth server just validated. Re-used verbatim on the RPC so
  // `auth.uid()` resolves inside the SECURITY DEFINER function.
  const accessToken = bearerToken(request);

  return { ok: true, body, userId, accessToken };
}

/** Extracts the `complete` flag the RPC replies with, defaulting to false. */
function completeOf(reply: Record<string, unknown>): boolean {
  return reply.complete === true;
}

// ---------------------------------------------------------------------------
// Face
// ---------------------------------------------------------------------------
export async function verifyFace(
  request: Request,
  deps: ServiceDeps = {}
): Promise<VerificationResult> {
  const start = await begin(request, deps);
  if (!start.ok) return start.result;
  const { body, userId, accessToken } = start;

  const selfieUrl = readString(body, 'selfieUrl');
  const gender = genderOf(body);
  if (!selfieUrl || !gender || !dataUrlWithPrefix(selfieUrl, 'data:image/')) {
    return { status: 400, body: { error: 'invalid_body' } };
  }
  if (selfieUrl.length > MAX_IMAGE_CHARS) {
    return { status: 413, body: { error: 'image_too_large' } };
  }

  if (!aiIsConfigured(deps)) {
    logger.error(
      'verification.face_ai_misconfigured',
      'AI_MODERATION_API_KEY is not set, so face verification cannot run.'
    );
    return { status: 500, body: { error: 'Missing AI configuration' } };
  }

  let verdict: FaceVerdict | null;
  try {
    // `throwOnFailure` turns a provider transport failure or non-2xx response
    // into a `VerificationUpstreamError` carrying the reason, so the 503 below
    // can name it instead of hiding behind a bare `ai_unavailable`.
    verdict = await analyzeFace(
      { selfieUrl, gender },
      { ...aiDeps(deps), throwOnFailure: true }
    );
  } catch (error) {
    return faceAiFailure(error, deps);
  }
  if (!verdict) {
    const requestId = randomUUID();
    logger.error('verification.face_ai_unavailable', 'The face classifier returned no verdict.', {
      requestId,
      aiKeyPresent: aiIsConfigured(deps),
    });
    return {
      status: 503,
      body: {
        error: 'ai_unavailable',
        details: 'The AI provider returned no verdict.',
        requestId,
      },
    };
  }

  const passed =
    verdict.human && verdict.facePresent && verdict.genderMatch && verdict.score >= VERIFICATION_THRESHOLD;

  try {
    const reply = await recordVerification(
      {
        userId,
        kind: 'face',
        passed,
        gender,
        provider: verdict.provider,
        model: verdict.model,
        score: verdict.score,
        faceRefHash: md5(selfieUrl),
      },
      writerDeps(deps, accessToken ?? undefined)
    );
    return {
      status: 200,
      body: {
        ok: true,
        passed,
        complete: completeOf(reply),
        apparentGender: verdict.apparentGender,
        reason: passed ? null : reasonForFace(verdict.human, verdict.facePresent, verdict.genderMatch),
      },
    };
  } catch (error) {
    console.error('[DB RECORD FAILED]', error);
    logger.error('verification.face_record_failed', 'Could not record a face verdict.', {
      errorName: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown',
    });
    return {
      status: 500,
      body: {
        error: 'record_failed',
        details: error instanceof Error ? error.message : 'unknown',
      },
    };
  }
}

function reasonForFace(human: boolean, facePresent: boolean, genderMatch: boolean): string {
  if (!human || !facePresent) return 'no_face';
  if (!genderMatch) return 'gender_mismatch';
  return 'low_confidence';
}

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------
export async function verifyPhoto(
  request: Request,
  deps: ServiceDeps = {}
): Promise<VerificationResult> {
  const start = await begin(request, deps);
  if (!start.ok) return start.result;
  const { body, userId, accessToken } = start;

  const photoUrl = readString(body, 'photoUrl');
  const selfieUrl = readString(body, 'selfieUrl');
  const role = readString(body, 'role');
  const gender = genderOf(body);
  if (
    !photoUrl ||
    !selfieUrl ||
    !gender ||
    (role !== 'gallery' && role !== 'avatar') ||
    !dataUrlWithPrefix(photoUrl, 'data:image/') ||
    !dataUrlWithPrefix(selfieUrl, 'data:image/')
  ) {
    return { status: 400, body: { error: 'invalid_body' } };
  }
  if (photoUrl.length > MAX_IMAGE_CHARS || selfieUrl.length > MAX_IMAGE_CHARS) {
    return { status: 413, body: { error: 'image_too_large' } };
  }

  const verdict = await analyzePhoto({ photoUrl, selfieUrl, gender }, aiDeps(deps));
  if (!verdict) {
    return { status: 503, body: { error: 'ai_unavailable' } };
  }

  const genderMatch = verdict.genderMatch || matchesSelectedGender(gender, verdict.apparentGender);
  const passed =
    verdict.human && verdict.samePerson && genderMatch && verdict.score >= VERIFICATION_THRESHOLD;

  const reasons: string[] = [];
  if (!verdict.human) reasons.push('not_human');
  if (!verdict.samePerson) reasons.push('different_person');
  if (!genderMatch) reasons.push('gender_mismatch');
  if (verdict.rejectReason) reasons.push(verdict.rejectReason);

  try {
    const reply = await recordPhotoCheck(
      {
        userId,
        photoUrl,
        role,
        human: verdict.human,
        genderMatch,
        passed,
        faceRefHash: md5(selfieUrl),
        provider: verdict.provider,
        model: verdict.model,
        score: verdict.score,
        reasons,
      },
      writerDeps(deps, accessToken ?? undefined)
    );
    return {
      status: 200,
      body: {
        ok: true,
        passed,
        complete: completeOf(reply),
        gallery: reply.gallery ?? 0,
        avatar: reply.avatar ?? 0,
        reasons,
      },
    };
  } catch (error) {
    console.error('[DB RECORD FAILED]', error);
    logger.error('verification.photo_record_failed', 'Could not record a photo verdict.', {
      errorName: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown',
    });
    return {
      status: 500,
      body: {
        error: 'record_failed',
        details: error instanceof Error ? error.message : 'unknown',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------
function pitchInRange(pitchHz: unknown): number | null {
  const value = typeof pitchHz === 'number' ? pitchHz : Number(pitchHz);
  if (!Number.isFinite(value)) return null;
  if (value < 50 || value > 500) return null;
  return value;
}

export async function verifyVoice(
  request: Request,
  deps: ServiceDeps = {}
): Promise<VerificationResult> {
  const start = await begin(request, deps);
  if (!start.ok) return start.result;
  const { body, userId, accessToken } = start;

  const audioUrl = readString(body, 'audioUrl');
  const phrase = readString(body, 'phrase');
  if (
    !audioUrl ||
    !phrase ||
    phrase.length > MAX_PHRASE_CHARS ||
    !dataUrlWithPrefix(audioUrl, 'data:audio/')
  ) {
    return { status: 400, body: { error: 'invalid_body' } };
  }
  if (audioUrl.length > MAX_AUDIO_CHARS) {
    return { status: 413, body: { error: 'audio_too_large' } };
  }

  const pitchHz = pitchInRange(body.pitchHz);
  
  // ✅ FIX: Removed the early rejection block for null/0 pitch here. 
  // We now always proceed to the AI transcript to check the phrase.

  const verdict = await transcribeVoice({ audioUrl, phrase }, aiDeps(deps));
  if (!verdict) {
    return { status: 503, body: { error: 'ai_unavailable' } };
  }

  const passed = verdict.phraseMatch;

  try {
    const reply = await recordVerification(
      {
        userId,
        kind: 'voice',
        passed,
        provider: verdict.provider,
        model: verdict.model,
        pitchHz,
      },
      writerDeps(deps, accessToken ?? undefined)
    );
    return {
      status: 200,
      body: {
        ok: true,
        passed,
        complete: completeOf(reply),
        transcript: verdict.transcript,
        reason: passed ? null : 'phrase_mismatch',
      },
    };
  } catch (error) {
    console.error('[DB RECORD FAILED]', error);
    logger.error('verification.voice_record_failed', 'Could not record a voice verdict.', {
      errorName: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : 'unknown',
    });
    return {
      status: 500,
      body: {
        error: 'record_failed',
        details: error instanceof Error ? error.message : 'unknown',
      },
    };
  }
}