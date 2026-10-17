import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { BotError, chatWithSubbu, normaliseHistory } from '@/lib/bot/subbu';

/**
 * M27 — Subbu, the in-app AI companion.
 *
 * POST { messages: [{ role: 'user' | 'assistant', content: string }] } →
 * 200 { reply }, or { error, message } with a status that says what went wrong.
 *
 * WHY THIS IS A ROUTE AND NOT A BROWSER CALL
 *   `AI_MODERATION_API_KEY` is a private value (`CONSTITUTION.md` Article 1.5),
 *   so the provider call must happen on the server. The session is resolved from
 *   the cookies with `@supabase/ssr`, exactly as `/api/translate` does — never
 *   from the request body — so an anonymous caller cannot spend the AI budget.
 *
 * ORDER OF CHECKS
 *   413 (declared size, before parsing) → 400 (malformed or empty history) →
 *   401 (no session) → 429 (per-member rate limit) → the provider call →
 *   502/503.
 */

export const dynamic = 'force-dynamic';

/** The request body ceiling. A trimmed 20-turn history is well under this. */
const MAX_BODY_BYTES = 64_000;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

interface RateWindow {
  startedAt: number;
  count: number;
}

// Per-process counters, keyed by member id. On a serverless platform each
// instance counts independently, so this is an abuse bound rather than an exact
// quota — the same tradeoff `/api/translate` documents. Stale entries are pruned
// so the map cannot grow without bound.
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

interface BotErrorBody {
  error: string;
  message: string;
}

function failure(error: string, message: string, status: number): NextResponse {
  const body: BotErrorBody = { error, message };
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
            // surfaced to the caller. (Same handling as /api/translate.)
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
async function resolveUser(supabase: ServerSupabaseClient): Promise<{ id: string } | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    logger.warn('bot.unauthenticated', 'Subbu was messaged without a valid session.');
    return null;
  }

  return { id: user.id };
}

export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();

  // 1. Declared size, before anything is parsed.
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return failure('payload_too_large', 'That conversation is too long.', 413);
  }

  // 2. The body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return failure('invalid_request', 'Send a JSON body with the conversation.', 400);
  }
  if (!isRecord(raw)) {
    return failure('invalid_request', 'Send a JSON body with the conversation.', 400);
  }

  let history;
  try {
    history = normaliseHistory(raw.messages);
  } catch (error) {
    if (error instanceof BotError) return failure(error.code, error.message, 400);
    return failure('invalid_request', 'There is no message to reply to.', 400);
  }

  // 3. The caller.
  let supabase: ServerSupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    logger.error('bot.server_client_failed', 'Could not build the server Supabase client.', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return failure('server_error', 'Subbu is unavailable right now.', 500);
  }

  const user = await resolveUser(supabase);
  if (!user) {
    return failure('unauthenticated', 'Sign in to chat with Subbu.', 401);
  }

  // 4. The rate limit, after authentication so an anonymous flood can never
  // consume a member's allowance.
  if (isRateLimited(user.id, now)) {
    logger.warn('bot.rate_limited', 'Member reached the Subbu rate limit.');
    return failure('rate_limited', 'You are messaging very quickly — please try again soon.', 429);
  }

  // 5. The reply. Note what is never logged: the conversation text or either key.
  try {
    const { reply, model } = await chatWithSubbu(history);

    logger.debug('bot.replied', 'Subbu answered.', { model, turns: history.length });

    return NextResponse.json({ reply }, { status: 200 });
  } catch (error) {
    if (error instanceof BotError) {
      logger.error('bot.failed', 'Subbu provider failed.', { failure: error.code });

      switch (error.code) {
        case 'not_configured':
          return failure('not_configured', 'Subbu is not available right now.', 503);
        case 'invalid_request':
          return failure('invalid_request', 'There is no message to reply to.', 400);
        case 'empty_result':
          return failure('empty_result', 'Subbu did not have an answer. Please try again.', 502);
        default:
          return failure('upstream_error', 'Subbu is unavailable right now.', 502);
      }
    }

    // Anything that is not a BotError is a bug on our side. Only its name is
    // logged: an unexpected error's message can carry request data.
    logger.error('bot.failed', 'Unexpected Subbu failure.', {
      failure: 'unexpected_error',
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return failure('server_error', 'Subbu is unavailable right now.', 500);
  }
}
