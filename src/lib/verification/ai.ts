/**
 * M24 — server-side authenticity classifier.
 *
 * SERVER ONLY. Like `src/lib/moderation/ai.ts`, this reads its credentials
 * through the injected-source pattern so it never uses a literal env read
 * inside a module that could be bundled for the browser (see the secrets scan
 * in `tests/security/security.test.ts`). It is
 * imported by the `/api/verification/*` route handlers and their tests, and by
 * nothing in the UI.
 *
 * FAIL CLOSED
 *   Every function returns `null` when AI is not configured, when the provider
 *   errors, or when the response cannot be parsed. The route treats `null` as
 *   "cannot verify" and refuses to record a pass — there is no code path where a
 *   missing key or an outage silently verifies a member. This is the opposite of
 *   the moderation classifier, which may degrade to "unscanned"; here an
 *   unscanned member simply cannot finish onboarding.
 *
 * PROVIDER SHAPE
 *   OpenAI-compatible. Vision uses `/chat/completions`; voice liveness uses
 *   `/audio/transcriptions`. `fetchImpl` is injectable so every branch is
 *   unit-testable offline.
 */

import { readAiEnv, type AiEnv } from '@/lib/moderation/ai';

/** The selected gender options the wizard offers. */
export type VerificationGender = 'Woman' | 'Man' | 'Nonbinary';

/** The model's best guess at how a person presents. */
export type ApparentGender = 'woman' | 'man' | 'nonbinary' | 'unknown';

export interface VerificationEnv extends AiEnv {
  transcribeModel: string;
}

// Changed from 'whisper-1' to Groq's supported model
const DEFAULT_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

/**
 * Groq's vision model is not fast on a cold image. 20 s aborts a large
 * fraction of real requests and shows up as `ai_unavailable`. 60 s matches
 * Vercel's serverless limit and is still well under any human patience budget.
 */
const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 32_768;
const MAX_IMAGE_URL_CHARS = 2_000_000;

/**
 * A single 429/5xx retry after a short delay absorbs the free tier's per-minute
 * burst limit without turning a transient throttle into a hard user-visible
 * failure. A second failure is returned as `null` on purpose: retrying forever
 * would make a genuine outage look like a slow success.
 */
const RETRY_DELAY_MS = 2_500;
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Confidence a face/photo verdict must reach to count as a pass. */
export const VERIFICATION_THRESHOLD = 0.6;

export function readVerificationEnv(
  source: Record<string, string | undefined> = process.env
): VerificationEnv {
  const base = readAiEnv(source);
  const transcribeModel =
    (source['AI_VERIFICATION_TRANSCRIBE_MODEL'] ?? '').trim() || DEFAULT_TRANSCRIBE_MODEL;
  return { ...base, transcribeModel };
}

export interface FaceVerdict {
  human: boolean;
  facePresent: boolean;
  apparentGender: ApparentGender;
  genderMatch: boolean;
  score: number;
  provider: string;
  model: string;
}

