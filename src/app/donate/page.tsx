import Link from 'next/link';
import DonationSection from '@/components/landing/DonationSection';

/**
 * `/donate` — the intermediate page between the landing CTA and auth.
 *
 * The "Support Mettivo!" card lived on the landing page; it now has its own
 * destination so a visitor can either donate through Stripe or skip straight to
 * signup/login without paying. Stripe's checkout redirects a successful payment
 * to `/auth` (see `src/app/api/donate/checkout/route.ts`).
 */
export default function DonatePage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#17121C] text-[#F2E9E4] font-sans antialiased">
      <header className="px-6 pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#F2E9E4]/70 hover:text-[#F2E9E4] transition-colors"
        >
          &larr; Back
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <DonationSection
          afterDonate={
            <Link
              href="/auth"
              data-testid="donate-skip"
              className="block w-full text-center py-3.5 rounded-xl border border-[#3a303d]/60 text-[#F2E9E4]/80 text-sm font-medium transition-colors hover:border-[#D4B18A]/50 hover:text-[#F2E9E4]"
            >
              Continue to signup or login without donation
            </Link>
          }
        />
      </main>
    </div>
  );
}
