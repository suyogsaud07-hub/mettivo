'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import InstallButton from '@/app/components/InstallButton';
import Logo from '@/components/Logo';
import { useLanguage } from '../context/LanguageContext';
import { Language } from '@/lib/translations';
import { supabase } from '@/lib/supabase';

/**
 * The landing page is for EVERYONE, including signed-in members.
 *
 * It used to call `supabase.auth.getSession()` on mount and immediately
 * `router.replace()` a signed-in visitor to `/profile` or `/discover`. That made
 * the page unreachable for members — pressing Back from the app bounced you
 * straight out again — and it was one half of a redirect cycle with the auth
 * screen, which redirected an authenticated visitor back into the app.
 *
 * There is NO automatic navigation here. A signed-in member can read the landing
 * page and decides for themselves what to open.
 *
 * THE CALL TO ACTION
 *   The primary sandy-gold button is "Let's get started" and it ALWAYS points at
 *   the signup/auth surface (`/signup`), for a signed-out visitor and for a
 *   member with a live session alike. It deliberately does NOT send anyone
 *   straight into onboarding or the dashboard:
 *
 *     - a brand-new visitor must meet the full signup/login surface first
 *       (email, Google, Facebook, Twitter, Discord, phone) — see `AuthPanel`;
 *     - a member who is half-onboarded must be able to sign out or keep a route
 *       back to the public pages instead of being churned through `/profile`;
 *     - the decision "dashboard or finish onboarding" belongs to exactly one
 *       place, the gate at `/profile`, and only after an explicit choice.
 *
 *   A signed-in member therefore gets a SECOND, clearly-labelled link into the
 *   app below the primary button. It is a deliberate click, never automatic, so
 *   the landing page stays reachable and Back keeps working.
 */

/**
 * The one destination of the primary call to action.
 *
 * `/signup` renders the same `AuthPanel` as `/auth` (one component, both
 * routes), so this is also the login surface: the panel opens in Sign Up mode
 * with a Log In toggle. Pointing at `/signup` rather than bouncing to `/profile`
 * is the fix — a new account meets the auth screen, not the onboarding wizard.
 */
const SIGNUP_HREF = '/signup';

/**
 * The signed-in member's explicit route into the app.
 *
 * `/profile` is the onboarding gate: it reads `onboarding_completed` and routes
 * to `/profile/dashboard` or `/profile/edit`. Keeping the decision there means
 * the landing page cannot drift from the gate.
 */
const DASHBOARD_HREF = '/profile';

const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ne', name: 'Nepali (नेपाली)' },
  { code: 'hi', name: 'Hindi (हिन्दी)' },
  { code: 'es', name: 'Spanish (Español)' },
  { code: 'fr', name: 'French (Français)' },
];

