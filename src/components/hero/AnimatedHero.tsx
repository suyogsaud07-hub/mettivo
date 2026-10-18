'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Man from './Man';
import Woman from './Woman';
import MettivoLogo from './MettivoLogo';
import {
  EASE,
  MORPH_TRANSITION,
  PHASE_DURATION_MS,
  PHASE_ORDER,
  TOTAL_DURATION_MS,
  glideForPhase,
  isMorphing,
  type HeroPhase,
} from './timeline';
import { HEART, HERO_VIEW_BOX, ROSE, assertMorphCompatibility } from './morphPaths';

/**
 * AnimatedHero — the cinematic landing sequence.
 *
 * THE STORY (one phase at a time)
 *   idle → walk → kiss → morph → logo
 * Two solid silhouettes rest apart, glide together, lean in for a slow kiss,
 * then return to the origin and morph into the METTIVO mark: the man into the
 * left stroke, the woman into the right, the lean-in heart into the heart in
 * the valley, and the bloom into the rose at the foot. The wordmark fades in.
 *
 * MOTION
 *   Every move is a tween on the single `EASE` cubic-bezier (see `timeline.ts`)
 *   — no springs, no linear — so the pair glide rather than step.
 *
 * ACCESSIBILITY
 *   `prefers-reduced-motion` skips the timeline entirely and jumps to the logo.
 *   The scene is `pointer-events-none`; only the optional Replay control is
 *   interactive.
 */

/** Where the heart blooms between the leaning pair, in world space. */
const HEART_BLOOM = { x: 500, y: 296 };

function HeroDefs() {
  return (
    <defs>
      {/* A faint warm centre so the silhouettes read against the black. */}
      <radialGradient id="heroBack" cx="0.5" cy="0.5" r="0.7">
        <stop offset="0" stopColor="#221b28" />
        <stop offset="1" stopColor="#0a0a0a" stopOpacity="0" />
      </radialGradient>
      {/* The pink bloom that grows with the kiss. */}
      <radialGradient id="heroGlow">
        <stop offset="0" stopColor="#d69aa0" stopOpacity="0.5" />
        <stop offset="0.6" stopColor="#b56f7c" stopOpacity="0.18" />
        <stop offset="1" stopColor="#b56f7c" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="heroHeart" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#e0b0b1" />
        <stop offset="1" stopColor="#c78c8d" />
      </linearGradient>
      <radialGradient id="heroRose" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stopColor="#d15b64" />
        <stop offset="0.6" stopColor="#a82f3c" />
        <stop offset="1" stopColor="#6e1f2a" />
      </radialGradient>
    </defs>
  );
}

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
  const [phase, setPhase] = useState<HeroPhase>('idle');
  const [runId, setRunId] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    assertMorphCompatibility();
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

      setPhase('idle');

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
  const heartVisible = phase === 'kiss' || morphing;

  return (
    <div className={['relative h-full w-full', className].filter(Boolean).join(' ')}>
      <svg
        viewBox={HERO_VIEW_BOX}
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <HeroDefs />

        <rect x="0" y="0" width="1000" height="640" fill="url(#heroBack)" />

        {/* The bloom grows with the kiss, then stays for the logo. */}
        <motion.circle
          cx="500"
          cy="330"
          r="300"
          fill="url(#heroGlow)"
          animate={{ opacity: heartVisible ? 1 : 0.12 }}
          transition={{ duration: 1, ease: EASE }}
        />

        <Man phase={phase} />
        <Woman phase={phase} />

        {/* The lean-in heart, then the heart in the valley of the mark. */}
        <motion.g
          animate={{
            x: morphing ? 0 : HEART_BLOOM.x,
            y: morphing ? 0 : HEART_BLOOM.y,
            opacity: heartVisible ? 1 : 0,
            scale: heartVisible ? 1 : 0.7,
          }}
          transition={morphing ? glideForPhase('morph') : { duration: 0.9, ease: EASE }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
        >
          <motion.path
            d={HEART.from}
            fill="url(#heroHeart)"
            animate={{ d: morphing ? HEART.to : HEART.from }}
            transition={morphing ? MORPH_TRANSITION : { duration: 0 }}
          />
        </motion.g>

        {/* The bloom settles as the rose at the foot of the mark. */}
        <motion.g
          animate={{ opacity: morphing ? 1 : 0, scale: morphing ? 1 : 0.6 }}
          transition={morphing ? glideForPhase('morph') : { duration: 0.6, ease: EASE }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
        >
          <motion.path
            d={ROSE.from}
            fill="url(#heroRose)"
            animate={{ d: morphing ? ROSE.to : ROSE.from }}
            transition={morphing ? MORPH_TRANSITION : { duration: 0 }}
          />
        </motion.g>
      </svg>

      {/* Wordmark. The mark itself is formed by the morphed silhouettes, so only
          the type is drawn here. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: phase === 'logo' ? 1 : 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: phase === 'logo' ? 0.15 : 0 }}
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
            className="pointer-events-auto absolute bottom-6 right-6 rounded-full border border-[#34283f] bg-[#211a28]/80 px-4 py-2 text-xs font-semibold tracking-wide text-[#eae2f0] backdrop-blur transition-colors hover:border-[#d8b38a] hover:text-[#d8b38a]"
          >
            Replay
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
