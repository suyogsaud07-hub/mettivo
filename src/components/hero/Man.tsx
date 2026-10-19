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
 * The man — a rigged editorial silhouette, not a single morphing blob.
 *
 * Hierarchical groups keep every joint honest:
 *
 *   root (position + ground-anchored morph scale)
 *     ├── legs: hip → thigh → knee → shin → shoe
 *     └── torso: pelvis pivot → jacket, neck, head, arms
 *           └── arm: shoulder → upper arm → elbow → forearm → wrist → hand
 *                 └── bouquet (only the left hand; the grip is the group's
 *                     bounding-box centre so it rotates around the palm)
 *
 * The torso leans without dragging the legs; the legs bend without rotating the
 * torso; the head tilts on the neck. During the morph the root shrinks toward
 * the mark and fades, while the logo strokes draw in over it.
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

interface ManProps {
  phase: HeroPhase;
}

const WALK_TIMES = [0, 0.25, 0.5, 0.75, 1] as const;
const WAVE_TIMES = [0, 0.22, 0.44, 0.68, 1] as const;
const ACCEPT_TIMES = [0, 0.3, 0.62, 0.84, 1] as const;
const HANDOFF_TIMES = [0, 0.3, 0.45, 1] as const;

const ROOT: Record<HeroPhase, RootPose> = {
  see: { x: 250, y: 520, scale: 1, opacity: 1 },
  wave: { x: 250, y: 520, scale: 1, opacity: 1 },
  walk: { x: 430, y: 520, scale: 1, opacity: 1 },
  propose: { x: 420, y: 575, scale: 1, opacity: 1 },
  accept: { x: 455, y: 520, scale: 1, opacity: 1 },
  morph: { x: 445, y: 470, scale: 0.72, opacity: 0 },
  logo: { x: 445, y: 470, scale: 0.72, opacity: 0 },
};

/** A slow lean toward her, pivoting on the pelvis. */
const TORSO_ROTATE: Record<HeroPhase, number> = {
  see: 0,
  wave: -2,
  walk: 0,
  propose: 14,
  accept: 9,
  morph: 0,
  logo: 0,
};

const TORSO_Y: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: [0, -3, 0, -3, 0],
  propose: 10,
  accept: 0,
  morph: 0,
  logo: 0,
};

const HEAD_ROTATE: Record<HeroPhase, number> = {
  see: 0,
  wave: -4,
  walk: 0,
  propose: 6,
  accept: 7,
  morph: 0,
  logo: 0,
};

const HEAD_X: Record<HeroPhase, number> = {
  see: 0,
  wave: 0,
  walk: 0,
  propose: 3,
  accept: 4,
  morph: 0,
  logo: 0,
};

/** Viewer-right arm (+x). Holds the bouquet; extends it during the proposal. */
const LEFT_ARM: Record<HeroPhase, ArmPose> = {
  see: { upper: 3, fore: 8, hand: 6 },
  wave: { upper: 3, fore: 8, hand: 6 },
  walk: { upper: [3, -8, 3, 12, 3], fore: [8, 4, 8, 12, 8], hand: [6, 2, 6, 8, 6] },
  propose: { upper: -60, fore: 0, hand: 0 },
  accept: { upper: [-60, -60, 10, 6], fore: [0, 0, 8, 6], hand: [0, 0, 4, 4] },
  morph: { upper: 0, fore: 0, hand: 0 },
  logo: { upper: 0, fore: 0, hand: 0 },
};

/** Viewer-left arm (−x). Waves, then counter-swings on the walk. */
const RIGHT_ARM: Record<HeroPhase, ArmPose> = {
  see: { upper: 4, fore: 2, hand: 0 },
  wave: {
    upper: [4, 150, 148, 150, 150],
    fore: [2, 25, 10, 30, 15],
    hand: [0, 16, -14, 16, -10],
  },
  walk: {
    upper: [150, 30, 4, -14, 4],
    fore: [15, -10, 2, 10, 2],
    hand: [-8, 2, 0, -4, 0],
  },
  propose: { upper: 20, fore: -16, hand: 0 },
  accept: { upper: 8, fore: 6, hand: 0 },
  morph: { upper: 0, fore: 0, hand: 0 },
  logo: { upper: 0, fore: 0, hand: 0 },
};

/** Viewer-left leg (−17). Kneels on this shin during the proposal. */
const LEFT_LEG: Record<HeroPhase, LegPose> = {
  see: { thigh: 0, shin: 0 },
  wave: { thigh: 0, shin: 0 },
  walk: { thigh: [0, -20, 0, 20, 0], shin: [0, 0, 8, 38, 0] },
  propose: { thigh: 6, shin: 78 },
  accept: { thigh: [6, 4, 0, 0], shin: [78, 36, 4, 0] },
  morph: { thigh: 0, shin: 0 },
  logo: { thigh: 0, shin: 0 },
};

