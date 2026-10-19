/**
 * Hero geometry: the stage, the kiss accent, and the official METTIVO mark.
 *
 * ============================ READ THIS FIRST ============================
 * The final mark is NOT invented here. Every stroke, head, heart petal and rose
 * petal below is copied verbatim from the official brand artwork in
 * `public/logo-mark.svg` / `src/components/Logo.tsx` (authored in the mark's
 * own `240 0 520 870` coordinate system). `LOGO_TO_HERO` places that artwork in
 * the hero's `0 0 1000 640` world without touching its proportions.
 *
 * The people are anatomically complex; the mark is a set of thick strokes with
 * different topology. Forcing a body outline through a single `d` interpolation
 * is what produced the old melting-blob (and the V-shaped target). The morph is
 * therefore staged: the detailed rig fades and simplifies into a tapered body,
 * then the real strokes draw over it, then the heart and rose resolve. See
 * `AnimatedHero` for the choreography.
 * ==========================================================================
 */

/** The hero scene's coordinate system. Both the story and the logo live here. */
export const HERO_VIEW_BOX = '0 0 1000 640';

/** The ground the characters stand on. */
export const GROUND_Y = 520;

/** Where their faces meet, in world space. */
export const KISS_POINT = { x: 500, y: 206 } as const;
export const KISS_HEART_POINT = { x: 500, y: 160 } as const;

/**
 * The official mark's centre in its own artwork is (500, 426). Placing it at
 * (500, 300) at 54% keeps the two heads tucked under the nav, the feet clear of
 * the wordmark, and the mark's width comfortably inside a phone viewport.
 */
export const LOGO_TO_HERO = 'translate(500 300) scale(0.54) translate(-500 -426)';
export const LOGO_SCALE = 0.54;
export const LOGO_ORIGIN = { x: 500, y: 426 } as const;
export const LOGO_CENTER = { x: 500, y: 300 } as const;

/** Map a point from the official mark's space into the hero's space. */
export function logoPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: LOGO_CENTER.x + (x - LOGO_ORIGIN.x) * LOGO_SCALE,
    y: LOGO_CENTER.y + (y - LOGO_ORIGIN.y) * LOGO_SCALE,
  };
}

/** The three official gold tones, in mark order: deep (far), mid, light. */
export type LogoStrokeTone = 'deep' | 'mid' | 'light';

export interface LogoStroke {
  /** The official centreline, in mark coordinates. */
  d: string;
  /** The official stroke width, in mark units. */
  width: number;
  /**
   * Which of the official gradients paints this stroke. The artwork is NOT a
   * flat gold: the far pair is `deep`, the near ARMS are `mid`, and only the
   * near LEGS are `light` — that split is what gives the crossing its depth.
   */
  tone: LogoStrokeTone;
}

/** The far pair (drawn first, in the deeper gold). */
export const LOGO_FAR_STROKES: readonly LogoStroke[] = [
  // Crossed far arms — the valley of the M.
  { d: 'M 386 258 Q 418 372 500 392 Q 582 372 614 258', width: 50, tone: 'deep' },
  // Far legs.
  { d: 'M 392 292 C 378 404 348 574 300 700 C 276 750 270 796 300 808', width: 66, tone: 'deep' },
  { d: 'M 608 292 C 622 404 652 574 700 700 C 724 750 730 796 700 808', width: 66, tone: 'deep' },
];

/** The near pair (drawn last, with the lift shadow). */
export const LOGO_NEAR_STROKES: readonly LogoStroke[] = [
  // Near arms cross the other way, completing the M. Mid gold — not light.
  { d: 'M 404 258 Q 452 396 552 346 Q 602 318 626 248', width: 46, tone: 'mid' },
  { d: 'M 596 258 Q 548 396 448 346 Q 398 318 374 248', width: 46, tone: 'mid' },
  // Near legs are the lightest strokes in the mark.
  { d: 'M 412 292 C 394 400 356 560 306 694 C 282 744 284 790 318 806', width: 80, tone: 'light' },
  { d: 'M 588 292 C 606 400 644 560 694 694 C 718 744 716 790 682 806', width: 80, tone: 'light' },
];

/** The two heads, from the official artwork. The right is deliberately lower. */
export const LOGO_HEADS = [
  { cx: 408, cy: 98, r: 72, tone: 'left' as const },
  { cx: 562, cy: 116, r: 64, tone: 'right' as const },
] as const;

/** The heart resting in the valley, from the official artwork. */
export const LOGO_HEART =
  'M 500 200 C 500 180 476 174 469 189 C 460 206 476 220 500 238 C 524 220 540 206 531 189 C 524 174 500 180 500 200 Z';

/** The rose at the foot of the mark, from the official artwork. */
export const LOGO_ROSE = {
  stem: 'M 506 508 C 514 572 520 636 524 700',
  leafRight: 'M 512 598 C 534 584 554 590 560 606 C 546 620 526 616 512 598 Z',
  leafLeft: 'M 517 650 C 495 638 477 646 473 662 C 487 674 506 668 517 650 Z',
  bloom: { cx: 509, cy: 478, r: 28 },
  petalOuter:
    'M 493 458 C 517 443 543 458 536 480 C 530 496 510 500 499 489 C 492 481 494 469 505 464',
  petalInner: 'M 499 474 C 510 469 521 475 519 486 C 517 495 506 499 501 493',
} as const;

/**
 * The small heart that blooms where their faces meet (world space origin).
 * It is the emotional beat before the mark; the official heart takes over
 * during the morph.
 */
export const KISS_HEART =
  'M 0 18 C 6 18 13 11 15 6 C 17 1 14 -6 9 -8 C 5 -9 2 -5 0 -3 C -2 -5 -5 -9 -9 -8 C -14 -6 -17 1 -15 6 C -13 11 -6 18 0 18 Z';

/**
 * Dev-only guard: no path may be empty, unclosed, or contain non-finite data.
 * Runs once on mount; silent in production and never throws.
 */
export function assertLogoGeometry(): void {
  if (process.env.NODE_ENV === 'production') return;

  const strokes: Array<[string, string]> = [
    ...LOGO_FAR_STROKES.map((stroke, index) => [`far[${index}]`, stroke.d] as [string, string]),
    ...LOGO_NEAR_STROKES.map((stroke, index) => [`near[${index}]`, stroke.d] as [string, string]),
    ['rose.stem', LOGO_ROSE.stem],
  ];
  const filled: Array<[string, string]> = [
    ['heart', LOGO_HEART],
    ['rose.leafRight', LOGO_ROSE.leafRight],
    ['rose.leafLeft', LOGO_ROSE.leafLeft],
    ['kissHeart', KISS_HEART],
  ];

  for (const [name, d] of [...strokes, ...filled]) {
    if (!d.trim().startsWith('M')) {
      console.error(`[AnimatedHero] Logo path "${name}" does not start with M.`);
      continue;
    }
    if (/NaN|Infinity/.test(d)) {
      console.error(`[AnimatedHero] Logo path "${name}" contains a non-finite number.`);
    }
  }

  // Stroked centrelines are deliberately open; only filled shapes must close.
  for (const [name, d] of filled) {
    if (!/Z\s*$/.test(d)) {
      console.error(`[AnimatedHero] Filled path "${name}" is not closed.`);
    }
  }
}
