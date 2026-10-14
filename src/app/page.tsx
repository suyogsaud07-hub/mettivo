'use client';

import { useState } from 'react';
import Link from 'next/link';

const LANGUAGES = [
  'English (United Kingdom)', 'English (United States)', 'Mandarin Chinese (中文)', 'Hindi (हिन्दी)',
  'Spanish (Español)', 'French (Français)', 'Arabic (العربية)', 'Bengali (বাংলা)', 'Portuguese (Português)',
  'Russian (Русский)', 'Urdu (اردو)', 'Nepali (नेपाली)', 'Japanese (日本語)', 'Korean (한국어)'
];

export default function LandingPage() {
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState('English (United Kingdom)');

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#0D0A10', color: '#F2E9E4', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' as const, position: 'relative' as const, overflowX: 'hidden' as const },
    topBar: { display: 'flex', justifyContent: 'flex-end', padding: '20px', zIndex: 50 },
    langBtn: { backgroundColor: 'transparent', border: 'none', color: '#F2E9E4', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' },
    langDropdown: { position: 'absolute' as const, top: '60px', right: '20px', backgroundColor: '#1C1822', border: '1px solid #4A1828', borderRadius: '12px', padding: '8px', zIndex: 100, width: '220px', maxHeight: '300px', overflowY: 'auto' as const },
    langItem: { padding: '12px', fontSize: '13px', color: '#F2E9E4', cursor: 'pointer', borderRadius: '8px', textAlign: 'center' as const },
    main: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' as const, zIndex: 10 },
    logoContainer: { marginBottom: '30px' },
    title: { fontSize: '48px', fontWeight: '800', color: '#F2E9E4', marginBottom: '8px', letterSpacing: '-1px' },
    subtitle: { fontSize: '24px', fontWeight: '500', color: '#D4B18A', marginBottom: '16px' },
    description: { fontSize: '15px', color: '#B58A83', maxWidth: '320px', marginBottom: '40px', lineHeight: '1.5' },
    buttonContainer: { width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    primaryBtn: { backgroundColor: '#D4B18A', color: '#17121C', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    secondaryBtn: { backgroundColor: '#29202D', color: '#F2E9E4', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '600', border: '1px solid #4A1828', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: '#B58A83' }
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div style={{ position: 'relative' }}>
          <button style={styles.langBtn} onClick={() => setLangMenuOpen(!langMenuOpen)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          {langMenuOpen && (
            <div style={styles.langDropdown}>
              {LANGUAGES.map((lang) => (
                <div key={lang} style={{ ...styles.langItem, backgroundColor: selectedLang === lang ? '#4A1828' : 'transparent' }} onClick={() => { setSelectedLang(lang); setLangMenuOpen(false); }}>{lang}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.main}>
        <div style={styles.logoContainer}>
          <svg viewBox="0 0 100 100" style={{ width: '80px', height: '80px', fill: 'none', stroke: '#D4B18A', strokeWidth: 6 }}>
            <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
          </svg>
        </div>
        <h1 style={styles.title}>Mettivo</h1>
        <h2 style={styles.subtitle}>Meet your kind of people.</h2>
        <p style={styles.description}>An intimate space to find meaningful connections wrapped in luxury.</p>
        <div style={styles.buttonContainer}>
          <Link href="/auth" style={styles.primaryBtn}>Get started →</Link>
          <Link href="/auth" style={styles.secondaryBtn}>Get the app</Link>
        </div>
      </div>

      <div style={styles.footer}>
        <p>Someone on Mettivo might give you butterflies.</p>
        <p style={{ fontSize: '11px', marginTop: '8px', opacity: 0.7 }}>© 2026 Mettivo. All rights reserved.</p>
      </div>
    </div>
  );
}