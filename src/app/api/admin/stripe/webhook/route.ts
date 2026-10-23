/**
 * M32 — Stripe webhook boundary.
 *
 * TRUST MODEL
 *   1. Stripe signs the raw request body; `constructEvent` proves the payload
 *      came from Stripe using STRIPE_WEBHOOK_SECRET.
 *   2. The same secret authenticates the `record_payment_event` RPC. There is
 *      no service-role key in this repository, and the RPC is the only writer.
 *   3. This route never creates or edits a subscription directly: the database
 *      validates the plan code and the allowed status values.
 *
 * The event ledger stores a minimal pseudonymous summary. Full Stripe objects
 * (billing address, card details, receipts) are deliberately discarded.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
]);

const ALLOWED_STATUS = new Set([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function uuidOrNull(value: unknown): string | null {
  const candidate = text(value, 64);
  if (!candidate) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function metadata(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry.slice(0, 500);
  }
  return result;
}

function firstPriceMetadata(object: Record<string, unknown>): Record<string, string> {
  const items = isRecord(object['items']) ? object['items'] : null;
  const data = items && Array.isArray(items['data']) ? items['data'] : [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const price = isRecord(item['price']) ? item['price'] : null;
    if (price) return metadata(price['metadata']);
  }
  return {};
}

function subscriptionStatus(value: unknown): string | null {
  const status = text(value, 32);
  if (!status) return null;
  if (status === 'incomplete_expired') return 'expired';
  return ALLOWED_STATUS.has(status) ? status : null;
}

function epochOrNull(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface EventSummary {
  userId: string | null;
  planCode: string | null;
  amountMinor: number | null;
  refundedMinor: number;
  currency: string | null;
  subscriptionStatus: string | null;
  periodEnd: string | null;
}

function summarise(eventType: string, object: Record<string, unknown>): EventSummary {
  const rootMeta = metadata(object['metadata']);
  const subscriptionDetails = isRecord(object['subscription_details'])
    ? object['subscription_details']
    : null;
  const invoiceMeta = metadata(subscriptionDetails?.['metadata']);
  const priceMeta = firstPriceMetadata(object);

  const userId =
    uuidOrNull(rootMeta['user_id']) ??
    uuidOrNull(invoiceMeta['user_id']) ??
    uuidOrNull(priceMeta['user_id']) ??
    uuidOrNull(object['client_reference_id']);

  const planCode = text(
    rootMeta['plan_code'] ?? invoiceMeta['plan_code'] ?? priceMeta['plan_code'],
    64
  );

  const currency = text(object['currency'], 8)?.toLowerCase() ?? null;

  let amountMinor: number | null = null;
  let refundedMinor = 0;
  let status: string | null = null;
  let periodEnd: string | null = null;

  switch (eventType) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      amountMinor = integer(object['amount_total']);
      break;
    case 'invoice.paid':
      amountMinor = integer(object['amount_paid']);
      break;
    case 'invoice.payment_failed':
      amountMinor = integer(object['amount_due']);
      break;
    case 'charge.refunded':
      amountMinor = integer(object['amount']);
      refundedMinor = integer(object['amount_refunded']) ?? 0;
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      status = subscriptionStatus(object['status']);
      periodEnd = epochOrNull(object['current_period_end']);
      break;
    default:
      break;
  }

  return {
    userId,
    planCode: planCode && /^[a-z0-9_]+$/i.test(planCode) ? planCode : null,
    amountMinor,
    refundedMinor: Math.max(refundedMinor, 0),
    currency,
    subscriptionStatus: status,
    periodEnd,
  };
}

function publicIds(object: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['id', 'customer', 'subscription', 'payment_intent', 'charge'] as const) {
    const value = text(object[key], 200);
    if (value) result[key] = value;
  }
  return result;
}

export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = (process.env['STRIPE_WEBHOOK_SECRET'] ?? '').trim();
  const supabaseUrl = (process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim();
  const anonKey = (process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim();

  if (!webhookSecret || !supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(webhookSecret);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const object = isRecord(event.data.object) ? event.data.object : null;
  if (!object) {
    return NextResponse.json({ error: 'invalid_event_object' }, { status: 400 });
  }

  const summary = summarise(event.type, object);
  const payload = {
    event_id: event.id,
    type: event.type,
    livemode: event.livemode,
    objects: publicIds(object),
    plan_code: summary.planCode,
    subscription_status: summary.subscriptionStatus,
    amount_minor: summary.amountMinor,
    refunded_minor: summary.refundedMinor,
    currency: summary.currency,
  };

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc('record_payment_event', {
      p_secret: webhookSecret,
      p_event_id: event.id,
      p_event_type: event.type,
      p_provider: 'stripe',
      p_user_id: summary.userId,
      p_plan_code: summary.planCode,
      p_amount_minor: summary.amountMinor,
      p_fee_minor: null,
      p_refunded_minor: summary.refundedMinor,
      p_currency: summary.currency,
      p_subscription_status: summary.subscriptionStatus,
      p_period_end: summary.periodEnd,
      p_payload: payload,
    });

    if (error) {
      const status = error.code === '42501' ? 401 : 500;
      return NextResponse.json(
        { error: status === 401 ? 'webhook_secret_mismatch' : 'ledger_write_failed' },
        { status }
      );
    }

    return NextResponse.json({ received: true, result: data });
  } catch {
    return NextResponse.json({ error: 'ledger_unavailable' }, { status: 500 });
  }
}
