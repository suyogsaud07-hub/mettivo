'use client';

import { useId } from 'react';
import { motion, type Transition } from 'framer-motion';
import Bouquet from './Bouquet';
import {
  EASE,
  glideForPhase,
  keyframeTransition,
  type HeroPhase,
} from './timeline';

/**
 * The woman — the same joint discipline as `Man`, with a saree built in layers:
 *
 *   root
 *     ├── legs (petticoat + skin shin + sandal), visible through the slit
 *     ├── saree skirt (outer drape, slit, fold strokes, zari hem)
 *     └── torso (blouse) → pallu → neck → head/hair → arms → bouquet
 *
 * Her left arm (viewer right, +x) both waves and accepts the flowers; her right
 * arm rests. The pallu and skirt sway subtly on the walk, and the head tilts
 * into his during the kiss.
 */

type Limb = number | number[];

interface ArmPose {
  upper: Limb;
  fore: Limb;
  hand: Limb;
}

interface LegPose {
  thigh: Limb;
  shin: Limb;
}

interface RootPose {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

interface WomanProps {
  phase: HeroPhase;
}

const WALK_TIMES = [0, 0.25, 0.5, 0.75, 1] as const;
const WAVE_TIMES = [0, 0.22, 0.44, 0.68, 1] as const;
const ACCEPT_TIMES = [0, 0.3, 0.62, 0.84, 1] as const;
const HANDOFF_TIMES = [0, 0.3, 0.45, 1] as const;

const ROOT: Record<HeroPhase, RootPose> = {
  see: { x: 750, y: 520, scale: 1, opacity: 1 },
  wave: { x: 750, y: 520, scale: 1, opacity: 1 },
  walk: { x: 570, y: 520, scale: 1, opacity: 1 },
  propose: { x: 610, y: 520, scale: 1, opacity: 1 },
  accept: { x: 545, y: 520, scale: 1, opacity: 1 },
  morph: { x: 555, y: 470, scale: 0.72, opacity: 0 },
  logo: { x: 555, y: 470, scale: 0.72, opacity: 0 },
};

/** A slow lean toward him, pivoting on the waist, then a deeper bend to accept. */
const TORSO_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 2,
  walk: 0,
  propose: -6,
  accept: [-6, -22, -10, -9, -9],
  morph: 0,
  logo: 0,
};

const TORSO_Y: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: [0, -2, 0, -2, 0],
  propose: 0,
  accept: 0,
  morph: 0,
  logo: 0,
};

const HEAD_ROTATE: Record<HeroPhase, number> = {
  see: 0,
  wave: 4,
  walk: 0,
  propose: -4,
  accept: -7,
  morph: 0,
  logo: 0,
};

const HEAD_X: Record<HeroPhase, number> = {
  see: 0,
  wave: 0,
  walk: 0,
  propose: -3,
  accept: -4,
  morph: 0,
  logo: 0,
};

/** Viewer-right arm (+x). Waves, then accepts and cradles the bouquet. */
const LEFT_ARM: Record<HeroPhase, ArmPose> = {
  see: { upper: -4, fore: 2, hand: 0 },
  wave: {
    upper: [-4, -150, -148, -150, -150],
    fore: [2, -25, -10, -30, -15],
    hand: [0, -16, 14, -16, 10],
  },
  walk: {
    upper: [-150, -20, -4, 10, -4],
    fore: [-15, 8, 2, -8, 2],
    hand: [8, -2, 0, 4, 0],
  },
  propose: { upper: -6, fore: 4, hand: 0 },
  accept: { upper: [-6, 42, 8, 4], fore: [4, 18, -30, 4], hand: [0, 0, 8, 8] },
  morph: { upper: 0, fore: 0, hand: 0 },
  logo: { upper: 0, fore: 0, hand: 0 },
};