export interface PhotoVerdict {
  human: boolean;
  samePerson: boolean;
  apparentGender: ApparentGender;
  genderMatch: boolean;
  rejectReason: string | null;
  score: number;
  provider: string;
  model: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normaliseApparentGender(value: unknown): ApparentGender {
  if (typeof value !== 'string') return 'unknown';
  const key = value.trim().toLowerCase();
  if (key === 'woman' || key === 'female' || key === 'f') return 'woman';
  if (key === 'man' || key === 'male' || key === 'm') return 'man';
  if (key === 'nonbinary' || key === 'non-binary' || key === 'enby') return 'nonbinary';
  return 'unknown';
}

/**
 * Whether the model's estimate is consistent with the member's selection.
 *
 * A vision model's guess at "how someone presents" is a weak signal, so the
 * mismatch is treated as a FAILED CHECK rather than a hard rejection — the
 * caller decides what to do with it. Woman/Man must be matched exactly;
 * Nonbinary only requires that the image shows a real human.
 */
export function matchesSelectedGender(
  selected: VerificationGender,
  apparent: ApparentGender
): boolean {
  if (selected === 'Woman') return apparent === 'woman';
  if (selected === 'Man') return apparent === 'man';
  return apparent !== 'unknown';
}

const FACE_SYSTEM_PROMPT =
  'You are an identity-verification classifier for an adults-only dating app. ' +
  'You receive ONE live camera frame. Decide whether it shows a real human face ' +
  '(NOT an animal, mascot, cartoon, drawing, statue, object, landscape, ' +
  'screenshot, or purchased/stock graphic) and estimate how the person presents. ' +
  'Respond with ONLY a JSON object: {"human": boolean, "face_present": boolean, ' +
  '"apparent_gender": "woman"|"man"|"nonbinary"|"unknown", "score": number}. ' +
  '"score" is your confidence in [0,1]. Be strict: if unsure, set "human" false.';

const PHOTO_SYSTEM_PROMPT =
  'You are an authenticity classifier for a dating profile. You receive TWO ' +
  'images: the member\u2019s VERIFIED live selfie (reference) first, then a ' +
  'profile/gallery photo. Decide whether the second image shows a real human ' +
  '(NOT a pet, object, landscape, screenshot, cartoon, or purchased/stock ' +
  'image), whether it is the SAME person as the reference, and how the person ' +
  'presents. Respond with ONLY a JSON object: {"human": boolean, ' +
  '"same_person": boolean, "apparent_gender": "woman"|"man"|"nonbinary"|"unknown", ' +
  '"reject_reason": string|null, "score": number}. "score" is your confidence in ' +
  '[0,1]. If the image is not a human or not the same person, say so plainly.';

interface VisionMessage {
  role: 'system' | 'user';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logs an upstream AI failure with the provider's exact error message and stack.
 *
 * This module is server-only and never bundled for the browser, so the stack is
 * safe here and is the fastest way to tell a bad key, an oversized payload and a
 * cold-model timeout apart. The request body (which holds the member's selfie)
 * is never logged.
 */
function logProviderError(event: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(
      `[verification.ai] ${event}: ${error.name}: ${error.message}\n${error.stack ?? ''}`
    );
    return;
  }
  console.error(`[verification.ai] ${event}:`, error);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one upstream call with the timeout. Retries once on 408/425/429/5xx
 * after a short delay — the free tier's per-minute burst limit and a cold
 * model start both surface as those statuses and both clear within seconds.
 */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  label: string
): Promise<Response | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, init);
  } catch (error) {
    logProviderError(`${label} request failed (transport or timeout)`, error);
    return null;
  }
  if (!RETRY_STATUSES.has(response.status)) return response;

  // Drain the failed body so the connection can be reused, and keep it for the
  // log — a 429's body names the rate-limit window, a 400's names the bad field.
  const retryBody = await response.text().catch(() => '');
  console.error(
    `[verification.ai] ${label} returned ${response.status}; retrying once. Body: ${retryBody.slice(0, 500)}`
  );

  await sleep(RETRY_DELAY_MS);
  try {
    return await fetchWithTimeout(fetchImpl, url, init);
  } catch (error) {
    logProviderError(`${label} retry failed (transport or timeout)`, error);
    return null;
  }
}

