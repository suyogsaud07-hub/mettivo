import Link from 'next/link';
import type { Metadata } from 'next';
import Logo from '@/components/Logo';
import ContinueToMettivo from '@/app/components/ContinueToMettivo';
import { WELCOME_LETTER, type WelcomeLetter } from '@/lib/welcome-letter';

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
  goldText: 'var(--mr-gold-text, #1a130c)',
  heading: 'var(--mr-heading, #eae2f0)',
  muted: 'var(--mr-placeholder, #9b8ba6)',
  surface: 'var(--mr-panel, #29202d)',
} as const;

const SERIF = 'Georgia, "Times New Roman", serif';

export default function WelcomeLetterPage() {
  const letter: WelcomeLetter = WELCOME_LETTER;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: mr.page,
        color: mr.heading,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column' as const,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: `1px solid ${mr.border}`,
        }}
      >
        <Link href="/" style={{ ...styles.backLink }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
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

          {letter.donation && (
            <section style={styles.donationSection}>
              <p style={styles.donationHeading}>{letter.donation.heading}</p>
              {letter.donation.body.map((paragraph) => (
                <p key={paragraph} style={styles.donationParagraph}>
                  {paragraph}
                </p>
              ))}
              <Link
                href={letter.donation.ctaHref}
                style={styles.donationButton}
              >
                {letter.donation.ctaLabel}
              </Link>
            </section>
          )}
        <div style={{ marginTop: '32px', textAlign: 'center' as const }}>
          <ContinueToMettivo />
        </div>
        </article>
      </main>

      <footer style={styles.footer}>
        © 2026 Mettivo. All rights reserved.
      </footer>
    </div>
  );
}

const styles = {
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
  } as React.CSSProperties,
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,
  wordmark: {
    fontSize: '13px',
    fontWeight: 800,
    letterSpacing: '4px',
    color: mr.heading,
  } as React.CSSProperties,
  barSpacer: { width: '84px' } as React.CSSProperties,
  main: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    padding: '32px 20px 56px 20px',
  } as React.CSSProperties,
  card: {
    width: '100%',
    maxWidth: '560px',
    backgroundColor: mr.card,
    border: `1px solid ${mr.border}`,
    borderRadius: '24px',
    padding: '40px 32px',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
  } as React.CSSProperties,
  heading: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '3px',
    textTransform: 'uppercase' as const,
    color: mr.gold,
    margin: 0,
  } as React.CSSProperties,
  rule: {
    height: '1px',
    width: '64px',
    background: `linear-gradient(90deg, ${mr.gold}, transparent)`,
    margin: '16px 0 28px 0',
  } as React.CSSProperties,
  salutation: {
    fontFamily: SERIF,
    fontSize: '24px',
    fontWeight: 600,
    color: mr.heading,
    margin: '0 0 24px 0',
  } as React.CSSProperties,
  paragraph: {
    fontFamily: SERIF,
    fontSize: '17px',
    lineHeight: 1.9,
    color: mr.heading,
    margin: '0 0 16px 0',
  } as React.CSSProperties,
  closing: {
    fontFamily: SERIF,
    fontSize: '17px',
    color: mr.heading,
    margin: '30px 0 4px 0',
  } as React.CSSProperties,
  signature: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '26px',
    color: mr.gold,
    margin: 0,
    letterSpacing: '0.4px',
  } as React.CSSProperties,
  donationSection: {
    marginTop: '40px',
    padding: '28px 24px',
    borderRadius: '16px',
    background: `linear-gradient(135deg, ${mr.surface}, ${mr.card})`,
    border: `1px solid ${mr.border}`,
  } as React.CSSProperties,
  donationHeading: {
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '2px',
    textTransform: 'uppercase' as const,
    color: mr.gold,
    margin: '0 0 12px 0',
  } as React.CSSProperties,
  donationParagraph: {
    fontSize: '15px',
    lineHeight: 1.7,
    color: mr.heading,
    margin: '0 0 10px 0',
    fontWeight: 400,
  } as React.CSSProperties,
  donationButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    marginTop: '14px',
    padding: '11px 20px',
    borderRadius: '999px',
    background: `linear-gradient(135deg, ${mr.gold}, #c78c8d)`,
    color: mr.goldText,
    fontSize: '13px',
    fontWeight: 700,
    textDecoration: 'none',
    letterSpacing: '0.2px',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.2s ease',
  } as React.CSSProperties,
  footer: {
    padding: '20px 24px 32px 24px',
    textAlign: 'center' as const,
    fontSize: '12px',
    color: mr.muted,
  } as React.CSSProperties,
};
