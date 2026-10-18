'use client';

import { motion } from 'framer-motion';
import { EASE, GENTLE, SPRING, WALK_SPRING, isMorphing, type HeroPhase } from './timeline';
import { WOMAN_BODY } from './morphPaths';

/**
 * The woman — deep blue saree, a red flower in her hair.
 *
 * Same contract as `Man`: placeholder geometry on a real rig. Replace the fills
 * in place and swap `WOMAN_BODY.from` in `morphPaths.ts` for your art (keeping
 * the command structure equal to `WOMAN_BODY.to`). The gradients live in
 * `WomanDefs` and are namespaced (`woman*`).
 *
 * She faces the man, who is to her left, so the arm nearest him is the
 * screen-left arm — the one that waves and later reaches for the bouquet.
 */

const WOMAN_X: Record<HeroPhase, number> = {
  idle: 796,
  wave: 796,
  approach: 664,
  propose: 664,
  accept: 638,
  kiss: 570,
  morph: 0,
  logo: 0,
};

const WOMAN_Y: Record<HeroPhase, number> = {
  idle: 190,
  wave: 190,
  approach: 190,
  propose: 190,
  accept: 192,
  kiss: 202,
  morph: 0,
  logo: 0,
};

const WALK_CYCLE = { duration: 1.7, ease: EASE } as const;

/** Deep-blue fabric gradients, a lit face and the contact/rim shadow. */
function WomanDefs() {
  return (
    <defs>
      <linearGradient id="womanSaree" x1="0.15" y1="0" x2="0.85" y2="1">
        <stop offset="0" stopColor="#2f4a7d" />
        <stop offset="0.5" stopColor="#1d3460" />
        <stop offset="1" stopColor="#0d1a34" />
      </linearGradient>
      <linearGradient id="womanSareeShade" x1="0" y1="0" x2="1" y2="0.5">
        <stop offset="0" stopColor="#0a1226" />
        <stop offset="1" stopColor="#283f6b" />
      </linearGradient>
      {/* Gold zari trim on the pallu and waistband. */}
      <linearGradient id="womanSareeTrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e6c489" />
        <stop offset="1" stopColor="#b98f52" />
      </linearGradient>
      <radialGradient id="womanSkin" cx="0.4" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#eec4a0" />
        <stop offset="0.6" stopColor="#d9ab84" />
        <stop offset="1" stopColor="#b07f5a" />
      </radialGradient>
      <linearGradient id="womanHair" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#2b2119" />
        <stop offset="1" stopColor="#100b08" />
      </linearGradient>
      <radialGradient id="womanRose" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stopColor="#e05a67" />
        <stop offset="0.6" stopColor="#b03040" />
        <stop offset="1" stopColor="#6f1d28" />
      </radialGradient>
      <filter id="womanShadow" x="-50%" y="-40%" width="200%" height="190%">
        <feDropShadow dx="7" dy="11" stdDeviation="10" floodColor="#000000" floodOpacity="0.55" />
        <feDropShadow dx="-4" dy="-2" stdDeviation="7" floodColor="#8294c9" floodOpacity="0.16" />
      </filter>
    </defs>
  );
}

