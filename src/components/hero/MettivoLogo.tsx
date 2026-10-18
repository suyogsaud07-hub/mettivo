'use client';

import { LOGO_MARK, HERO_VIEW_BOX } from './morphPaths';

/**
 * The hero's METTIVO logo — the morph target.
 *
 * NOT the production brand mark (that is `src/components/Logo.tsx`). This one is
 * authored in the hero's own world space (`0 0 1000 640`) so the character
 * silhouettes can morph onto its exact coordinates.
 *
 * `showMark` lets the orchestrator render only the wordmark when the mark is
 * already on screen (formed by the morphed characters) — otherwise the two
 * would draw on top of each other.
 */
export interface MettivoLogoProps {
  /** Draw the abstract "M" (two strokes + heart + rose). Default true. */
  showMark?: boolean;
  /** Draw the METTIVO wordmark and tagline. Default true. */
  showWordmark?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function MettivoLogo({
  showMark = true,
  showWordmark = true,
  className,
  style,
}: MettivoLogoProps) {
  return (
    <svg
      viewBox={HERO_VIEW_BOX}
      className={className}
      style={{ display: 'block', pointerEvents: 'none', ...style }}
      aria-label={showWordmark ? 'Mettivo' : undefined}
      role={showWordmark ? 'img' : 'presentation'}
    >
      {showMark && (
        <>
          {/* The two strokes of the "M". */}
          <path d={LOGO_MARK.left} fill="url(#heroGold)" />
          <path d={LOGO_MARK.right} fill="url(#heroGold)" />
          {/* Heart in the valley, rose at the foot. */}
          <path d={LOGO_MARK.heart} fill="url(#heroHeart)" />
          <path d={LOGO_MARK.rose} fill="url(#heroRose)" />
          <path d="M 500 538 C 502 556 504 574 505 590" fill="none" stroke="#4a1c2e" strokeWidth="5" strokeLinecap="round" />
        </>
      )}

      {showWordmark && (
        <>
          <text
            x="500"
            y="600"
            textAnchor="middle"
            fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
            fontSize="58"
            fontWeight={300}
            letterSpacing="8"
            fill="#eae2f0"
          >
            METTIVO
          </text>
          <text
            x="500"
            y="630"
            textAnchor="middle"
            fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
            fontSize="20"
            fontWeight={300}
            letterSpacing="2.6"
            fill="#d8b38a"
          >
            Your Next Connection
          </text>
        </>
      )}
    </svg>
  );
}
