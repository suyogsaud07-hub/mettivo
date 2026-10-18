'use client';

import { motion } from 'framer-motion';
import { EASE, GENTLE, SPRING, WALK_SPRING, isMorphing, type HeroPhase } from './timeline';
import { MAN_BODY } from './morphPaths';

/**
 * The man — dark grey tailored suit, red roses.
 *
 * PLACEHOLDER ART, REAL RIG. The rig (grouped limbs that rotate on their
 * joints) is what the timeline drives; the geometry below is authored with
 * bezier curves, gradient "lighting" and a drop shadow so it reads as a
 * high-end render rather than flat shapes. To drop in your own art:
 *
 *   1. Replace the fill paths INSIDE the existing `<motion.g>` groups. Keep the
 *      GROUPING and the groups' `transform` / `animate` props untouched — the
 *      head pivots on the neck, the two arms pivot at the shoulder, and the
 *      body `<motion.path>` is the morph carrier. Only the `d=` values inside
 *      change.
 *   2. Replace `MAN_BODY.from` in `morphPaths.ts` with the silhouette you want
 *      to morph FROM; it must keep the same command structure as `MAN_BODY.to`.
 *   3. The gradients live in `ManDefs` below — retune the stops to your palette.
 *      They are namespaced (`man*`) so they never collide with `Woman`'s or the
 *      logo's gradients.
 */

/** World-space placement of the man per phase (morph returns him to the origin). */
const MAN_X: Record<HeroPhase, number> = {
  idle: 204,
  wave: 204,
  approach: 336,
  propose: 336,
  accept: 350,
  kiss: 430,
  morph: 0,
  logo: 0,
};

const MAN_Y: Record<HeroPhase, number> = {
  idle: 190,
  wave: 190,
  approach: 190,
  propose: 286,
  accept: 258,
  kiss: 206,
  morph: 0,
  logo: 0,
};

/** The walk stride, eased so the feet plant exactly as the pair meets. */
const WALK_CYCLE = { duration: 1.7, ease: EASE } as const;

/** Gradients, "lighting" and the drop shadow that lifts the man off the black. */
function ManDefs() {
  return (
    <defs>
      {/* Suit: a cool key light top-left falling to near-black in the folds. */}
      <linearGradient id="manSuit" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#4b4f59" />
        <stop offset="0.45" stopColor="#31343c" />
        <stop offset="1" stopColor="#1a1c21" />
      </linearGradient>
      {/* The shaded side of the jacket / rear limb. */}
      <linearGradient id="manSuitShade" x1="0" y1="0" x2="1" y2="0.5">
        <stop offset="0" stopColor="#12141a" />
        <stop offset="1" stopColor="#3b3f48" />
      </linearGradient>
      <linearGradient id="manTrouser" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#282b31" />
        <stop offset="1" stopColor="#0e1014" />
      </linearGradient>
      {/* Skin with a soft radial highlight, so the face is lit, not flat. */}
      <radialGradient id="manSkin" cx="0.38" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#e8bd94" />
        <stop offset="0.6" stopColor="#cf9f74" />
        <stop offset="1" stopColor="#a8794f" />
      </radialGradient>
      <linearGradient id="manHair" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#3d352d" />
        <stop offset="1" stopColor="#14110e" />
      </linearGradient>
      {/* Contact shadow (down-right) plus a faint rim light (up-left). */}
      <filter id="manShadow" x="-50%" y="-40%" width="200%" height="190%">
        <feDropShadow dx="7" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity="0.55" />
        <feDropShadow dx="-4" dy="-2" stdDeviation="7" floodColor="#6b7280" floodOpacity="0.16" />
      </filter>
    </defs>
  );
}

