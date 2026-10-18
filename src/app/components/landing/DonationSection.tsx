'use client';

import { useState } from 'react';

const PRESET_AMOUNTS = [5, 10, 25, 50, 100, 250];

export default function DonationSection() {
  const [frequency, setFrequency] = useState<'one-time' | 'monthly'>('one-time');
  const [amount, setAmount] = useState<number | string>(10);
  const [currency, setCurrency] = useState<'EUR' | 'USD'>('EUR');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDonate = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/donate/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency, frequency }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <section className="w-full max-w-3xl mx-auto px-6 py-16">
      <div className="bg-[#1A1520] border border-white/10 rounded-3xl p-8 md:p-12 shadow-2xl">
        
        {/* Header */}
        <div className="text-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Support Mettivo!
          </h2>
          <p className="text-gray-400 text-sm md:text-base max-w-xl mx-auto leading-relaxed">
            Your support enables developers to work on adding new features, fix bugs, 
            and keep our community safe and ad-free.
          </p>
          <p className="text-rose-400 font-medium mt-4 text-sm">
            Every donation counts. Thank you!
          </p>
        </div>

        {/* Frequency Toggle */}
        <div className="flex justify-center mb-8">
          <div className="bg-black/40 p-1 rounded-full flex gap-1 border border-white/5">
            <button
              onClick={() => setFrequency('monthly')}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                frequency === 'monthly'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setFrequency('one-time')}
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all ${
                frequency === 'one-time'
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              One-time
            </button>
          </div>
        </div>

        {/* Amount Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(amt)}
              className={`py-4 rounded-xl border text-lg font-semibold transition-all ${
                Number(amount) === amt
                  ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                  : 'border-white/10 bg-white/5 text-white hover:border-white/30'
              }`}
            >
              €{amt}
            </button>
          ))}
        </div>

        {/* Custom Amount & Currency */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-grow">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">
              {currency === 'EUR' ? '€' : '$'}
            </span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Custom Amount"
              min="1"
              className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-10 pr-4 text-white focus:outline-none focus:border-rose-500 transition-colors"
            />
          </div>
          
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as 'EUR' | 'USD')}
            className="bg-black/40 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-rose-500 appearance-none min-w-[100px] cursor-pointer"
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-rose-500 text-sm text-center mb-4 bg-rose-500/10 py-2 rounded-lg border border-rose-500/20">
            {error}
          </div>
        )}

        {/* Donate Button */}
        <button
          onClick={handleDonate}
          disabled={loading || !amount || Number(amount) < 1}
          className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 text-lg shadow-lg shadow-rose-600/20"
        >
          {loading ? (
            <span className="animate-pulse">Redirecting to Stripe...</span>
          ) : (
            <>
              Donate {frequency === 'monthly' ? 'Monthly' : ''} ❤️
            </>
          )}
        </button>

        <p className="text-center text-xs text-gray-500 mt-6 flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
          Secure payment powered by Stripe
        </p>
      </div>
    </section>
  );
}