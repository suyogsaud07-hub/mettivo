import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * `POST /api/push/send`
 *
 * Sends a Web Push notification to the other participant in a match when a
 * new message is inserted. Called by the frontend after a message send, or by
 * any server process that learns about a new message.
 *
 * Body: { match_id, sender_id, preview }
 *
 * The VAPID keys must be set in .env.local:
 *   VAPID_PRIVATE_KEY=<base64 private key>
 *   VAPID_EMAIL=mailto:you@example.com
 */

export const dynamic = 'force-dynamic';

// Configure web-push with VAPID details from env.
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:noreply@mettivo.local';

if (vapidPrivateKey) {
  webpush.setVapidDetails(
    vapidEmail,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
    vapidPrivateKey
  );
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
  if (!vapidPrivateKey) {
    return failure('push_notifications_not_configured', 503);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return failure('unauthenticated', 401);
  }

  let body: { match_id: string; sender_id: string; preview?: string };
  try {
    body = await request.json();
  } catch {
    return failure('invalid_request', 400);
  }

  const { match_id, sender_id, preview } = body ?? {};
  if (!match_id || !sender_id) {
    return failure('missing_match_id_or_sender_id', 400);
  }

  // Find the match and the other participant (not the sender).
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('user_a, user_b')
    .eq('id', match_id)
    .maybeSingle();

  if (matchError || !match) {
    return failure('match_not_found', 404);
  }

  const recipientId =
    match.user_a === sender_id ? match.user_b : match.user_a;

  if (!recipientId || recipientId === sender_id) {
    return failure('no_recipient', 400);
  }

  // Look up the recipient's push subscriptions.
  const { data: subscriptions, error: subError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', recipientId);

  if (subError) {
    console.error('[push/send] subscription lookup failed:', subError.message);
    return failure('could_not_lookup_subscriptions', 500);
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({
    title: 'New message',
    body: preview || 'You have a new message on Mettivo.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    url: `/chat/${match_id}`,
    data: {
      url: `/chat/${match_id}`,
      match_id,
      sender_id,
    },
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      )
    )
  );

  const sent = results.filter(
    (r) => r.status === 'fulfilled'
  ).length;

  const failed = results.filter((r) => r.status === 'rejected');
  for (const r of failed) {
    const err = (r as PromiseRejectedResult).reason;
    console.error('[push/send] failed to send to subscription:', err?.statusCode, err?.message);
    // Clean up expired/invalid subscriptions.
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      const endpoint = (subscriptions as { endpoint: string }[])[
        failed.indexOf(r)
      ]?.endpoint;
      if (endpoint) {
        void supabase
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
    }
  }

  return NextResponse.json({ ok: true, sent });
}
