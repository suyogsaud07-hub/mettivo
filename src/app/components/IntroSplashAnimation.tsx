'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '@/components/Logo';

/**
 * The cinematic intro.
 *
 * THE STORY, IN ONE TIMELINE (~3.4s)
 *   0.0s  the boy lowers onto one knee and offers the bouquet
 *   0.6s  the girl steps in and reaches down to accept
 *   1.2s  they meet — the heart blooms between them
 *   2.0s  the pair sweep upward and become the brand mark
 *   2.9s  "METTIVO — Your Next Connection" settles in
 *   3.4s  the curtain lifts
 *
 * WHY IT ROUTES THROUGH THE REAL LOGO
 *   The morph target is not a redrawn approximation. `<Logo variant="mark">` is
 *   mounted inside the scene and the figures cross-fade into it, so if the brand
 *   mark ever changes this animation follows automatically. `variant="mark"` and
 *   not `lockup`: a nested `<svg>` inside another `<svg>` does not render, and
 *   the wordmark belongs to the page this curtain lifts onto anyway.
 *
 * WHEN IT PLAYS, AND WHY IT CAN BE SKIPPED
 *   Every full load of the app. There is no `sessionStorage` / `localStorage`
 *   flag: the intro is not cached or suppressed. Because this component lives in
 *   the root layout, it runs on the first paint of any entry point — the landing
 *   page or a deep link such as `/chat/...` — and does NOT re-run on client-side
 *   navigation, where the layout is preserved rather than remounted. A visible
 *   Skip control is present from the first frame, because a multi-second
 *   unskippable overlay is hostile on a repeat visit.
 *
 * REDUCED MOTION IS A HARD GATE, NOT A POLISH ITEM
 *   A full-screen sweeping animation is exactly the pattern that triggers
 *   vestibular discomfort. Under `prefers-reduced-motion: reduce` this component
 *   renders NOTHING and reveals the app immediately — the timeline is never
 *   mounted, so no frames are committed and no work is done. A CSS `@media`
 *   fallback would not be enough.
 */

/** Scene cues in seconds. One place, so the whole story reads at a glance. */
const T = {
  boy: 0.0,
  girl: 0.6,
  heart: 1.2,
  morph: 2.0,
  lockup: 2.9,
  end: 3.4,
} as const;

/** Fluid, symmetric easing — reads as a drawn sweep rather than a machine. */
const EASE = [0.65, 0, 0.35, 1] as const;

