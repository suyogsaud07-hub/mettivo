'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase'; 


export default function AuthPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAuthAction = async (provider: string) => {
    if (!isAgeVerified) return alert('You must confirm you are 18 or older to continue.');
    setLoading(true);
    try {
      if (provider === 'Google' || provider === 'Facebook' || provider === 'Twitter') {
        const { error } = await supabase.auth.signInWithOAuth({ provider: provider.toLowerCase() as any, options: { redirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error;
      } else if (provider === 'Email') {
        const email = prompt("Enter your email address:");
        if (!email) { setLoading(false); return; }
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error;
        alert('Check your email for the login link!');
        setLoading(false);
      } else if (provider === 'Phone') {
        const phone = prompt("Enter your phone number with country code (e.g., +1234567890):");
        if (!phone) { setLoading(false); return; }
        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;
        const token = prompt("Enter the 6-digit code sent to your phone:");
        if (token) {
          const { error: verifyError } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
          if (verifyError) throw verifyError;
          router.push('/profile');
        }
        setLoading(false);
      }
    } catch (error: any) {
      alert(`Authentication error: ${error.message}`);
      setLoading(false);
    }
  };

  const styles = {
    container: { minHeight: '100vh', backgroundColor: '#121212', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'system-ui', boxSizing: 'border-box' as const },
    heading: { color: '#ffffff', fontSize: '28px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'center' as const },
    subheading: { color: '#888888', fontSize: '13px', textAlign: 'center' as const, marginBottom: '24px' },
    tabContainer: { display: 'flex', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '30px', padding: '4px', marginBottom: '20px', width: '100%', maxWidth: '320px' },
    tabButton: { flex: 1, padding: '10px', borderRadius: '30px', border: 'none', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' },
    tabActive: { backgroundColor: '#C5A880', color: '#121212' },
    tabInactive: { backgroundColor: 'transparent', color: '#888888' },
    checkboxContainer: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.03)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '320px', width: '100%', boxSizing: 'border-box' as const },
    checkboxBox: { width: '20px', height: '20px', borderRadius: '4px', border: '2px solid #C5A880', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    checkboxLabel: { color: '#ffffff', fontSize: '13px', fontWeight: '500', userSelect: 'none' as const },
    buttonContainer: { width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    buttonBase: { width: '100%', padding: '14px', borderRadius: '30px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer', transition: 'opacity 0.2s', boxSizing: 'border-box' as const },
    outlineButton: { backgroundColor: 'transparent', border: '1px solid #555555', color: '#ffffff' },
    googleButton: { backgroundColor: '#1A73E8', border: 'none', color: '#ffffff' },
    facebookButton: { backgroundColor: '#1877F2', border: 'none', color: '#ffffff' },
    twitterButton: { backgroundColor: '#000000', border: '1px solid #333333', color: '#ffffff' },
    icon: { width: '20px', height: '20px', flexShrink: 0 },
    legalText: { color: '#666666', fontSize: '10px', textAlign: 'center' as const, lineHeight: '1.5', maxWidth: '320px', marginTop: '24px' }
  };

  return (
    <div style={styles.container}>
      <div style={{ marginBottom: '16px' }}>
        <svg viewBox="0 0 100 100" style={{ width: '48px', height: '48px', fill: 'none', stroke: '#C5A880', strokeWidth: 9 }}>
          <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
        </svg>
      </div>
      <h1 style={styles.heading}>{authMode === 'signup' ? 'Create account' : 'Welcome back'}</h1>
      <p style={styles.subheading}>{authMode === 'signup' ? 'Find your kind of people.' : 'Log in to continue your journey.'}</p>

      <div style={styles.tabContainer}>
        <button onClick={() => setAuthMode('signup')} style={{ ...styles.tabButton, ...(authMode === 'signup' ? styles.tabActive : styles.tabInactive) }}>Sign Up</button>
        <button onClick={() => setAuthMode('login')} style={{ ...styles.tabButton, ...(authMode === 'login' ? styles.tabActive : styles.tabInactive) }}>Log In</button>
      </div>

      <div style={styles.checkboxContainer} onClick={() => setIsAgeVerified(!isAgeVerified)}>
        <div style={{ ...styles.checkboxBox, backgroundColor: isAgeVerified ? '#C5A880' : 'transparent' }}>
          {isAgeVerified && <span style={{ color: '#121212', fontSize: '14px', fontWeight: 'bold' }}>✓</span>}
        </div>
        <span style={styles.checkboxLabel}>I confirm I am 18 years or older</span>
      </div>

      <div style={{ ...styles.buttonContainer, opacity: isAgeVerified ? 1 : 0.5, pointerEvents: isAgeVerified ? 'auto' : 'none' }}>
        <button disabled={loading} onClick={() => handleAuthAction('Email')} style={{ ...styles.buttonBase, ...styles.outlineButton }}>
          <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          {authMode === 'signup' ? 'Sign up with email' : 'Log in with email'}
        </button>
        <button disabled={loading} onClick={() => handleAuthAction('Google')} style={{ ...styles.buttonBase, ...styles.googleButton }}>
          <svg style={styles.icon} viewBox="0 0 24 24"><path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          {authMode === 'signup' ? 'Sign up with Google' : 'Log in with Google'}
        </button>
        <button disabled={loading} onClick={() => handleAuthAction('Facebook')} style={{ ...styles.buttonBase, ...styles.facebookButton }}>
          <svg style={{ ...styles.icon, fill: '#ffffff' }} viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          {authMode === 'signup' ? 'Sign up with Facebook' : 'Log in with Facebook'}
        </button>
        <button disabled={loading} onClick={() => handleAuthAction('Twitter')} style={{ ...styles.buttonBase, ...styles.twitterButton }}>
          <svg style={{ ...styles.icon, fill: '#ffffff' }} viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          {authMode === 'signup' ? 'Sign up with Twitter' : 'Log in with Twitter'}
        </button>
        <button disabled={loading} onClick={() => handleAuthAction('Phone')} style={{ ...styles.buttonBase, ...styles.outlineButton }}>
          <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          {authMode === 'signup' ? 'Sign up with phone' : 'Log in with phone number'}
        </button>
      </div>

      <p style={styles.legalText}>
        By tapping {authMode === 'signup' ? 'Sign up' : 'Log in'}, you agree to our Terms. Learn how we process your data in our Privacy Policy and Cookie Policy.
      </p>
    </div>
  );
}