export default function LandingPage() {
  const { language, changeLanguage, t } = useLanguage();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  /**
   * Whether a member has a live session.
   *
   * Used for exactly one thing: whether to offer the secondary, explicit link
   * into the app. It never changes where the primary CTA goes.
   *
   * Starts `false` so the server and first client render agree (the signed-out
   * state), and is corrected in an effect. Deciding this during render would be
   * a hydration mismatch.
   */
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let isMounted = true;

    /**
     * `getSession()` reads the cookie locally — it does not call the Auth
     * server, so this cannot block the landing page behind a network round trip.
     * The session is already validated and refreshed by the middleware.
     */
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (isMounted) setIsSignedIn(Boolean(session));
      })
      .catch((err: unknown) => {
        // A failure here must never strand the page: stay signed-out.
        console.error('[landing] session lookup failed:', err);
      });

    // A sign-out in another tab should stop this page claiming a session.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) setIsSignedIn(Boolean(session));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * The primary CTA never changes target. It is the signup/auth surface for
   * everyone, which is what makes "Let's get started" mean the same thing to a
   * logged-out visitor and to a brand-new account that has not finished
   * onboarding: both meet the full set of sign-in options rather than being
   * pushed into an app they have not chosen to enter.
   */
  const primaryHref = SIGNUP_HREF;
  const primaryLabel = t('get_started');

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' as const },
    loaderContainer: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '20px' },
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 30px', zIndex: 50 },
    logoWrapper: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoText: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
    logoTitle: { fontSize: '16px', fontWeight: '800', color: '#F2E9E4', letterSpacing: '4px', lineHeight: '1' },
    logoSubtitle: { fontSize: '8px', fontWeight: '600', color: '#B58A83', letterSpacing: '2px', lineHeight: '1' },
    langBtn: { backgroundColor: 'transparent', border: 'none', color: '#F2E9E4', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' },
    langDropdown: { position: 'absolute' as const, top: '60px', right: '20px', backgroundColor: '#1C1822', border: '1px solid #4A1828', borderRadius: '12px', padding: '8px', zIndex: 100, width: '220px', maxHeight: '300px', overflowY: 'auto' as const },
    langItem: { padding: '12px', fontSize: '13px', color: '#F2E9E4', cursor: 'pointer', borderRadius: '8px', textAlign: 'center' as const },
    main: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' as const, zIndex: 10 },
    title: { fontSize: '48px', fontWeight: '800', color: '#F2E9E4', marginBottom: '8px', letterSpacing: '-1px', lineHeight: '1.2' },
    subtitle: { fontSize: '24px', fontWeight: '500', color: '#D4B18A', marginBottom: '16px' },
    description: { fontSize: '15px', color: '#B58A83', maxWidth: '320px', marginBottom: '40px', lineHeight: '1.5' },
    buttonContainer: { width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    primaryBtn: { backgroundColor: '#D4B18A', color: '#17121C', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    /**
     * The signed-in member's way into the app. Outlined, not gold: the gold
     * button belongs to "Let's get started" and only to it.
     */
    secondaryBtn: { backgroundColor: 'transparent', color: '#D4B18A', padding: '14px', borderRadius: '30px', fontSize: '14px', fontWeight: '600', border: '1px solid #4A1828', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: '#B58A83' }
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div style={styles.logoWrapper}>
          <Logo variant="mark" width={44} alt="" />
          <div style={styles.logoText}>
            <span style={styles.logoTitle}>METTIVO</span>
            <span style={styles.logoSubtitle}>YOUR NEXT CONNECTION</span>
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <button style={styles.langBtn} onClick={() => setLangMenuOpen(!langMenuOpen)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          {langMenuOpen && (
            <div style={styles.langDropdown}>
              {LANGUAGES.map((lang, idx) => (
                <div 
                  key={`${lang.code}-${idx}`} 
                  style={{ ...styles.langItem, backgroundColor: language === lang.code ? '#4A1828' : 'transparent' }} 
                  onClick={() => { changeLanguage(lang.code); setLangMenuOpen(false); }}
                >
                  {lang.name}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.main}>
        {/*
          The full brand lockup — mark, wordmark and tagline as one piece of
          artwork — is the page's brand statement. It is a single component that
          scales from a 220px phone to a full-width desktop, so there is no
          breakpoint-specific markup to keep in sync.
        */}
        <Logo
          variant="lockup"
          width="min(78vw, 300px)"
          alt="Mettivo — Your Next Connection"
          style={{ marginBottom: '24px' }}
        />
        <h1 style={styles.title}>
          {t('welcome')}
        </h1>
        <h2 style={styles.subtitle}>
          {t('subtitle')}
        </h2>
        <p style={styles.description}>
          {t('description')}
        </p>

        <div style={styles.buttonContainer}>
          {/*
            The primary CTA always opens the signup/auth surface. No automatic
            redirect: a signed-out visitor and a half-onboarded member both get
            the full choice of sign-in methods here.
          */}
          <Link href={primaryHref} style={styles.primaryBtn} data-testid="landing-primary-cta">
            {primaryLabel}
          </Link>

          {/*
            Signed in: an explicit, clearly-labelled way into the app. This is
            the ONLY route from this page to `/profile`, and it exists so a
            member is never trapped on the landing page and never bounced off it
            either. The gate at `/profile` then decides dashboard vs onboarding.
          */}
          {isSignedIn && (
            <Link
              href={DASHBOARD_HREF}
              style={styles.secondaryBtn}
              data-testid="landing-dashboard-link"
            >
              {t('go_to_dashboard')}
            </Link>
          )}

          <InstallButton />
        </div>
      </div>

      <div style={styles.footer}>
        <p>{t('footer_text')}</p>
        <p style={{ fontSize: '11px', marginTop: '8px', opacity: 0.7 }}>© 2026 Mettivo. All rights reserved.</p>
      </div>
    </div>
  );
}
