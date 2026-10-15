/**
 * The Mettivo logo.
 *
 * WHY A COMPONENT AND NOT JUST THE SVG FILES
 *   `public/logo-mark.svg` and `public/logo-lockup.svg` exist because a PNG icon
 *   and an OG image need a file. Everywhere the logo is drawn IN the app it goes
 *   through this component, so a brand change is one edit rather than six copies
 *   of hand-written `<svg>` — which is exactly what the previous infinity-mark
 *   logo had become (four copies, in four files, with no shared source).
 *
 * TWO VARIANTS
 *   `mark`   — the figures only. Navigation, headers, tight spaces.
 *   `lockup` — the mark plus "METTIVO / Your Next Connection". The landing hero
 *              and the auth screen.
 *
 * ACCESSIBILITY
 *   `alt` is required for the lockup (it introduces the brand) and defaults to
 *   empty for the mark, which is decorative whenever it sits next to the word
 *   "Mettivo" as text. An empty `alt` renders `aria-hidden`, so a screen reader
 *   never reads the brand twice.
 *
 * COLOUR
 *   The palette is baked into gradients rather than driven by `currentColor`:
 *   the mark is gold-on-plum by definition, and a monochrome override would lose
 *   the rose and heart accents that carry the meaning. `titleColor` and
 *   `subtitleColor` are therefore only read in the lockup variant, where a
 *   surface may legitimately want its own text tone.
 */

export type LogoVariant = 'mark' | 'lockup';

/**
 * The mark's own coordinate system, exported.
 *
 * A caller that needs to line type up under the mark (the intro splash) must
 * derive the rendered height from this ratio — the mark's 520:870 box is taller
 * than its ink, so guessing from the width alone puts the text in the wrong
 * place. `public/logo-mark.svg` uses the same value and
 * `scripts/generate-icons.mjs` reads it back out of that file.
 */
export const MARK_VIEW_BOX = '240 0 520 870';

/** Rendered height of the mark for a given width. */
export function markHeightForWidth(width: number): number {
  const [, , , vbWidth, vbHeight] = MARK_VIEW_BOX.split(/\s+/).map(Number);
  return (width * vbHeight) / vbWidth;
}

export interface LogoProps {
  /** Which lockup to draw. Defaults to the full brand lockup. */
  variant?: LogoVariant;
  /** Rendered width. Height follows the aspect ratio. */
  width?: number | string;
  /** Render height; takes precedence over `width` when both are given. */
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Accessible name. Pass `""` (or omit) when the logo is decorative and the
   * brand is already present as text next to it.
   */
  alt?: string;
  /** "METTIVO" colour. Lockup only. Defaults to the brand off-white. */
  titleColor?: string;
  /** Tagline colour. Lockup only. Defaults to the brand muted lavender. */
  subtitleColor?: string;
}

/** Shared gradient ids. All instances draw the same artwork, so they share defs. */
const G = {
  goldLight: 'mv-logo-gold-light',
  goldMid: 'mv-logo-gold-mid',
  goldDeep: 'mv-logo-gold-deep',
  headLeft: 'mv-logo-head-left',
  headRight: 'mv-logo-head-right',
  heart: 'mv-logo-heart',
  rose: 'mv-logo-rose',
  lift: 'mv-logo-lift',
} as const;

const TITLE_DEFAULT = '#eae2f0';
const SUBTITLE_DEFAULT = '#b4a3c0';

/**
 * The artwork, as a fragment so it can be reused by both variants and by the
 * lockup's nested `<svg>` without a second copy of the paths.
 */
