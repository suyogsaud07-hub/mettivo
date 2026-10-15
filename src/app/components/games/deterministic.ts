/**
 * Deterministic selection helpers for the Game Zone mini-games.
 *
 * CODING_STANDARDS §2 forbids computing random or time-dependent values during
 * render: the server and the browser would disagree and React would report a
 * hydration mismatch. Every board, deck and word in this folder is therefore
 * derived from an explicit integer *seed* by these pure functions. The same seed
 * produces the same order on every engine, which also lets the Playwright
 * journeys in `tests/e2e/game-zone.spec.ts` predict a board exactly.
 *
 * There is no `Math.random()` in any game in this folder — every board, deck and
 * word is a pure function of an explicit integer seed.
 */

/** mulberry32 — a small, well-distributed 32-bit PRNG. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates using `createRng`, so the result depends only on `seed`. */
export function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = [...items];

  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }

  return out;
}

/** Picks one item from a non-empty list, deterministically. */
export function pickWithSeed<T>(items: readonly T[], seed: number): T {
  if (items.length === 0) {
    throw new Error('pickWithSeed requires a non-empty list');
  }

  return items[Math.abs(Math.floor(seed)) % items.length];
}

/** `m:ss` for the shell timer, e.g. 0:07, 1:42. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
