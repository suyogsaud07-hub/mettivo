/**
 * The morph geometry — every character part that becomes part of the logo.
 *
 * ============================ READ THIS FIRST ============================
 * Framer Motion animates the SVG `d` attribute by interpolating the NUMBERS in
 * the string; the command letters and their order must be IDENTICAL between the
 * `from` and `to` path of a pair. If they differ, the morph is not interpolated
 * at all — it snaps, and Framer logs a warning.
 *
 * So when you paste in your real vector art:
 *   1. Keep each pair's command sequence EXACTLY equal, e.g. every body path is
 *      `M … C … C … C … Z` (one move, three cubics, close).
 *   2. Keep the same NUMBER of control points, in the same order.
 *   3. Only the coordinate numbers should differ.
 * `assertMorphCompatibility()` below checks this at dev time and tells you
 * precisely which pair is mismatched.
 *
 * The pairs are authored in the hero's world space, `0 0 1000 640`:
 *   * body paths are drawn around the ORIGIN and placed by their group's
 *     transform while the story plays, then the group returns to the origin
 *     during the morph while `d` travels to its world-space logo target;
 *   * the heart and rose do the same.
 * ==========================================================================
 */

/** The hero scene's coordinate system. Both the story and the logo live here. */
export const HERO_VIEW_BOX = '0 0 1000 640';

export interface MorphPair {
  /** The character-phase shape (drawn around the origin). */
  from: string;
  /** The logo-phase shape, in world space. */
  to: string;
}

/** Man's suited silhouette → the left stroke of the "M". `M C C C C Z` both sides. */
export const MAN_BODY: MorphPair = {
  from: 'M -58 -96 C -58 -122 -34 -132 -6 -128 C 40 -120 64 -74 66 12 C 68 156 60 302 54 356 C 18 372 -22 372 -56 356 C -66 252 -64 62 -58 -96 Z',
  to: 'M 348 198 C 374 190 398 218 422 266 C 452 330 488 356 500 384 C 486 446 468 494 452 522 C 408 532 362 532 338 520 C 338 420 342 298 348 198 Z',
};

/** Woman's saree silhouette → the right stroke of the "M". `M C C C C Z` both sides. */
export const WOMAN_BODY: MorphPair = {
  from: 'M -54 -96 C -54 -124 14 -132 44 -118 C 58 -60 82 30 96 130 C 96 230 86 300 78 356 C 40 374 -4 374 -44 356 C -62 250 -60 60 -54 -96 Z',
  to: 'M 652 198 C 626 190 602 218 578 266 C 548 330 512 356 500 384 C 514 446 532 494 548 522 C 592 532 638 532 662 520 C 662 420 658 298 652 198 Z',
};

/** The kiss heart → the small heart in the "M" valley. `M C C C C Z` both sides. */
export const HEART: MorphPair = {
  from: 'M 0 -20 C -12 -34 -34 -44 -52 -28 C -70 -12 -60 12 0 36 C 60 12 70 -12 52 -28 C 34 -44 12 -34 0 -20 Z',
  to: 'M 500 404 C 488 390 466 380 448 396 C 430 412 440 436 500 460 C 560 436 570 412 552 396 C 534 380 512 390 500 404 Z',
};

/** The bouquet → the rose at the foot of the logo. `M C C C Z` both sides. */
export const ROSE: MorphPair = {
  from: 'M 0 -28 C 24 -28 34 -12 34 2 C 34 18 18 30 0 30 C -18 30 -34 18 -34 2 Z',
  to: 'M 500 488 C 524 488 534 504 534 518 C 534 534 518 546 500 546 C 482 546 466 534 466 518 Z',
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
 * drifts apart (the usual cause: pasting a path authored with a different number
 * of control points). Silent in production, and never throws.
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
