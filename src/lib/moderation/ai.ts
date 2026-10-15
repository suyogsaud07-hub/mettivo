/**
 * M21 — server-side AI moderation classifier.
 *
 * SERVER ONLY. Reads `AI_MODERATION_API_KEY`, a private value
 * (`CONSTITUTION.md` Article 1.5). It is imported by the `/api/moderation/scan`
 * route and by its unit test, and by nothing else — never from a component.
 *
 * PROVIDER SHAPE
 *   An OpenAI-compatible `/chat/completions` endpoint, so the same code works
 *   against OpenAI, Azure-style gateways, or a local model. `fetchImpl` is
 *   injectable so every branch is unit-testable offline, exactly like
 *   `src/lib/translation-service.ts`.
 *
 * WHAT IT DOES NOT DO
 *   The classifier returns a verdict. It does not decide punishment: the
 *   database's `record_ai_scan()` is the only thing that can act, and it can
 *   only ever restrict the member who authored the scanned content. The model is
 *   a signal, never the authority — a prompt-injected model cannot name a
 *   victim.
 */

/** The closed set of violation categories, mirroring the database CHECK. */
export const AI_CATEGORIES = ['nudity', 'harassment', 'underage', 'spam'] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

/** The content shapes the queue produces. */
export type ModerationContentType =
  | 'message'
  | 'moment_caption'
  | 'comment'
  | 'bio'
  | 'profile_photo'
  | 'live_snapshot';

/** The enforcement scope a verdict points at. `null` = no action suggested. */
export type SuggestedAction = 'chat' | 'video' | 'account' | null;

export interface AiScanInput {
  contentType: ModerationContentType;
  contentText: string | null;
  contentUrl: string | null;
}

export interface AiVerdict {
  flagged: boolean;
  score: number;
  categories: AiCategory[];
  suggestedAction: SuggestedAction;
  provider: string;
  model: string;
}

export interface AiEnv {
  apiKey: string | null;
  baseUrl: string;
  textModel: string;
  visionModel: string;
  provider: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TEXT_MODEL = 'gpt-4o-mini';
const DEFAULT_VISION_MODEL = 'gpt-4o-mini';

/** Providers cap input size; a moderation scan never needs the whole thing. */
const MAX_TEXT_CHARS = 4_000;
/** A vision request accepts the JPEG snapshot the live reporter captured. */
const MAX_IMAGE_URL_CHARS = 700_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 32_768;

/**
 * Reads the AI configuration through the injected-source pattern, so the
 * secrets scan in `tests/security/security.test.ts` stays meaningful without
 * weakening the server-only guarantee.
 */
export function readAiEnv(source: Record<string, string | undefined> = process.env): AiEnv {
  const apiKey = (source['AI_MODERATION_API_KEY'] ?? '').trim();
  const baseUrl = (source['AI_MODERATION_BASE_URL'] ?? '').trim() || DEFAULT_BASE_URL;
  const textModel = (source['AI_MODERATION_TEXT_MODEL'] ?? '').trim() || DEFAULT_TEXT_MODEL;
  const visionModel = (source['AI_MODERATION_VISION_MODEL'] ?? '').trim() || DEFAULT_VISION_MODEL;

  return {
    apiKey: apiKey || null,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    textModel,
    visionModel,
    provider: 'openai-compatible',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The instruction sent to the model. The output contract is strict JSON. */
const SYSTEM_PROMPT =
  'You are a trust-and-safety classifier for a dating app. Classify the ' +
  'content for policy violations. Respond with ONLY a JSON object of the form ' +
  '{"flagged": boolean, "score": number, "categories": string[], ' +
  '"suggested_action": "chat"|"video"|"account"|null}. "score" is your ' +
  'confidence in [0,1] that the content violates policy. "categories" may ' +
  'contain only: nudity, harassment, underage, spam. Use "underage" only when ' +
  'the content indicates a minor. Use "nudity" for explicit sexual content. ' +
  'Use "spam" for scams or advertising. Use "harassment" for abuse or threats.';

interface ChatMessage {
  role: 'system' | 'user';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
}

/** Runs one fetch under a timeout budget. The timer is always cleared. */
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

function normaliseScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function normaliseCategories(value: unknown): AiCategory[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(AI_CATEGORIES);
  const seen = new Set<AiCategory>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const key = item.trim().toLowerCase();
    if (allowed.has(key)) seen.add(key as AiCategory);
  }
  return [...seen];
}

function normaliseAction(value: unknown): SuggestedAction {
  if (value === 'chat' || value === 'video' || value === 'account') return value;
  return null;
}

/**
 * Parses the model's JSON content. Anything malformed is a `null` verdict, which
 * the caller treats as "no signal" rather than "clean" — a broken classifier
 * must never silently vouch for content.
 */
function parseVerdict(raw: string, env: AiEnv, model: string): AiVerdict | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const categories = normaliseCategories(parsed.categories);
  const score = normaliseScore(parsed.score);
  const flagged = parsed.flagged === true || (categories.length > 0 && score > 0);

  return {
    flagged,
    score,
    categories,
    suggestedAction: normaliseAction(parsed.suggested_action) ?? suggestedActionFor(categories),
    provider: env.provider,
    model,
  };
}

/** The default action a category implies when the model does not choose one. */
export function suggestedActionFor(categories: AiCategory[]): SuggestedAction {
  if (categories.includes('underage')) return 'account';
  if (categories.includes('nudity')) return 'video';
  return categories.length > 0 ? 'chat' : null;
}

interface ClassifyDeps {
  fetchImpl?: typeof fetch;
  env?: AiEnv;
}

/**
 * Classifies one queued item.
 *
 * Returns `null` when AI is not configured or the provider fails — an outage
 * degrades to "unscanned", never to "banned" and never to "clean".
 */
export async function classifyContent(
  input: AiScanInput,
  deps: ClassifyDeps = {}
): Promise<AiVerdict | null> {
  const env = deps.env ?? readAiEnv();
  if (!env.apiKey) return null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const isImage = input.contentType === 'profile_photo' || input.contentType === 'live_snapshot';
  const model = isImage ? env.visionModel : env.textModel;

  const userContent: ChatMessage['content'] = isImage
    ? [
        { type: 'text', text: `Classify this image from a ${input.contentType}.` },
        { type: 'image_url', image_url: { url: (input.contentUrl ?? '').slice(0, MAX_IMAGE_URL_CHARS) } },
      ]
    : (input.contentText ?? '').slice(0, MAX_TEXT_CHARS);

  if (!isImage && (userContent as string).trim().length === 0) return null;
  if (isImage && !input.contentUrl) return null;

  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ] satisfies ChatMessage[],
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${env.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

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
  if (!isRecord(payload)) return null;

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content !== 'string') return null;

  return parseVerdict(content, env, model);
}