/** Gold gradient shared by every limb, so the figures read as one material. */
function GoldDefs() {
  return (
    <defs>
      <linearGradient id="mvIntroGold" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor="#f0d8b6" />
        <stop offset="0.55" stopColor="#d8b38a" />
        <stop offset="1" stopColor="#cfab83" />
      </linearGradient>
      <linearGradient id="mvIntroHeart" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#d4a3a5" />
        <stop offset="1" stopColor="#c78c8d" />
      </linearGradient>
      <linearGradient id="mvIntroRose" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#7a3b4f" />
        <stop offset="1" stopColor="#4a1c2e" />
      </linearGradient>
      <radialGradient id="mvIntroGlow">
        <stop offset="0" stopColor="#c78c8d" stopOpacity="0.55" />
        <stop offset="1" stopColor="#c78c8d" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/**
 * Two figures, drawn in the same rounded-stroke grammar as the brand mark:
 * circles for heads, tapered round-capped strokes for bodies and limbs. Keeping
 * one visual language is what makes the final morph read as the same characters
 * rather than as a scene change.
 */
function Figures({ morphed }: { morphed: boolean }) {
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={morphed ? { opacity: 0, scale: 1.14, y: -60 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: morphed ? 0.7 : 0.4, ease: EASE }}
      style={{ originX: '320px', originY: '640px' }}
    >
      {/* ================= THE BOY — down on one knee ================= */}
      <motion.g
        initial={{ opacity: 0, y: 34 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.75, ease: EASE, delay: T.boy }}
      >
        <circle cx="222" cy="296" r="54" fill="url(#mvIntroGold)" />
        {/* Torso, leaning in toward her. */}
        <path
          d="M232 352 C 244 428 258 496 276 552"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="58" strokeLinecap="round"
        />
        {/* The planted leg. */}
        <path
          d="M274 548 C 286 610 296 660 302 688"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="50" strokeLinecap="round"
        />
        {/* The knee he has dropped to. */}
        <path
          d="M270 540 C 244 596 220 648 208 716"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="52" strokeLinecap="round"
        />
        <path
          d="M208 716 C 214 750 244 766 278 758"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="46" strokeLinecap="round"
        />
        {/* His presenting arm is drawn later, over both torsos — see THE ARMS. */}
      </motion.g>

      {/* ================= THE GIRL — steps in, then reaches down ================= */}
      <motion.g
        initial={{ opacity: 0, x: 44 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.75, ease: EASE, delay: T.girl }}
      >
        <circle cx="424" cy="238" r="50" fill="url(#mvIntroGold)" />
        {/* Torso, inclining toward him. Shorter than his reach, so the pair read
            as leaning together rather than as two parallel columns. */}
        <path
          d="M420 288 C 412 372 406 452 402 524"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="54" strokeLinecap="round"
        />
        {/* Legs. */}
        <path
          d="M404 520 C 398 604 396 676 400 722"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="46" strokeLinecap="round"
        />
        <path
          d="M400 722 C 394 754 406 772 434 774"
          fill="none" stroke="url(#mvIntroGold)" strokeWidth="42" strokeLinecap="round"
        />
      </motion.g>

      {/* ================= THE BOUQUET, offered between them =================
          Stems fan out from one grip, which is what makes a cluster of circles
          read as a held bunch of roses rather than as floating dots. */}
      <motion.g
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.65, ease: EASE, delay: T.boy + 0.5 }}
        style={{ originX: '372px', originY: '572px' }}
      >
        {/* Stems. */}
        <path d="M372 626 C 370 604 366 586 362 570" fill="none" stroke="#6b4a3a" strokeWidth="7" strokeLinecap="round" />
        <path d="M372 626 C 362 606 350 588 336 572" fill="none" stroke="#6b4a3a" strokeWidth="6" strokeLinecap="round" />
        <path d="M372 626 C 380 606 392 588 404 572" fill="none" stroke="#6b4a3a" strokeWidth="6" strokeLinecap="round" />
        {/* Leaves. */}
        <path d="M368 600 C 350 590 334 596 330 610 C 348 620 362 610 368 600 Z" fill="#4a1c2e" />
        <path d="M378 596 C 396 586 412 592 416 606 C 398 616 384 606 378 596 Z" fill="#5f3346" />
        {/* Blossoms, clustered. */}
        <circle cx="360" cy="556" r="24" fill="url(#mvIntroRose)" />
        <circle cx="334" cy="558" r="19" fill="url(#mvIntroRose)" />
        <circle cx="404" cy="556" r="20" fill="#7a3b4f" />
        <circle cx="368" cy="530" r="17" fill="#8d4a5f" />
        <circle cx="346" cy="534" r="13" fill="#5d2b3c" />
      </motion.g>

      {/* ================= THE ARMS, drawn over the torsos =================
          Rendered last so the gesture is legible: an arm buried under two
          54px torso strokes reads as nothing at all. */}
      <motion.path
        d="M244 404 C 292 444 334 496 362 552"
        fill="none" stroke="url(#mvIntroGold)" strokeWidth="38" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: T.boy + 0.25 }}
      />
      <motion.path
        d="M412 350 C 392 420 374 486 366 548"
        fill="none" stroke="url(#mvIntroGold)" strokeWidth="36" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: EASE, delay: T.girl + 0.3 }}
      />
      {/* Her far arm, completing the embrace. */}
      <motion.path
        d="M428 360 C 408 420 388 462 360 494"
        fill="none" stroke="url(#mvIntroGold)" strokeWidth="32" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE, delay: T.heart }}
      />

      {/* ================= THE HEART, blooming between them =================
          A compact glyph in the negative space between the two heads — sized
          from the 96px gap between their centres, so it reads as a spark rather
          than as a shape covering somebody's face. */}
      <motion.g
        initial={{ opacity: 0, scale: 0.2 }}
        animate={{ opacity: [0, 1, 0.92], scale: [0.2, 1.25, 1] }}
        transition={{ duration: 0.9, ease: EASE, delay: T.heart, times: [0, 0.6, 1] }}
        style={{ originX: '322px', originY: '240px' }}
      >
        <path
          d="M322 232 C 322 214 298 209 291 224 C 283 241 298 256 322 274 C 346 256 361 241 353 224 C 346 209 322 214 322 232 Z"
          fill="url(#mvIntroHeart)"
        />
      </motion.g>
    </motion.g>
  );
}

export interface IntroSplashAnimationProps {
  /** Called once the curtain has lifted. */
  onDone?: () => void;
}

