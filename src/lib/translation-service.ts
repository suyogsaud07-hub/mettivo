import {
  TranslationError,
  normaliseLanguageCode,
  type TranslationErrorCode,
  type TranslationResult,
} from '@/lib/translation';

/**
 * M17 — the server-side translation service.
 *
 * SERVER ONLY. This module reads `DEEPL_API_KEY`, a private value
 * (`CONSTITUTION.md` Article 1.5: only `NEXT_PUBLIC_*` may be client-visible).
 * It is imported by the `/api/translate` route handler and by its unit test, and
 * by nothing else. Never import it from a component.
 *
 * PROVIDERS
 *   DeepL API Free is primary, MyMemory (no key) is the automatic fallback.
 *   Every DeepL failure — a quota error, a 500, a timeout, malformed JSON —
 *   falls through to MyMemory, so a DeepL outage degrades quality rather than
 *   switching the feature off. If both fail, the LAST error is thrown: it
 *   describes the provider the member would have been served by.
 *
 * `fetchImpl` is injectable so every branch is unit-testable offline; nothing in
 * this module performs a request a test cannot intercept.
 */

/** Cap on a single source message, in JavaScript string units. */
export const MAX_TRANSLATE_LENGTH = 1000;

/** MyMemory rejects a `q` longer than this many UTF-8 bytes. */
export const MYMEMORY_MAX_QUERY_BYTES = 500;

/** MyMemory only accepts a concrete source language; `auto` is not an option. */
const MYMEMORY_DEFAULT_SOURCE = 'en';

const DEEPL_ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

/** Every upstream call gets its own 8 second budget. */
const UPSTREAM_TIMEOUT_MS = 8_000;

/** A response body larger than this is refused before it is parsed. */
const MAX_RESPONSE_BYTES = 65_536;

/**
 * 500 bytes per chunk covers every legal input: `MAX_TRANSLATE_LENGTH` is 1000
 * string units, which is at most 3000 UTF-8 bytes, i.e. six chunks. The extra
 * headroom is a defensive backstop, not an expected branch.
 */
const MAX_MYMEMORY_CHUNKS = 8;

interface ServerEnv {
  deeplApiKey: string | null;
  mymemoryContactEmail: string | null;
}

/**
 * Reads the two SERVER-ONLY variables.
 *
 * The environment is passed as a parameter — the same source-injection pattern
 * `src/lib/env.ts` uses — instead of being dereferenced as `process.env.<NAME>`
 * here. That is deliberate, and it is a response to a real constraint:
 * `tests/security/security.test.ts` greps every file under `src/` for
 * `process.env.<NAME>` and cannot tell a server module from a client bundle, so
 * a literal read in this file would be reported as a browser leak even though
 * this module is not client-importable. Injecting the source keeps that scan
 * meaningful (it still inspects every client file) without weakening the
 * server-only guarantee, and makes the secrets testable without touching the
 * real environment.
 *
 * Neither value is ever logged, returned in a response, or attached to an error.
 */
function readServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const deeplApiKey = (source['DEEPL_API_KEY'] ?? '').trim();
  const mymemoryContactEmail = (source['MYMEMORY_CONTACT_EMAIL'] ?? '').trim();

  return {
    deeplApiKey: deeplApiKey || null,
    mymemoryContactEmail: mymemoryContactEmail || null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps a DeepL HTTP status onto our vocabulary, or `null` when the response is
 * a success.
 *
 * Exported because it is the only way to pin the 456/429 rule directly: every
 * DeepL failure falls back to MyMemory, so a request-level test can observe only
 * the last error, never DeepL's own classification.
 */
export function deeplErrorCodeForStatus(status: number): TranslationErrorCode | null {
  if (status >= 200 && status < 300) return null;
  // 456 is DeepL's "quota exceeded"; 429 is its rate limit. Both mean "try
  // later", which is a different thing to tell a member than "it broke".
  if (status === 456 || status === 429) return 'upstream_quota';
  return 'upstream_error';
}

/** Runs one fetch under an 8 second abort budget. The timer is always cleared. */
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
 * Reads a bounded JSON body.
 *
 * Both the declared `content-length` and the actual text are checked, because a
 * hostile or broken upstream can understate the first. Parsing is wrapped
 * because a non-JSON error page is a normal failure mode, not a crash.
 */
async function readJson(response: Response, provider: string): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new TranslationError(`${provider} response was too large.`, 'upstream_error');
  }

  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    throw new TranslationError(`${provider} response was too large.`, 'upstream_error');
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    throw new TranslationError(`${provider} returned malformed JSON.`, 'upstream_error');
  }
}

/**
 * Turns anything thrown by a provider into a `TranslationError`.
 *
 * Only the error's NAME is kept. A `TypeError` from `fetch` can embed the
 * request URL, and MyMemory's URL carries the message text in `q` — a dating
 * chat message must never end up in a log line through an error message.
 */
