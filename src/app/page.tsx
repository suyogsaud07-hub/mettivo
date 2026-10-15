'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import InstallButton from '@/app/components/InstallButton';
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
 * The session is now read for exactly one purpose: choosing the call to action.
 * There is NO automatic navigation here. A signed-in member can read the landing
 * page and decides for themselves whether to open their dashboard.
 */

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
   * Whether a member has a live session. Only ever used to pick the CTA.
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
   * Signed-in members go to the onboarding gate at `/profile`, which routes on
   * `onboarding_completed` (finished -> /profile/dashboard, unfinished ->
   * /profile/edit). Letting the gate decide keeps that decision in one place
   * instead of duplicating the rule here, which is what drifted before.
   */
  const primaryHref = isSignedIn ? '/profile' : '/auth';
  const primaryLabel = isSignedIn ? 'Go to Dashboard' : t('get_started');

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
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: '#B58A83' }
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div style={styles.logoWrapper}>
          <svg viewBox="0 0 100 100" style={{ width: '36px', height: '36px', fill: 'none', stroke: '#D4B18A', strokeWidth: 9, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
          </svg>
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
          {/* No automatic redirect: the member chooses. Signed in -> the
              onboarding gate decides between dashboard and setup; signed out ->
              the auth screen. */}
          <Link href={primaryHref} style={styles.primaryBtn} data-testid="landing-primary-cta">
            {primaryLabel}
          </Link>
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