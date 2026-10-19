'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Man, { MAN_ROOT } from './Man';
import Woman, { WOMAN_ROOT } from './Woman';
import LogoMark from './LogoMark';
import MettivoLogo from './MettivoLogo';
import {
  EASE,
  PHASE_DURATION_MS,
  PHASE_ORDER,
  TOTAL_DURATION_MS,
  glideForPhase,
  isMorphing,
  isStory,
  type HeroPhase,
} from './timeline';
import {
  GROUND_Y,
  HERO_VIEW_BOX,
  KISS_HEART,
  KISS_HEART_POINT,
  KISS_POINT,
  assertLogoGeometry,
} from './morphPaths';

/**
 * AnimatedHero — the cinematic landing sequence.
 *
 * THE STORY
 *   SEE      two people notice each other across a midnight courtyard.
 *   WAVE     he raises his right arm; she answers with her left.
 *   WALK     they close the distance with an alternating stride.
 *   PROPOSE  he kneels, leans in and offers the roses.
 *   ACCEPT   she bends, takes them, rises, and they kiss.
 *   MORPH    their silhouettes dissolve into the official METTIVO mark.
 *
 * The timeline is deterministic (phase timers only), the limbs are separate
 * groups with real joints, and the mark is built from the official artwork.
 *
 * ACCESSIBILITY
 *   `prefers-reduced-motion` jumps straight to the finished mark. The scene is
 *   `pointer-events-none`; only the optional Replay control is interactive.
 */

/** Restrained atmospheric motes. Fixed seeds; no new nodes per frame. */
const MOTES = [
  { x: 150, y: 150, r: 1.6, duration: 6.2, delay: 0 },
  { x: 320, y: 96, r: 1.1, duration: 7.4, delay: 1.1 },
  { x: 470, y: 132, r: 1.8, duration: 5.6, delay: 0.4 },
  { x: 620, y: 90, r: 1.2, duration: 8.1, delay: 2.0 },
  { x: 790, y: 168, r: 1.7, duration: 6.8, delay: 0.8 },
  { x: 866, y: 300, r: 1.0, duration: 7.8, delay: 1.6 },
  { x: 190, y: 330, r: 1.3, duration: 7.0, delay: 2.4 },
  { x: 700, y: 392, r: 1.1, duration: 6.4, delay: 1.3 },
] as const;

export interface AnimatedHeroProps {
  className?: string;
  /** Called once the timeline reaches the terminal `logo` hold. */
  onComplete?: () => void;
  /** Show the small Replay control. Default true. */
  showReplay?: boolean;
}

