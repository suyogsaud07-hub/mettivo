/**
 * Mettivo donation checkout — creates a Stripe Checkout Session.
 *
 * SERVER ONLY. The secret key (`STRIPE_SECRET_KEY`) is never sent to the
 * browser; only the publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
 * initialises Stripe.js on the client (docs/CONSTITUTION.md Article 1.5).
 *
 * POST body: { amount, currency, frequency }
 *   amount     — number, minor units of the selected currency (e.g. 5.00)
 *   currency   — 'EUR' | 'USD' | 'NPR'
 *   frequency  — 'one-time' | 'monthly'
 *
 * Responds: { url } — the hosted Stripe Checkout URL the client redirects to.
 *
 * The Checkout form shows Apple Pay, Link and credit/debit card (whichever
 * Stripe enables for the selected currency), plus required billing-address
 * fields (Country, Street, City, Postal Code).
 */

import { NextResponse } from 'next/server';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

interface DonateEnv {
  secretKey: string;
}

/** Reads the server-side Stripe secret from any source (defaults to env). */
function readDonateEnv(
  source: Record<string, string | undefined> = process.env
): DonateEnv {
  return {
    secretKey: (source['STRIPE_SECRET_KEY'] ?? '').trim(),
  };
}

type CheckoutCurrency = 'eur' | 'usd' | 'npr';

function normaliseCurrency(value: string | undefined): CheckoutCurrency {
  const c = (value ?? 'EUR').toUpperCase();
  if (c === 'USD') return 'usd';
  if (c === 'NPR') return 'npr';
  return 'eur';
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = readDonateEnv();
  if (!env.secretKey) {
    return NextResponse.json(
      { error: 'Donations not configured: STRIPE_SECRET_KEY is not set on the server.' },
      { status: 503 }
    );
  }

  let body: { amount?: unknown; currency?: unknown; frequency?: unknown };
  try {
    body = (await request.json()) as { amount?: unknown; currency?: unknown; frequency?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 50_000) {
    return NextResponse.json({ error: 'Amount must be between 1 and 50,000.' }, { status: 400 });
  }

  const currency = normaliseCurrency(typeof body.currency === 'string' ? body.currency : undefined);
  const frequency =
    body.frequency === 'monthly' ? 'monthly' : 'one-time';

  const unitAmount = Math.round(amount * 100); // currency minor units (cents)

  // The origin the customer is redirected back to after checkout.
  const origin = new URL(request.url).origin;

  const stripe = new Stripe(env.secretKey);

  const session = await stripe.checkout.sessions.create({
    mode: frequency === 'monthly' ? 'subscription' : 'payment',
    line_items: [
      {
        price_data: {
          currency,
          product_data: {
            name: 'Support Mettivo!',
            description: frequency === 'monthly' ? 'Monthly donation' : 'One-time donation',
          },
          unit_amount: unitAmount,
          ...(frequency === 'monthly' ? { recurring: { interval: 'month' } } : {}),
        },
        quantity: 1,
      },
    ],
    success_url: `${origin}/?donation=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?donation=canceled`,
    billing_address_collection: 'required',
    metadata: {
      frequency,
      source: 'mettivo-landing',
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}
