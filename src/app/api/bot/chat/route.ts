import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { BotError, chatWithSubbu, normaliseHistory, type BotTurn } from '@/lib/bot/subbu';

export const dynamic = 'force-dynamic';

// Chat generation on a cold Groq model can take tens of seconds; Vercel's
// default is too short and surfaces as a 502/timeout. 60 s is the serverless
// ceiling and the budget the provider client allows the upstream fetch.
export const maxDuration = 60;

const MAX_BODY_BYTES = 64_000;
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

  if (isRateLimited(user.id, now)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  try {
    let result = await chatWithSubbu(history);

    // ✅ EXECUTE TOOL CALLS (Automated Punishments)
    if (result.tool_calls && result.tool_calls.length > 0) {
      const toolCall = result.tool_calls[0];
      
      if (toolCall.function.name === 'issue_ban') {
        const args = JSON.parse(toolCall.function.arguments);
        const { target_user_id, duration_days, reason } = args;

        logger.warn('bot.automated_ban', 'Subbu issued a ban.', { target_user_id, duration_days, reason });

        // Calculate ban end date
        const banUntil = new Date();
        banUntil.setDate(banUntil.getDate() + duration_days);

        // 1. Update the target user's profile
        await supabase
          .from('profiles')
          .update({ 
            banned_until: banUntil.toISOString(), 
            ban_reason: reason 
          })
          .eq('id', target_user_id);

        // 2. Feed the tool result back to Subbu so he can reply to the user
        const updatedHistory: BotTurn[] = [
          ...history,
          { role: 'assistant', content: null, tool_calls: result.tool_calls },
          { role: 'tool', content: JSON.stringify({ success: true, message: `User banned for ${duration_days} days.` }), tool_call_id: toolCall.id }
        ];

        result = await chatWithSubbu(updatedHistory);
      }
    }

    if (!result.reply) throw new Error('No reply generated');
    return NextResponse.json({ reply: result.reply }, { status: 200 });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;

    // A malformed request is the client's fault — not an upstream failure.
    if (error instanceof BotError && error.code === 'invalid_request') {
      return NextResponse.json({ error: error.code, message }, { status: 400 });
    }
    // A missing key is a deployment mistake, not a provider outage.
    if (error instanceof BotError && error.code === 'not_configured') {
      logger.error('bot.not_configured', 'Subbu is not configured.');
      return NextResponse.json({ error: error.code, message }, { status: 500 });
    }

    // Everything else is the provider (timeout, 4xx/5xx, unparseable reply) or
    // an unexpected throw. Log the exact failure for Vercel Runtime Logs and
    // hand the reason to the client as `details`.
    console.error('[SUBBU CHAT ERROR]', message, stack);
    logger.error('bot.failed', 'Subbu provider failed.', {
      failure: error instanceof BotError ? error.code : 'unexpected',
      message,
    });
    return NextResponse.json(
      { error: 'upstream_error', details: message, message },
      { status: 502 }
    );
  }
}