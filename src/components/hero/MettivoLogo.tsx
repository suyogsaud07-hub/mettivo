'use client';

import LogoMark from './LogoMark';
import { HERO_VIEW_BOX } from './morphPaths';

/**
 * The hero's METTIVO logo.
 *
 * The mark is the official artwork (`LogoMark` → `public/logo-mark.svg`), placed
 * in the hero's `0 0 1000 640` world so the character morph can land on its
 * exact geometry. This component is also the static/accessible fallback: the
 * composer renders only the wordmark (`showMark={false}`) because the mark is
 * already formed by the morphed figures.
 */
export interface MettivoLogoProps {
  /** Draw the official mark. Default true. */
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
      {showMark && <LogoMark phase="logo" animated={false} />}

      {showWordmark && (
        <>
          <text
            x="500"
            y="600"
            textAnchor="middle"
            fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
            fontSize="54"
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
            fontSize="19"
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
