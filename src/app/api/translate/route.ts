import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { DEFAULT_TRANSLATION_LANGUAGE, TranslationError, normaliseLanguageCode } from '@/lib/translation';
import { MAX_TRANSLATE_LENGTH, translateText } from '@/lib/translation-service';

/**
 * M17 — on-demand message translation.
 *
 * POST { text, targetLanguage?, sourceLanguage? } → 200 { translatedText,
 * provider, detectedSourceLanguage? }, or { error, message } with a status that
 * says what went wrong.
 *
 * WHY THIS IS A ROUTE AND NOT A BROWSER CALL
 *   `DEEPL_API_KEY` is a private value (`CONSTITUTION.md` Article 1.5), so the
 *   provider call must happen on the server. The session is resolved from the
 *   cookies with `@supabase/ssr`, exactly as `/auth/callback` does — never from
 *   the request body — so an anonymous caller cannot spend the translation
 *   budget, and `auth.uid()` (via the member's own client) remains the only
 *   source of identity (Article 1.2).
 *
 * ORDER OF CHECKS
 *   413 (declared size, before parsing anything) → 400 (malformed body, empty or
 *   oversized text, bad target) → 401 (no session) → 429 (per-member rate limit)
 *   → the provider call → 502/503.
 *   The declared-size check cannot run after the parse, so it is the one step
 *   taken first; the post-parse size check below stays where the contract puts
 *   it, after the 400s.
 */

export const dynamic = 'force-dynamic';

/** The request body ceiling. A legal 1000-character message is ~3 KB at most. */
const MAX_BODY_BYTES = 8_192;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

interface RateWindow {
  startedAt: number;
  count: number;
}

// Per-process counters, keyed by member id. On a serverless platform each
// instance counts independently, so this is an abuse bound rather than an exact
// quota — the same tradeoff `/api/observability` documents. The goal is to stop
// one session (or a script holding a stolen one) from spending the provider
// budget in a loop. Stale entries are pruned so the map cannot grow without
// bound.
const windows = new Map<string, RateWindow>();

function isRateLimited(userId: string, now: number): boolean {
  const existing = windows.get(userId);

  if (!existing || now - existing.startedAt > RATE_LIMIT_WINDOW_MS) {
    windows.set(userId, { startedAt: now, count: 1 });
    for (const [key, window] of windows) {
      if (now - window.startedAt > RATE_LIMIT_WINDOW_MS) windows.delete(key);
    }
    return false;
  }

  existing.count += 1;
  return existing.count > RATE_LIMIT_MAX;
}

interface TranslateErrorBody {
  error: string;
  message: string;
}

interface AuthenticatedUser {
  id: string;
}

function failure(error: string, message: string, status: number): NextResponse {
  const body: TranslateErrorBody = { error, message };
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The refreshed session cookie could not be written back — the
            // request still carries a valid one. Session refresh belongs to
            // middleware; this is not an authorisation decision, so it is not
            // surfaced to the caller. (Same handling as /auth/callback.)
          }
        },
      },
    }
  );
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Resolves the caller from the session cookie only. Returns `null` for an
 * anonymous or invalid session, which the route answers with 401.
 */
async function resolveUser(supabase: ServerSupabaseClient): Promise<AuthenticatedUser | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    // Deliberately logs no error message: an auth error can carry token-shaped
    // material, and the request is not a member's fault worth recording.
    logger.warn('translate.unauthenticated', 'Translation requested without a valid session.');
    return null;
  }

  return { id: user.id };
}

/**
 * The member's stored preference, read server-side.
 *
 * CONTRACT C (`src/lib/preferences.ts`) is client-only, so the route cannot use
 * it: `fetchPreferredTranslationLanguage()` builds the browser client at module
 * scope. This is the same query against the member's own row, and a failure
 * degrades to `null` rather than blocking the translation — a preference must
 * never be the reason a member cannot read a message.
 */