export default function Man({ phase }: { phase: HeroPhase }) {
  const morphing = isMorphing(phase);
  const walking = phase === 'approach';
  const kneeling = phase === 'propose' || phase === 'accept';
  const waving = phase === 'wave';

  const root = {
    x: MAN_X[phase],
    y: MAN_Y[phase],
    transition: walking ? WALK_SPRING : SPRING,
  };

  const torso = { rotate: kneeling ? 9 : morphing ? 0 : 0, transition: GENTLE };
  const head = {
    rotate: kneeling ? -6 : phase === 'kiss' ? 14 : 0,
    y: kneeling ? 3 : 0,
    transition: GENTLE,
  };

  // Legs swing on the stride, then fold for the kneel.
  const legBack = {
    rotate: kneeling ? -8 : walking ? [-15, 15, -15, 15, -4, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  const legFront = {
    rotate: kneeling ? 32 : walking ? [15, -15, 15, -15, 4, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  // The near arm waves, then presents the bouquet on one knee.
  const armBack = {
    rotate: walking ? [11, -11, 11, -11, 0, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  const armFront = {
    rotate: waving
      ? [-118, -150, -120, -150, -120, -150, -118]
      : kneeling
        ? -62
        : morphing
          ? -18
          : 0,
    transition: waving ? { duration: 1.6, ease: EASE } : SPRING,
  };

  const details = { opacity: morphing ? 0 : 1, transition: { duration: 0.5, ease: EASE } };

  return (
    <>
      <ManDefs />
      <motion.g animate={root} filter="url(#manShadow)">
        {/* Back arm, behind the jacket. */}
        <motion.g
          transform="translate(-52 -46)"
          style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
          animate={armBack}
        >
          <path
            d="M -14 4 C -22 44 -20 86 -13 120 C -4 128 6 128 14 120 C 20 86 22 44 14 4 C 5 -5 -5 -5 -14 4 Z"
            fill="url(#manSuitShade)"
          />
          <path
            d="M -14 106 C -6 114 6 114 14 106 C 14 120 8 128 0 130 C -8 128 -14 120 -14 106 Z"
            fill="#202329"
          />
        </motion.g>

        {/* Body silhouette — the morph carrier. */}
        <motion.path
          d={MAN_BODY.from}
          fill="url(#manSuit)"
          animate={{ d: morphing ? MAN_BODY.to : MAN_BODY.from }}
          transition={morphing ? { duration: 1.25, ease: EASE } : { duration: 0 }}
        />

        {/* Everything below is detail that dissolves as the morph begins. */}
        <motion.g animate={details}>
          {/* Rear leg, shaded into the background. */}
          <motion.g
            transform="translate(-26 70)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={legBack}
          >
            <path
              d="M -16 0 C -21 92 -19 190 -13 276 C -4 284 4 284 13 276 C 19 190 21 92 16 0 Z"
              fill="url(#manTrouser)"
            />
            <path d="M -16 266 C -25 280 -21 296 -6 300 C 9 302 21 293 16 274 Z" fill="#101216" />
          </motion.g>
          {/* Front leg. */}
          <motion.g
            transform="translate(26 70)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={legFront}
          >
            <path
              d="M -16 0 C -21 92 -17 190 -12 276 C -3 284 5 284 14 276 C 19 190 21 92 16 0 Z"
              fill="url(#manTrouser)"
            />
            <path d="M -15 266 C -23 281 -18 297 -3 300 C 12 302 22 292 16 274 Z" fill="#16181c" />
          </motion.g>

          {/* Jacket: lapels, shirt V, tie, and the fold sheen that models the torso. */}
          <motion.g
            transform="translate(0 0)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
            animate={torso}
          >
            <path d="M -54 -60 C -30 -50 -8 -24 0 6 C -14 -12 -32 -30 -52 -40 Z" fill="url(#manSuitShade)" />
            <path d="M 54 -60 C 30 -50 8 -24 0 6 C 14 -12 32 -30 52 -40 Z" fill="url(#manSuit)" />
            <path d="M -18 -60 L 0 -12 L 18 -60 C 10 -66 -10 -66 -18 -60 Z" fill="#e7e9ee" />
            <path d="M 0 -50 L 8 -34 L 0 62 L -8 -34 Z" fill="#2b2e35" />
            <path d="M 0 -56 L 8 -48 L -8 -48 Z" fill="#3a3e46" />
            <path d="M -46 -30 C -30 -6 -26 40 -34 96 C -44 60 -50 14 -46 -30 Z" fill="#ffffff" opacity="0.05" />
            <path d="M 46 -30 C 30 -6 26 40 34 96 C 44 60 50 14 46 -30 Z" fill="#000000" opacity="0.12" />
          </motion.g>

          {/* Front / waving arm, in front of the jacket. */}
          <motion.g
            transform="translate(52 -46)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={armFront}
          >
            <path
              d="M -14 4 C -22 44 -20 86 -13 120 C -4 128 6 128 14 120 C 20 86 22 44 14 4 C 5 -5 -5 -5 -14 4 Z"
              fill="url(#manSuit)"
            />
            <path
              d="M -14 104 C -6 112 6 112 14 104 C 14 118 8 126 0 128 C -8 126 -14 118 -14 104 Z"
              fill="#26292f"
            />
            <path
              d="M -11 116 C -5 126 5 126 11 116 C 13 132 6 144 0 146 C -6 144 -13 132 -11 116 Z"
              fill="url(#manSkin)"
            />
          </motion.g>

          {/* Head, pivoting on the neck. */}
          <motion.g
            transform="translate(0 0)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
            animate={head}
          >
            <path d="M -13 -70 L 13 -70 L 8 -50 L -8 -50 Z" fill="#b98a63" />
            <path
              d="M -34 -104 C -34 -132 -18 -148 0 -148 C 18 -148 34 -132 34 -104 C 34 -78 20 -62 0 -62 C -20 -62 -34 -78 -34 -104 Z"
              fill="url(#manSkin)"
            />
            <path
              d="M -30 -96 C -22 -74 -10 -64 0 -64 C 10 -64 22 -74 30 -96 C 22 -74 10 -66 0 -66 C -10 -66 -22 -74 -30 -96 Z"
              fill="#a8794f"
              opacity="0.5"
            />
            <path
              d="M -36 -112 C -42 -146 -14 -166 6 -164 C 32 -162 46 -142 38 -106 C 30 -128 14 -140 0 -138 C -16 -136 -32 -128 -36 -112 Z"
              fill="url(#manHair)"
            />
            <path d="M 32 -108 C 40 -110 42 -98 34 -94 C 30 -98 30 -104 32 -108 Z" fill="#cf9f74" />
          </motion.g>
        </motion.g>
      </motion.g>
    </>
  );
}
