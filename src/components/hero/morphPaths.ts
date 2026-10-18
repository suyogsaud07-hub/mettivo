/**
 * The morph geometry — every figure that becomes part of the logo.
 *
 * ============================ READ THIS FIRST ============================
 * Framer Motion animates the SVG `d` attribute by interpolating the NUMBERS in
 * the string; the command letters and their order must be IDENTICAL between the
 * `from` and `to` path of a pair. If they differ the morph is not interpolated
 * at all — it snaps.
 *
 * Every pair below was generated from an anchor list through the SAME closed
 * Catmull-Rom routine, so each `from` and its `to` share a command signature
 * exactly:
 *   * MAN_BODY / WOMAN_BODY → `M` + 14 cubics + `Z`
 *   * HEART                 → `M` + 8 cubics + `Z`
 *   * ROSE                  → `M` + 8 cubics + `Z`
 *
 * `assertMorphCompatibility()` prints the offending pair in dev if that ever
 * drifts. The figures are solid, minimal silhouettes (head → shoulders → body)
 * so their outline maps cleanly onto the two strokes of the "M".
 *
 * Coordinate system: the hero's world space, `0 0 1000 640`. A figure's `from`
 * is drawn around the ORIGIN and positioned by its group's transform while the
 * story plays; during the morph the group returns to the origin while `d`
 * travels to its world-space logo target.
 * ==========================================================================
 */

/** The hero scene's coordinate system. Both the story and the logo live here. */
export const HERO_VIEW_BOX = '0 0 1000 640';

export interface MorphPair {
  /** The active-phase shape (drawn around the origin). */
  from: string;
  /** The logo-phase shape, in world space. */
  to: string;
}

/** Man's silhouette → the left stroke of the "M". */
export const MAN_BODY: MorphPair = {
  from: 'M 0 -150 C 11.3 -150 26 -147.7 34 -142 C 42 -136.3 46 -125 48 -116 C 50 -107 43.3 -97 46 -88 C 48.7 -79 58 -75 64 -62 C 70 -49 79.3 -40.3 82 -10 C 84.7 20.3 93.7 88.3 80 120 C 66.3 151.7 26.7 180 0 180 C -26.7 180 -66.3 151.7 -80 120 C -93.7 88.3 -84.7 20.3 -82 -10 C -79.3 -40.3 -70 -49 -64 -62 C -58 -75 -48.7 -79 -46 -88 C -43.3 -97 -50 -107 -48 -116 C -46 -125 -42 -136.3 -34 -142 C -26 -147.7 -11.3 -150 0 -150 Z',
  to: 'M 362 200 C 363.3 198.3 373.3 207.3 378 214 C 382.7 220.7 385.5 230.7 390 240 C 394.5 249.3 398.3 259.2 405 270 C 411.7 280.8 420.5 292.7 430 305 C 439.5 317.3 452.7 332.8 462 344 C 471.3 355.2 479.7 365.3 486 372 C 492.3 378.7 502.3 383 500 384 C 497.7 385 481.7 383.3 472 378 C 462.3 372.7 451.3 362 442 352 C 432.7 342 423.7 329 416 318 C 408.3 307 401.7 296.3 396 286 C 390.3 275.7 386.3 266.3 382 256 C 377.7 245.7 373.3 233.3 370 224 C 366.7 214.7 360.7 201.7 362 200 Z',
};