/** Viewer-left arm (−x). Rests at her side. */
const RIGHT_ARM: Record<HeroPhase, ArmPose> = {
  see: { upper: 3, fore: 6, hand: 4 },
  wave: { upper: 3, fore: 6, hand: 4 },
  walk: {
    upper: [3, 10, 3, -8, 3],
    fore: [6, 10, 6, 2, 6],
    hand: [4, 6, 4, 2, 4],
  },
  propose: { upper: 5, fore: 4, hand: 2 },
  accept: { upper: 4, fore: 6, hand: 2 },
  morph: { upper: 0, fore: 0, hand: 0 },
  logo: { upper: 0, fore: 0, hand: 0 },
};

/** Viewer-left leg (−14). Steps forward as she accepts. */
const LEFT_LEG: Record<HeroPhase, LegPose> = {
  see: { thigh: 0, shin: 0 },
  wave: { thigh: 0, shin: 0 },
  walk: { thigh: [0, 7, 0, -7, 0], shin: [0, 10, 4, 0, 0] },
  propose: { thigh: 0, shin: 0 },
  accept: { thigh: [0, -14, 6, 0], shin: [0, 16, 4, 0] },
  morph: { thigh: 0, shin: 0 },
  logo: { thigh: 0, shin: 0 },
};

/** Viewer-right leg (+14). */
const RIGHT_LEG: Record<HeroPhase, LegPose> = {
  see: { thigh: 0, shin: 0 },
  wave: { thigh: 0, shin: 0 },
  walk: { thigh: [0, -7, 0, 7, 0], shin: [0, 0, 4, 10, 0] },
  propose: { thigh: 0, shin: 0 },
  accept: { thigh: [0, 8, -8, 0], shin: [0, 6, 10, 0] },
  morph: { thigh: 0, shin: 0 },
  logo: { thigh: 0, shin: 0 },
};

const BOUQUET_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: 0,
  propose: 0,
  accept: [60, 60, 8, 0],
  morph: 0,
  logo: 0,
};

const BOUQUET_OPACITY: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: 0,
  propose: 0,
  accept: [0, 0, 1, 1],
  morph: 1,
  logo: 0,
};

const SKIRT_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: [0, -2.5, 0, 2.5, 0],
  propose: 0,
  accept: [0, 2, 0, 0],
  morph: 0,
  logo: 0,
};

const PALLU_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 1.5,
  walk: [0, 3, 0, -2, 0],
  propose: -2,
  accept: [0, -4, 1, 0, 0],
  morph: 0,
  logo: 0,
};

const HAIR_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: [0, 2, 0, -2, 0],
  propose: 0,
  accept: [0, 3, -1, 0, 0],
  morph: 0,
  logo: 0,
};

function valueTransition(
  value: Limb,
  phase: HeroPhase,
  times?: readonly number[],
): Transition {
  if (!Array.isArray(value)) return glideForPhase(phase);
  return keyframeTransition(phase, value.length, times);
}

