'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { supabase } from '@/lib/supabase';
import InstallButton from '@/app/components/InstallButton';
import HeaderLanguageDropdown from '@/app/components/HeaderLanguageDropdown';
import MobileDrawer from '@/app/components/MobileDrawer';
import RibbonLogo from '@/app/components/RibbonLogo';
import FounderLetterLink from '@/app/components/FounderLetterLink';
import IntroSplash from '@/components/hero/IntroSplash';

const DONATE_HREF = '/donate';
const INTRO_SEEN_KEY = 'mettivo_intro_seen';

export default function LandingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Auth initialisation state.
  // - 'checking'   : session is being resolved (render splash, no flash).
  // - 'authenticated': an active session exists (splash, then redirect).
  // - 'unauthenticated': no session (render the marketing landing page).
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isIntroComplete, setIsIntroComplete] = useState(true);
  const introDoneRef = useRef(false);

  const authListenerRef = useRef<ReturnType<typeof supabase.auth.onAuthStateChange> | null>(null);

  // Resolve the session once on mount, then listen for auth changes.
  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setAuthState(data.session ? 'authenticated' : 'unauthenticated');
      setIsLoggedIn(!!data.session);
    }

    resolveSession();

    // Persist the redirect decision across auth events so a SIGNED_IN event
    // (e.g. returning from an OAuth callback) always lands on /discover.
    const listener = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const signedIn = event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED';
      setAuthState(signedIn ? 'authenticated' : 'unauthenticated');
      setIsLoggedIn(!!session);
      if (signedIn && session) {
        // Use replace so the landing page never enters the history stack and
        // the back button never returns the member to it.
        void router.replace('/discover');
      } else if (event === 'SIGNED_OUT') {
        setAuthState('unauthenticated');
        setIsLoggedIn(false);
      }
    });

    authListenerRef.current = listener;

    return () => {
      cancelled = true;
      if (listener?.data?.subscription?.unsubscribe) {
        listener.data.subscription.unsubscribe();
      }
    };
  }, [router]);

  const handleGetStarted = useCallback(() => {
    if (isLoggedIn) {
      router.replace('/discover');
    } else {
      router.push('/auth');
    }
  }, [isLoggedIn, router]);

  const handleIntroDone = useCallback(() => {
    if (introDoneRef.current) return;
    introDoneRef.current = true;
    try {
      window.sessionStorage.setItem(INTRO_SEEN_KEY, '1');
    } catch {
      // Ignore: the intro simply plays again next load.
    }
    setIsIntroComplete(true);
  }, []);

  // Online / offline state (kept from the original implementation).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ========================================================================
  // RENDER
  // While the session is still being resolved we render a branded splash so
  // the marketing page never flashes for an authenticated member. Once the
  // session is known we either show the splash (then redirect) or the landing
  // page.
  // ========================================================================
  if (authState === 'checking') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#131017]">
        <div className="w-16 h-16 rounded-full border-4 border-[#D4B18A]/40 border-t-[#D4B18A] animate-spin" />
      </div>
    );
  }

  if (authState === 'authenticated') {
    // Authenticated member: show the branded splash, then redirect to /discover.
    // IntroSplash respects sessionStorage so returning members skip the full
    // animation and land in the app quickly.
    return (
      <IntroSplash
        onDone={() => {
          void router.replace('/discover');
        }}
      />
    );
  }

  // ========================================================================
  // MARKETING LANDING PAGE (unauthenticated)
  // ========================================================================
  return (
    <div className="relative isolate min-h-screen flex flex-col overflow-x-hidden bg-[#17121C] text-[#F2E9E4] font-sans antialiased">
      {/* ============================== TOP NAV ============================== */}
      <nav className="fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-5">
          <div className="flex justify-between items-center">
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

            <div className="flex items-center gap-3">
              <HeaderLanguageDropdown />
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                className="w-11 h-11 rounded-2xl bg-[#29202D] border border-white/15 shadow-xl flex items-center justify-center hover:bg-[#3a303d] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A]"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Offline banner (shown when logged-in users open the app while offline). */}
      {!isOnline && isLoggedIn && (
        <div className="sticky top-0 z-[60] px-6 py-2 text-center bg-[#1C1822] border-b border-[#34283F] text-xs text-[#FCA5B5]">
          You are offline — cached data may be shown.
        </div>
      )}

      {/* ============================== HERO ============================== */}
      <main className="flex-1 flex flex-col items-center justify-center pt-24 pb-16 text-center px-6">
        <div className="max-w-xl w-full">
          <div className="font-serif font-black text-4xl sm:text-5xl md:text-6xl leading-[1.15] text-[#F2E9E4] mb-10">
            Meet your
            <br />
            kind of
            <br />
            <span className="font-serif italic text-[#D4B18A]">people</span>
            <span className="text-[#4A1828]">.</span>
          </div>

          <div className="max-w-65 w-full flex flex-col gap-4 mx-auto">
            <div className="flex flex-col gap-1 leading-tight">
              <p className="text-[#F2E9E4] text-xs">
                Someone on Mettivo might give you butterflies.
              </p>
              <p className="text-[#D4B18A] font-semibold tracking-wider uppercase leading-none text-xs">
                FIND OUT WHO &darr;
              </p>
            </div>

            <div className="group w-full">
              {/* SMART ROUTING BUTTON */}
              <button
                type="button"
                onClick={handleGetStarted}
                className="group w-full inline-flex items-center justify-center gap-1 py-3.5 px-6 rounded-full bg-[#D4B18A] text-[#17121C] text-sm font-bold tracking-tight uppercase shadow-lg shadow-[#D4B18A]/35 transition-all hover:bg-[#E4C9A0] hover:shadow-[#D4B18A]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17121C]"
                data-testid="landing-primary-cta"
              >
                {isLoggedIn ? 'Go to App' : t('get_started')}
                <span className="group-hover:translate-x-1 transition-transform inline-block ml-0.5">
                  &rarr;
                </span>
              </button>
            </div>

            <Link
              href={DONATE_HREF}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-6 rounded-full bg-[#29202D] border border-[#D4B18A]/60 text-[#D4B18A] text-sm font-bold tracking-tight uppercase transition-all hover:bg-[#D4B18A]/10 hover:text-[#F2E9E4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A]"
              data-testid="landing-donate-cta"
            >
              Donate to Mettivo
            </Link>

            <InstallButton />
          </div>
        </div>
      </main>

      <footer className="flex justify-center items-center px-6 py-16 text-xs opacity-70 text-[#F2E9E4]">
        <p className="text-center">
          All photos are of models and used for illustrative purposes only &bull; Mettivo &copy; 2026
        </p>
      </footer>

      <FounderLetterLink variant="corner" />
      <MobileDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {!isIntroComplete && <IntroSplash onDone={handleIntroDone} />}
    </div>
  );
}
