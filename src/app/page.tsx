'use client';

import Link from 'next/link';
import InstallButton from '@/app/components/InstallButton';
import FounderLetterLink from '@/app/components/FounderLetterLink';
import Logo from '@/components/Logo';
import LanguagePicker from '@/app/components/LanguagePicker';
import { useLanguage } from '../context/LanguageContext';

/**
 * The public landing page. It is for EVERYONE and it never redirects.
 *
 * HISTORY — why the session logic is gone
 *   This page used to call `supabase.auth.getSession()` on mount and
 *   `router.replace()` a signed-in visitor straight into the app (`/profile` or
 *   `/discover`). That made the page unreachable for members — pressing Back
 *   bounced you out again — and formed a redirect cycle with the auth screen,
 *   which pushed authenticated visitors back into the app. A later iteration kept
 *   the session read only to swap the CTA label for "Go to Dashboard" ->
 *   `/profile`, which still pushed whoever clicked it into the onboarding gate
 *   instead of the signup surface.
 *
 *   There is no session read here any more, and therefore nothing on this page
 *   can bounce, loop, or trap anybody: it renders identically for a signed-out
 *   visitor and for a member, and its single job is to hand people to the auth
 *   surface.
 *
 * THE CALL TO ACTION
 *   One primary sandy-gold button — "Let's Get Started" — and it always opens
 *   `/signup`, which renders `AuthPanel`: inline email + password, Google,
 *   Facebook, Twitter, Discord and phone sign-up, in the Midnight Romance
 *   palette. A visitor who already holds a session is asked *there* whether to
 *   continue (that is where the dashboard lives) or sign out; nobody is bounced
 *   into onboarding or the dashboard by this page.
 */

/**
 * The one destination of the primary call to action.
 *
 * `/signup` and `/auth` render the same `AuthPanel` (one component, two routes),
 * so this is also the login surface — the panel opens on Sign Up with a Log In
 * toggle. `/signup` is the destination because the CTA is a signup invitation;
 * the already-signed-in case is handled on that screen, not here.
 */
const SIGNUP_HREF = '/signup';

/**
 * Midnight Romance tokens, read from `globals.css` (`:root`).
 *
 * Every colour on this page comes from the shared token set rather than a local
 * literal, so the landing page cannot drift from the auth screen again. The old
 * literals (`#0D0A10` page, `#1C1822` surface, `#D4B18A` gold) were a visibly
 * different plum from the `AuthPanel` surface. The fallbacks repeat the token
 * values so the page is still correct before the stylesheet loads.
 *
 *   --mr-page          #131017  deep dark plum page
 *   --mr-card          #211a28  eggplant surface
 *   --mr-card-border   #34283f
 *   --mr-gold          #d8b38a  sandy gold accent
 *   --mr-gold-text     #1a130c
 *   --mr-heading       #eae2f0
 *   --mr-placeholder   #9b8ba6
 *   --mr-inactive-text #b4a3c0
 */
const mr = {
  page: 'var(--mr-page, #131017)',
  card: 'var(--mr-card, #211a28)',
  border: 'var(--mr-card-border, #34283f)',
  gold: 'var(--mr-gold, #d8b38a)',
  goldText: 'var(--mr-gold-text, #1a130c)',
  heading: 'var(--mr-heading, #eae2f0)',
  muted: 'var(--mr-placeholder, #9b8ba6)',
  soft: 'var(--mr-inactive-text, #b4a3c0)',
} as const;

export default function LandingPage() {
  const { t } = useLanguage();

  const styles = {
    container: { minHeight: '100vh', backgroundColor: mr.page, color: mr.heading, fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' as const },
    // `flexWrap` lets the header's right-hand group (language picker + letter
    // pill) drop below the logo on a narrow phone instead of overflowing.
    topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, rowGap: '12px', padding: '24px 30px', zIndex: 50 },
    // The grouped right side: language picker then Founder's Letter, `gap-3`
    // (12px) apart so the two pills sit as one cluster.
    topBarActions: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoWrapper: { display: 'flex', alignItems: 'center', gap: '12px' },
    logoText: { display: 'flex', flexDirection: 'column' as const, gap: '2px' },
    logoTitle: { fontSize: '16px', fontWeight: '800', color: mr.heading, letterSpacing: '4px', lineHeight: '1' },
    logoSubtitle: { fontSize: '8px', fontWeight: '600', color: mr.gold, letterSpacing: '2px', lineHeight: '1' },
    main: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', padding: '20px', textAlign: 'center' as const, zIndex: 10 },
    title: { fontSize: '48px', fontWeight: '800', color: mr.heading, marginBottom: '8px', letterSpacing: '-1px', lineHeight: '1.2' },
    subtitle: { fontSize: '24px', fontWeight: '500', color: mr.gold, marginBottom: '16px' },
    description: { fontSize: '15px', color: mr.muted, maxWidth: '320px', marginBottom: '40px', lineHeight: '1.5' },
    buttonContainer: { width: '100%', maxWidth: '280px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    primaryBtn: { backgroundColor: mr.gold, color: mr.goldText, padding: '16px', borderRadius: '30px', fontSize: '16px', fontWeight: '700', border: 'none', cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' as const },
    footer: { padding: '24px', textAlign: 'center' as const, fontSize: '13px', color: mr.soft },
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <div style={styles.logoWrapper}>
          {/* The new brand mark: intertwined figures forming the "M", with the
              heart and the rose. One component, so every surface draws the same
              artwork — there is no inline copy left to drift. */}
          <Logo variant="mark" width={44} alt="" />
          <div style={styles.logoText}>
            <span style={styles.logoTitle}>METTIVO</span>
            <span style={styles.logoSubtitle}>YOUR NEXT CONNECTION</span>
          </div>
        </div>

        <div style={styles.topBarActions}>
          {/*
            The global language picker. Choosing a language writes the preference
            and re-renders every `useLanguage()` consumer, so the copy around it
            changes immediately — it is not a decorative menu.
          */}
          <LanguagePicker />

          {/*
            The founder's Welcome Letter, sitting right beside the language
            picker so the two pills form one right-hand group. The floating
            corner pill below points at the same `/letter` route.
          */}
          <FounderLetterLink variant="header" label="Letter" />
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
            THE one primary action: "Let's Get Started" -> `/signup`.

            A plain link, not a handler with a redirect, so there is nothing here
            that can race, loop, or bounce a visitor: the browser navigates to
            the signup surface and the full choice of sign-in methods is on
            screen. There is deliberately no second "dashboard" button — this
            page's job is the signup invitation, and the account-with-a-session
            choice lives on the auth screen.
          */}
          <Link href={SIGNUP_HREF} style={styles.primaryBtn} data-testid="landing-primary-cta">
            {t('get_started')}
          </Link>

          <InstallButton />
        </div>
      </div>

      <div style={styles.footer}>
        <p>{t('footer_text')}</p>
        <p style={{ fontSize: '11px', marginTop: '8px', opacity: 0.7 }}>© 2026 Mettivo. All rights reserved.</p>
      </div>

      {/*
        The second entry point to the letter: a floating pill in the bottom-left
        corner, so it stays visible wherever the visitor has scrolled to.
      */}
      <FounderLetterLink variant="corner" />
    </div>
  );
}