export default function Woman({ phase }: WomanProps) {
  const raw = useId();
  const uid = `wom${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = ROOT[phase];

  return (
    <motion.g
      initial={false}
      animate={{ x: root.x, y: root.y, scale: root.scale, opacity: root.opacity }}
      transition={phase === 'morph' ? { duration: 0.45, ease: EASE } : glideForPhase(phase)}
      className="hero-pivot-center"
    >
      <defs>
        <linearGradient id={`${uid}-saree`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#2a5cb8" />
          <stop offset="0.45" stopColor="#173f8f" />
          <stop offset="1" stopColor="#081a40" />
        </linearGradient>
        <linearGradient id={`${uid}-sareeDark`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#1d438f" />
          <stop offset="1" stopColor="#071532" />
        </linearGradient>
        <linearGradient id={`${uid}-blouse`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#2c63c2" />
          <stop offset="1" stopColor="#0c2250" />
        </linearGradient>
        <linearGradient id={`${uid}-skin`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#c89379" />
          <stop offset="1" stopColor="#8f5e4b" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#241b24" />
          <stop offset="1" stopColor="#0a080c" />
        </linearGradient>
        <linearGradient id={`${uid}-zari`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9d7b4a" />
          <stop offset="0.5" stopColor="#e3c28f" />
          <stop offset="1" stopColor="#9d7b4a" />
        </linearGradient>
      </defs>
      <rect x="-1500" y="-1500" width="3000" height="3000" fill="none" />

      <Leg side={-1} pose={LEFT_LEG[phase]} phase={phase} uid={uid} />
      <Leg side={1} pose={RIGHT_LEG[phase]} phase={phase} uid={uid} />

      {/* Saree skirt: the slit is a hole, so the leg behind reads through it. */}
      <motion.g
        animate={{ rotate: SKIRT_ROTATE[phase] }}
        transition={valueTransition(SKIRT_ROTATE[phase], phase, WALK_TIMES)}
        className="hero-pivot-top"
      >
        <path
          d="M -24 -154 C -30 -110 -44 -62 -50 -18 C -52 -10 -47 -8 -40 -8 L 40 -8 C 47 -8 52 -10 50 -18 C 44 -62 30 -110 24 -154 Z M -27 -10 C -25 -38 -23 -64 -18 -88 L -6 -86 C -10 -58 -13 -34 -12 -10 Z"
          fillRule="evenodd"
          fill={`url(#${uid}-saree)`}
        />
        {/* Fabric folds. */}
        <g fill="none" stroke="#5c88d8" strokeWidth="1.6" strokeLinecap="round" opacity="0.35">
          <path d="M -18 -144 C -24 -104 -34 -62 -41 -24" />
          <path d="M -4 -148 C -8 -108 -14 -64 -18 -20" />
          <path d="M 12 -148 C 12 -108 10 -64 8 -20" />
          <path d="M 26 -140 C 32 -100 37 -60 40 -24" />
        </g>
        <path
          d="M -24 -152 C -30 -110 -43 -64 -49 -22 L -40 -20 C -34 -60 -22 -106 -16 -150 Z"
          fill="#05122c"
          opacity="0.55"
        />
        <path
          d="M 22 -146 C 28 -108 34 -66 40 -26 L 34 -24 C 29 -62 22 -102 16 -144 Z"
          fill="#4f83dd"
          opacity="0.22"
        />
        {/* Zari hem. */}
        <path
          d="M -50 -12 C -40 -4 40 -4 50 -12"
          fill="none"
          stroke={`url(#${uid}-zari)`}
          strokeWidth="2.4"
          strokeLinecap="round"
          opacity="0.9"
        />
      </motion.g>

      <motion.g
        animate={{ rotate: TORSO_ROTATE[phase], y: TORSO_Y[phase] }}
        transition={{
          rotate: valueTransition(TORSO_ROTATE[phase], phase, ACCEPT_TIMES),
          y: valueTransition(TORSO_Y[phase], phase, WALK_TIMES),
        }}
        className="hero-pivot-center"
      >
        <rect x="-1100" y="-1250" width="2200" height="2200" fill="none" />
        {/* Neck. */}
        <path d="M -6 -280 L 6 -280 L 8 -258 L -8 -258 Z" fill={`url(#${uid}-skin)`} />

        {/* Fitted blouse. */}
        <path
          d="M -26 -264 C -35 -260 -39 -249 -38 -235 L -30 -172 L -24 -154 L 24 -154 L 30 -172 L 38 -235 C 39 -249 35 -260 26 -264 Z"
          fill={`url(#${uid}-blouse)`}
        />
        {/* Waistband and zari edge. */}
        <path d="M -25 -160 L 25 -160 L 24 -151 L -24 -151 Z" fill="#0a1a3f" />
        <path
          d="M -24 -159 L 24 -159"
          stroke={`url(#${uid}-zari)`}
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* Necklace. */}
        <path
          d="M -11 -262 C -5 -254 5 -254 11 -262"
          fill="none"
          stroke="#d9b77e"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.9"
        />


        {/* Pallu falling from her left shoulder. */}
        <motion.g
          animate={{ rotate: PALLU_ROTATE[phase] }}
          transition={valueTransition(PALLU_ROTATE[phase], phase, WALK_TIMES)}
          className="hero-pivot-top"
        >
          <path
            d="M 8 -264 C 28 -260 42 -246 40 -226 L 46 -180 L 52 -140 C 60 -104 64 -76 56 -44 C 48 -68 40 -96 36 -128 L 28 -178 L 18 -222 L 12 -246 Z"
            fill={`url(#${uid}-sareeDark)`}
          />
          <path
            d="M 18 -222 L 28 -178 L 36 -128 C 40 -96 48 -68 56 -44"
            fill="none"
            stroke={`url(#${uid}-zari)`}
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.85"
          />
        </motion.g>

        {/* Hair falls behind the face and the arms; it sways from the crown. */}
        <motion.g
          animate={{ rotate: HAIR_ROTATE[phase] }}
          transition={valueTransition(HAIR_ROTATE[phase], phase, WALK_TIMES)}
          className="hero-pivot-top"
        >
          <path
            d="M -23 -314 C -30 -336 -14 -350 2 -348 C 20 -346 32 -332 28 -312 L 27 -286 C 33 -262 31 -238 25 -216 C 20 -240 20 -264 14 -282 C 8 -296 -10 -296 -16 -282 C -22 -264 -22 -240 -26 -216 C -32 -240 -32 -268 -28 -290 Z"
            fill={`url(#${uid}-hair)`}
          />
          <path
            d="M 25 -300 C 31 -278 30 -250 25 -222 C 29 -250 30 -278 25 -300 Z"
            fill="#4a3a4e"
            opacity="0.5"
          />
        </motion.g>

        {/* Head pivots on the neck; the chin is the bottom of this bbox. */}
        <motion.g
          animate={{ rotate: HEAD_ROTATE[phase], x: HEAD_X[phase] }}
          transition={glideForPhase(phase)}
          className="hero-pivot-waist"
        >
          <path
            d="M -22 -310 C -22 -331 -12 -342 0 -342 C 12 -342 22 -331 22 -310 C 22 -296 14 -284 4 -277 C 1 -275 -1 -275 -4 -277 C -14 -284 -22 -296 -22 -310 Z"
            fill={`url(#${uid}-skin)`}
          />
          <path
            d="M -22 -304 C -27 -300 -27 -295 -22 -292 L -20 -296 Z"
            fill="#b07d66"
            opacity="0.9"
          />
          <path
            d="M -21 -318 C -24 -330 -12 -338 0 -337 C 14 -336 23 -327 21 -316 C 15 -323 8 -326 0 -326 C -8 -326 -16 -323 -21 -318 Z"
            fill={`url(#${uid}-hair)`}
          />
          <circle cx="15" cy="-321" r="1.8" fill="#e0c08a" />
        </motion.g>

        <Arm
          side={-1}
          pose={RIGHT_ARM[phase]}
          phase={phase}
          uid={uid}
          holdsBouquet={false}
          bouquetRotation={0}
          bouquetOpacity={0}
        />
        <Arm
          side={1}
          pose={LEFT_ARM[phase]}
          phase={phase}
          uid={uid}
          holdsBouquet
          bouquetRotation={BOUQUET_ROTATE[phase]}
          bouquetOpacity={BOUQUET_OPACITY[phase]}
        />
      </motion.g>
    </motion.g>
  );
}

