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
  SPRING,
  TOTAL_DURATION_MS,
  isMorphing,
  type HeroPhase,
} from './timeline';
import {
  HEART,
  HERO_VIEW_BOX,
  ROSE,
  assertMorphCompatibility,
} from './morphPaths';

/**
 * AnimatedHero — a self-contained, cinematic landing hero.
 *
 * THE STORY (strict, one phase at a time)
 *   idle → wave → approach → propose → accept → kiss → morph → logo
 * See `timeline.ts` for the phase list and durations. The morph is the payoff:
 * the two character silhouettes animate their SVG `d` attribute directly into
 * the two strokes of the "M", while the kiss heart and the bouquet rose morph
 * into the heart and rose at the foot of the logo. The wordmark then fades in.
 *
 * HOW TO SWAP IN YOUR OWN ART
 *   1. `Man.tsx` / `Woman.tsx`: replace the fill artwork inside each group.
 *   2. `morphPaths.ts`: replace each pair's `from`/`to` `d` strings. Keep the
 *      command structure of a pair IDENTICAL (that is what lets Framer
 *      interpolate the path). `assertMorphCompatibility()` warns in dev if a
 *      pair drifts.
 *   3. Leave the `animate={{ d }}` wiring here and in the figures alone.
 *
 * ACCESSIBILITY
 *   `prefers-reduced-motion` skips the timeline entirely and jumps to the logo.
 *   The whole scene is `pointer-events-none`, so it never blocks the page's
 *   buttons or links; only the optional Replay control is interactive.
 */

/** World-space rose position per phase (it travels from his hand to hers). */
const ROSE_X: Record<HeroPhase, number> = {
  idle: 272,
  wave: 272,
  approach: 400,
  propose: 350,
  accept: 566,
  kiss: 540,
  morph: 0,
  logo: 0,
};
const ROSE_Y: Record<HeroPhase, number> = {
  idle: 236,
  wave: 236,
  approach: 244,
  propose: 330,
  accept: 236,
  kiss: 246,
  morph: 0,
  logo: 0,
};

/** The kiss heart appears only at the kiss, then becomes the logo's heart. */
const HEART_X: Record<HeroPhase, number> = {
  idle: 0,
  wave: 0,
  approach: 0,
  propose: 0,
  accept: 0,
  kiss: 500,
  morph: 0,
  logo: 0,
};
const HEART_Y: Record<HeroPhase, number> = {
  idle: 0,
  wave: 0,
  approach: 0,
  propose: 0,
  accept: 0,
  kiss: 150,
  morph: 0,
  logo: 0,
};

function HeroDefs() {
  return (
    <defs>
      {/* The characters' suit / saree lighting lives in their own files
          (`ManDefs` / `WomanDefs`), so those gradients travel with the art. */}
      {/* The logo's champagne gold. */}
      <linearGradient id="heroGold" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#f0d8b6" />
        <stop offset="0.5" stopColor="#e0bc93" />
        <stop offset="1" stopColor="#cfab83" />
      </linearGradient>
      <linearGradient id="heroHeart" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#e0b0b1" />
        <stop offset="1" stopColor="#c78c8d" />
      </linearGradient>
      <radialGradient id="heroRose" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#d15b64" />
        <stop offset="0.6" stopColor="#a82f3c" />
        <stop offset="1" stopColor="#6e1f2a" />
      </radialGradient>
      <radialGradient id="heroGlow">
        <stop offset="0" stopColor="#d69aa0" stopOpacity="0.45" />
        <stop offset="1" stopColor="#b56f7c" stopOpacity="0" />
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

  // Keep the latest callback without making the timeline effect depend on it.
  // Synced in an effect (not during render) so the ref rule stays satisfied.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Warn (dev only) if a morph pair's paths are no longer interpolatable.
  useEffect(() => {
    assertMorphCompatibility();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const timers: number[] = [];

    // Deferred to a frame: `react-hooks/set-state-in-effect` rejects a direct
    // setState in an effect body, and this is imperceptible on first paint.
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
  const roseTarget = morphing ? ROSE.to : ROSE.from;
  const heartTarget = morphing ? HEART.to : HEART.from;

  const roseGroup = {
    x: ROSE_X[phase],
    y: ROSE_Y[phase],
    transition: morphing ? MORPH_TRANSITION : SPRING,
  };

  const heartGroup = {
    x: HEART_X[phase],
    y: HEART_Y[phase],
    opacity: heartVisible ? 1 : 0,
    rotate: phase === 'kiss' ? [0, -6, 6, -4, 0] : 0,
    transition: morphing ? MORPH_TRANSITION : SPRING,
  };

  return (
    <div className={['relative h-full w-full', className].filter(Boolean).join(' ')}>
      <svg
        viewBox={HERO_VIEW_BOX}
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <HeroDefs />

        {/* Soft bloom that blooms with the heart. */}
        <motion.circle
          cx="500"
          cy="340"
          r="260"
          fill="url(#heroGlow)"
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          animate={{ opacity: heartVisible ? 0.9 : 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        />

        {/* Ground contact shadows, so the pair are standing, not floating. */}
        <motion.g animate={{ opacity: morphing ? 0 : 0.5 }} transition={{ duration: 0.4 }}>
          <ellipse cx="330" cy="548" rx="92" ry="15" fill="#000000" opacity="0.45" />
          <ellipse cx="670" cy="548" rx="92" ry="15" fill="#000000" opacity="0.45" />
        </motion.g>

        <Man phase={phase} />
        <Woman phase={phase} />

        {/* The bouquet rose: travels to her, then morphs to the logo's rose. */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          animate={roseGroup}
        >
          <motion.path
            d={ROSE.from}
            fill="url(#heroRose)"
            animate={{ d: roseTarget }}
            transition={morphing ? MORPH_TRANSITION : { duration: 0 }}
          />
        </motion.g>

        {/* The kiss heart, which becomes the heart in the logo's valley. */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
          animate={heartGroup}
        >
          <motion.path
            d={HEART.from}
            fill="url(#heroHeart)"
            animate={{
              d: heartTarget,
              scale: phase === 'kiss' ? [0.2, 1.2, 1, 1.12, 1] : 1,
            }}
            transition={morphing ? MORPH_TRANSITION : SPRING}
          />
        </motion.g>
      </svg>

      {/* Wordmark overlay. The mark itself is already on screen, formed by the
          morphed characters, so only the type is drawn here. */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        initial={false}
        animate={{ opacity: phase === 'logo' ? 1 : 0 }}
        transition={{ duration: 0.7, ease: EASE, delay: phase === 'logo' ? 0.1 : 0 }}
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