/** Runs one vision classification and returns the parsed JSON object, or null. */
async function callVision(
  systemPrompt: string,
  userText: string,
  imageUrls: string[],
  env: VerificationEnv,
  fetchImpl: typeof fetch,
  throwOnFailure = false
): Promise<Record<string, unknown> | null> {
  if (!env.apiKey) {
    console.error('[verification.ai] vision blocked: AI_MODERATION_API_KEY is not configured');
    return null;
  }
  if (imageUrls.some((url) => !url)) {
    console.error('[verification.ai] vision blocked: an image URL was empty');
    return null;
  }

  const content: VisionMessage['content'] = [
    { type: 'text', text: userText },
    ...imageUrls.map((url) => ({
      type: 'image_url' as const,
      image_url: { url: url.slice(0, MAX_IMAGE_URL_CHARS) },
    })),
  ];

  const response = await fetchWithRetry(
    fetchImpl,
    `${env.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.visionModel,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ] satisfies VisionMessage[],
      }),
    },
    'vision chat/completions'
  );
  if (!response) {
    // Both attempts failed at the transport layer (network error or 60 s abort).
    if (throwOnFailure) {
      throw new VerificationUpstreamError(
        'The AI provider could not be reached (network error or timeout).'
      );
    }
    return null;
  }
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(
      `[verification.ai] vision chat/completions returned ${response.status}: ${errorBody.slice(0, 500)}`
    );
    if (throwOnFailure) {
      const detail = errorBody.trim().slice(0, 200);
      throw new VerificationUpstreamError(
        `The AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
        response.status
      );
    }
    return null;
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    logProviderError('vision response body could not be read', error);
    return null;
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    console.error(
      `[verification.ai] vision response was ${text.length} bytes (cap ${MAX_RESPONSE_BYTES})`
    );
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    logProviderError('vision response was not valid JSON', error);
    return null;
  }
  if (!isRecord(payload)) {
    console.error('[verification.ai] vision response was not a JSON object');
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    console.error('[verification.ai] vision response had no choices');
    return null;
  }
  const first = choices[0];
  if (!isRecord(first)) {
    console.error('[verification.ai] vision response choice was not an object');
    return null;
  }
  const message = first.message;
  if (!isRecord(message)) {
    console.error('[verification.ai] vision response choice had no message object');
    return null;
  }
  const messageContent = message.content;
  if (typeof messageContent !== 'string') {
    console.error('[verification.ai] vision response message.content was not a string');
    return null;
  }

  // Groq's vision models reject `response_format: json_object`, so the prompt
  // only *asks* for JSON — the model may still fence it in a ```json block.
  // Strip that before parsing.
  const cleanContent = messageContent
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(cleanContent);
    if (!isRecord(parsed)) {
      console.error('[verification.ai] vision model content was not a JSON object');
      return null;
    }
    return parsed;
  } catch (error) {
    logProviderError('vision model content was not valid JSON', error);
    return null;
  }
}

/**
 * Raised instead of returning `null` when the provider call itself failed and
 * the caller asked for a reason (`throwOnFailure`). `status` is the upstream
 * HTTP status when there was one, so a 401/429/timeout can be told apart.
 *
 * The message is safe to send to the browser: it names the HTTP status and a
 * bounded slice of the provider's error body — never the request payload (which
 * holds the member's selfie).
 */
export class VerificationUpstreamError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'VerificationUpstreamError';
    this.status = status;
  }
}

export interface AnalyzeDeps {
  fetchImpl?: typeof fetch;
  env?: VerificationEnv;
  /**
   * When true, a provider transport failure or non-2xx response throws a
   * `VerificationUpstreamError` instead of resolving to `null`. Defaults to
   * false so existing callers keep the fail-closed "returns null" contract.
   */
  throwOnFailure?: boolean;
}

export interface FaceInput {
  selfieUrl: string;
  gender: VerificationGender;
}

/** Classifies a live selfie. `null` means "could not verify" — never a pass. */
export async function analyzeFace(
  input: FaceInput,
  deps: AnalyzeDeps = {}
): Promise<FaceVerdict | null> {
  const env = deps.env ?? readVerificationEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const parsed = await callVision(
    FACE_SYSTEM_PROMPT,
    `Verify this live selfie. The member selected gender: ${input.gender}.`,
    [input.selfieUrl],
    env,
    fetchImpl,
    deps.throwOnFailure === true
  );
  if (!parsed) return null;

  const apparentGender = normaliseApparentGender(parsed.apparent_gender);
  return {
    human: parsed.human === true,
    facePresent: parsed.face_present === true,
    apparentGender,
    genderMatch: matchesSelectedGender(input.gender, apparentGender),
    score: normaliseScore(parsed.score),
    provider: env.provider,
    model: env.visionModel,
  };
}

export interface PhotoInput {
  photoUrl: string;
  selfieUrl: string;
  gender: VerificationGender;
}

/** Classifies a gallery/avatar photo against the verified selfie. */
export async function analyzePhoto(
  input: PhotoInput,
  deps: AnalyzeDeps = {}
): Promise<PhotoVerdict | null> {
  const env = deps.env ?? readVerificationEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;

  const parsed = await callVision(
    PHOTO_SYSTEM_PROMPT,
    `Reference (verified selfie) first, then the photo to check. The member selected gender: ${input.gender}.`,
    [input.selfieUrl, input.photoUrl],
    env,
    fetchImpl
  );
  if (!parsed) return null;

  const apparentGender = normaliseApparentGender(parsed.apparent_gender);
  return {
    human: parsed.human === true,
    samePerson: parsed.same_person === true,
    apparentGender,
    genderMatch: matchesSelectedGender(input.gender, apparentGender),
    rejectReason:
      typeof parsed.reject_reason === 'string' && parsed.reject_reason.trim().length > 0
        ? parsed.reject_reason.trim().slice(0, 200)
        : null,
    score: normaliseScore(parsed.score),
    provider: env.provider,
    model: env.visionModel,
  };
}

