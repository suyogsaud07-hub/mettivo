import Link from 'next/link';
import type { Metadata } from 'next';
import Logo from '@/components/Logo';
import { WELCOME_LETTER } from '@/lib/welcome-letter';

/**
 * The founder's Welcome Letter.
 *
 * A public, static route — it renders the same for a signed-out visitor and a
 * member, and it reads its copy from `src/lib/welcome-letter.ts` so the letter
 * can be edited without touching this file. There is no data access and no
 * session read here, so the page cannot bounce or loop anybody.
 *
 * The look is the Midnight Romance palette (`#131017` page, `#211a28` card,
 * `#d8b38a` gold) with a serif letter body, so it reads like correspondence
 * rather than another app screen.
 */

export const metadata: Metadata = {
  title: 'A Welcome Letter from the Founder',
  description: 'A short welcome to Mettivo, signed by the founder.',
};

const mr = {
  page: 'var(--mr-page, #131017)',
  card: 'var(--mr-card, #211a28)',
  border: 'var(--mr-card-border, #34283f)',
  gold: 'var(--mr-gold, #d8b38a)',
  heading: 'var(--mr-heading, #eae2f0)',
  muted: 'var(--mr-placeholder, #9b8ba6)',
} as const;

export default function WelcomeLetterPage() {
  const letter = WELCOME_LETTER;

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: mr.page,
      color: mr.heading,
      fontFamily: 'system-ui',
      display: 'flex',
      flexDirection: 'column' as const,
    },
    topBar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 24px',
      borderBottom: `1px solid ${mr.border}`,
    },
    backLink: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: mr.muted,
      textDecoration: 'none',
      fontSize: '13px',
      fontWeight: 600,
      padding: '8px 14px',
      borderRadius: '999px',
      border: `1px solid ${mr.border}`,
      backgroundColor: mr.card,
    },
    brand: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    wordmark: {
      fontSize: '13px',
      fontWeight: 800,
      letterSpacing: '4px',
      color: mr.heading,
    },
    barSpacer: { width: '84px' },
    main: {
      flex: 1,
      display: 'flex',
      justifyContent: 'center',
      padding: '32px 20px 56px 20px',
    },
    card: {
      width: '100%',
      maxWidth: '560px',
      backgroundColor: mr.card,
      border: `1px solid ${mr.border}`,
      borderRadius: '24px',
      padding: '36px 32px',
      boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
    },
    heading: {
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '3px',
      textTransform: 'uppercase' as const,
      color: mr.gold,
      margin: 0,
    },
    rule: {
      height: '1px',
      width: '64px',
      background: `linear-gradient(90deg, ${mr.gold}, transparent)`,
      margin: '16px 0 28px 0',
    },
    salutation: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '22px',
      fontWeight: 600,
      color: mr.heading,
      margin: '0 0 18px 0',
    },
    paragraph: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '18px',
      lineHeight: 1.8,
      color: mr.heading,
      margin: '0 0 18px 22px',
    },
    closing: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '17px',
      color: mr.heading,
      margin: '24px 0 2px 0',
    },
    signature: {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontStyle: 'italic',
      fontSize: '26px',
      color: mr.gold,
      margin: 0,
      letterSpacing: '0.4px',
    },
    footer: {
      padding: '20px 24px 32px 24px',
      textAlign: 'center' as const,
      fontSize: '12px',
      color: mr.muted,
    },
  };

  return (
    <div style={styles.container}>
      <header style={styles.topBar}>
        <Link href="/" style={styles.backLink} data-testid="letter-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </Link>

        <div style={styles.brand}>
          <Logo variant="mark" width={26} alt="" />
          <span style={styles.wordmark}>METTIVO</span>
        </div>

        <span style={styles.barSpacer} aria-hidden />
      </header>

      <main style={styles.main}>
        <article style={styles.card}>
          <p style={styles.heading}>{letter.heading}</p>
          <div style={styles.rule} aria-hidden />

          <p style={styles.salutation}>{letter.salutation}</p>

          {letter.body.map((paragraph) => (
            <p key={paragraph} style={styles.paragraph}>
              {paragraph}
            </p>
          ))}

          <p style={styles.closing}>{letter.closing}</p>
          <p style={styles.signature}>{letter.signature}</p>
        </article>
      </main>

      <footer style={styles.footer}>
        © 2026 Mettivo. All rights reserved.
      </footer>
    </div>
  );
}
