/**
 * The hero timeline — the single source of truth for the sequence.
 *
 * Kept apart from the components so `Man`, `Woman`, `LogoMark` and the
 * orchestrator can share the phase type without importing one another.
 *
 * THE STORY
 *   SEE → WAVE → WALK → PROPOSE → ACCEPT_AND_KISS → MORPH_TO_LOGO
 *
 * Two people notice each other across a midnight courtyard, greet, walk
 * together, he kneels with a bouquet, she accepts it, they kiss — and the two
 * silhouettes become the METTIVO mark. `logo` is the terminal hold once the M
 * is fully formed; it is not a story beat.
 *
 * MOTION
 *   Major position and shape changes use one cinematic cubic-bezier — `EASE`.
 *   Limbs that belong to a physical action (the wave, the walk step, the rise
 *   from a knee) use finite keyframes on the same curve so their timing matches
 *   the body they are attached to, and stop dead when the phase ends.
 */

import type { Transition } from 'framer-motion';

export const PHASE_ORDER = [
  'see',
  'wave',
  'walk',
  'propose',
  'accept',
  'morph',
  'logo',
] as const;

export type HeroPhase = (typeof PHASE_ORDER)[number];

/** Ordered index of each phase, so `>=` comparisons are meaningful. */
export const PHASE_INDEX: Record<HeroPhase, number> = Object.fromEntries(
  PHASE_ORDER.map((phase, index) => [phase, index]),
) as Record<HeroPhase, number>;

/** True once the timeline has reached `target` (including now). */
export function phaseIsAtLeast(phase: HeroPhase, target: HeroPhase): boolean {
  return PHASE_INDEX[phase] >= PHASE_INDEX[target];
}

/** The two acts where the mark is taking over from the people. */
export function isMorphing(phase: HeroPhase): boolean {
  return phase === 'morph' || phase === 'logo';
}

/** How long each phase is held, in milliseconds. `logo` is the terminal hold. */
export const PHASE_DURATION_MS: Record<HeroPhase, number> = {
  see: 900,
  wave: 1500,
  walk: 2200,
  propose: 1800,
  // The transfer, the rise and the kiss share this phase: roughly 0.3 for the
  // hand-off, 0.35 for the step/rise, and 0.35 for the lean-in and hold.
  accept: 2200,
  morph: 1800,
  logo: 0,
};

/** Total run time before the terminal `logo` hold. */
export const TOTAL_DURATION_MS = PHASE_ORDER.reduce(
  (sum, phase) => (phase === 'logo' ? sum : sum + PHASE_DURATION_MS[phase]),
  0,
);

/**
 * The one cinematic easing used for every major move: a long, liquid ease-out.
 * Fast enough to leave the mark the eye is tracking, slow enough to never snap.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** A transition that lasts exactly as long as the phase it moves into. */
export function glideForPhase(phase: HeroPhase): Transition {
  return { duration: PHASE_DURATION_MS[phase] / 1000, ease: EASE };
}

/**
 * A keyframed transition whose duration is the phase it belongs to. `times` are
 * generated evenly except where the caller supplies explicit beats (the wave
 * and the hand-off need uneven spacing to read correctly).
 */
export function keyframeTransition(
  phase: HeroPhase,
  count: number,
  times?: readonly number[],
): Transition {
  const resolved = times
    ? [...times]
    : Array.from({ length: count }, (_, index) => index / Math.max(1, count - 1));
  return {
    duration: PHASE_DURATION_MS[phase] / 1000,
    ease: EASE,
    times: resolved,
  };
}

/** The silhouette → logo reveal. Long and smooth so the strokes visibly draw. */
export const MORPH_TRANSITION: Transition = {
  duration: PHASE_DURATION_MS.morph / 1000,
  ease: EASE,
};

/** True while the two people are still the foreground (before the mark forms). */
export function isStory(phase: HeroPhase): boolean {
  return phase !== 'morph' && phase !== 'logo';
}