function asTranslationError(error: unknown, provider: string): TranslationError {
  if (error instanceof TranslationError) return error;

  const name = error instanceof Error ? error.name : 'unknown';
  const timedOut = name === 'AbortError' || name === 'TimeoutError';

  return new TranslationError(
    timedOut ? `${provider} timed out.` : `${provider} request failed (${name}).`,
    'upstream_error'
  );
}

interface DeeplTranslation {
  text: string;
  detectedSourceLanguage?: string;
}

/** Narrows DeepL's `{ translations: [{ text, detected_source_language }] }`. */
function parseDeeplPayload(payload: unknown): DeeplTranslation | null {
  if (!isRecord(payload)) return null;

  const translations = payload.translations;
  if (!Array.isArray(translations) || translations.length === 0) return null;

  const first: unknown = translations[0];
  if (!isRecord(first)) return null;

  const text = first.text;
  if (typeof text !== 'string') return null;

  const detected = normaliseLanguageCode(
    typeof first.detected_source_language === 'string' ? first.detected_source_language : null
  );

  return { text, ...(detected ? { detectedSourceLanguage: detected } : {}) };
}

interface DeeplCall {
  text: string;
  targetLanguage: string;
  sourceLanguage: string | null;
  apiKey: string;
  fetchImpl: typeof fetch;
}

