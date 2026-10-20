'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import AnimatedHero from './AnimatedHero';
import { EASE } from './timeline';

/**
 * IntroSplash — the full-screen pre-loader.
 *
 * It plays the `AnimatedHero` sequence behind an opaque overlay. Once the morph
 * into the METTIVO mark is complete the logo is held on screen for 1.5 s, then
 * the whole overlay fades out to reveal the landing page beneath.
 *
 * The overlay is `position: fixed`, so it never participates in document flow:
 * when it unmounts, the page beneath is already laid out and nothing shifts.
 *
 * `prefers-reduced-motion` is a hard gate — the splash renders nothing and the
 * page is revealed immediately. (The caller also refuses to mount it, so this
 * is belt-and-braces.)
 */

/** How long the finished logo is held before the fade begins. */
const HOLD_MS = 1500;
const FADE_MS = 800;

export interface IntroSplashProps {
  /** Called once the splash has fully faded out and can be unmounted. */
  onDone: () => void;
}

export default function IntroSplash({ onDone }: IntroSplashProps) {
  const prefersReducedMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const holdRef = useRef<number | null>(null);
  // Guards the exit sequence so a repeated `onComplete` (Strict Mode,
  // reduced-motion re-render, Fast Refresh) cannot schedule a second hold or a
  // second `onDone`. The animation must play exactly once per mount.
  const completedRef = useRef(false);
  const doneRef = useRef(false);

  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (holdRef.current !== null) window.clearTimeout(holdRef.current);
    holdRef.current = window.setTimeout(() => setLeaving(true), HOLD_MS);
  }, []);

  // Clear a pending hold if we unmount mid-hold.
  useEffect(
    () => () => {
      if (holdRef.current !== null) window.clearTimeout(holdRef.current);
    },
    [],
  );

  // Unmount a hair after the fade finishes so it never cuts off.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    }, FADE_MS + 60);
    return () => window.clearTimeout(timer);
  }, [leaving, onDone]);

  if (prefersReducedMotion) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]"
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: FADE_MS / 1000, ease: EASE }}
      aria-hidden="true"
    >
      <AnimatedHero className="h-full w-full" showReplay={false} onComplete={handleComplete} />
    </motion.div>
  );
}
