import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Donation checkout — the redirect contract.
 *
 * The landing page's job after "Donate ❤️" is to obtain a Stripe Checkout URL
 * and send the visitor to it. This suite pins that contract for every preset
 * amount, a custom amount, both frequencies and all three currencies, and pins
 * the failure modes (missing key, malformed body, out-of-range amount, provider
 * without a URL) so a misconfiguration can never silently look like success.
 *
 * `stripe` is mocked: the tests never perform network I/O and never handle real
 * key material.
 */

const stripeMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  create: vi.fn<(...args: unknown[]) => Promise<{ url: string | null }>>(),
}));

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: stripeMock.create } };
    constructor(key: string) {
      stripeMock.constructor(key);
    }
  },
}));

import { POST } from '@/app/api/donate/checkout/route';

const PRESET_AMOUNTS = [5, 10, 25, 50, 100, 250];

function post(body: unknown, raw = false): Promise<Response> {
  return POST(
    new Request('https://mettivo.test/api/donate/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? String(body) : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  stripeMock.constructor.mockClear();
  stripeMock.create.mockReset();
  stripeMock.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

describe('POST /api/donate/checkout', () => {
  it('refuses with 503 when the secret key is not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const response = await post({ amount: 25, currency: 'EUR', frequency: 'one-time' });
    expect(response.status).toBe(503);
    expect(stripeMock.create).not.toHaveBeenCalled();
  });

  it('refuses malformed JSON with 400', async () => {
    const response = await post('not json', true);
    expect(response.status).toBe(400);
  });

  it('rejects non-numeric, zero and over-limit amounts with 400', async () => {
    for (const amount of ['abc', 0, -5, 50_001]) {
      const response = await post({ amount, currency: 'EUR', frequency: 'one-time' });
      expect(response.status, `amount=${String(amount)}`).toBe(400);
    }
    expect(stripeMock.create).not.toHaveBeenCalled();
  });

  it('returns a checkout URL for every preset amount', async () => {
    for (const amount of PRESET_AMOUNTS) {
      stripeMock.create.mockClear();
      const response = await post({ amount, currency: 'EUR', frequency: 'one-time' });
      expect(response.status, `amount=${amount}`).toBe(200);
      const body = (await response.json()) as { url?: string };
      expect(body.url, `amount=${amount}`).toBe(
        'https://checkout.stripe.com/c/pay/cs_test_123'
      );
    }
  });

  it('creates a one-time payment for a preset amount with billing address required', async () => {
    await post({ amount: 25, currency: 'EUR', frequency: 'one-time' });

    const params = stripeMock.create.mock.calls[0][0] as {
      mode: string;
      line_items: { price_data: { currency: string; unit_amount: number } }[];
      billing_address_collection: string;
      success_url: string;
      cancel_url: string;
    };

    expect(params.mode).toBe('payment');
    expect(params.line_items[0].price_data).toMatchObject({ currency: 'eur', unit_amount: 2500 });
    expect(params.line_items[0].price_data).not.toHaveProperty('recurring');
    expect(params.billing_address_collection).toBe('required');
    expect(params.success_url).toContain('https://mettivo.test/auth?donation=success');
    expect(params.cancel_url).toBe('https://mettivo.test/donate?donation=canceled');
  });

  it('creates a monthly subscription for a custom amount', async () => {
    const response = await post({ amount: 12.5, currency: 'EUR', frequency: 'monthly' });

    expect(response.status).toBe(200);
    const params = stripeMock.create.mock.calls[0][0] as {
      mode: string;
      line_items: { price_data: { unit_amount: number; recurring?: { interval: string } } }[];
      metadata: { frequency: string };
    };
    expect(params.mode).toBe('subscription');
    expect(params.line_items[0].price_data.unit_amount).toBe(1250);
    expect(params.line_items[0].price_data.recurring).toEqual({ interval: 'month' });
    expect(params.metadata.frequency).toBe('monthly');
  });

  it('normalises NPR and USD to lower-case minor units', async () => {
    await post({ amount: 100, currency: 'NPR', frequency: 'one-time' });
    await post({ amount: 100, currency: 'USD', frequency: 'one-time' });

    const first = stripeMock.create.mock.calls[0][0] as {
      line_items: { price_data: { currency: string; unit_amount: number } }[];
    };
    const second = stripeMock.create.mock.calls[1][0] as {
      line_items: { price_data: { currency: string; unit_amount: number } }[];
    };
    expect(first.line_items[0].price_data).toMatchObject({ currency: 'npr', unit_amount: 10_000 });
    expect(second.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 10_000 });
  });

  it('constructs Stripe with the server secret key', async () => {
    await post({ amount: 5, currency: 'EUR', frequency: 'one-time' });
    expect(stripeMock.constructor).toHaveBeenCalledWith('sk_test_dummy');
  });

  it('answers 502 when Stripe returns no checkout URL', async () => {
    stripeMock.create.mockResolvedValue({ url: null });
    const response = await post({ amount: 5, currency: 'EUR', frequency: 'one-time' });
    expect(response.status).toBe(502);
  });
});
