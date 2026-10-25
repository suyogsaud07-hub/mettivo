/**
 * Mettivo donation checkout — creates a Stripe Checkout Session.
 *
 * SERVER ONLY. The secret key (`STRIPE_SECRET_KEY`) is never sent to the
 * browser; only the publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
 * initialises Stripe.js on the client (docs/CONSTITUTION.md Article 1.5).
 *
 * POST body: { amount, currency, frequency, displayName? }
 *   amount      — number, in major units of the selected currency (e.g. 5.00)
 *   currency    — 'EUR' | 'USD' | 'NPR'
 *   frequency   — 'one-time' | 'monthly'
 *   displayName — optional public name for the verified supporters wall
 *
 * Responds: { url } — the hosted Stripe Checkout URL the client redirects to.
 *
 * The Checkout form shows Apple Pay, Link and credit/debit card (whichever
 * Stripe enables for the selected currency), plus required billing-address
 * fields (Country, Street, City, Postal Code).
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
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

/**
 * The verified server-side session, when the donor is signed in.
 *
 * Cookies are the same session the browser client writes. This value is used
 * only as opaque Stripe metadata; the browser can never supply it, so a payment
 * cannot be attributed to an account by editing the request body.
 */
async function signedInUserId(): Promise<string | null> {
  const supabaseUrl = (process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '').trim();
  const anonKey = (process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim();
  if (!supabaseUrl || !anonKey) return null;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          // Read-only lookup: the route does not mutate the session.
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    // A direct unit-test call has no Next request scope. Donation still works
    // as an anonymous gift; it simply cannot be attributed to an account.
    return null;
  }
}

/** Optional public name, trimmed and bounded before it reaches Stripe metadata. */
function donorDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 40) : null;
}

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

  let body: {
    amount?: unknown;
    currency?: unknown;
    frequency?: unknown;
    displayName?: unknown;
  };
  try {
    body = (await request.json()) as {
      amount?: unknown;
      currency?: unknown;
      frequency?: unknown;
      displayName?: unknown;
    };
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

  const donorUserId = await signedInUserId();
  const donorName = donorDisplayName(body.displayName);
  const donationMetadata: Record<string, string> = {
    kind: 'donation',
    frequency,
    source: 'mettivo-landing',
  };
  if (donorUserId) donationMetadata['user_id'] = donorUserId;
  if (donorName) donationMetadata['donor_display_name'] = donorName;

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
    // A completed donation hands the member straight to signup/login; a
    // cancel returns them to the donation page so they can try again or skip.
    success_url: `${origin}/auth?donation=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/donate?donation=canceled`,
    billing_address_collection: 'required',
    client_reference_id: donorUserId ?? undefined,
    metadata: donationMetadata,
    // Copies the attribution onto the recurring subscription, so later invoice
    // events can be reconciled to the same donor without trusting the browser.
    ...(frequency === 'monthly'
      ? { subscription_data: { metadata: donationMetadata } }
      : {}),
  });

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}