export interface VoiceInput {
  /** `data:audio/...;base64,...`. */
  audioUrl: string;
  phrase: string;
}

export interface VoiceVerdict {
  transcript: string;
  phraseMatch: boolean;
  provider: string;
  model: string;
}

/** Normalises text for phrase containment: lowercase, alphanumeric words only. */
function normaliseWords(text: string): string[] {
  let normalized = text.toLowerCase().replace(/-/g, '');
  
  // ✅ FIX: Expand common contractions so "I'm" matches "I am"
  normalized = normalized
    .replace(/'m\b/g, ' am ')
    .replace(/'re\b/g, ' are ')
    .replace(/'ve\b/g, ' have ')
    .replace(/'ll\b/g, ' will ')
    .replace(/'d\b/g, ' would ')
    .replace(/n't\b/g, ' not ');

  return normalized
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True when the transcript contains every content word of the phrase, in any
 * order. Speech-to-text is lossy, so an exact match is too brittle; requiring
 * every word is a strong liveness signal without demanding perfection.
 */
export function phraseMatches(phrase: string, transcript: string): boolean {
  const wanted = normaliseWords(phrase);
  if (wanted.length === 0) return false;
  const heard = new Set(normaliseWords(transcript));
  return wanted.every((word) => heard.has(word));
}

/** Splits a `data:` URL into its media type and raw bytes. */
export function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  try {
    if (isBase64) {
      // ✅ FIX: Use Buffer instead of atob for Node.js compatibility with large files
      const buffer = Buffer.from(match[3], 'base64');
      return new Blob([buffer], { type: contentType });
    }
    return new Blob([decodeURIComponent(match[3])], { type: contentType });
  } catch {
    return null;
  }
}

/**
 * Transcribes short speech. `null` means "could not verify" — never a pass.
 * `phraseMatch` is computed by the caller through `phraseMatches`.
 */
export async function transcribeVoice(
  input: VoiceInput,
  deps: AnalyzeDeps = {}
): Promise<VoiceVerdict | null> {
  const env = deps.env ?? readVerificationEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!env.apiKey) return null;

  const blob = dataUrlToBlob(input.audioUrl);
  if (!blob || blob.size === 0) {
    console.error('[verification.ai] Invalid audio blob');
    return null;
  }

  // Safety net: Groq does not support 'whisper-1'. Fall back to turbo.
  const model = env.transcribeModel === 'whisper-1' 
    ? 'whisper-large-v3-turbo' 
    : env.transcribeModel;

  // Groq infers the container from the file, not the Content-Type alone, so a
  // Safari `audio/mp4` recording uploaded as `voice.webm` is rejected. Derive the
  // extension from the blob's actual media type.
  const extension = blob.type.includes('mp4') || blob.type.includes('m4a')
    ? 'mp4'
    : blob.type.includes('ogg')
      ? 'ogg'
      : blob.type.includes('wav')
        ? 'wav'
        : 'webm';

  const form = new FormData();
  form.append('model', model);
  form.append('file', blob, `voice.${extension}`);

  const response = await fetchWithRetry(
    fetchImpl,
    `${env.baseUrl}/audio/transcriptions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.apiKey}` },
      body: form,
    },
    'audio transcription'
  );

  if (!response) {
    console.error('[verification.ai] audio transcription fetch failed (timeout/network)');
    return null;
  }

  if (!response.ok) {
    // Log the actual error from the provider to help debug.
    const errText = await response.text().catch(() => '');
    console.error(`[verification.ai] audio transcription returned ${response.status}: ${errText}`);
    return null;
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.length > MAX_RESPONSE_BYTES) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(payload) || typeof payload.text !== 'string') return null;

  const transcript = payload.text.trim();
  return {
    transcript,
    phraseMatch: phraseMatches(input.phrase, transcript),
    provider: env.provider,
    model: model,
  };
}