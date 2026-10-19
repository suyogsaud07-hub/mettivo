'use client';

import { useId } from 'react';
import { motion } from 'framer-motion';
import { EASE, type HeroPhase } from './timeline';
import {
  LOGO_FAR_STROKES,
  LOGO_HEADS,
  LOGO_HEART,
  LOGO_NEAR_STROKES,
  LOGO_ROSE,
  LOGO_TO_HERO,
  type LogoStroke,
  type LogoStrokeTone,
} from './morphPaths';

/** Maps a stroke's official tone to the gradient suffix defined in `<defs>`. */
const STROKE_GRADIENT: Record<LogoStrokeTone, string> = {
  deep: 'goldDeep',
  mid: 'goldMid',
  light: 'goldLight',
};

/**
 * The official METTIVO mark in the hero's world space.
 *
 * `animated` turns the morph into a build: the legs draw first, the crossed
 * arms follow, then the heads, heart and rose settle in. It is the same
 * artwork as `src/components/Logo.tsx` and `public/logo-mark.svg`, only placed
 * with `LOGO_TO_HERO` so the characters can dissolve into it.
 */

export interface LogoMarkProps {
  phase: HeroPhase;
  /** Draw the mark on during `morph`. False renders the finished mark. */
  animated?: boolean;
}

export default function LogoMark({ phase, animated = true }: LogoMarkProps) {
  const raw = useId();
  const uid = `mk${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const revealed = phase === 'morph' || phase === 'logo';

  return (
    <>
      <defs>
        <linearGradient id={`${uid}-goldLight`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f0d8b6" />
          <stop offset="0.5" stopColor="#e0bc93" />
          <stop offset="1" stopColor="#cfab83" />
        </linearGradient>
        <linearGradient id={`${uid}-goldMid`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e0bc93" />
          <stop offset="1" stopColor="#d8b38a" />
        </linearGradient>
        <linearGradient id={`${uid}-goldDeep`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#cfa87e" />
          <stop offset="1" stopColor="#b58c5e" />
        </linearGradient>
        <linearGradient id={`${uid}-headLeft`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#f0d8b6" />
          <stop offset="1" stopColor="#d8b38a" />
        </linearGradient>
        <linearGradient id={`${uid}-headRight`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#e8cba6" />
          <stop offset="1" stopColor="#cfab83" />
        </linearGradient>
        <linearGradient id={`${uid}-heart`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#d4a3a5" />
          <stop offset="1" stopColor="#c78c8d" />
        </linearGradient>
        <linearGradient id={`${uid}-rose`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#8d4a5f" />
          <stop offset="0.6" stopColor="#5d2b3c" />
          <stop offset="1" stopColor="#4a1c2e" />
        </linearGradient>
        <filter id={`${uid}-lift`} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow
            dx="7"
            dy="9"
            stdDeviation="7"
            floodColor="#1b0f14"
            floodOpacity="0.32"
          />
        </filter>
        <filter id={`${uid}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow
            dx="0"
            dy="0"
            stdDeviation="7"
            floodColor="#e0bc93"
            floodOpacity="0.35"
          />
        </filter>
      </defs>

      <motion.g
        transform={LOGO_TO_HERO}
        initial={false}
        animate={{ opacity: revealed ? 1 : 0 }}
        transition={{ duration: animated ? 0.45 : 0, ease: EASE }}
      >
        {/* Far pair. */}
        {LOGO_FAR_STROKES.map((stroke, index) => (
          <Stroke
            key={`far-${index}`}
            stroke={stroke}
            tone={`url(#${uid}-${STROKE_GRADIENT[stroke.tone]})`}
            revealed={revealed}
            animated={animated}
            delay={0.02 * index}
          />
        ))}

        {/* Near pair, lifted so it sits in front. */}
        <g filter={`url(#${uid}-lift)`}>
          {LOGO_NEAR_STROKES.map((stroke, index) => (
            <Stroke
              key={`near-${index}`}
              stroke={stroke}
              tone={`url(#${uid}-${STROKE_GRADIENT[stroke.tone]})`}
              revealed={revealed}
              animated={animated}
              delay={0.1 + 0.09 * index}
            />
          ))}
        </g>

        {/* Heads. The right is marginally lower and smaller, as in the mark. */}
        {LOGO_HEADS.map((head, index) => (
          <motion.circle
            key={`head-${index}`}
            cx={head.cx}
            cy={head.cy}
            r={head.r}
            fill={`url(#${uid}-${head.tone === 'left' ? 'headLeft' : 'headRight'})`}
            initial={{ opacity: 0, scale: 0.72 }}
            animate={{ opacity: revealed ? 1 : 0, scale: revealed ? 1 : 0.72 }}
            transition={{
              duration: animated ? 0.55 : 0,
              delay: animated ? 1.05 + index * 0.08 : 0,
              ease: EASE,
            }}
            style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          />
        ))}

        {/* Heart in the valley. */}
        <motion.path
          d={LOGO_HEART}
          fill={`url(#${uid}-heart)`}
          filter={`url(#${uid}-glow)`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: revealed ? 1 : 0, scale: revealed ? 1 : 0.5 }}
          transition={{
            duration: animated ? 0.6 : 0,
            delay: animated ? 1.3 : 0,
            ease: EASE,
          }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
        />

        {/* Rose: stem, leaves, then the layered bloom. */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: revealed ? 1 : 0 }}
          transition={{
            duration: animated ? 0.5 : 0,
            delay: animated ? 1.4 : 0,
            ease: EASE,
          }}
        >
          <path
            d={LOGO_ROSE.stem}
            fill="none"
            stroke="#6b4a3a"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path d={LOGO_ROSE.leafRight} fill="#5f3346" />
          <path d={LOGO_ROSE.leafLeft} fill="#4a1c2e" />
          <motion.g
            initial={false}
            animate={{ scale: revealed ? 1 : 0.55 }}
            transition={{
              duration: animated ? 0.55 : 0,
              delay: animated ? 1.5 : 0,
              ease: EASE,
            }}
            style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          >
            <circle
              cx={LOGO_ROSE.bloom.cx}
              cy={LOGO_ROSE.bloom.cy}
              r={LOGO_ROSE.bloom.r}
              fill={`url(#${uid}-rose)`}
            />
            <path
              d={LOGO_ROSE.petalOuter}
              fill="none"
              stroke="#8d4a5f"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d={LOGO_ROSE.petalInner}
              fill="none"
              stroke="#a35d72"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </motion.g>
        </motion.g>
      </motion.g>
    </>
  );
}

function Stroke({
  stroke,
  tone,
  revealed,
  animated,
  delay,
}: {
  stroke: LogoStroke;
  tone: string;
  revealed: boolean;
  animated: boolean;
  delay: number;
}) {
  return (
    <motion.path
      d={stroke.d}
      fill="none"
      stroke={tone}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: revealed ? 1 : 0, opacity: revealed ? 1 : 0 }}
      transition={{
        pathLength: {
          duration: animated ? 0.95 : 0,
          delay: animated ? 0.5 + delay : 0,
          ease: EASE,
        },
        opacity: {
          duration: animated ? 0.3 : 0,
          delay: animated ? 0.5 + delay : 0,
          ease: EASE,
        },
      }}
    />
  );
}
