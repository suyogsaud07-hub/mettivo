'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OAuthProviderIcon } from '@/app/components/OAuthIcons';
import {
  OAUTH_PROVIDER_BRANDS,
  OAUTH_PROVIDER_IDS,
  oauthButtonLabel,
  type OAuthProvider,
} from '@/lib/auth-providers';

/** Supabase's own minimum. Mirrored here so the error appears before the round trip. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Sign-up / log-in screen.
 *
 * The email flow previously used `prompt()` for the address and `alert()` for
 * every outcome. Browser dialogs are unstyleable, unlocalisable, blocked by some
 * browsers, and they discard whatever the member typed. Email is now an inline
 * form with inline feedback, and the 18+ refusal is a message rather than a
 * popup.
 *
 * Layout: the email form sits directly below the Sign Up / Log In toggle and
 * above the Google / Facebook / Twitter / Phone buttons, per the design brief.
 *
 * Sessions: the browser client is `createBrowserClient` (cookie storage), so it
 * shares one session with `/auth/callback` and with the refresh middleware.
 * Before that, OAuth completed on the server while the browser still saw "no
 * session" — which is what produced the redirect loop.
 */
export default function AuthPage() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  /**
   * Sends a member somewhere sensible once they have a session.
   *
   * Reads `onboarding_completed` rather than assuming `/discover`: a brand-new
   * account has no profile row, and sending it to discover would bounce straight
   * back to the onboarding gate.
   */
  const routeAfterSignIn = useCallback(
    async (userId: string) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('id', userId)
        .maybeSingle();

      router.replace(profile?.onboarding_completed ? '/discover' : '/profile');
    },
    [router]
  );

  /**
   * The session listener this app did not have at all.
   *
   * It covers flows that do not return through our own `await` — a magic link
   * opened in another tab, or a session restored on mount — and it guarantees a
   * member who already has a session is never left on the sign-in screen, which
   * was the visible symptom of the redirect loop.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        void routeAfterSignIn(session.user.id);
      }
    });

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) void routeAfterSignIn(user.id);
    });

    return () => subscription.unsubscribe();
  }, [routeAfterSignIn]);

  /** Email + password, inline. No dialogs, no lost input. */
  const handleEmailAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);

    // The 18+ gate covers every method, not just OAuth.
    if (!isAgeVerified) {
      setFormError('You must confirm you are 18 or older to continue.');
      return;
    }

    const address = email.trim();
    if (!address) {
      setFormError('Enter your email address.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setFormError('That does not look like an email address.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setLoading(true);
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;

        // With email confirmation on there is no session yet, and saying so is
        // far clearer than silently doing nothing.
        if (!data.session) {
          setFormNotice('Check your email to confirm your account, then log in.');
          setPassword('');
          return;
        }
        // A session means confirmation is off; the listener above routes us.
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: address,
          password,
        });
        if (error) throw error;
        // `onAuthStateChange` fires SIGNED_IN and routes us.
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Authentication failed. Please try again.'
      );
    } finally {
      // CONSTITUTION Article 2.8: loading must always terminate.
      setLoading(false);
    }
  };

  /** OAuth providers. Failures render inline instead of in an `alert()`. */
  const handleOAuth = async (provider: OAuthProvider) => {
    setFormError(null);
    setFormNotice(null);

    if (!isAgeVerified) {
      setFormError('You must confirm you are 18 or older to continue.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // The browser now navigates to the provider; there is nothing to do here.
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not start that sign-in. Please try again.'
      );
      setLoading(false);
    }
  };

  /**
   * Phone OTP.
   *
   * NOT YET converted to inline inputs — it still uses `prompt()` for the number
   * and the code. Flagged rather than silently left inconsistent: the two-step
   * flow needs its own inline field pair, which is a separate change.
   */
  const handlePhoneAuth = async () => {
    setFormError(null);
    setFormNotice(null);

    if (!isAgeVerified) {
      setFormError('You must confirm you are 18 or older to continue.');
      return;
    }

    setLoading(true);
    try {
      const phone = prompt('Enter your phone number with country code (e.g., +1234567890):');
      if (!phone) return;

      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) throw error;

      const token = prompt('Enter the 6-digit code sent to your phone:');
      if (!token) return;

      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });
      if (verifyError) throw verifyError;
      // The listener routes us once the session lands.
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Phone sign-in failed. Please try again.'
      );
    } finally {
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
    form: { width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column' as const, gap: '12px', marginBottom: '16px' },
    field: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
    label: { color: '#888888', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
    input: { width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#ffffff', fontSize: '14px', boxSizing: 'border-box' as const, outline: 'none' },
    submit: { width: '100%', padding: '14px', borderRadius: '30px', border: 'none', fontSize: '14px', fontWeight: '700', cursor: 'pointer', backgroundColor: '#C5A880', color: '#121212', boxSizing: 'border-box' as const },
    errorBox: { width: '100%', maxWidth: '320px', backgroundColor: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', color: '#FCA5A5', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', lineHeight: 1.5, marginBottom: '16px', boxSizing: 'border-box' as const },
    noticeBox: { width: '100%', maxWidth: '320px', backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', color: '#6EE7B7', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', lineHeight: 1.5, marginBottom: '16px', boxSizing: 'border-box' as const },
    dividerRow: { width: '100%', maxWidth: '320px', display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 16px' },
    dividerLine: { flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' },
    dividerText: { color: '#666666', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '1px' },
    checkboxContainer: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.03)', padding: '12px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', maxWidth: '320px', width: '100%', boxSizing: 'border-box' as const },
    checkboxBox: { width: '20px', height: '20px', borderRadius: '4px', border: '2px solid #C5A880', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    checkboxLabel: { color: '#ffffff', fontSize: '13px', fontWeight: '500', userSelect: 'none' as const },
    buttonContainer: { width: '100%', maxWidth: '320px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    buttonBase: { width: '100%', padding: '14px', borderRadius: '30px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer', transition: 'opacity 0.2s', boxSizing: 'border-box' as const },
    outlineButton: { backgroundColor: 'transparent', border: '1px solid #555555', color: '#ffffff' },
    icon: { width: '20px', height: '20px', flexShrink: 0 },
    legalText: { color: '#666666', fontSize: '10px', textAlign: 'center' as const, lineHeight: '1.5', maxWidth: '320px', marginTop: '24px' },
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
        <button type="button" onClick={() => { setAuthMode('signup'); setFormError(null); setFormNotice(null); }} style={{ ...styles.tabButton, ...(authMode === 'signup' ? styles.tabActive : styles.tabInactive) }}>Sign Up</button>
        <button type="button" onClick={() => { setAuthMode('login'); setFormError(null); setFormNotice(null); }} style={{ ...styles.tabButton, ...(authMode === 'login' ? styles.tabActive : styles.tabInactive) }}>Log In</button>
      </div>

      {/* Inline email + password. Replaces the old prompt()/alert() flow. */}
      <form style={styles.form} onSubmit={handleEmailAuth} noValidate>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            style={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            name="password"
            autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={authMode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
            style={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <button type="submit" style={{ ...styles.submit, opacity: loading ? 0.6 : 1 }} disabled={loading}>
          {loading ? 'Please wait…' : authMode === 'signup' ? 'Sign up with email' : 'Log in with email'}
        </button>
      </form>

      <div style={styles.checkboxContainer} onClick={() => setIsAgeVerified(!isAgeVerified)}>
        <div style={{ ...styles.checkboxBox, backgroundColor: isAgeVerified ? '#C5A880' : 'transparent' }}>
          {isAgeVerified && <span style={{ color: '#121212', fontSize: '14px', fontWeight: 'bold' }}>✓</span>}
        </div>
        <span style={styles.checkboxLabel}>I confirm I am 18 years or older</span>
      </div>

      {/* Inline feedback — visible, styleable, and it never discards input. */}
      {formError && (
        <div role="alert" data-testid="auth-error" style={styles.errorBox}>{formError}</div>
      )}
      {formNotice && (
        <div role="status" data-testid="auth-notice" style={styles.noticeBox}>{formNotice}</div>
      )}

      <div style={styles.dividerRow}>
        <div style={styles.dividerLine} />
        <span style={styles.dividerText}>or</span>
        <div style={styles.dividerLine} />
      </div>

      <div
        style={{
          ...styles.buttonContainer,
          opacity: isAgeVerified ? 1 : 0.5,
          pointerEvents: isAgeVerified ? 'auto' : 'none',
        }}
      >
        {/* Rendered from the shared provider list, so a provider added there
            appears on every screen with consistent branding. Discord uses its
            brand colour, #5865F2. */}
        {OAUTH_PROVIDER_IDS.map((provider) => (
          <button
            key={provider}
            type="button"
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

        <button type="button" disabled={loading} onClick={() => void handlePhoneAuth()} style={{ ...styles.buttonBase, ...styles.outlineButton }}>
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
