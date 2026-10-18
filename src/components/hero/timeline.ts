/**
 * The AnimatedHero timeline — the single source of truth for the sequence.
 *
 * Kept apart from the components so `Man`, `Woman`, `MettivoLogo` and the
 * orchestrator can share the phase type and spring presets without importing
 * one another (which would create an import cycle).
 *
 * The story is a plain finite state machine: one phase is current at a time,
 * each phase lasts `PHASE_DURATION_MS`, and every visual is a pure function of
 * `phase`. Spring physics smooth the jumps between poses.
 */

import type { Transition } from 'framer-motion';

export const PHASE_ORDER = [
  'idle',
  'wave',
  'approach',
  'propose',
  'accept',
  'kiss',
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

/** The two acts where the silhouettes are (or have become) the logo. */
export function isMorphing(phase: HeroPhase): boolean {
  return phase === 'morph' || phase === 'logo';
}

/** How long each phase is held, in milliseconds. `logo` is the terminal hold. */
export const PHASE_DURATION_MS: Record<HeroPhase, number> = {
  idle: 1300,
  wave: 1700,
  approach: 1700,
  // The romantic act — propose → accept → kiss — is held ~25% longer than the
  // rest so the movements read as weightless rather than choreographed.
  propose: 2000,
  accept: 2250,
  kiss: 2750,
  morph: 1500,
  logo: 0,
};

/** Total run time before the terminal `logo` hold. */
export const TOTAL_DURATION_MS = PHASE_ORDER.reduce(
  (sum, phase) => (phase === 'logo' ? sum : sum + PHASE_DURATION_MS[phase]),
  0,
);

/** Fluid, symmetric easing — reads as a drawn sweep rather than a machine. */
export const EASE = [0.65, 0, 0.35, 1] as const;

/** Movement springs. High damping (≥25) keeps the figures settling, never bouncing. */
export const SPRING: Transition = { type: 'spring', stiffness: 80, damping: 25, mass: 1 };
export const WALK_SPRING: Transition = { type: 'spring', stiffness: 50, damping: 26, mass: 1 };
export const GENTLE: Transition = { type: 'spring', stiffness: 70, damping: 25, mass: 1 };

/** The silhouette → logo morph. Long and smooth so shapes visibly travel. */
export const MORPH_TRANSITION: Transition = { duration: 1.25, ease: EASE };