/** Viewer-right leg (+17). The front foot stays planted under the knee. */
const RIGHT_LEG: Record<HeroPhase, LegPose> = {
  see: { thigh: 0, shin: 0 },
  wave: { thigh: 0, shin: 0 },
  walk: { thigh: [0, 20, 0, -20, 0], shin: [0, 38, 8, 0, 0] },
  propose: { thigh: -64, shin: 104 },
  accept: { thigh: [-64, -36, -4, 0], shin: [104, 66, 10, 0] },
  morph: { thigh: 0, shin: 0 },
  logo: { thigh: 0, shin: 0 },
};

const BOUQUET_ROTATE: Record<HeroPhase, Limb> = {
  see: 0,
  wave: 0,
  walk: [0, -5, 0, 5, 0],
  propose: 65,
  accept: [65, 60, 8, 0],
  morph: 0,
  logo: 0,
};

const BOUQUET_OPACITY: Record<HeroPhase, Limb> = {
  see: 1,
  wave: 1,
  walk: 1,
  propose: 1,
  accept: [1, 1, 0, 0],
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

export default function Man({ phase }: ManProps) {
  const raw = useId();
  const uid = `man${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = ROOT[phase];
  const bouquetRotation = BOUQUET_ROTATE[phase];
  const bouquetOpacity = BOUQUET_OPACITY[phase];

  return (
    <motion.g
      initial={false}
      animate={{
        x: root.x,
        y: root.y,
        scale: root.scale,
        opacity: root.opacity,
      }}
      transition={
        phase === 'accept'
          ? { duration: 0.85, ease: EASE }
          : phase === 'morph'
            ? { duration: 0.7, ease: EASE }
            : glideForPhase(phase)
      }
      className="hero-pivot-center"
    >
      <defs>
        <linearGradient id={`${uid}-suit`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#3b4a63" />
          <stop offset="0.55" stopColor="#222c3d" />
          <stop offset="1" stopColor="#0e131d" />
        </linearGradient>
        <linearGradient id={`${uid}-trouser`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#2a3447" />
          <stop offset="1" stopColor="#0d121b" />
        </linearGradient>
        <linearGradient id={`${uid}-skin`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#bd8d70" />
          <stop offset="1" stopColor="#8a5c49" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#1c1720" />
          <stop offset="1" stopColor="#08070b" />
        </linearGradient>
        <linearGradient id={`${uid}-shirt`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d5dbe5" />
          <stop offset="1" stopColor="#a9b3c3" />
        </linearGradient>
      </defs>
      <rect x="-1500" y="-1500" width="3000" height="3000" fill="none" />

      <Leg
        side={-1}
        pose={LEFT_LEG[phase]}
        phase={phase}
        times={phase === 'accept' ? ACCEPT_TIMES : WALK_TIMES}
        uid={uid}
      />
      <Leg
        side={1}
        pose={RIGHT_LEG[phase]}
        phase={phase}
        times={phase === 'accept' ? ACCEPT_TIMES : WALK_TIMES}
        uid={uid}
      />

      <motion.g
        animate={{ rotate: TORSO_ROTATE[phase], y: TORSO_Y[phase] }}
        transition={{
          rotate: glideForPhase(phase),
          y: valueTransition(TORSO_Y[phase], phase, WALK_TIMES),
        }}
        className="hero-pivot-center"
      >
        <rect x="-1100" y="-1250" width="2200" height="2200" fill="none" />
        {/* Neck sits behind the jacket collar. */}
        <path d="M -7 -282 L 7 -282 L 9 -258 L -9 -258 Z" fill={`url(#${uid}-skin)`} />

        {/* Jacket. */}
        <path
          d="M -32 -264 C -43 -260 -48 -249 -47 -233 L -41 -160 L -34 -128 C -22 -121 22 -121 34 -128 L 41 -160 L 47 -233 C 48 -249 43 -260 32 -264 Z"
          fill={`url(#${uid}-suit)`}
        />
        {/* Shirt and tie, restrained. */}
        <path
          d="M -8 -261 L 8 -261 L 9 -226 L 0 -214 L -9 -226 Z"
          fill={`url(#${uid}-shirt)`}
        />
        <path d="M -5 -248 L 5 -248 L 6 -200 L 0 -188 L -6 -200 Z" fill="#182132" />
        {/* Lapels. */}
        <path d="M -18 -263 L -5 -230 L -2 -216 L -16 -200 L -26 -232 Z" fill="#0c111a" />
        <path d="M 18 -263 L 5 -230 L 2 -216 L 16 -200 L 26 -232 Z" fill="#0c111a" />
        {/* Pocket line and a button. */}
        <path d="M 13 -188 L 27 -190" stroke="#0a0f17" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="0" cy="-168" r="1.7" fill="#0a0f17" />

        {/* Cold rim light on the shoulders. */}
        <path
          d="M 31 -264 C 43 -260 48 -249 47 -233"
          fill="none"
          stroke="#a9c1e6"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.55"
        />
        <path
          d="M -47 -233 C -48 -249 -43 -260 -32 -264"
          fill="none"
          stroke="#6f86a8"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity="0.35"
        />

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
          bouquetRotation={bouquetRotation}
          bouquetOpacity={bouquetOpacity}
        />

        {/* Head and hair. */}
        <motion.g
          animate={{ rotate: HEAD_ROTATE[phase], x: HEAD_X[phase] }}
          transition={glideForPhase(phase)}
          className="hero-pivot-waist"
        >
          <ellipse cx="-20" cy="-305" rx="4" ry="7" fill="#8a5c49" opacity="0.85" />
          <path d="M -23 -312 C -23 -333 -12 -345 0 -345 C 12 -345 23 -333 23 -312 C 23 -298 15 -285 4 -277 C 1 -275 -1 -275 -4 -277 C -15 -285 -23 -298 -23 -312 Z" fill={`url(#${uid}-skin)`} />
          <path
            d="M 22 -306 C 27 -302 27 -297 22 -294 L 20 -298 Z"
            fill="#a97a62"
            opacity="0.9"
          />
          <path
            d="M -23 -312 C -27 -334 -10 -347 4 -345 C 20 -343 30 -329 26 -310 C 22 -322 14 -329 2 -330 C -10 -331 -19 -324 -23 -312 Z"
            fill={`url(#${uid}-hair)`}
          />
          <path
            d="M -23 -314 C -22 -306 -21 -300 -19 -296 L -15 -301 C -17 -306 -19 -311 -20 -316 Z"
            fill={`url(#${uid}-hair)`}
          />
        </motion.g>
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
  const times = phase === 'wave' ? WAVE_TIMES : phase === 'walk' ? WALK_TIMES : ACCEPT_TIMES;

  return (
    <g transform={`translate(${side * 42} -249)`}>
      <motion.g
        animate={{ rotate: pose.upper }}
        transition={valueTransition(pose.upper, phase, times)}
        className="hero-pivot-center"
      >
        <rect x="-800" y="-800" width="1600" height="1600" fill="none" />
        <circle cx="0" cy="0" r="9" fill={`url(#${uid}-suit)`} />
        <path
          d="M -11 0 C -13 18 -13 40 -9 58 L 9 58 C 13 40 13 18 11 0 Z"
          fill={`url(#${uid}-suit)`}
        />
        <path
          d={side < 0 ? 'M -9 2 C -11 20 -11 38 -8 55' : 'M 9 2 C 11 20 11 38 8 55'}
          fill="none"
          stroke="#94accf"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.4"
        />
        <g transform="translate(0 58)">
          <motion.g
            animate={{ rotate: pose.fore }}
            transition={valueTransition(pose.fore, phase, times)}
            className="hero-pivot-center"
          >
            <rect x="-500" y="-500" width="1000" height="1000" fill="none" />
            <circle cx="0" cy="0" r="6" fill={`url(#${uid}-suit)`} />
            <path
              d="M -9 0 C -10 12 -10 24 -8 32 L 8 32 C 10 24 10 12 9 0 Z"
              fill={`url(#${uid}-suit)`}
            />
            <path d="M -8 29 L 8 29 L 8 35 L -8 35 Z" fill={`url(#${uid}-shirt)`} />
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
                  d="M -7 0 C -10 5 -9 15 -5 20 C -2 24 3 24 6 20 C 9 15 9 5 6 0 Z"
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
  times,
  uid,
}: {
  side: -1 | 1;
  pose: LegPose;
  phase: HeroPhase;
  times: readonly number[];
  uid: string;
}) {
  return (
    <g transform={`translate(${side * 17} -124)`}>
      <motion.g
        animate={{ rotate: pose.thigh }}
        transition={valueTransition(pose.thigh, phase, times)}
        className="hero-pivot-top"
      >
        <circle cx="0" cy="0" r="9" fill={`url(#${uid}-trouser)`} />
        <path
          d="M -13 0 C -15 20 -15 40 -12 58 L 12 58 C 15 40 15 20 13 0 Z"
          fill={`url(#${uid}-trouser)`}
        />
        <path
          d={side < 0 ? 'M -11 3 C -13 22 -13 40 -10 55' : 'M 11 3 C 13 22 13 40 10 55'}
          fill="none"
          stroke="#39465c"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.5"
        />
        <g transform="translate(0 58)">
          <motion.g
            animate={{ rotate: pose.shin }}
            transition={valueTransition(pose.shin, phase, times)}
            className="hero-pivot-top"
          >
            <circle cx="0" cy="0" r="7" fill={`url(#${uid}-trouser)`} />
            <path
              d="M -10 0 C -11 18 -11 38 -8 54 L 8 54 C 11 38 11 18 10 0 Z"
              fill={`url(#${uid}-trouser)`}
            />
            <path
              d="M -9 52 L 11 52 C 19 52 23 55 23 59 C 23 62 17 63 8 63 L -9 63 C -11 62 -11 56 -9 52 Z"
              fill="#080b11"
            />
            <path
              d="M -7 58 L 15 58"
              stroke="#2c374a"
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.65"
            />
          </motion.g>
        </g>
      </motion.g>
    </g>
  );
}

/** The composer reads the ground anchor from here so the shadow follows. */
export const MAN_ROOT = ROOT;
