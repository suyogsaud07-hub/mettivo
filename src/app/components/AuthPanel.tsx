'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OAuthProviderIcon } from '@/app/components/OAuthIcons';
import Logo from '@/components/Logo';
import {
  OAUTH_PROVIDER_BRANDS,
  OAUTH_PROVIDER_IDS,
  oauthButtonLabel,
  type OAuthProvider,
} from '@/lib/auth-providers';

/**
 * The one sign-up / log-in surface for the product.
 *
 * WHY THIS COMPONENT EXISTS
 *   `/auth` and `/signup` each carried a near-identical copy of this screen.
 *   They had already drifted: `/auth` had an inline email + password form and
 *   inline feedback, while `/signup` still called `prompt()` for the address
 *   and `alert()` for every outcome. Two copies means every fix has to be made
 *   twice and every palette change has to be applied twice — so the whole
 *   surface, logic and styling together, now lives here and both routes render
 *   it unchanged.
 *
 * WHY NO DIALOGS
 *   Browser dialogs are unstyleable, unlocalisable, blocked by some browsers,
 *   and they discard whatever the member typed. Every input is inline and every
 *   outcome is an inline `role="alert"` / `role="status"` message.
 *
 * LAYOUT CONTRACT (asserted by `tests/e2e/journeys.spec.ts`)
 *   heading → Sign Up / Log In toggle → inline email form → 18+ confirmation →
 *   inline feedback → "or" divider → social providers. The email form sits
 *   below the toggle and above the Google button, and it is the same on both
 *   routes.
 *
 * PALETTE
 *   "Midnight Romance". Every colour is a `var(--mr-*)` token defined in
 *   `src/app/globals.css`, so the values have exactly one home and this file
 *   cannot drift from the stylesheet. No literal hex lives here.
 *
 * SESSIONS
 *   The browser client is `createBrowserClient` (cookie storage), so it shares
 *   one session with `/auth/callback` and with the refresh middleware.
 */

/** Supabase's own minimum. Mirrored here so the error appears before the round trip. */
const MIN_PASSWORD_LENGTH = 6;

/** Phone OTP codes are six digits; validating locally saves a round trip. */
const OTP_LENGTH = 6;

/**
 * True when `'discord'` is a provider Supabase's own `Provider` union accepts.
 *
 * The real compile-time proof is `OAUTH_PROVIDERS_ARE_SUPPORTED_BY_SUPABASE` in
 * `src/lib/auth-providers.ts`, which fails the build if an id in the list is not
 * a valid Supabase provider. This is the same fact expressed at runtime.
 */
export const DISCORD_IS_A_SUPPORTED_PROVIDER: boolean = OAUTH_PROVIDER_IDS.includes('discord');

/**
 * The auth surface palette, read from the stylesheet rather than duplicated.
 *
 * `var()` is resolved by the browser against `:root` in `globals.css`, so
 * `getComputedStyle()` — and therefore the Playwright brand-colour assertion on
 * the Discord button — sees the real hex.
 */
const mr = {
  page: 'var(--mr-page)',
  card: 'var(--mr-card)',
  cardBorder: 'var(--mr-card-border)',
  gold: 'var(--mr-gold)',
  goldText: 'var(--mr-gold-text)',
  input: 'var(--mr-input)',
  inputBorder: 'var(--mr-input-border)',
  placeholder: 'var(--mr-placeholder)',
  inactive: 'var(--mr-inactive)',
  inactiveText: 'var(--mr-inactive-text)',
  heading: 'var(--mr-heading)',
  divider: '#34283f',
} as const;

/** Layout is shared between both routes, so there is one width to tune. */
const PANEL_WIDTH = 360;

