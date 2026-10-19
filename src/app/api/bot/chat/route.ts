import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { errorContext, logger } from '@/lib/logger';
import {
  BotError,
  botFailureFromError,
  chatWithSubbu,
  normaliseHistory,
  type BotTurn,
} from '@/lib/bot/subbu';
import {
  SUBBU_IMAGE_BAN_DAYS,
  banDeniedMessage,
  parseBanFlag,
  parseBanStatus,
} from '@/lib/bot/moderation';
import { classifyContent } from '@/lib/moderation/ai';

export const dynamic = 'force-dynamic';

// Chat generation on a cold Groq model can take tens of seconds; Vercel's
// default is too short and surfaces as a 502/timeout. 60 s is the serverless
// ceiling and the budget the provider client allows the upstream fetch.
export const maxDuration = 60;

// A chat with one compressed image is a few hundred KB as base64. The old 64 KB
// cap rejected every image before it could be moderated, so the upload path
// could never work. This is a DoS ceiling, not a content policy: the image
// classifier and Subbu each cap the image they forward.
const MAX_BODY_BYTES = 2_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

interface RateWindow { startedAt: number; count: number; }
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
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function resolveUser(supabase: ServerSupabaseClient): Promise<{ id: string } | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { id: user.id };
}

interface BanRecord {
  until: string;
  reason: string | null;
}

function bannedResponse(ban: BanRecord): NextResponse {
  return NextResponse.json(
    {
      error: 'banned',
      banned_until: ban.until,
      reason: ban.reason,
      message: banDeniedMessage(ban.until, ban.reason),
    },
    { status: 403 },
  );
}

/**
 * The caller's own ban, read through `my_ban_status()`.
 *
 * It accepts no user id, so this can never be used to inspect another member.
 * A failure here is treated as an enforcement failure (500), not as "not
 * banned": silently allowing chat when the ban store is unavailable would make
 * the whole system bypassable.
 */
async function readOwnBan(supabase: ServerSupabaseClient): Promise<BanRecord | null> {
  const { data, error } = await supabase.rpc('my_ban_status');
  if (error) {
    console.error('[SUBBU BAN CHECK FAILED]', error.message);
    logger.error('bot.ban_check_failed', 'Could not read the caller ban state.', {
      message: error.message,
    });
    throw new Error('ban_check_failed');
  }

  const status = parseBanStatus(data);
  return status.banned && status.until ? { until: status.until, reason: status.reason } : null;
}

/**
 * Writes a ban for the caller only. Returns the new end timestamp, or `null`
 * when the write failed. `apply_self_ban` derives the subject from `auth.uid()`
 * and has no target parameter.
 */
async function persistBan(
  supabase: ServerSupabaseClient,
  days: number,
  reason: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('apply_self_ban', {
    p_duration_days: days,
    p_reason: reason,
  });

  if (error) {
    console.error('[SUBBU BAN FAILED]', error.message);
    logger.error('bot.ban_failed', 'Could not persist the ban.', {
      message: error.message,
      days,
      reason,
    });
    return null;
  }

  const status = parseBanStatus(data);
  if (!status.until) {
    console.error('[SUBBU BAN FAILED]', 'apply_self_ban returned no banned_until');
    return null;
  }

  logger.warn('bot.ban_applied', 'Subbu issued a ban.', { days, reason, until: status.until });
  return status.until;
}

export async function POST(request: Request): Promise<NextResponse> {
  const now = Date.now();
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
  if (!isRecord(raw)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  let history: BotTurn[];
  try {
    history = normaliseHistory(raw.messages);
  } catch (error) {
    if (error instanceof BotError) return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const user = await resolveUser(supabase);
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  // 1. Enforcement BEFORE the model is called. A banned member can never reach
  //    Subbu, no matter what the client sends.
  try {
    const ban = await readOwnBan(supabase);
    if (ban) return bannedResponse(ban);
  } catch {
    return NextResponse.json({ error: 'ban_check_failed' }, { status: 500 });
  }

  if (isRateLimited(user.id, now)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    // 2. Image moderation.
    //
    //    The client is not trusted: it could tuck an image into an old turn and
    //    put text last, hoping it reaches the vision model unchecked. So we find
    //    the most recent image in the (already normalised) history, screen it,
    //    and strip every other image before the model sees the conversation.
    //    Only the upload being sent now can reach the vision model.
    const lastImageIndex = history.reduce(
      (last, turn, index) => (turn.role === 'user' && turn.imageUrl ? index : last),
      -1,
    );
    const imageUrl = lastImageIndex >= 0 ? history[lastImageIndex].imageUrl : undefined;

    if (imageUrl) {
      const verdict = await classifyContent({
        contentType: 'chat_media',
        contentText: null,
        contentUrl: imageUrl,
      });

      // No verdict means the classifier is unconfigured or down. We must not
      // punish on an outage (a provider failure is not evidence), but we also
      // must not hand an unscreened image to the bot.
      if (!verdict) {
        return NextResponse.json(
          {
            error: 'moderation_unavailable',
            message: 'Image moderation is unavailable right now. Please try again shortly.',
          },
          { status: 503 },
        );
      }

      const explicit =
        verdict.flagged &&
        (verdict.categories.includes('nudity') || verdict.categories.includes('underage'));

      if (explicit) {
        const reason = verdict.categories.includes('underage') ? 'underage_image' : 'explicit_image';
        const until = await persistBan(supabase, SUBBU_IMAGE_BAN_DAYS, reason);
        if (!until) return NextResponse.json({ error: 'ban_failed' }, { status: 500 });
        return bannedResponse({ until, reason });
      }
    }

    const safeHistory: BotTurn[] = imageUrl
      ? history.map((turn, index) =>
          index === lastImageIndex ? turn : { ...turn, imageUrl: undefined },
        )
      : history;

    // 3. Talk to Subbu.
    const result = await chatWithSubbu(safeHistory);
    if (!result.reply) throw new Error('No reply generated');

    // 4. Text moderation. Subbu cannot write to the database; it can only emit
    //    the fixed flag. We parse it here and apply a real 2-day ban.
    const flag = parseBanFlag(result.reply);
    if (flag) {
      const until = await persistBan(supabase, flag.days, flag.reason);
      if (!until) return NextResponse.json({ error: 'ban_failed' }, { status: 500 });
      return bannedResponse({ until, reason: flag.reason });
    }

    return NextResponse.json({ reply: result.reply }, { status: 200 });

  } catch (error) {
    // One mapper decides the status: client errors stay 4xx, a misconfiguration
    // is a 500, a throttled provider is a retryable 503, and only a genuine
    // upstream failure is a 502. The provider's raw body never reaches the
    // client — it is logged here (redacted) for the operator instead.
    const failure = botFailureFromError(error);
    const diagnostic =
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    // Requested Vercel-log marker. The value is a sanitized string, never the
    // raw error object (which can carry a provider response body).
    console.error('CHATBOT API ERROR:', diagnostic);
    logger.error('bot.failed', 'Subbu request failed.', {
      ...errorContext(error),
      status: failure.status,
      code: failure.error,
      category: error instanceof BotError ? error.category : null,
    });
    return NextResponse.json(
      { error: failure.error, message: failure.message },
      { status: failure.status }
    );
  }
}
