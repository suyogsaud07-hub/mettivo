/**
 * The hero timeline — the single source of truth for the sequence.
 *
 * Kept apart from the components so `Man`, `Woman`, `MettivoLogo` and the
 * orchestrator can share the phase type without importing one another.
 *
 * THE STORY
 *   idle → walk → kiss → morph → logo
 * Two silhouettes rest apart, glide together, lean in for a slow kiss, then the
 * pair returns to the origin and morphs into the METTIVO mark.
 *
 * MOTION
 *   Every move is a tween on one cinematic cubic-bezier — `EASE`. No springs,
 *   no linear segments — so the pair read as gliding, not stepping. Each phase
 *   lasts exactly as long as its transition, so motion is continuous.
 */

import type { Transition } from 'framer-motion';

export const PHASE_ORDER = ['idle', 'walk', 'kiss', 'morph', 'logo'] as const;

export type HeroPhase = (typeof PHASE_ORDER)[number];

/** Ordered index of each phase, so `>=` comparisons are meaningful. */
export const PHASE_INDEX: Record<HeroPhase, number> = Object.fromEntries(
  PHASE_ORDER.map((phase, index) => [phase, index]),
) as Record<HeroPhase, number>;

/** True once the timeline has reached `target` (including now). */
export function phaseIsAtLeast(phase: HeroPhase, target: HeroPhase): boolean {
  return PHASE_INDEX[phase] >= PHASE_INDEX[target];
}

/** The two acts where the silhouettes are (or have become) the logo. */
export function isMorphing(phase: HeroPhase): boolean {
  return phase === 'morph' || phase === 'logo';
}

/** How long each phase is held, in milliseconds. `logo` is the terminal hold. */
export const PHASE_DURATION_MS: Record<HeroPhase, number> = {
  idle: 800,
  // The glide in and the lean-in are deliberately slow — the whole point is
  // that it reads as oil, not as a step.
  walk: 2000,
  kiss: 2000,
  morph: 1800,
  logo: 0,
};

/** Total run time before the terminal `logo` hold. */
export const TOTAL_DURATION_MS = PHASE_ORDER.reduce(
  (sum, phase) => (phase === 'logo' ? sum : sum + PHASE_DURATION_MS[phase]),
  0,
);

/**
 * The one cinematic easing used for every move: a long, liquid ease-out. Fast
 * enough to leave the mark the eye is tracking, slow enough to never snap.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** A transition that lasts exactly as long as the phase it moves into. */
export function glideForPhase(phase: HeroPhase): Transition {
  return { duration: PHASE_DURATION_MS[phase] / 1000, ease: EASE };
}

/** The silhouette → logo morph. Long and smooth so the shapes visibly travel. */
export const MORPH_TRANSITION: Transition = {
  duration: PHASE_DURATION_MS.morph / 1000,
  ease: EASE,
};
