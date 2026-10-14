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
    
    // Top Bar is now space-between to push logo left and language right
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 30px', zIndex: 50 },
    
    // The new top-left logo layout
    logoWrapper: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoText: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
    logoTitle: { fontSize: '16px', fontWeight: '800', color: '#F2E9E4', letterSpacing: '4px', lineHeight: '1' },
    logoSubtitle: { fontSize: '8px', fontWeight: '600', color: '#B58A83', letterSpacing: '2px', lineHeight: '1' },
    
    langBtn: { backgroundColor: 'transparent', border: 'none', color: '#F2E9E4', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' },
    langDropdown: { position: 'absolute' as const, top: '60px', right: '20px', backgroundColor: '#1C1822', border: '1px solid #4A1828', borderRadius: '12px', padding: '8px', zIndex: 100, width: '220px', maxHeight: '300px', overflowY: 'auto' as const },
    langItem: { padding: '12px', fontSize: '13px', color: '#F2E9E4', cursor: 'pointer', borderRadius: '8px', textAlign: 'center' as const },
    
    main: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' as const, zIndex: 10 },
    title: { fontSize: '48px', fontWeight: '800', color: '#F2E9E4', marginBottom: '8px', letterSpacing: '-1px', lineHeight: '1.2' },
    description: { fontSize: '15px', color: '#B58A83', maxWidth: '320px', marginBottom: '40px', lineHeight: '1.5' },
    buttonContainer: { width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    primaryBtn: { backgroundColor: '#D4B18A', color: '#17121C', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    secondaryBtn: { backgroundColor: '#29202D', color: '#F2E9E4', padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '600', border: '1px solid #4A1828', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: '#B58A83' }
  };

  return (
    <div style={styles.container}>
      
      {/* Top Bar: Logo on the left, Language on the right */}
      <div style={styles.topBar}>
        
        {/* New Top Left Logo Layout (Matches Pic 2 & 3) */}
        <div style={styles.logoWrapper}>
          <svg viewBox="0 0 100 100" style={{ width: '36px', height: '36px', fill: 'none', stroke: '#D4B18A', strokeWidth: 9, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
          </svg>
          <div style={styles.logoText}>
            <span style={styles.logoTitle}>METTIVO</span>
            <span style={styles.logoSubtitle}>YOUR NEXT CONNECTION</span>
          </div>
        </div>

        {/* Language Selector on the right */}
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

      {/* Main Hero Content (Centered) */}
      <div style={styles.main}>
        <h1 style={styles.title}>
          Meet your<br />
          kind of<br />
          <span style={{ fontStyle: 'italic', color: '#D4B18A', fontFamily: 'Georgia, serif' }}>people</span>.
        </h1>
        <p style={styles.description}>
          An intimate space to find meaningful connections wrapped in luxury.
        </p>

        <div style={styles.buttonContainer}>
          <Link href="/auth" style={styles.primaryBtn}>
            Get started →
          </Link>
          <Link href="/auth" style={styles.secondaryBtn}>
            Get the app
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <p>Someone on Mettivo might give you butterflies.</p>
        <p style={{ fontSize: '11px', marginTop: '8px', opacity: 0.7 }}>© 2026 Mettivo. All rights reserved.</p>
      </div>
    </div>
  );
}