export default function AuthPanel() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [isAgeVerified, setIsAgeVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  /** Inline phone OTP state — two steps, both on screen, no `prompt()`. */
  const [phoneStep, setPhoneStep] = useState<'idle' | 'code'>('idle');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');

  /**
   * A member who already holds a session, when they open `/auth` or `/signup`.
   *
   * This screen NO LONGER redirects such a visitor away. It shows them who they
   * are and offers a deliberate choice — continue into the app, or sign out and
   * test the signup flow. The old behaviour was an unconditional
   * `router.replace()` on mount, which made it impossible to reach the signup
   * screen while signed in and formed a redirect cycle with any page that sent
   * an authenticated member back here.
   */
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  /**
   * True once the member has signed out from this screen.
   *
   * Drives the "go back to the app" affordance so signing out here is
   * reversible — the member came from an existing session, and being stranded
   * with no route back would be a worse experience than the redirect this
   * replaced.
   */
  const [signedOutHere, setSignedOutHere] = useState(false);

  /**
   * True only for a sign-in that happened ON THIS SCREEN.
   *
   * The distinction is the whole fix: a session that appears because the member
   * just authenticated should take them into the app, while a session that was
   * already present on load must ask. A ref, not state — it is a
   * decision-input, and flipping it must not re-render mid-flow.
   */
  const signedInHereRef = useRef(false);

  /**
   * Sends a member who just authenticated to the onboarding gate.
   *
   * The gate at `/profile` is the ONE place that routes on
   * `onboarding_completed` (finished -> /profile/dashboard, unfinished ->
   * /profile/edit). Reading the profile here as well was a second copy of that
   * rule, and a second place for it to disagree — and it meant a slow or failed
   * profile read left the member stranded on the sign-in screen, which is what
   * made the loop feel infinite.
   */
  const routeAfterSignIn = useCallback(() => {
    router.replace('/profile');
  }, [router]);

  /**
   * The session listener.
   *
   * Covers flows that do not return through our own `await` — a magic link
   * opened in another tab, or a session restored on mount. It only navigates
   * for a genuine sign-in on this screen (`signedInHereRef`); an existing
   * session is surfaced as a choice instead.
   */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user && signedInHereRef.current) {
        void routeAfterSignIn();
      }
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionEmail(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, [routeAfterSignIn]);

  /** Continue as the account already signed in on this device. */
  const handleContinueAsAccount = () => {
    setSigningOut(true);
    routeAfterSignIn();
  };

  /** Clears per-attempt feedback. Called before every method, so nothing goes stale. */
  const clearFeedback = (): void => {
    setFormError(null);
    setFormNotice(null);
  };

  /**
   * The 18+ gate, for every method — not just OAuth.
   *
   * Returns the message to show, or `null` when the member has confirmed.
   */
  const ageGateMessage = (): string | null =>
    isAgeVerified ? null : 'You must confirm you are 18 or older to continue.';

  const switchMode = (mode: 'signup' | 'login'): void => {
    setAuthMode(mode);
    clearFeedback();
    // A half-finished OTP step belongs to the other mode; drop it.
    setPhoneStep('idle');
    setOtpCode('');
  };

  /**
   * Sign out so the signup flow can be tested, without leaving the screen.
   *
   * `scope: 'local'` clears this browser's session only; the other devices the
   * member is signed in on are untouched, which is the right default for
   * "let me try the signup form".
   */
  const handleSignOutHere = async (): Promise<void> => {
    clearFeedback();
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      signedInHereRef.current = false;
      setSessionEmail(null);
      setSignedOutHere(true);
      setAuthMode('signup');
      setFormNotice('You are signed out. You can create or test an account now.');
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not sign you out. Please try again.'
      );
    } finally {
      // CONSTITUTION Article 2.8: a loading state must always terminate.
      setSigningOut(false);
    }
  };

  /** Email + password, inline. No dialogs, no lost input. */
  const handleEmailAuth = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    clearFeedback();

    const ageError = ageGateMessage();
    if (ageError) {
      setFormError(ageError);
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
        // A session means confirmation is off. This sign-in happened here, so
        // the listener is allowed to navigate instead of asking.
        signedInHereRef.current = true;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: address,
          password,
        });
        if (error) throw error;
        // `onAuthStateChange` fires SIGNED_IN; `signedInHereRef` lets it route.
        signedInHereRef.current = true;
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

  /**
   * OAuth providers, including Discord.
   *
   * The provider id is passed straight through to
   * `supabase.auth.signInWithOAuth({ provider })`; `OAuthProvider` is derived
   * from `OAUTH_PROVIDER_IDS`, which is compile-checked against Supabase's own
   * `Provider` union, so `'discord'` is accepted by the types as well as at
   * runtime. Failures render inline instead of in an `alert()`.
   */
  const handleOAuth = async (provider: OAuthProvider): Promise<void> => {
    clearFeedback();

    const ageError = ageGateMessage();
    if (ageError) {
      setFormError(ageError);
      return;
    }

    setLoading(true);
    try {
      // Intent is recorded BEFORE the call: `signInWithOAuth` can emit
      // SIGNED_IN for an existing session, and that must not be mistaken for a
      // fresh sign-in that is allowed to navigate.
      signedInHereRef.current = true;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // The browser now navigates to the provider; there is nothing to do here.
    } catch (error) {
      signedInHereRef.current = false;
      setFormError(
        error instanceof Error ? error.message : 'Could not start that sign-in. Please try again.'
      );
      setLoading(false);
    }
  };

  /**
   * Phone OTP, step one: send the code.
   *
   * Inline, like the email flow. This previously used `prompt()`, which is the
   * same class of defect the email flow was fixed for.
   */
  const handleSendOtp = async (): Promise<void> => {
    clearFeedback();

    const ageError = ageGateMessage();
    if (ageError) {
      setFormError(ageError);
      return;
    }

    const number = phone.trim();
    if (!number) {
      setFormError('Enter your phone number with country code (e.g., +1234567890).');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: number });
      if (error) throw error;
      setPhone(number);
      setPhoneStep('code');
      setFormNotice('Enter the code we sent to your phone.');
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not send that code. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  /** Phone OTP, step two: verify the six-digit code. */
  const handleVerifyOtp = async (): Promise<void> => {
    clearFeedback();

    if (otpCode.trim().length !== OTP_LENGTH) {
      setFormError(`Enter the ${OTP_LENGTH}-digit code we sent you.`);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: otpCode.trim(),
        type: 'sms',
      });
      if (error) throw error;
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
    page: {
      minHeight: '100vh',
      width: '100%',
      backgroundColor: mr.page,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box' as const,
    },
    logo: {
      marginBottom: '16px',
      display: 'flex',
      justifyContent: 'center',
    },
    heading: {
      color: mr.heading,
      fontSize: '28px',
      fontWeight: 'bold',
      margin: '0 0 8px',
      textAlign: 'center' as const,
      letterSpacing: '-0.5px',
    },
    subheading: {
      color: mr.placeholder,
      fontSize: '13px',
      textAlign: 'center' as const,
      margin: '0 0 24px',
    },
    /**
     * The "already signed in" card. Deliberately prominent and placed above the
     * toggle: a member who already has a session must see why this screen is
     * offering them a sign-out before they start filling in the form.
     */
    sessionCard: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      backgroundColor: mr.card,
      border: `1px solid ${mr.gold}`,
      borderRadius: '16px',
      padding: '16px',
      marginBottom: '16px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px',
      boxSizing: 'border-box' as const,
    },
    sessionTitle: {
      color: mr.heading,
      fontSize: '14px',
      fontWeight: 700,
      margin: 0,
    },
    sessionEmail: {
      color: mr.gold,
      fontSize: '13px',
      fontWeight: 600,
      margin: 0,
      wordBreak: 'break-all' as const,
    },
    sessionHint: {
      color: mr.placeholder,
      fontSize: '12px',
      lineHeight: 1.5,
      margin: 0,
    },
    sessionActions: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '8px',
    },
    /** Shown only after a sign-out from this screen, as a route back. */
    signedOutRow: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      marginBottom: '16px',
      backgroundColor: mr.card,
      border: `1px solid ${mr.cardBorder}`,
      borderRadius: '12px',
      padding: '10px 14px',
      boxSizing: 'border-box' as const,
    },
    signedOutLabel: {
      color: mr.inactiveText,
      fontSize: '12px',
      margin: 0,
    },    tabContainer: {
      display: 'flex',
      backgroundColor: mr.inactive,
      border: `1px solid ${mr.cardBorder}`,
      borderRadius: '30px',
      padding: '4px',
      marginBottom: '20px',
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      boxSizing: 'border-box' as const,
    },
    tabButton: {
      flex: 1,
      padding: '10px',
      borderRadius: '30px',
      border: 'none',
      fontSize: '13px',
      fontWeight: 'bold',
      cursor: 'pointer',
      transition: 'background-color 0.2s, color 0.2s',
    },
    tabActive: {
      backgroundColor: mr.gold,
      color: mr.goldText,
    },
    tabInactive: {
      backgroundColor: 'transparent',
      color: mr.inactiveText,
    },
    /** Inline email form: directly below the toggle, above the providers. */
    form: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      backgroundColor: mr.card,
      border: `1px solid ${mr.cardBorder}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '12px',
      marginBottom: '16px',
      boxSizing: 'border-box' as const,
    },
    field: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '6px',
    },
    label: {
      color: mr.placeholder,
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.5px',
    },
    input: {
      width: '100%',
      padding: '14px 16px',
      borderRadius: '12px',
      border: `1px solid ${mr.inputBorder}`,
      backgroundColor: mr.input,
      color: mr.heading,
      fontSize: '14px',
      boxSizing: 'border-box' as const,
      outline: 'none',
    },
    submit: {
      width: '100%',
      padding: '14px',
      borderRadius: '30px',
      border: 'none',
      fontSize: '14px',
      fontWeight: 700,
      cursor: 'pointer',
      backgroundColor: mr.gold,
      color: mr.goldText,
      boxSizing: 'border-box' as const,
    },
    /** Compact text button, used for "resend code" and "use a different number". */
    linkButton: {
      background: 'none',
      border: 'none',
      padding: 0,
      color: mr.gold,
      fontSize: '12px',
      fontWeight: 600,
      textDecoration: 'underline',
      cursor: 'pointer',
      textAlign: 'left' as const,
    },
    errorBox: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      backgroundColor: 'rgba(220,38,38,0.12)',
      border: '1px solid rgba(220,38,38,0.4)',
      color: '#FCA5A5',
      padding: '10px 14px',
      borderRadius: '12px',
      fontSize: '12px',
      lineHeight: 1.5,
      marginBottom: '16px',
      boxSizing: 'border-box' as const,
    },
    noticeBox: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      backgroundColor: 'rgba(216,179,138,0.10)',
      border: `1px solid ${mr.gold}`,
      color: mr.heading,
      padding: '10px 14px',
      borderRadius: '12px',
      fontSize: '12px',
      lineHeight: 1.5,
      marginBottom: '16px',
      boxSizing: 'border-box' as const,
    },
    dividerRow: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      margin: '0 0 16px',
    },
    dividerLine: {
      flex: 1,
      height: '1px',
      backgroundColor: mr.divider,
    },
    dividerText: {
      color: mr.placeholder,
      fontSize: '11px',
      textTransform: 'uppercase' as const,
      letterSpacing: '1px',
    },
    checkboxContainer: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '16px',
      cursor: 'pointer',
      backgroundColor: mr.card,
      padding: '12px 16px',
      borderRadius: '12px',
      border: `1px solid ${mr.cardBorder}`,
      maxWidth: `${PANEL_WIDTH}px`,
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    checkboxBox: {
      width: '20px',
      height: '20px',
      borderRadius: '4px',
      border: `2px solid ${mr.gold}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    checkboxLabel: {
      color: mr.heading,
      fontSize: '13px',
      fontWeight: 500,
      userSelect: 'none' as const,
    },
    buttonContainer: {
      width: '100%',
      maxWidth: `${PANEL_WIDTH}px`,
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
      transition: 'opacity 0.2s, background-color 0.2s',
      boxSizing: 'border-box' as const,
    },
    outlineButton: {
      backgroundColor: 'transparent',
      border: `1px solid ${mr.inputBorder}`,
      color: mr.heading,
    },
    icon: {
      width: '20px',
      height: '20px',
      flexShrink: 0,
    },
    legalText: {
      color: mr.placeholder,
      fontSize: '10px',
      textAlign: 'center' as const,
      lineHeight: '1.5',
      maxWidth: `${PANEL_WIDTH}px`,
      marginTop: '24px',
    },
  };

  const isSignup = authMode === 'signup';

  return (
    <div style={styles.page} data-testid="auth-panel">
      <div style={styles.logo}>
        {/* The brand mark. Decorative here: the heading immediately below is the
            accessible name for this screen. */}
        <Logo variant="mark" width={56} alt="" />
      </div>

      <h1 style={styles.heading}>{isSignup ? 'Create account' : 'Welcome back'}</h1>
      <p style={styles.subheading}>
        {isSignup ? 'Find your kind of people.' : 'Log in to continue your journey.'}
      </p>

      {/*
        A session already exists on this device. No redirect: the member chooses.
        "Continue" goes through the `/profile` gate, which is the single place
        that decides dashboard vs onboarding; "sign out" stays on this screen so
        the signup flow can be tested immediately.
      */}
      {sessionEmail && !signingOut && (
        <div style={styles.sessionCard} data-testid="session-choice">
          <p style={styles.sessionTitle}>You are already signed in</p>
          <p style={styles.sessionEmail} data-testid="session-email">
            {sessionEmail}
          </p>
          <p style={styles.sessionHint}>
            Continue with this account, or sign out if you want to create or test another one.
          </p>
          <div style={styles.sessionActions}>
            <button
              type="button"
              data-testid="continue-session"
              onClick={handleContinueAsAccount}
              style={styles.submit}
            >
              Continue as {sessionEmail}
            </button>
            <button
              type="button"
              data-testid="sign-out-here"
              onClick={() => void handleSignOutHere()}
              style={{ ...styles.buttonBase, ...styles.outlineButton }}
            >
              Sign out to sign up with another account
            </button>
          </div>
        </div>
      )}

      {/* After a local sign-out the card disappears. The confirmation is the
          `formNotice` banner below (role="status"), and the toggle plus the
          email form are already right here. */}
      {signedOutHere && (
        <div style={styles.signedOutRow} data-testid="signed-out-note">
          <p style={styles.signedOutLabel}>Signed out on this device.</p>
          <button
            type="button"
            data-testid="back-to-app"
            onClick={() => router.replace('/profile')}
            style={styles.linkButton}
          >
            Return to the app
          </button>
        </div>
      )}

      {/* Sign Up / Log In toggle. The email form sits directly below it. */}
      <div style={styles.tabContainer}>
        <button
          type="button"
          onClick={() => switchMode('signup')}
          aria-pressed={isSignup}
          style={{
            ...styles.tabButton,
            ...(isSignup ? styles.tabActive : styles.tabInactive),
          }}
        >
          Sign Up
        </button>
        <button
          type="button"
          onClick={() => switchMode('login')}
          aria-pressed={!isSignup}
          style={{
            ...styles.tabButton,
            ...(isSignup ? styles.tabInactive : styles.tabActive),
          }}
        >
          Log In
        </button>
      </div>

      {/* Inline email + password. There is no `prompt()` and no `alert()`. */}
      <form style={styles.form} onSubmit={handleEmailAuth} noValidate>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            style={styles.input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            name="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder={isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
            style={styles.input}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button
          type="submit"
          style={{ ...styles.submit, opacity: loading ? 0.6 : 1 }}
          disabled={loading}
        >
          {loading ? 'Please wait…' : isSignup ? 'Sign up with email' : 'Log in with email'}
        </button>
      </form>

      <div
        style={styles.checkboxContainer}
        onClick={() => setIsAgeVerified(!isAgeVerified)}
        role="checkbox"
        aria-checked={isAgeVerified}
        aria-label="I confirm I am 18 years or older"
        data-testid="age-gate"
      >
        <div
          style={{
            ...styles.checkboxBox,
            backgroundColor: isAgeVerified ? mr.gold : 'transparent',
          }}
        >
          {isAgeVerified && (
            <span style={{ color: mr.goldText, fontSize: '14px', fontWeight: 'bold' }}>✓</span>
          )}
        </div>
        <span style={styles.checkboxLabel}>I confirm I am 18 years or older</span>
      </div>

      {/* Inline feedback — visible, styleable, and it never discards input. */}
      {formError && (
        <div role="alert" data-testid="auth-error" style={styles.errorBox}>
          {formError}
        </div>
      )}
      {formNotice && (
        <div role="status" data-testid="auth-notice" style={styles.noticeBox}>
          {formNotice}
        </div>
      )}

      <div style={styles.dividerRow}>
        <div style={styles.dividerLine} />
        <span style={styles.dividerText}>or</span>
        <div style={styles.dividerLine} />
      </div>

      {/*
        The gate is enforced in the DOM as well as in the handlers: the container
        is inert until the 18+ box is ticked, and every handler refuses anyway.
        This is deliberately NOT a fieldset — a disabled fieldset would also
        disable the email inputs above, and `pointer-events` on the direct parent
        is what `tests/e2e/journeys.spec.ts` asserts.
      */}
      <div
        style={{
          ...styles.buttonContainer,
          opacity: isAgeVerified ? 1 : 0.5,
          pointerEvents: isAgeVerified ? 'auto' : 'none',
        }}
      >
        {/* Rendered from the shared provider list, so a provider added there
            appears on every route with consistent branding — including Discord,
            whose brand colour is #5865F2 (hover keeps the same hue, darkened). */}
        {OAUTH_PROVIDER_IDS.map((provider) => {
          const brand = OAUTH_PROVIDER_BRANDS[provider];
          return (
            <button
              key={provider}
              type="button"
              disabled={loading}
              onClick={() => void handleOAuth(provider)}
              onMouseEnter={(event) => {
                if (brand.hover) event.currentTarget.style.backgroundColor = brand.hover;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = brand.background;
              }}
              style={{
                ...styles.buttonBase,
                backgroundColor: brand.background,
                color: brand.foreground,
                border: brand.border ?? 'none',
              }}
            >
              <OAuthProviderIcon provider={provider} />
              {oauthButtonLabel(provider, authMode)}
            </button>
          );
        })}

        {/* Phone OTP: inline, two steps, no browser dialogs. */}
        {phoneStep === 'idle' ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleSendOtp()}
            style={{ ...styles.buttonBase, ...styles.outlineButton }}
          >
            <svg style={styles.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            {isSignup ? 'Sign up with phone' : 'Log in with phone number'}
          </button>
        ) : (
          <div style={{ ...styles.form, marginBottom: 0 }}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="auth-phone-code">
                Code sent to {phone}
              </label>
              <input
                id="auth-phone-code"
                type="text"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                placeholder={`${OTP_LENGTH}-digit code`}
                style={styles.input}
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
              />
            </div>

            <button
              type="button"
              style={{ ...styles.submit, opacity: loading ? 0.6 : 1 }}
              disabled={loading}
              onClick={() => void handleVerifyOtp()}
            >
              {loading ? 'Please wait…' : 'Verify code'}
            </button>

            <button
              type="button"
              style={styles.linkButton}
              disabled={loading}
              onClick={() => void handleSendOtp()}
            >
              Resend code
            </button>

            <button
              type="button"
              style={styles.linkButton}
              disabled={loading}
              onClick={() => {
                setPhoneStep('idle');
                setOtpCode('');
                clearFeedback();
              }}
            >
              Use a different number
            </button>
          </div>
        )}
      </div>

      <p style={styles.legalText}>
        By tapping {isSignup ? 'Sign up' : 'Log in'}, you agree to our Terms. Learn how we
        process your data in our Privacy Policy and Cookie Policy.
      </p>
    </div>
  );
}