function Arm({
  side,
  pose,
  phase,
  uid,
  holdsBouquet,
  bouquetRotation,
  bouquetOpacity,
}: {
  side: -1 | 1;
  pose: ArmPose;
  phase: HeroPhase;
  uid: string;
  holdsBouquet: boolean;
  bouquetRotation: Limb;
  bouquetOpacity: Limb;
}) {
  const times =
    phase === 'wave' ? WAVE_TIMES : phase === 'walk' ? WALK_TIMES : ACCEPT_TIMES;

  return (
    <g transform={`translate(${side * 33} -246)`}>
      <motion.g
        animate={{ rotate: pose.upper }}
        transition={valueTransition(pose.upper, phase, times)}
        className="hero-pivot-center"
      >
        <rect x="-800" y="-800" width="1600" height="1600" fill="none" />
        <circle cx="0" cy="0" r="8" fill={`url(#${uid}-blouse)`} />
        <path
          d="M -9 0 C -11 16 -11 38 -8 54 L 8 54 C 11 38 11 16 9 0 Z"
          fill={`url(#${uid}-blouse)`}
        />
        <path
          d={side < 0 ? 'M -7 3 C -9 18 -9 36 -7 51' : 'M 7 3 C 9 18 9 36 7 51'}
          fill="none"
          stroke="#6c9ae8"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.45"
        />
        <g transform="translate(0 54)">
          <motion.g
            animate={{ rotate: pose.fore }}
            transition={valueTransition(pose.fore, phase, times)}
            className="hero-pivot-center"
          >
            <rect x="-500" y="-500" width="1000" height="1000" fill="none" />
            <circle cx="0" cy="0" r="6" fill={`url(#${uid}-skin)`} />
            <path
              d="M -8 0 C -9 12 -9 26 -7 34 L 7 34 C 9 26 9 12 8 0 Z"
              fill={`url(#${uid}-skin)`}
            />
            {/* Gold bangle. */}
            <path
              d="M -8 4 L 8 4"
              stroke="#d9b77e"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.9"
            />
            <g transform="translate(0 33)">
              <motion.g
                animate={{ rotate: pose.hand }}
                transition={valueTransition(pose.hand, phase, times)}
                className="hero-pivot-center"
              >
                <rect x="-300" y="-300" width="600" height="600" fill="none" />
                {holdsBouquet && (
                  <motion.g
                    initial={false}
                    animate={{ opacity: bouquetOpacity }}
                    transition={valueTransition(bouquetOpacity, phase, HANDOFF_TIMES)}
                  >
                    <g transform="translate(0 8)">
                      <motion.g
                        animate={{ rotate: bouquetRotation }}
                        transition={valueTransition(bouquetRotation, phase, times)}
                        className="hero-pivot-center"
                      >
                        <Bouquet />
                      </motion.g>
                    </g>
                  </motion.g>
                )}
                <path
                  d="M -5 0 C -8 4 -7 13 -4 17 C -1 20 3 20 5 17 C 8 13 8 4 5 0 Z"
                  fill={`url(#${uid}-skin)`}
                />
              </motion.g>
            </g>
          </motion.g>
        </g>
      </motion.g>
    </g>
  );
}