export default function AnimatedHero({
  className,
  onComplete,
  showReplay = true,
}: AnimatedHeroProps) {
  const [phase, setPhase] = useState<HeroPhase>('see');
  const [runId, setRunId] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const rawId = useId();
  const uid = `hero${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    assertLogoGeometry();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const timers: number[] = [];

    const start = () => {
      if (cancelled) return;

      if (prefersReducedMotion) {
        setPhase('logo');
        onCompleteRef.current?.();
        return;
      }

      setPhase('see');

      let elapsed = 0;
      for (let i = 1; i < PHASE_ORDER.length; i += 1) {
        elapsed += PHASE_DURATION_MS[PHASE_ORDER[i - 1]];
        const next = PHASE_ORDER[i];
        timers.push(
          window.setTimeout(() => {
            if (!cancelled) setPhase(next);
          }, elapsed),
        );
      }

      timers.push(
        window.setTimeout(() => {
          if (!cancelled) onCompleteRef.current?.();
        }, TOTAL_DURATION_MS),
      );
    };

    const frame = window.requestAnimationFrame(start);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      timers.forEach(window.clearTimeout);
    };
  }, [prefersReducedMotion, runId]);

  const morphing = isMorphing(phase);
  const story = isStory(phase);
  const accepting = phase === 'accept';
  const manX = MAN_ROOT[phase].x;
  const womanX = WOMAN_ROOT[phase].x;

  const kissTransition = accepting
    ? { duration: PHASE_DURATION_MS.accept / 1000, ease: EASE, times: [0, 0.55, 0.75, 1] }
    : morphing
      ? { duration: PHASE_DURATION_MS.morph / 1000, ease: EASE, times: [0, 1] }
      : { duration: 0.4, ease: EASE };

  return (
    <div className={['relative h-full w-full', className].filter(Boolean).join(' ')}>
      <svg
        viewBox={HERO_VIEW_BOX}
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${uid}-sky`} x1="0.1" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#111b31" />
            <stop offset="0.45" stopColor="#0a1120" />
            <stop offset="1" stopColor="#05070d" />
          </linearGradient>
          <radialGradient id={`${uid}-centre`} cx="0.5" cy="0.52" r="0.62">
            <stop offset="0" stopColor="#2b2444" stopOpacity="0.9" />
            <stop offset="0.55" stopColor="#14152a" stopOpacity="0.45" />
            <stop offset="1" stopColor="#05070d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-blue`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#2f66d8" stopOpacity="0.42" />
            <stop offset="0.6" stopColor="#1d3f8f" stopOpacity="0.14" />
            <stop offset="1" stopColor="#1d3f8f" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-silver`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#b9cfe8" stopOpacity="0.24" />
            <stop offset="0.6" stopColor="#8fa9c8" stopOpacity="0.08" />
            <stop offset="1" stopColor="#8fa9c8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-wine`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#b3324a" stopOpacity="0.26" />
            <stop offset="1" stopColor="#7a1f33" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-flash`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffe9cf" stopOpacity="0.95" />
            <stop offset="0.35" stopColor="#e6b98d" stopOpacity="0.5" />
            <stop offset="1" stopColor="#d8b38a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-heart`} cx="0.5" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#f0c4c4" />
            <stop offset="0.55" stopColor="#d69aa0" />
            <stop offset="1" stopColor="#b56f7c" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width="1000" height="640" fill={`url(#${uid}-sky)`} />
        <rect x="0" y="0" width="1000" height="640" fill={`url(#${uid}-centre)`} />

        {/* Directional light: cool silver behind him, blue behind her, and the
            roses' warm red low between them. */}
        <circle cx="360" cy="300" r="240" fill={`url(#${uid}-silver)`} />
        <circle cx="650" cy="300" r="260" fill={`url(#${uid}-blue)`} />
        <circle cx="480" cy="400" r="150" fill={`url(#${uid}-wine)`} />
        <motion.circle
          cx="500"
          cy="340"
          r="300"
          fill={`url(#${uid}-centre)`}
          animate={{ opacity: morphing ? 1 : 0.45 }}
          transition={{ duration: 1.2, ease: EASE }}
        />

        {MOTES.map((mote, index) => (
          <motion.circle
            key={`mote-${index}`}
            cx={mote.x}
            cy={mote.y}
            r={mote.r}
            fill={index % 3 === 0 ? '#e0bc93' : '#9fb6d6'}
            initial={{ opacity: 0.1 }}
            animate={{ opacity: [0.06, 0.38, 0.06] }}
            transition={{
              duration: mote.duration,
              delay: mote.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}

        {/* Ground shadows follow the roots, but stay on the ground line. */}
        <motion.g
          animate={{ x: manX, opacity: story ? 0.34 : 0 }}
          transition={glideForPhase(phase)}
        >
          <ellipse cx="0" cy={GROUND_Y + 2} rx="44" ry="7" fill="#000" />
        </motion.g>
        <motion.g
          animate={{ x: womanX, opacity: story ? 0.3 : 0 }}
          transition={glideForPhase(phase)}
        >
          <ellipse cx="0" cy={GROUND_Y + 2} rx="38" ry="6" fill="#000" />
        </motion.g>

        <g transform={`translate(${KISS_POINT.x} ${KISS_POINT.y})`}>
          <motion.circle
            r="26"
            fill={`url(#${uid}-flash)`}
            initial={false}
            animate={
              accepting
                ? { opacity: [0, 0, 0.5, 0.5], scale: [0.2, 0.2, 1, 1] }
                : morphing
                  ? { opacity: [0.5, 0], scale: [1, 1.6] }
                  : { opacity: 0, scale: 0.2 }
            }
            transition={kissTransition}
            style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          />
        </g>

        <LogoMark key={runId} phase={phase} />
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: PHASE_DURATION_MS.see / 1000, ease: EASE }}
        >
          <Man phase={phase} />
          <Woman phase={phase} />
        </motion.g>

        {/* The small heart where their faces meet; it blooms with the kiss and
            dissolves into the heart of the mark. */}
        <g transform={`translate(${KISS_HEART_POINT.x} ${KISS_HEART_POINT.y})`}>
          <motion.g
            initial={false}
            animate={
              accepting
                ? { opacity: [0, 0, 1, 1], scale: [0.5, 0.5, 1, 1] }
                : { opacity: 0, scale: 0.5 }
            }
            transition={kissTransition}
            style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          >
            <path d={KISS_HEART} fill={`url(#${uid}-heart)`} />
          </motion.g>
        </g>

        {/* The mark itself: the official artwork, drawn from the same assets as
            the navigation logo. */}
      </svg>

      {/* Wordmark. The mark is formed by the morph above, so only the type is
          drawn here. It resolves in the tail of the morph so the COMPLETE lockup
          — emblem plus type — is held for the whole terminal `logo` hold, rather
          than the type still fading in while the hold is already running down. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: isMorphing(phase) ? 1 : 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: isMorphing(phase) ? 1.3 : 0 }}
      >
        <MettivoLogo showMark={false} className="h-full w-full" />
      </motion.div>

      <AnimatePresence>
        {showReplay && phase === 'logo' && (
          <motion.button
            key="replay"
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={() => setRunId((id) => id + 1)}
            className="pointer-events-auto absolute bottom-6 right-6 rounded-full border border-[#32405a] bg-[#0d1424]/80 px-4 py-2 text-xs font-semibold tracking-wide text-[#e7e2dc] backdrop-blur transition-colors hover:border-[#d8b38a] hover:text-[#d8b38a]"
          >
            Replay
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
