'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Mettivo donation section — Bumble-style support block.
 *
 * Renders the "Support Mettivo!" card: billing-frequency toggle, preset and
 * custom amounts, a currency selector, and a "Donate ❤️" call-to-action that
 * creates a Stripe Checkout session and redirects the visitor to the hosted
 * checkout form (Apple Pay, Link and credit/debit card, plus billing address).
 *
 * Stripe is only ever initialised with the *publishable* key
 * (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), which is safe in a browser bundle.
 * The secret key never leaves the server — it lives in `STRIPE_SECRET_KEY` and
 * is used exclusively by `src/app/api/donate/checkout/route.ts`.
 *
 * When Stripe is not configured (no publishable key on the client, or no secret
 * key on the server) the section renders a clear, non-fatal message instead of
 * crashing the landing page.
 */

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/** Singleton: initialised once per page load. null when not configured. */
const stripePromise: Promise<Stripe | null> | null = PUBLISHABLE_KEY
  ? loadStripe(PUBLISHABLE_KEY).then((stripe) => stripe ?? null)
  : null;

type Frequency = 'one-time' | 'monthly';
type Currency = 'EUR' | 'USD' | 'NPR';

const CURRENCY_LABELS: Record<Currency, { code: Currency; symbol: string; label: string }> = {
  EUR: { code: 'EUR', symbol: '€', label: 'EUR €' },
  USD: { code: 'USD', symbol: '$', label: 'USD $' },
  NPR: { code: 'NPR', symbol: '₨', label: 'NPR ₨' },
};

const PRESET_AMOUNTS = [5, 10, 25, 50, 100, 250] as const;

const FREQUENCIES: Frequency[] = ['one-time', 'monthly'];

const AMOUNT_MIN = 1;
const AMOUNT_MAX = 50_000;