function Leg({
  side,
  pose,
  phase,
  uid,
}: {
  side: -1 | 1;
  pose: LegPose;
  phase: HeroPhase;
  uid: string;
}) {
  const times = phase === 'accept' ? ACCEPT_TIMES : WALK_TIMES;

  return (
    <g transform={`translate(${side * 14} -150)`}>
      <motion.g
        animate={{ rotate: pose.thigh }}
        transition={valueTransition(pose.thigh, phase, times)}
        className="hero-pivot-top"
      >
        {/* Petticoat-covered thigh; mostly hidden by the saree. */}
        <circle cx="0" cy="0" r="8" fill="#12244f" />
        <path
          d="M -10 0 C -12 20 -12 42 -9 62 L 9 62 C 12 42 12 20 10 0 Z"
          fill="#12244f"
        />
        <g transform="translate(0 62)">
          <motion.g
            animate={{ rotate: pose.shin }}
            transition={valueTransition(pose.shin, phase, times)}
            className="hero-pivot-top"
          >
            <circle cx="0" cy="0" r="6" fill={`url(#${uid}-skin)`} />
            <path
              d="M -7 0 C -8 24 -8 50 -6 74 L 6 74 C 8 50 8 24 7 0 Z"
              fill={`url(#${uid}-skin)`}
            />
            <path
              d="M -7 66 L 7 66"
              stroke="#d9b77e"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.95"
            />
            <path
              d="M -7 70 L 6 70 L 16 78 C 18 82 14 84 8 82 L -7 78 Z"
              fill="#2a1a1e"
            />
            <path
              d="M 0 71 L 12 79"
              stroke="#d9b77e"
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.9"
            />
          </motion.g>
        </g>
      </motion.g>
    </g>
  );
}

/** The composer reads the ground anchor from here so the shadow follows. */
export const WOMAN_ROOT = ROOT;