function MarkArtwork() {
  return (
    <>
      <defs>
        <linearGradient id={G.goldLight} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f0d8b6" />
          <stop offset="0.5" stopColor="#e0bc93" />
          <stop offset="1" stopColor="#cfab83" />
        </linearGradient>
        <linearGradient id={G.goldMid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0bc93" />
          <stop offset="1" stopColor="#d8b38a" />
        </linearGradient>
        <linearGradient id={G.goldDeep} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfa87e" />
          <stop offset="1" stopColor="#b58c5e" />
        </linearGradient>
        <linearGradient id={G.headLeft} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f0d8b6" />
          <stop offset="1" stopColor="#d8b38a" />
        </linearGradient>
        <linearGradient id={G.headRight} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#e8cba6" />
          <stop offset="1" stopColor="#cfab83" />
        </linearGradient>
        <linearGradient id={G.heart} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#d4a3a5" />
          <stop offset="1" stopColor="#c78c8d" />
        </linearGradient>
        <linearGradient id={G.rose} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#8d4a5f" />
          <stop offset="0.6" stopColor="#5d2b3c" />
          <stop offset="1" stopColor="#4a1c2e" />
        </linearGradient>
        {/*
          Depth for the near pair. `feDropShadow` rather than a hand-built
          blur/offset/composite chain: an earlier version ended the chain with
          feComponentTransfer, which replaced the stroke's own colour with a
          black silhouette and rendered the whole mark black. A drop shadow
          composites OVER the source, so the gradients survive.
        */}
        <filter id={G.lift} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="7" dy="9" stdDeviation="7" floodColor="#1b0f14" floodOpacity="0.32" />
        </filter>
      </defs>

      {/* Far pair: deeper tone, drawn first so the near pair sits in front. */}
      <path
        d="M 386 258 Q 418 372 500 392 Q 582 372 614 258"
        fill="none"
        stroke={`url(#${G.goldDeep})`}
        strokeWidth="50"
        strokeLinecap="round"
      />
      <path
        d="M 392 292 C 378 404 348 574 300 700 C 276 750 270 796 300 808"
        fill="none"
        stroke={`url(#${G.goldDeep})`}
        strokeWidth="66"
        strokeLinecap="round"
      />
      <path
        d="M 608 292 C 622 404 652 574 700 700 C 724 750 730 796 700 808"
        fill="none"
        stroke={`url(#${G.goldDeep})`}
        strokeWidth="66"
        strokeLinecap="round"
      />

      {/* Near pair: the crossing arms and the two legs of the "M". */}
      <g filter={`url(#${G.lift})`}>
        <path
          d="M 404 258 Q 452 396 552 346 Q 602 318 626 248"
          fill="none"
          stroke={`url(#${G.goldMid})`}
          strokeWidth="46"
          strokeLinecap="round"
        />
        <path
          d="M 596 258 Q 548 396 448 346 Q 398 318 374 248"
          fill="none"
          stroke={`url(#${G.goldMid})`}
          strokeWidth="46"
          strokeLinecap="round"
        />
        <path
          d="M 412 292 C 394 400 356 560 306 694 C 282 744 284 790 318 806"
          fill="none"
          stroke={`url(#${G.goldLight})`}
          strokeWidth="80"
          strokeLinecap="round"
        />
        <path
          d="M 588 292 C 606 400 644 560 694 694 C 718 744 716 790 682 806"
          fill="none"
          stroke={`url(#${G.goldLight})`}
          strokeWidth="80"
          strokeLinecap="round"
        />
      </g>

      {/* Heads — the right sits slightly lower and smaller, as in the artwork. */}
      <circle cx="408" cy="98" r="72" fill={`url(#${G.headLeft})`} />
      <circle cx="562" cy="116" r="64" fill={`url(#${G.headRight})`} />

      {/* Heart, resting in the valley where the two figures meet. */}
      <path
        d="M 500 200 C 500 180 476 174 469 189 C 460 206 476 220 500 238 C 524 220 540 206 531 189 C 524 174 500 180 500 200 Z"
        fill={`url(#${G.heart})`}
      />

      {/* Rose: stem through the centre, two leaves, layered petals. */}
      <path
        d="M 506 508 C 514 572 520 636 524 700"
        fill="none"
        stroke="#6b4a3a"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path d="M 512 598 C 534 584 554 590 560 606 C 546 620 526 616 512 598 Z" fill="#5f3346" />
      <path d="M 517 650 C 495 638 477 646 473 662 C 487 674 506 668 517 650 Z" fill="#4a1c2e" />
      <circle cx="509" cy="478" r="28" fill={`url(#${G.rose})`} />
      <path
        d="M 493 458 C 517 443 543 458 536 480 C 530 496 510 500 499 489 C 492 481 494 469 505 464"
        fill="none"
        stroke="#8d4a5f"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M 499 474 C 510 469 521 475 519 486 C 517 495 506 499 501 493"
        fill="none"
        stroke="#a35d72"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </>
  );
}

export default function Logo({
  variant = 'lockup',
  width,
  height,
  className,
  style,
  alt,
  titleColor = TITLE_DEFAULT,
  subtitleColor = SUBTITLE_DEFAULT,
}: LogoProps) {
  const isDecorative = !alt;
  const a11y = isDecorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': alt } as const);

  if (variant === 'mark') {
    // The mark's own coordinate system. Its content spans roughly
    // x 265..735, y 15..826 within this box, so the padding is intentional and
    // symmetric — do not tighten it or the feet clip.
    return (
      <svg
        viewBox="240 0 520 870"
        width={width ?? 44}
        height={height}
        className={className}
        style={{ display: 'block', ...style }}
        {...a11y}
      >
        <MarkArtwork />
      </svg>
    );
  }

  // Lockup frame: 640 x 960.
  //
  // The mark is placed with an explicit `<g transform>` rather than a nested
  // `<svg>`. A nested `<svg>` is subject to `preserveAspectRatio` fitting against
  // the parent viewport: when it did not fit, the browser scaled it down while
  // the sibling `<text>` elements stayed put, so the artwork overlapped the
  // wordmark. A group transform has no such behaviour — the geometry below is
  // exactly what renders.
  //
  // The mark's ink spans x 280..720, y 26..808 in its authored coordinate space,
  // so it is centred in this 640-wide frame by translating -180 (ink then spans
  // 100..540, centred on 320). The frame is deliberately taller than the mark's
  // 808 so the artwork is never clipped by the viewport, and the type sits below
  // it with a clear gap rather than crowding the feet.
  return (
    <svg
      viewBox="0 0 640 1010"
      width={width ?? 260}
      height={height}
      className={className}
      style={{ display: 'block', ...style }}
      {...a11y}
    >
      <g transform="translate(-180,0)">
        <MarkArtwork />
      </g>

      <text
        x="320"
        y="912"
        textAnchor="middle"
        fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
        fontSize="62"
        fontWeight={300}
        letterSpacing="8"
        textLength="430"
        lengthAdjust="spacingAndGlyphs"
        fill={titleColor}
      >
        METTIVO
      </text>
      <text
        x="320"
        y="952"
        textAnchor="middle"
        fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
        fontSize="22"
        fontWeight={300}
        letterSpacing="2.6"
        textLength="286"
        lengthAdjust="spacingAndGlyphs"
        fill={subtitleColor}
      >
        Your Next Connection
      </text>
    </svg>
  );
}
