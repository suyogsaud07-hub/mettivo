import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * `POST /api/push/send`
 *
 * Sends a Web Push notification to a recipient's devices. Called two ways:
 *
 * 1. From the database trigger (pg_net) — authenticated via the shared
 *    `PUSH_SERVER_SECRET` sent in the `Authorization: Bearer <secret>` header.
 *    Body: { event_type, recipient_id, actor_id, title, body, url, tag }
 *
 * 2. From the frontend (legacy message flow) — authenticated via the Supabase
 *    session. Body: { match_id, sender_id, preview }
 *
 * The VAPID private key must remain server-side. The browser only ever sees
 * the public key.
 *
 * Required env vars (server-side only):
 *   PUSH_SERVER_SECRET      shared secret for database-triggered calls
 *   VAPID_PRIVATE_KEY       base64 private key
 *   VAPID_EMAIL             mailto contact for VAPID
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY
 */

export const dynamic = 'force-dynamic';

// Configure web-push with VAPID details from env.
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL || 'mailto:noreply@mettivo.local';
const pushServerSecret = process.env.PUSH_SERVER_SECRET;

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

/**
 * Authenticates a database-triggered call using the shared secret.
 * Returns null when unauthenticated.
 */
function authenticateServer(request: Request): boolean {
  if (!pushServerSecret) return false;
  const auth = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${pushServerSecret}`;
  return auth === expected;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!vapidPrivateKey) {
    return failure('push_notifications_not_configured', 503);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let body: {
    event_type?: 'like' | 'follow' | 'message';
    recipient_id?: string;
    actor_id?: string;
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
    match_id?: string;
    sender_id?: string;
    preview?: string;
  };

  try {
    body = await request.json();
  } catch {
    return failure('invalid_request', 400);
  }

  // -------------------------------------------------------------------------
  // Authentication: database trigger (shared secret) OR frontend (session).
  // -------------------------------------------------------------------------
  const isServerCall = authenticateServer(request);

  if (!isServerCall && !user) {
    return failure('unauthenticated', 401);
  }

  // -------------------------------------------------------------------------
  // Resolve recipient + payload.
  // -------------------------------------------------------------------------
  const eventType = body.event_type;
  let recipientId = body.recipient_id;
  let actorId = body.actor_id;

  let title: string;
  let messageBody: string;
  let url: string;
  let tag: string;

  if (isServerCall && eventType && recipientId) {
    // Database-triggered call: use the explicit event fields.
    if (!['like', 'follow', 'message'].includes(eventType)) {
      return failure('invalid_event_type', 400);
    }

    // A database trigger must never notify the actor themselves.
    if (actorId && actorId === recipientId) {
      return failure('actor_is_recipient', 400);
    }

    const eventConfigs: Record<string, { title: string; body: string; tag: string }> = {
      like: {
        title: 'New Like on METTIVO',
        body: 'Someone is interested in your profile.',
        tag: 'mettivo-like',
      },
      follow: {
        title: 'New Follower',
        body: 'Someone just followed you on METTIVO.',
        tag: 'mettivo-follow',
      },
      message: {
        title: 'New Message',
        body: 'You have a new message.',
        tag: 'mettivo-message',
      },
    };

    const cfg = eventConfigs[eventType];
    title = cfg.title;
    messageBody = cfg.body;
    tag = cfg.tag;
    url = body.url || `/notifications`;
  } else if (user && body.match_id && body.sender_id) {
    // Legacy frontend flow: resolve recipient from the match.
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .select('user_a, user_b')
      .eq('id', body.match_id)
      .maybeSingle();

    if (matchError || !match) {
      return failure('match_not_found', 404);
    }

    const resolvedRecipient =
      match.user_a === body.sender_id ? match.user_b : match.user_a;

    if (!resolvedRecipient || resolvedRecipient === body.sender_id) {
      return failure('no_recipient', 400);
    }

    // Only allow the sender of the message to trigger this flow.
    if (body.sender_id !== user.id) {
      return failure('unauthorized_sender', 403);
    }

    title = 'New Message';
    messageBody = body.preview || 'You have a new message on Mettivo.';
    tag = 'mettivo-message';
    url = `/chat/${body.match_id}`;
    recipientId = resolvedRecipient;
    actorId = body.sender_id;
  } else {
    return failure('missing_recipient_or_match', 400);
  }

  // -------------------------------------------------------------------------
  // Look up the recipient's push subscriptions.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Build the payload. Never include private message content.
  // -------------------------------------------------------------------------
  const payload = JSON.stringify({
    title,
    body: messageBody,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    url,
    tag,
    renotify: true,
    requireInteraction: false,
    data: {
      url,
      tag,
      actor_id: actorId ?? null,
    },
  });

  // -------------------------------------------------------------------------
  // Deliver to all of the recipient's devices (partial failures tolerated).
  // -------------------------------------------------------------------------
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

  const sent = results.filter((r) => r.status === 'fulfilled').length;

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

  return NextResponse.json({ ok: true, sent, recipient_id: recipientId });
}
