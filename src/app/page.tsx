'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../context/LanguageContext';
import { Language } from '@/lib/translations';
import { supabase } from '@/lib/supabase';
const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'en', name: 'English (UK)' },
  { code: 'en', name: 'English (US)' },
  { code: 'ne', name: 'Nepali (नेपाली)' },
  { code: 'hi', name: 'Hindi (हिन्दी)' },
  { code: 'es', name: 'Spanish (Español)' },
  { code: 'fr', name: 'French (Français)' },
];

export default function LandingPage() {
  const router = useRouter();
  const { language, changeLanguage, t } = useLanguage();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  

  useEffect(() => {
    let isMounted = true;

    async function verifyUserAndRouting() {
      try {
        // 1. Check active auth session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          if (isMounted) setIsCheckingAuth(false);
          return;
        }

        // 2. Check profile onboarding status in database
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('onboarding_completed')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!isMounted) return;

        // 3. Precision Routing Decision
        if (profileError || !profile || profile.onboarding_completed === false) {
          router.replace('/profile'); // Send to interview / setup
        } else {
          router.replace('/discover'); // Send to main app
        }
      } catch (err) {
        console.error('Auth verification error on root page:', err);
        if (isMounted) setIsCheckingAuth(false);
      }
    }

    verifyUserAndRouting();

    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

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
    secondaryBtn: { backgroundColor: '#29202D', color: '#F2E9E4', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '600', border: '1px solid #4A1828', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: '#B58A83' }
  };

  // Render a polished branded loading state while verifying auth & profile to eliminate flicker
  if (isCheckingAuth) {
    return (
      <div style={styles.loaderContainer}>
        <svg viewBox="0 0 100 100" style={{ width: '48px', height: '48px', fill: 'none', stroke: '#D4B18A', strokeWidth: 8, strokeLinecap: 'round', strokeLinejoin: 'round', opacity: 0.9 }}>
          <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
        </svg>
        <span style={{ fontSize: '12px', letterSpacing: '3px', color: '#B58A83', textTransform: 'uppercase' }}>Loading Mettivo...</span>
      </div>
    );
  }

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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
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
          <Link href="/auth" style={styles.primaryBtn}>
            {t('get_started')}
          </Link>
          <Link href="/auth" style={styles.secondaryBtn}>
            {t('get_app')}
          </Link>
        </div>
      </div>

      <div style={styles.footer}>
        <p>{t('footer_text')}</p>
        <p style={{ fontSize: '11px', marginTop: '8px', opacity: 0.7 }}>© 2026 Mettivo. All rights reserved.</p>
      </div>
    </div>
  );
}