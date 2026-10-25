import Link from 'next/link';
import DonationSection from '@/components/landing/DonationSection';
import TopContributors from '@/app/components/landing/TopContributors';

/**
 * `/donate` — the intermediate page between the landing CTA and auth.
 *
 * Donation is optional: the primary landing CTA now goes straight to `/signup`,
 * and this page exists for visitors who choose to support the product. Stripe's
 * checkout redirects a successful payment to `/auth` (see
 * `src/app/api/donate/checkout/route.ts`), while the skip control goes to
 * signup without taking a payment.
 *
 * The Top Contributors wall is a read-only projection of the verified donation
 * ledger — never local state and never an unverified browser claim.
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
              href="/signup"
              data-testid="donate-skip"
              className="block w-full text-center py-3.5 rounded-xl border border-[#3a303d]/60 text-[#F2E9E4]/80 text-sm font-medium transition-colors hover:border-[#D4B18A]/50 hover:text-[#F2E9E4]"
            >
              Continue to signup without donation
            </Link>
          }
        />

        <div className="w-full mt-4">
          <TopContributors />
        </div>
      </main>
    </div>
  );
}
