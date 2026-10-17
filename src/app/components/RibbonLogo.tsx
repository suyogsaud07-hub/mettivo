'use client';

/**
 * The Mettivo brand mark rendered as a single flowing ribbon.
 *
 * The ribbon is drawn as one continuous "M": two rising strokes that meet in a
 * valley, with a small heart nested where they cross — the same "two figures
 * forming an M, with a heart and rose" idea as `Logo`, but flattened into one
 * solid Champagne Gold line so it reads cleanly at nav size.
 *
 * It is a client component only because it holds no state; the `'use client'`
 * directive keeps it consistent with the other header widgets (language picker,
 * drawer trigger) that are interactive.
 */

export default function RibbonLogo({ width = 32 }: { width?: number }) {
  const height = width;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#D4B18A"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* The continuous ribbon "M": left figure rises to the valley, right
          figure mirrors it down. */}
      <path d="M5 22 Q6 4 10 14 Q14 4 16 22" />
      {/* The heart nested at the valley where the two figures meet. */}
      <path
        d="M11 14 Q10 12 9 11 Q8 10 9 9 Q10 8 11 11 Q12 8 13 11 Q14 9 15 10 Q16 11 15 12 Q14 14 12 16 Q10 14 11 14 Z"
        fill="#D4B18A"
      />
    </svg>
  );
}