export default function Woman({ phase }: { phase: HeroPhase }) {
  const morphing = isMorphing(phase);
  const walking = phase === 'approach';
  const waving = phase === 'wave';
  const accepting = phase === 'accept' || phase === 'kiss';

  const root = {
    x: WOMAN_X[phase],
    y: WOMAN_Y[phase],
    transition: walking ? WALK_SPRING : SPRING,
  };

  const torso = { rotate: accepting ? -7 : 0, transition: GENTLE };
  const head = {
    rotate: accepting ? -13 : 0,
    x: accepting ? -6 : 0,
    transition: GENTLE,
  };

  const legBack = {
    rotate: walking ? [13, -13, 13, -13, 4, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  const legFront = {
    rotate: walking ? [-13, 13, -13, 13, -4, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  // Screen-left arm: waves back, then lifts to take the bouquet.
  const armNear = {
    rotate: waving
      ? [-118, -150, -120, -150, -120, -150, -118]
      : accepting
        ? -104
        : morphing
          ? -16
          : 0,
    transition: waving ? { duration: 1.6, ease: EASE } : SPRING,
  };
  const armFar = {
    rotate: walking ? [-10, 10, -10, 10, 0, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  const details = { opacity: morphing ? 0 : 1, transition: { duration: 0.5, ease: EASE } };

  return (
    <>
      <WomanDefs />
      <motion.g animate={root} filter="url(#womanShadow)">
        {/* Long hair, falling behind the saree. */}
        <motion.g animate={details}>
          <path
            d="M -34 -120 C -58 -56 -70 40 -62 138 C -54 70 -50 4 -46 -34 C -42 -74 -30 -98 -34 -120 Z"
            fill="url(#womanHair)"
          />
          <path
            d="M 34 -120 C 58 -56 70 40 62 138 C 54 70 50 4 46 -34 C 42 -74 30 -98 34 -120 Z"
            fill="url(#womanHair)"
          />
        </motion.g>

        {/* Back arm, behind the saree. */}
        <motion.g
          transform="translate(48 -46)"
          style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
          animate={armFar}
        >
          <path
            d="M -12 4 C -18 42 -16 82 -10 114 C -3 122 5 122 11 114 C 16 82 18 42 12 4 C 4 -4 -4 -4 -12 4 Z"
            fill="url(#womanSareeShade)"
          />
          <path
            d="M -10 100 C -4 108 4 108 10 100 C 11 114 6 122 0 124 C -6 122 -11 114 -10 100 Z"
            fill="url(#womanSareeTrim)"
            opacity="0.7"
          />
        </motion.g>

        {/* Saree silhouette — the morph carrier. */}
        <motion.path
          d={WOMAN_BODY.from}
          fill="url(#womanSaree)"
          animate={{ d: morphing ? WOMAN_BODY.to : WOMAN_BODY.from }}
          transition={morphing ? { duration: 1.25, ease: EASE } : { duration: 0 }}
        />

        <motion.g animate={details}>
          {/* Pallu (draped shoulder cloth), neckline, zari waistband, folds. */}
          <motion.g
            transform="translate(0 0)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
            animate={torso}
          >
            <path
              d="M -34 -58 C -4 -42 8 -6 10 74 C -6 42 -22 6 -44 -36 C -40 -48 -37 -54 -34 -58 Z"
              fill="url(#womanSareeShade)"
              opacity="0.85"
            />
            <path d="M -18 -58 L 0 -18 L 18 -58 C 8 -64 -8 -64 -18 -58 Z" fill="#24365c" />
            <path d="M -50 6 L 50 6 L 56 34 L -56 34 Z" fill="url(#womanSareeTrim)" opacity="0.9" />
            <path
              d="M -40 34 C -30 90 -26 150 -30 210 C -42 150 -48 90 -40 34 Z"
              fill="#ffffff"
              opacity="0.05"
            />
            <path
              d="M 40 34 C 30 90 26 150 30 210 C 42 150 48 90 40 34 Z"
              fill="#000000"
              opacity="0.12"
            />
          </motion.g>

          {/* Legs (under the saree hem). */}
          <motion.g
            transform="translate(-24 70)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={legBack}
          >
            <path
              d="M -14 0 C -18 90 -16 190 -11 276 C -4 284 4 284 11 276 C 16 190 18 90 14 0 Z"
              fill="url(#womanSareeShade)"
            />
          </motion.g>
          <motion.g
            transform="translate(24 70)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={legFront}
          >
            <path
              d="M -14 0 C -18 90 -16 190 -11 276 C -4 284 4 284 11 276 C 16 190 18 90 14 0 Z"
              fill="url(#womanSaree)"
            />
          </motion.g>

          {/* Near arm: waving, then reaching for the bouquet. */}
          <motion.g
            transform="translate(-48 -46)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
            animate={armNear}
          >
            <path
              d="M -12 4 C -18 42 -16 82 -10 114 C -3 122 5 122 11 114 C 16 82 18 42 12 4 C 4 -4 -4 -4 -12 4 Z"
              fill="url(#womanSaree)"
            />
            <path
              d="M -10 100 C -4 108 4 108 10 100 C 11 114 6 122 0 124 C -6 122 -11 114 -10 100 Z"
              fill="url(#womanSareeTrim)"
            />
            <path
              d="M -10 114 C -4 124 4 124 10 114 C 12 130 5 142 0 144 C -5 142 -12 130 -10 114 Z"
              fill="url(#womanSkin)"
            />
          </motion.g>

          {/* Head with the red flower. */}
          <motion.g
            transform="translate(0 0)"
            style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
            animate={head}
          >
            <path d="M -12 -70 L 12 -70 L 7 -50 L -7 -50 Z" fill="#c3946c" />
            <path
              d="M -33 -104 C -33 -132 -17 -148 0 -148 C 17 -148 33 -132 33 -104 C 33 -78 19 -62 0 -62 C -19 -62 -33 -78 -33 -104 Z"
              fill="url(#womanSkin)"
            />
            <path
              d="M -38 -114 C -44 -150 -14 -168 6 -166 C 32 -164 46 -144 38 -108 C 30 -130 14 -142 0 -140 C -16 -138 -32 -128 -38 -114 Z"
              fill="url(#womanHair)"
            />
            <path d="M -8 -152 C -2 -140 2 -140 8 -152 C 6 -158 -6 -158 -8 -152 Z" fill="#1c1713" opacity="0.6" />
            <circle cx="-30" cy="-92" r="3" fill="url(#womanSareeTrim)" />
            {/* Red flower in her hair. */}
            <g transform="translate(30 -140)">
              <circle cx="0" cy="0" r="10" fill="url(#womanRose)" />
              <circle cx="-9" cy="-7" r="6.5" fill="#a8322a" />
              <circle cx="9" cy="-6" r="6.5" fill="#b93a2c" />
              <circle cx="8" cy="8" r="6.5" fill="#c94433" />
              <circle cx="-8" cy="8" r="6.5" fill="#a8322a" />
              <circle cx="0" cy="0" r="3.5" fill="#e8b04a" />
            </g>
          </motion.g>
        </motion.g>
      </motion.g>
    </>
  );
}