async function readPreferredTargetLanguage(
  supabase: ServerSupabaseClient,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('preferred_translation_language')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.warn('translate.preference_read_failed', 'Using the requested language instead.', {
        pgError: error.code,
      });
      return null;
    }

    if (!isRecord(data)) return null;

    return normaliseLanguageCode(
      typeof data.preferred_translation_language === 'string'
        ? data.preferred_translation_language
        : null
    );
  } catch (error) {
    logger.warn('translate.preference_read_failed', 'Using the requested language instead.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();

  // 1. Declared size, before anything is parsed.
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return failure('payload_too_large', 'That message is too long to translate.', 413);
  }

  // 2. The body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return failure('invalid_request', 'Send a JSON body with the text to translate.', 400);
  }

  if (!isRecord(raw)) {
    return failure('invalid_request', 'Send a JSON body with the text to translate.', 400);
  }

  const textValue = raw.text;
  if (typeof textValue !== 'string' || textValue.trim().length === 0) {
    return failure('invalid_request', 'There is no text to translate.', 400);
  }

  const text = textValue.trim();
  if (text.length > MAX_TRANSLATE_LENGTH) {
    return failure(
      'invalid_request',
      `Text must be ${MAX_TRANSLATE_LENGTH} characters or fewer.`,
      400
    );
  }

  // The contract's post-parse size check. With MAX_TRANSLATE_LENGTH = 1000 the
  // widest legal body is ~3 KB, so this cannot trigger today; it is kept as the
  // backstop for a future cap increase, and because a body can lie about (or
  // omit) `content-length`.
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return failure('payload_too_large', 'That message is too long to translate.', 413);
  }

  // 3. The target. A supplied target is authoritative; an omitted one falls back
  // to the member's stored preference and then to the default, because this
  // route is the only place that can read the preference on the server.
  const targetValue = raw.targetLanguage;
  let requestedTarget: string | null = null;

  if (targetValue !== undefined && targetValue !== null && targetValue !== '') {
    if (typeof targetValue !== 'string') {
      return failure('invalid_request', 'targetLanguage must be a language code.', 400);
    }
    requestedTarget = normaliseLanguageCode(targetValue);
    if (!requestedTarget) {
      return failure('unsupported_language', 'That language is not supported yet.', 400);
    }
  }

  const sourceValue = raw.sourceLanguage;
  if (sourceValue !== undefined && sourceValue !== null && typeof sourceValue !== 'string') {
    return failure('invalid_request', 'sourceLanguage must be a language code.', 400);
  }
  const sourceLanguage = typeof sourceValue === 'string' ? sourceValue : null;

  // 4. The caller.
  let supabase: ServerSupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    logger.error('translate.server_client_failed', 'Could not build the server Supabase client.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return failure('server_error', 'Translation is unavailable right now.', 500);
  }

  const user = await resolveUser(supabase);
  if (!user) {
    return failure('unauthenticated', 'Sign in to translate messages.', 401);
  }

  // 5. The rate limit, after authentication so an anonymous flood can never
  // consume a member's allowance.
  if (isRateLimited(user.id, now)) {
    logger.warn('translate.rate_limited', 'Member reached the translation rate limit.');
    return failure(
      'rate_limited',
      'You are translating very quickly — please try again in a minute.',
      429
    );
  }

  const targetLanguage =
    requestedTarget ??
    (await readPreferredTargetLanguage(supabase, user.id)) ??
    DEFAULT_TRANSLATION_LANGUAGE;

  // 6. The translation. Note what is never logged: the message text, the request
  // URL (its `q` parameter carries the text), the upstream body and either key.
  try {
    const result = await translateText({ text, targetLanguage, sourceLanguage });

    logger.debug('translate.succeeded', 'Translated a message.', {
      provider: result.provider,
      targetLanguage,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TranslationError) {
      logger.error('translate.failed', 'Translation provider failed.', {
        failure: error.code,
        targetLanguage,
      });

      switch (error.code) {
        case 'upstream_quota':
          return failure(
            'upstream_quota',
            'Translation is temporarily unavailable — please try again later.',
            503
          );
        case 'empty_result':
          return failure(
            'empty_result',
            'We could not translate that message. Please try again.',
            502
          );
        case 'invalid_request':
          return failure('invalid_request', 'There is no text to translate.', 400);
        case 'unsupported_language':
          return failure('unsupported_language', 'That language is not supported yet.', 400);
        default:
          return failure(
            'upstream_error',
            'Translation is unavailable right now. Please try again.',
            502
          );
      }
    }

    // Anything that is not a TranslationError is a bug on our side. Only its
    // name is logged: an unexpected error's message can carry request data.
    logger.error('translate.failed', 'Unexpected translation failure.', {
      failure: 'unexpected_error',
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return failure('server_error', 'Translation is unavailable right now.', 500);
  }
}