/** Woman's silhouette → the right stroke of the "M". */
export const WOMAN_BODY: MorphPair = {
  from: 'M 0 -152 C 10.7 -152 24.3 -151.3 32 -146 C 39.7 -140.7 43.7 -129 46 -120 C 48.3 -111 43.7 -101 46 -92 C 48.3 -83 55.3 -78.7 60 -66 C 64.7 -53.3 66.7 -50.3 74 -16 C 81.3 18.3 116.3 107 104 140 C 91.7 173 34.7 182 0 182 C -34.7 182 -91.7 173 -104 140 C -116.3 107 -81.3 18.3 -74 -16 C -66.7 -50.3 -64.7 -53.3 -60 -66 C -55.3 -78.7 -48.3 -83 -46 -92 C -43.7 -101 -48.3 -111 -46 -120 C -43.7 -129 -39.7 -140.7 -32 -146 C -24.3 -151.3 -10.7 -152 0 -152 Z',
  to: 'M 638 200 C 636.7 198.3 626.7 207.3 622 214 C 617.3 220.7 614.5 230.7 610 240 C 605.5 249.3 601.7 259.2 595 270 C 588.3 280.8 579.5 292.7 570 305 C 560.5 317.3 547.3 332.8 538 344 C 528.7 355.2 520.3 365.3 514 372 C 507.7 378.7 497.7 383 500 384 C 502.3 385 518.3 383.3 528 378 C 537.7 372.7 548.7 362 558 352 C 567.3 342 576.3 329 584 318 C 591.7 307 598.3 296.3 604 286 C 609.7 275.7 613.7 266.3 618 256 C 622.3 245.7 626.7 233.3 630 224 C 633.3 214.7 639.3 201.7 638 200 Z',
};

/** The lean-in heart → the small heart in the "M" valley. */
export const HEART: MorphPair = {
  from: 'M 0 34 C 8 34 18.3 25 24 18 C 29.7 11 34.3 0 34 -8 C 33.7 -16 27.7 -28 22 -30 C 16.3 -32 7.3 -20 0 -20 C -7.3 -20 -16.3 -32 -22 -30 C -27.7 -28 -33.7 -16 -34 -8 C -34.3 0 -29.7 11 -24 18 C -18.3 25 -8 34 0 34 Z',
  to: 'M 500 460 C 512 460 527.3 441.3 536 432 C 544.7 422.7 552 412.3 552 404 C 552 395.7 544.7 383.3 536 382 C 527.3 380.7 512 396 500 396 C 488 396 472.7 380.7 464 382 C 455.3 383.3 448 395.7 448 404 C 448 412.3 455.3 422.7 464 432 C 472.7 441.3 488 460 500 460 Z',
};

/** The bloom → the rose at the foot of the logo. */
export const ROSE: MorphPair = {
  from: 'M 0 -28 C 6.7 -28 15.3 -24.7 20 -20 C 24.7 -15.3 28 -6.7 28 0 C 28 6.7 24.7 15.3 20 20 C 15.3 24.7 6.7 28 0 28 C -6.7 28 -15.3 24.7 -20 20 C -24.7 15.3 -28 6.7 -28 0 C -28 -6.7 -24.7 -15.3 -20 -20 C -15.3 -24.7 -6.7 -28 0 -28 Z',
  to: 'M 500 488 C 508 488 518.3 491 524 496 C 529.7 501 534 510.7 534 518 C 534 525.3 529.7 535 524 540 C 518.3 545 508 548 500 548 C 492 548 481.7 545 476 540 C 470.3 535 466 525.3 466 518 C 466 510.7 470.3 501 476 496 C 481.7 491 492 488 500 488 Z',
};

/** The logo's own full mark, for the `<MettivoLogo />` component. */
export const LOGO_MARK = {
  left: MAN_BODY.to,
  right: WOMAN_BODY.to,
  heart: HEART.to,
  rose: ROSE.to,
} as const;

/**
 * The command signature of a path: the letters and separators left after every
 * number is stripped. Two paths are morphable when their signatures are equal.
 */
export function pathSignature(d: string): string {
  return d.replace(/-?\d*\.?\d+(e[-+]?\d+)?/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Dev-only guard. Logs the offending pair if a `from`/`to` command structure
 * drifts apart. Silent in production, and never throws.
 */
export function assertMorphCompatibility(): void {
  if (process.env.NODE_ENV === 'production') return;

  const pairs: Array<[string, MorphPair]> = [
    ['MAN_BODY', MAN_BODY],
    ['WOMAN_BODY', WOMAN_BODY],
    ['HEART', HEART],
    ['ROSE', ROSE],
  ];

  for (const [name, pair] of pairs) {
    if (pathSignature(pair.from) !== pathSignature(pair.to)) {
      console.error(
        `[AnimatedHero] Morph pair "${name}" is not compatible:\n` +
          `  from: ${pathSignature(pair.from)}\n` +
          `  to:   ${pathSignature(pair.to)}\n` +
          `Both paths must use the same SVG commands in the same order.`,
      );
    }
  }
}
