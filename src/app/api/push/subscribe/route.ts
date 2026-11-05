import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * `POST /api/push/subscribe`
 *
 * Saves a Web Push subscription for the signed-in member. Called by the
 * frontend after `pushManager.subscribe()`. The endpoint, p256dh and auth
 * keys are stored in `public.push_subscriptions` and keyed by `auth.uid()`,
 * so a member can only manage their own subscriptions (RLS enforced).
 */

export const dynamic = 'force-dynamic';

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
            // ignore
          }
        },
      },
    }
  );
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return failure('unauthenticated', 401);
  }

  let body: { endpoint: string; keys: { p256dh: string; auth: string } };
  try {
    body = await request.json();
  } catch {
    return failure('invalid_request', 400);
  }

  const { endpoint, keys } = body ?? {};
  if (
    typeof endpoint !== 'string' ||
    !keys ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string'
  ) {
    return failure('invalid_subscription', 400);
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

  if (error) {
    console.error('[push/subscribe] upsert failed:', error.message);
    return failure('could_not_save_subscription', 500);
  }

  return NextResponse.json({ ok: true });
}
