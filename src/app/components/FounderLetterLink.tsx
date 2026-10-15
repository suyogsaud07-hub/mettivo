'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * The trigger that opens the founder's Welcome Letter (`/letter`).
 *
 * WHY ONE COMPONENT, TWO PLACEMENTS
 *   The landing page offers the letter in two spots — a pill in the header, right
 *   beside the language picker, and a floating pill in the bottom corner — so the
 *   same destination cannot be wired two different ways. The only thing that
 *   changes is the surface it sits on, which is what the `variant` prop switches.
 *
 * It is a plain `<Link>`, not a handler, so navigation is a normal client-side
 * route change with nothing that can race or loop (the same reasoning the
 * landing page's primary CTA documents).
 *
 * STYLING
 *   The header variant is a sibling of the language picker chip: same `#211a28`
 *   surface, same `999px` radius and `13px` label, so the two pills read as one
 *   group. It differs only in the accent it reveals on hover/focus — the sandy
 *   gold (`#d8b38a`) — which is why the component is a client component: an
 *   inline style cannot express `:hover`, and the palette already carries all
 *   the colours the interaction needs.
 */

const mr = {
  card: 'var(--mr-card, #211a28)',
  border: 'var(--mr-card-border, #34283f)',
  /** The header pill's own border, a hair darker than the panel border. */
  headerBorder: 'var(--mr-header-border, #32283c)',
  gold: 'var(--mr-gold, #d8b38a)',
  goldText: 'var(--mr-gold-text, #1a130c)',
  heading: 'var(--mr-heading, #eae2f0)',
} as const;

export type FounderLetterVariant = 'header' | 'corner';

export interface FounderLetterLinkProps {
  variant?: FounderLetterVariant;
  label?: string;
}

export default function FounderLetterLink({
  variant = 'header',
  label = "Founder's Letter",
}: FounderLetterLinkProps) {
  const isCorner = variant === 'corner';
  const [hovered, setHovered] = useState(false);

  const style: React.CSSProperties = isCorner
    ? {
        position: 'fixed',
        left: '20px',
        bottom: '20px',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '11px 18px',
        borderRadius: '999px',
        background: `linear-gradient(135deg, ${mr.gold}, #c78c8d)`,
        color: mr.goldText,
        fontSize: '13px',
        fontWeight: 800,
        textDecoration: 'none',
        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
        letterSpacing: '0.2px',
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '999px',
        backgroundColor: mr.card,
        border: `1px solid ${hovered ? mr.gold : mr.headerBorder}`,
        color: hovered ? mr.gold : mr.heading,
        fontSize: '13px',
        fontWeight: 700,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        letterSpacing: '0.3px',
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease',
      };

  return (
    <Link
      href="/letter"
      style={style}
      aria-label="Read the founder's welcome letter"
      data-testid={`founder-letter-${variant}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <svg
        width={isCorner ? 16 : 15}
        height={isCorner ? 16 : 15}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      {label}
    </Link>
  );
}