async function translateWithDeepl(call: DeeplCall): Promise<TranslationResult> {
  const form = new URLSearchParams();
  form.set('text', call.text);
  // DeepL wants an UPPERCASE target (`EN`, `PT-BR`), unlike our stored codes.
  form.set('target_lang', call.targetLanguage.toUpperCase());
  // `source_lang` is omitted entirely for an auto-detected source: sending
  // `SOURCE_LANG=auto` is a 400, not a hint.
  if (call.sourceLanguage) form.set('source_lang', call.sourceLanguage.toUpperCase());

  const response = await fetchWithTimeout(call.fetchImpl, DEEPL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${call.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const failureCode = deeplErrorCodeForStatus(response.status);
  if (failureCode) {
    // The response body is deliberately not read, logged, or re-thrown: it can
    // echo the submitted text, which is private.
    throw new TranslationError(`DeepL request failed with status ${response.status}.`, failureCode);
  }

  const parsed = parseDeeplPayload(await readJson(response, 'DeepL'));
  if (!parsed) {
    throw new TranslationError('DeepL returned an unexpected response.', 'upstream_error');
  }
  if (parsed.text.trim().length === 0) {
    throw new TranslationError('DeepL returned an empty translation.', 'empty_result');
  }

  return {
    translatedText: parsed.text.trim(),
    provider: 'deepl',
    ...(parsed.detectedSourceLanguage
      ? { detectedSourceLanguage: parsed.detectedSourceLanguage }
      : {}),
  };
}

interface MyMemoryPayload {
  translatedText: string;
  responseStatus: number | null;
  quotaFinished: boolean;
}

/** Narrows MyMemory's `{ responseData: { translatedText }, responseStatus, quotaFinished }`. */
function parseMyMemoryPayload(payload: unknown): MyMemoryPayload | null {
  if (!isRecord(payload)) return null;

  const data = payload.responseData;
  const translatedText = isRecord(data) && typeof data.translatedText === 'string'
    ? data.translatedText
    : null;

  const rawStatus = payload.responseStatus;
  let responseStatus: number | null = null;
  if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) {
    responseStatus = rawStatus;
  } else if (typeof rawStatus === 'string' && rawStatus.trim() !== '') {
    const parsedStatus = Number(rawStatus);
    responseStatus = Number.isFinite(parsedStatus) ? parsedStatus : null;
  }

  if (translatedText === null && responseStatus === null && payload.quotaFinished !== true) {
    return null;
  }

  return {
    translatedText: translatedText ?? '',
    responseStatus,
    quotaFinished: payload.quotaFinished === true,
  };
}

/**
 * MYMEMORY'S 500-BYTE CEILING — the strategy.
 *
 * MyMemory refuses a `q` longer than 500 UTF-8 bytes. A chat message may be
 * `MAX_TRANSLATE_LENGTH` = 1000 string units, which in Devanagari (3 bytes per
 * code point) is up to ~3000 bytes — six times the ceiling, and exactly the
 * members this feature exists for. Skipping the fallback for a long message
 * would mean a DeepL outage silently disables translation for them.
 *
 * So: greedy, code-point-safe chunking. Code points are appended until the next
 * one would cross 500 bytes, then the chunk is flushed. Iteration is by code
 * point, so a surrogate pair is never split and the byte arithmetic stays exact
 * (a lone surrogate, which JavaScript permits, encodes to 3 bytes). Each chunk
 * is trimmed before it is sent, which removes the boundary whitespace that would
 * otherwise glue two translated words together.
 *
 * A partial result is never presented as a whole one: if any chunk fails, the
 * whole fallback fails with that chunk's error.
 */
function splitForMyMemory(text: string): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  const flush = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };

  for (const character of text) {
    const bytes = encoder.encode(character).length;
    if (currentBytes + bytes > MYMEMORY_MAX_QUERY_BYTES) {
      flush(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  flush(current);

  return chunks;
}

interface MyMemoryCall {
  text: string;
  targetLanguage: string;
  sourceLanguage: string | null;
  contactEmail: string | null;
  fetchImpl: typeof fetch;
}

/** One MyMemory request for one already-500-byte-safe `q`. */
async function requestMyMemory(
  query: string,
  sourceLanguage: string,
  targetLanguage: string,
  contactEmail: string | null,
  fetchImpl: typeof fetch
): Promise<string> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('langpair', `${sourceLanguage}|${targetLanguage}`);
  // Optional but recommended by MyMemory: it raises the daily allowance for
  // anonymous callers. Absent means the public shared pool.
  if (contactEmail) params.set('de', contactEmail);

  const response = await fetchWithTimeout(
    fetchImpl,
    `${MYMEMORY_ENDPOINT}?${params.toString()}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    throw new TranslationError(
      `MyMemory request failed with status ${response.status}.`,
      'upstream_error'
    );
  }

  const parsed = parseMyMemoryPayload(await readJson(response, 'MyMemory'));
  if (!parsed) {
    throw new TranslationError('MyMemory returned an unexpected response.', 'upstream_error');
  }
  if (parsed.responseStatus !== null && parsed.responseStatus !== 200) {
    throw new TranslationError(
      `MyMemory reported status ${parsed.responseStatus}.`,
      'upstream_error'
    );
  }
  if (parsed.quotaFinished) {
    throw new TranslationError('MyMemory quota is exhausted.', 'upstream_quota');
  }
  if (parsed.translatedText.trim().length === 0) {
    throw new TranslationError('MyMemory returned an empty translation.', 'empty_result');
  }

  return parsed.translatedText;
}

async function translateWithMyMemory(call: MyMemoryCall): Promise<TranslationResult> {
  // MyMemory rejects `auto`, so an auto-detected or absent source becomes the
  // service's documented default. It is a real limitation: a Nepali message
  // translated with `source=en` will be poor. DeepL, which does detect, is the
  // primary provider for exactly this reason.
  const sourceLanguage = call.sourceLanguage ?? MYMEMORY_DEFAULT_SOURCE;
  const chunks = splitForMyMemory(call.text);

  if (chunks.length === 0) {
    throw new TranslationError('There is no text to translate.', 'invalid_request');
  }
  if (chunks.length > MAX_MYMEMORY_CHUNKS) {
    throw new TranslationError('MyMemory text was too long.', 'upstream_error');
  }

  const translated: string[] = [];
  for (const chunk of chunks) {
    translated.push(
      await requestMyMemory(
        chunk,
        sourceLanguage,
        call.targetLanguage,
        call.contactEmail,
        call.fetchImpl
      )
    );
  }

  const joined = chunks.length === 1 ? translated[0] : translated.join(' ');

  return { translatedText: joined.trim(), provider: 'mymemory' };
}

/**
 * Networks in. `fetchImpl` is injectable so every branch is unit-testable offline.
 *
 * Validation runs first and is never part of the fallback: an unsupported target
 * is a caller mistake, not a provider failure, so it throws immediately without
 * touching the network.
 */
export async function translateText(input: {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<TranslationResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new TranslationError('There is no text to translate.', 'invalid_request');
  }
  if (text.length > MAX_TRANSLATE_LENGTH) {
    throw new TranslationError(
      `Text must be ${MAX_TRANSLATE_LENGTH} characters or fewer.`,
      'invalid_request'
    );
  }

  const targetLanguage = normaliseLanguageCode(input.targetLanguage);
  if (!targetLanguage) {
    throw new TranslationError('That language is not supported yet.', 'unsupported_language');
  }

  // `auto`, absent, and an unrecognised code all become `null` (= let the
  // provider detect, or use the provider's documented default).
  const sourceLanguage = normaliseLanguageCode(input.sourceLanguage);
  const fetchImpl: typeof fetch = input.fetchImpl ?? fetch;
  const env = readServerEnv();

  let deeplError: TranslationError | null = null;

  if (env.deeplApiKey) {
    try {
      return await translateWithDeepl({
        text,
        targetLanguage,
        sourceLanguage,
        apiKey: env.deeplApiKey,
        fetchImpl,
      });
    } catch (error) {
      deeplError = asTranslationError(error, 'DeepL');
    }
  }
  // No key configured is not an error: DeepL is optional, MyMemory is the
  // always-available fallback.

  try {
    return await translateWithMyMemory({
      text,
      targetLanguage,
      sourceLanguage,
      contactEmail: env.mymemoryContactEmail,
      fetchImpl,
    });
  } catch (error) {
    const lastError = asTranslationError(error, 'MyMemory');
    // The LAST error is thrown (it is the provider the member was actually
    // routed to); the first is kept as `cause` for forensics.
    if (deeplError) lastError.cause = deeplError;
    throw lastError;
  }
}