export default function IntroSplashAnimation({
  onDone,
}: IntroSplashAnimationProps) {
  /** `null` = undecided. Keeps the server and first client render identical. */
  const [isVisible, setIsVisible] = useState<boolean | null>(null);
  const [morphed, setMorphed] = useState(false);
  const [showLockup, setShowLockup] = useState(false);
  const timers = useRef<number[]>([]);

  const finish = useCallback(() => {
    setIsVisible(false);
    onDone?.();
  }, [onDone]);

  useEffect(() => {
    // Decided on the CLIENT only. `prefers-reduced-motion` is a browser API, so
    // it cannot be read during render (the server would disagree and hydration
    // would mismatch); the first paint is therefore always "undecided".
    if (typeof window === 'undefined') return;

    // The decision is made inside a frame callback rather than synchronously in
    // the effect body. `react-hooks/set-state-in-effect` rejects a direct
    // `setState` here because it triggers a cascading render; deferring by one
    // frame is imperceptible — the curtain is the first thing painted either
    // way — and keeps the first client render (`null`, undecided) identical to
    // the server's.
    const decide = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Reveal immediately: the timeline is never mounted, so no frames are
        // committed and no work is done.
        setIsVisible(false);
        return;
      }

      // Always play. There is no "already seen" check — the intro runs on every
      // full load of the app.
      setIsVisible(true);

      // Scene cues as timers rather than an animation-complete chain, so the
      // whole story is readable in one place and skipping can clear everything.
      timers.current = [
        window.setTimeout(() => setMorphed(true), T.morph * 1000),
        window.setTimeout(() => setShowLockup(true), T.lockup * 1000),
        window.setTimeout(() => finish(), T.end * 1000),
      ];
    };

    const frame = window.requestAnimationFrame(decide);

    return () => {
      window.cancelAnimationFrame(frame);
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
  }, [finish]);

  const skip = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    finish();
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          data-testid="intro-splash"
          // Above the app for the length of the story, then unmounted.
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#131017]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -28 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <svg
            viewBox="0 0 640 1000"
            className="h-full w-auto max-w-none"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Mettivo — Your Next Connection"
          >
            <GoldDefs />

            {/* Soft bloom behind the pair as they meet. */}
            <motion.circle
              cx="320"
              cy="520"
              r="250"
              fill="url(#mvIntroGlow)"
              initial={{ opacity: 0 }}
              animate={{ opacity: morphed ? 0.6 : 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: T.heart }}
            />

            <Figures morphed={morphed} />

            {/*
              The morph target — the REAL mark, inlined via `<Logo variant="mark">`
              rather than redrawn, so the logo the intro reveals is the logo the
              product ships. It sweeps up from below as the figures lift away.
            */}
            <motion.g
              initial={{ opacity: 0, scale: 0.84, y: 170 }}
              animate={morphed ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.84, y: 170 }}
              transition={{ duration: 1.0, ease: EASE }}
              style={{ originX: '320px', originY: '600px' }}
            >
              <g transform="translate(100, 0)">
                <Logo variant="mark" width={440} alt="" />
              </g>
            </motion.g>

            {/*
              The wordmark and tagline, settling in on the mark.

              These fade ONLY — no `y` animation. Animating `y` on an SVG
              `<text>` makes framer-motion write a CSS `transform` that overrides
              the attribute value, which threw the wordmark ~900px down the frame
              and off-screen. A plain opacity fade leaves the glyph exactly where
              the attribute puts it.
            */}
            <motion.text
              x="320"
              y="852"
              textAnchor="middle"
              fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
              fontSize="58"
              fontWeight={300}
              letterSpacing="8"
              fill="#eae2f0"
              initial={{ opacity: 0 }}
              animate={{ opacity: showLockup ? 1 : 0 }}
              transition={{ duration: 0.7, ease: EASE }}
            >
              METTIVO
            </motion.text>
            <motion.text
              x="320"
              y="890"
              textAnchor="middle"
              fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
              fontSize="22"
              fontWeight={300}
              letterSpacing="2.6"
              fill="#b4a3c0"
              initial={{ opacity: 0 }}
              animate={{ opacity: showLockup ? 1 : 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: showLockup ? 0.15 : 0 }}
            >
              Your Next Connection
            </motion.text>
          </svg>

          <button
            type="button"
            data-testid="intro-skip"
            onClick={skip}
            className="absolute bottom-8 right-6 rounded-full border border-[#34283f] bg-[#211a28]/80 px-4 py-2 text-xs font-semibold tracking-wide text-[#eae2f0] backdrop-blur transition-colors hover:border-[#d8b38a] hover:text-[#d8b38a]"
          >
            Skip intro
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
