'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
// FIXED IMPORT PATH: Go up two levels from app/signup to src/lib
import { supabase } from '@/lib/supabase';

import { OAuthProviderIcon } from '@/app/components/OAuthIcons';
import {
  OAUTH_PROVIDER_BRANDS,
  OAUTH_PROVIDER_IDS,
  oauthButtonLabel,
  type OAuthProvider,
} from '@/lib/auth-providers';

export default function SignUpPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * OAuth. Accepts the provider id directly — no `provider.toLowerCase()`
   * string dance, and no chance of a typo slipping through, because the id is
   * typed against the shared list in `@/lib/auth-providers`.
   */
  const handleOAuth = async (provider: OAuthProvider) => {
    if (!isAgeVerified) {
      alert('You must confirm you are 18 or older to continue.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (error) {
      alert(`Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setLoading(false);
    }
  };

  // --- REAL AUTHENTICATION LOGIC (email / phone only) ---
  const handleAuthAction = async (provider: 'Email' | 'Phone') => {
    if (!isAgeVerified) {
      alert('You must confirm you are 18 or older to continue.');
      return;
    }

    setLoading(true);

    try {
      if (provider === 'Email') {
        // Email Magic Link
        const email = prompt("Enter your email address:");
        if (!email) {
          setLoading(false);
          return;
        }

        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) throw error;
        alert('Check your email for the login link!');
        setLoading(false);
      }
      else if (provider === 'Phone') {
        // Phone OTP
        const phone = prompt("Enter your phone number with country code (e.g., +1234567890):");
        if (!phone) {
          setLoading(false);
          return;
        }

        const { error } = await supabase.auth.signInWithOtp({ phone });
        if (error) throw error;

        const token = prompt("Enter the 6-digit code sent to your phone:");
        if (token) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            phone,
            token,
            type: 'sms',
          });
          if (verifyError) throw verifyError;
          router.push('/profile');
        }
        setLoading(false);
      }
    } catch (error) {
      alert(
        `Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setLoading(false);
    }
  };

  // --- INLINE STYLES FOR GUARANTEED RENDERING ---
  const styles = {
    container: {
      minHeight: '100vh',
      width: '100%',
      backgroundColor: '#121212',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative' as const,
      boxSizing: 'border-box' as const,
    },
    logoContainer: {
      marginBottom: '16px',
      display: 'flex',
      justifyContent: 'center',
    },
    heading: {
      color: '#ffffff',
      fontSize: '28px',
      fontWeight: 'bold',
      marginBottom: '8px',
      textAlign: 'center' as const,
      letterSpacing: '-0.5px',
    },
    subheading: {
      color: '#888888',
      fontSize: '13px',
      textAlign: 'center' as const,
      marginBottom: '24px',
    },
    tabContainer: {
      display: 'flex',
      backgroundColor: 'rgba(255,255,255,0.05)',
      borderRadius: '30px',
      padding: '4px',
      marginBottom: '20px',
      width: '100%',
      maxWidth: '320px',
    },
    tabButton: {
      flex: 1,
      padding: '10px',
      borderRadius: '30px',
      border: 'none',
      fontSize: '13px',
      fontWeight: 'bold',
      cursor: 'pointer',
      transition: 'all 0.2s',
    },
    tabActive: {
      backgroundColor: '#C5A880',
      color: '#121212',
    },
    tabInactive: {
      backgroundColor: 'transparent',
      color: '#888888',
    },
    checkboxContainer: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '24px',
      cursor: 'pointer',
      backgroundColor: 'rgba(255,255,255,0.03)',
      padding: '12px 16px',
      borderRadius: '12px',
      border: '1px solid rgba(255,255,255,0.1)',
      maxWidth: '320px',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    checkboxBox: {
      width: '20px',
      height: '20px',
      borderRadius: '4px',
      border: '2px solid #C5A880',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    checkboxLabel: {
      color: '#ffffff',
      fontSize: '13px',
      fontWeight: '500',
      userSelect: 'none' as const,
    },
    buttonContainer: {
      width: '100%',
      maxWidth: '320px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px',
    },
    buttonBase: {
      width: '100%',
      padding: '14px',
      borderRadius: '30px',
      fontSize: '14px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      cursor: 'pointer',
      transition: 'opacity 0.2s',
      boxSizing: 'border-box' as const,
    },
    outlineButton: {
      backgroundColor: 'transparent',
      border: '1px solid #555555',
      color: '#ffffff',
    },
    icon: {
      width: '20px',
      height: '20px',
      flexShrink: 0,
    },
    legalText: {
      color: '#666666',
      fontSize: '10px',
      textAlign: 'center' as const,
      lineHeight: '1.5',
      maxWidth: '320px',
      marginTop: '24px',
    },
    link: {
      color: '#1A73E8',
      textDecoration: 'underline',
      cursor: 'pointer',
    },
    troubleLink: {
      color: '#1A73E8',
      fontSize: '12px',
      textDecoration: 'underline',
      cursor: 'pointer',
      marginTop: '16px',
      display: 'inline-block',
      background: 'none',
      border: 'none',
    }
  };

  return (
    <div style={styles.container}>
      
      {/* Logo */}
      <div style={styles.logoContainer}>
        <svg viewBox="0 0 100 100" style={{ width: '48px', height: '48px', fill: 'none', stroke: '#C5A880', strokeWidth: 9, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M 25,30 C 15,30 15,70 25,70 C 40,70 60,30 75,30 C 85,30 85,70 75,70 C 60,70 40,30 25,30 Z" />
        </svg>
      </div>

      {/* Dynamic Heading based on Mode */}
      <h1 style={styles.heading}>
        {authMode === 'signup' ? 'Create account' : 'Welcome back'}
      </h1>
      <p style={styles.subheading}>
        {authMode === 'signup' ? 'Find your kind of people.' : 'Log in to continue your journey.'}
      </p>

      {/* Tab Switcher */}
      <div style={styles.tabContainer}>
        <button 
          onClick={() => setAuthMode('signup')} 
          style={{ ...styles.tabButton, ...(authMode === 'signup' ? styles.tabActive : styles.tabInactive) }}
        >
          Sign Up
        </button>
        <button 
          onClick={() => setAuthMode('login')} 
          style={{ ...styles.tabButton, ...(authMode === 'login' ? styles.tabActive : styles.tabInactive) }}
        >
          Log In
        </button>
      </div>

      {/* 18+ Verification Checkbox */}
      <div 
        style={styles.checkboxContainer} 
        onClick={() => setIsAgeVerified(!isAgeVerified)}
      >
        <div style={{ ...styles.checkboxBox, backgroundColor: isAgeVerified ? '#C5A880' : 'transparent' }}>
          {isAgeVerified && <span style={{ color: '#121212', fontSize: '14px', fontWeight: 'bold' }}>✓</span>}
        </div>
        <span style={styles.checkboxLabel}>I confirm I am 18 years or older</span>
      </div>

      {/* Action Buttons */}
      <div style={{ ...styles.buttonContainer, opacity: isAgeVerified ? 1 : 0.5, pointerEvents: isAgeVerified ? 'auto' : 'none' }}>
        
        {/* Email */}
        <button disabled={loading} onClick={() => handleAuthAction('Email')} style={{ ...styles.buttonBase, ...styles.outlineButton }}>
          <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {authMode === 'signup' ? 'Sign up with email' : 'Log in with email'}
        </button>

        {/* Rendered from the shared provider list, so adding a provider there
            puts it on this screen too, with consistent branding. */}
        {OAUTH_PROVIDER_IDS.map((provider) => (
          <button
            key={provider}
            disabled={loading}
            onClick={() => void handleOAuth(provider)}
            style={{
              ...styles.buttonBase,
              backgroundColor: OAUTH_PROVIDER_BRANDS[provider].background,
              color: OAUTH_PROVIDER_BRANDS[provider].foreground,
              border: OAUTH_PROVIDER_BRANDS[provider].border ?? 'none',
            }}
          >
            <OAuthProviderIcon provider={provider} />
            {oauthButtonLabel(provider, authMode)}
          </button>
        ))}

        {/* Phone Number */}
        <button disabled={loading} onClick={() => handleAuthAction('Phone')} style={{ ...styles.buttonBase, ...styles.outlineButton }}>
          <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          {authMode === 'signup' ? 'Sign up with phone' : 'Log in with phone number'}
        </button>
      </div>

      {/* Legal Text */}
      <p style={styles.legalText}>
        By tapping {authMode === 'signup' ? 'Sign up' : 'Log in'}, you agree to our <a href="#" style={styles.link}>Terms</a>. Learn how we process your data in our <a href="#" style={styles.link}>Privacy Policy</a> and <a href="#" style={styles.link}>Cookie Policy</a>.
      </p>

      {/* Trouble Link */}
      <button onClick={() => alert('Redirecting to troubleshooting...')} style={styles.troubleLink}>
        Trouble logging in?
      </button>

    </div>
  );
}