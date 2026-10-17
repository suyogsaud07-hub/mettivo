'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import InstallButton from '@/app/components/InstallButton';
import HeaderLanguageDropdown from '@/app/components/HeaderLanguageDropdown';
import MobileDrawer from '@/app/components/MobileDrawer';
import RibbonLogo from '@/app/components/RibbonLogo';
import FounderLetterLink from '@/app/components/FounderLetterLink';

/**
 * The public landing page — rebuilt as the Mettivo "Midnight Romance"
 * Bumble-style entry surface.
 *
 * It never reads the session and never redirects: every visitor, signed in or
 * not, sees the same page and is handed to the signup surface by the primary
 * CTA. Local storage is only touched inside effects, so there are no hydration
 * mismatches.
 */

const SIGNUP_HREF = '/signup';

export default function LandingPage() {
  const { t } = useLanguage();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden bg-[#17121C] text-[#F2E9E4] font-sans antialiased"
    >
      {/* ============================== TOP NAV ============================== */}
      <nav className="fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5">
          <div className="flex justify-between items-center">
            {/* Top-left branding: ribbon M mark + wordmark. */}
            <div className="flex items-center gap-3">
              <RibbonLogo width={30} />
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="text-sm font-bold tracking-[3px] text-[#F2E9E4]">
                  METTIVO
                </span>
                <span className="text-[10px] font-semibold tracking-[2.5px] text-[#D4B18A] uppercase">
                  Your Next Connection
                </span>
              </div>
            </div>

            {/* Top-right controls: language dropdown, then hamburger. */}
            <div className="flex items-center gap-3">
              <HeaderLanguageDropdown />
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="w-11 h-11 rounded-2xl bg-[#29202D] border border-white/15 shadow-xl flex items-center justify-center hover:bg-[#3a303d] transition-colors                 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A]"
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
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ============================== HERO ============================== */}
      <main className="flex-1 flex items-center justify-center pt-20 pb-0 text-center px-6">
        <div className="max-w-xl w-full">
          {/* Hero headline: serif, black weight, large. "people" in gold, oxblood period. */}
          <div className="font-serif font-black text-4xl sm:text-5xl md:text-6xl leading-[1.15] text-[#F2E9E4] mb-10">
            Meet your
            <br />
            kind of
            <br />
            <span className="font-serif italic text-[#D4B18A]">people</span>
            <span className="text-[#4A1828]">.</span>
          </div>

          {/* Stacked CTAs: "Get started" (gold) then "Get the app" (surface + gold border). */}
          <div className="max-w-[260px] w-full flex flex-col gap-4">
            <div className="group w-full">
              <Link
                href={SIGNUP_HREF}
                className="group w-full inline-flex items-center justify-center gap-1 py-3.5 px-6 rounded-full bg-[#D4B18A] text-[#17121C] text-sm font-bold tracking-tight uppercase shadow-lg shadow-[#D4B18A]/35 transition-all hover:bg-[#E4C9A0] hover:shadow-[#D4B18A]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17121C]"
                data-testid="landing-primary-cta"
              >
                {t('get_started')}
                <span className="group-hover:translate-x-1 transition-transform inline-block ml-0.5">
                  &rarr;
                </span>
              </Link>
            </div>

            <InstallButton />
          </div>
        </div>
      </main>

      {/* ============================== FOOTER ============================== */}
      <footer className="flex justify-between items-center px-6 py-16 text-xs opacity-70 text-[#F2E9E4]">
        <div className="flex flex-col gap-1 leading-tight">
          <p className="text-[#F2E9E4]">Someone on Mettivo might give you butterflies.</p>
          <p className="text-[#D4B18A] font-semibold tracking-wider uppercase leading-none">
            FIND OUT WHO &darr;
          </p>
        </div>
        <p className="text-[#F2E9E4]">
          All photos are of models and used for illustrative purposes only &bull; Mettivo &copy; 2026
        </p>
      </footer>

      {/* Floating bottom-left entry point to the founder's letter. */}
      <FounderLetterLink variant="corner" />

      {/* Full-screen immersive drawer (mobile hamburger). */}
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