export default function DonationSection() {
  const [frequency, setFrequency] = useState<Frequency>('one-time');
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donationStatus, setDonationStatus] = useState<'idle' | 'success' | 'canceled'>('idle');

  const inputRef = useRef<HTMLInputElement>(null);

  const symbol = CURRENCY_LABELS[currency].symbol;

  // Read the query string once on mount so a completed/canceled Stripe redirect
  // lands back on this page and shows a thank-you / canceled message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('donation') === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDonationStatus('success');
      setError(null);
    } else if (params.get('donation') === 'canceled') {
      setDonationStatus('canceled');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const effectiveAmount = (() => {
    if (customAmount.trim() !== '') {
      const parsed = Number(customAmount);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return selectedAmount;
  })();

  const amountIsValid = (() => {
    const value = effectiveAmount;
    return value !== null && value >= AMOUNT_MIN && value <= AMOUNT_MAX;
  })();

  const onSelectAmount = useCallback((amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
    setError(null);
  }, []);

  const onCustomChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    // Allow digits and a single decimal point only.
    if (!/^[0-9]*\.?[0-9]{0,2}$/.test(value) && value !== '') return;
    setCustomAmount(value);
    setSelectedAmount(null);
    setError(null);
  }, []);

  const handleDonate = useCallback(async () => {
    if (!stripePromise) {
      setError('Donations are not configured yet — Stripe is missing on this deployment.');
      return;
    }
    if (!amountIsValid) {
      setError(`Please enter an amount between ${symbol}${AMOUNT_MIN} and ${symbol}${AMOUNT_MAX}.`);
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/donate/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: effectiveAmount,
          currency,
          frequency,
        }),
      });

      const result = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !result.url) {
        setError(result.error ?? 'Could not start checkout. Please try again.');
        setIsLoading(false);
        return;
      }

      // Redirect to the hosted Stripe Checkout form.
      window.location.assign(result.url);
      // This line is only reached if the assignment throws.
    } catch {
      setError('Checkout could not be started. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [currency, frequency, amountIsValid, effectiveAmount, symbol]);

  const reset = () => {
    setSelectedAmount(null);
    setCustomAmount('');
    setCurrency('EUR');
    setFrequency('one-time');
    setError(null);
    setDonationStatus('idle');
    inputRef.current?.focus();
  };

  const isOneTime = frequency === 'one-time';
  const ctaLabel = isOneTime ? 'Donate, just once' : 'Donate monthly';

  // Already showed a thank-you / canceled message: don't render the form again.
  if (donationStatus !== 'idle') {
    const succeeded = donationStatus === 'success';
    return (
      <section className="py-12 md:py-16 px-6">
        <div className="max-w-xl mx-auto">
          <div className="bg-[#29202D] border border-[#3a303d]/60 rounded-2xl p-8 md:p-12 text-center shadow-lg shadow-[#17121C]/40">
            <div
              className="w-14 h-14 rounded-full bg-[#4A1828]/20 flex items-center justify-center mx-auto mb-6 text-[#D4B18A]"
              style={{ boxShadow: '0 0 24px #D4B18A/30' }}
            >
              {succeeded ? '❤️' : '↺'}
            </div>
            <h2 className="text-2xl font-serif font-bold text-[#F2E9E4] mb-3">
              {succeeded ? 'Thank you!' : 'Donation canceled'}
            </h2>
            <p className="text-sm text-[#F2E9E4]/70 mb-6">
              {succeeded
                ? 'Your support helps us keep Mettivo safe, ad-free and full of new features.'
                : 'No payment was taken. You can try again whenever you are ready.'}
            </p>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-transparent border border-[#D4B18A]/50 text-[#D4B18A] text-sm font-medium hover:bg-[#D4B18A]/10 hover:text-[#F2E9E4] transition-colors"
            >
              {succeeded ? 'Donate again' : 'Try again'}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const notConfigured = !PUBLISHABLE_KEY;

  return (
    <section className="py-12 md:py-16 px-6" data-testid="donation-section">
      <div className="max-w-xl mx-auto">
        {/* Not-configured guard: never crashes the page when Stripe is absent. */}
        {notConfigured && (
          <div className="bg-[#29202D] border border-[#4A1828]/40 rounded-2xl p-6 md:p-8 text-center mb-8">
            <h2 className="text-lg font-semibold text-[#F2E9E4] mb-2">Donations not configured</h2>
            <p className="text-sm text-[#F2E9E4]/70">
              Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY` to your environment to
              enable the donation flow.
            </p>
          </div>
        )}

        {/* Donation card. */}
        <div className={`bg-[#29202D] border border-[#3a303d]/50 rounded-2xl p-6 md:p-8 shadow-xl shadow-[#17121C]/50 ${notConfigured ? 'mt-0' : ''}`}>
          {/* Header & tagline. */}
          <div className="mb-8">
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-[#F2E9E4] tracking-tight mb-3">
              Support Mettivo!
            </h2>
            <p className="text-sm md:text-base text-[#F2E9E4]/80 leading-relaxed mb-4">
              Your support enables developers to work on adding new features, fix bugs, and keep our
              community safe and ad-free.
            </p>
            <p className="text-xs text-[#D4B18A] font-medium">Every donation counts. Thank you!</p>
          </div>

          {/* Billing frequency toggle. */}
          <div className="flex items-center gap-1.5 bg-[#17121C]/40 rounded-xl p-1.5 mb-8">
            {FREQUENCIES.map((freq) => {
              const active = frequency === freq;
              return (
                <button
                  key={freq}
                  type="button"
                  onClick={() => {
                    setFrequency(freq);
                    setSelectedAmount(null);
                    setCustomAmount('');
                    setError(null);
                  }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-[#D4B18A] text-[#17121C] shadow-sm'
                      : 'text-[#F2E9E4]/60 hover:text-[#F2E9E4] hover:bg-[#17121C]/30'
                  }`}
                >
                  {freq === 'one-time' ? 'One-time' : 'Monthly'}
                </button>
              );
            })}
          </div>

          {/* Preset amount buttons. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            {PRESET_AMOUNTS.map((amount) => {
              const active = selectedAmount === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => onSelectAmount(amount)}
                  className={`flex flex-col items-center justify-center gap-1 h-16 rounded-xl border text-sm font-medium transition-all duration-150 ${
                    active
                      ? 'border-[#D4B18A] bg-[#D4B18A] text-[#17121C] shadow-[0_0_16px_rgba(212,177,138,0.35)]'
                      : 'border-transparent bg-[#17121C]/30 text-[#F2E9E4]/70 border-[#3a303d]/40 hover:border-[#D4B18A]/40 hover:text-[#F2E9E4] hover:bg-[#17121C]/50'
                  }`}
                >
                  {symbol}{amount}
                </button>
              );
            })}
          </div>

          {/* Custom amount input + currency selector. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
            <label
              htmlFor="donation-custom-amount"
              className="text-sm font-medium text-[#F2E9E4]/90 whitespace-nowrap"
            >
              {ctaLabel}
            </label>
            <div className="flex-1 min-w-0 relative group">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#F2E9E4]/50 text-sm font-medium"
              >
                {symbol}
              </span>
              <input
                id="donation-custom-amount"
                ref={inputRef}
                type="text"
                maxLength={10}
                value={customAmount}
                onChange={onCustomChange}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-[#17121C]/40 border border-[#3a303d]/50 text-[#F2E9E4] text-sm font-medium placeholder-[#F2E9E4]/30 focus:outline-none focus:ring-2 focus:ring-[#D4B18A] focus:border-transparent transition-all"
              />
            </div>
            <select
              value={currency}
              onChange={(event) => setCurrency((event.target.value as Currency))}
              className="w-full sm:w-auto max-w-[150px] py-2.5 rounded-xl bg-[#17121C]/40 border border-[#3a303d]/50 text-[#F2E9E4] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#D4B18A] transition-all cursor-pointer appearance-none"
            >
              {Object.values(CURRENCY_LABELS).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Error / success inline state. */}
          {error && (
            <p className="mb-5 text-xs text-[#F2E9E4]/90 bg-[#4A1828]/20 border border-[#4A1828]/40 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          {/* Donate ❤️ CTA. */}
          <button
            type="button"
            onClick={handleDonate}
            disabled={!amountIsValid || isLoading || notConfigured}
            data-testid="donate-button"
            className={`w-full py-4.5 rounded-xl font-bold text-lg tracking-tight flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
              !amountIsValid || notConfigured
                ? 'bg-[#4A1828]/25 border border-[#4A1828]/50 text-[#F2E9E4]/50'
                : 'bg-[#4A1828] text-[#F2E9E4] shadow-lg shadow-[#4A1828]/40 hover:bg-[#5d2337] hover:shadow-[#4A1828]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#29202D]'
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3.05 1.27-3.5 2.9M6.5 17c0-1.281 1-2.5 3-2.5s3 1.219 3 2.5" />
            </svg>
            Donate ❤️
            {isLoading ? <span className="text-xs">Processing…</span> : null}
          </button>
        </div>
      </div>
    </section>
  );
}
