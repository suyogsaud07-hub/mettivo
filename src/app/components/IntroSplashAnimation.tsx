'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * The cinematic intro — a four-act story that settles into the brand mark.
 *
 * THE STORY, IN ONE 8s TIMELINE
 *   Phase 1 · Meet & greet    0.0s – 2.0s  the pair slide in from opposite
 *                                          sides, say "Hi", and turn to face
 *                                          each other.
 *   Phase 2 · The proposal    2.0s – 4.0s  the boy drops to one knee and the
 *                                          rose slides out to hover between
 *                                          them.
 *   Phase 3 · The acceptance  4.0s – 5.5s  the girl leans in, the heart blooms
 *                                          and beats, the rose drifts toward
 *                                          her.
 *   Phase 4 · Embrace & settle 5.5s – 8.0s the pair converge into the solid,
 *                                          symmetrical "M"; the heart settles
 *                                          between their heads, the rose hangs
 *                                          at the bottom centre, and the
 *                                          wordmark fades in.
 *
 * WHY THE FIGURES *ARE* THE MARK
 *   Every `<g>` below is authored in the brand mark's own coordinate space
 *   (`src/components/Logo.tsx`, `MarkArtwork`) and animated from a story pose
 *   back to its authored pose. The final frame therefore *is* the mark's
 *   geometry — the bodies do not cross-fade into a redrawn logo, so the last
 *   frame cannot drift from the brand. If the mark changes, the path data here
 *   must be updated with it.
 *
 * WHEN IT PLAYS, AND WHY IT CAN BE SKIPPED
 *   ONCE per app launch. A `sessionStorage` flag (`splash_played`) records that
 *   the curtain has already played in this tab: a reload keeps the flag and the
 *   intro is skipped, while closing the tab clears it and the next launch plays
 *   it again — the native-app "intro on cold start" behaviour. Because this
 *   component lives in the root layout, it runs on the first paint of any entry
 *   point and does NOT re-run on client-side navigation. A visible Skip control
 *   is present from the first frame, because a multi-second unskippable overlay
 *   is hostile on a repeat visit; skipping also records the flag.
 *
 * REDUCED MOTION IS A HARD GATE, NOT A POLISH ITEM
 *   A full-screen sweeping animation is exactly the pattern that triggers
 *   vestibular discomfort. Under `prefers-reduced-motion: reduce` this component
 *   renders NOTHING and reveals the app immediately — the timeline is never
 *   mounted, so no frames are committed and no work is done. A CSS `@media`
 *   fallback would not be enough. The flag is deliberately NOT set in that case,
 *   so reduced motion short-circuits every launch, not just the first.
 *
 * NO LAYOUT SHIFT
 *   The curtain is a `position: fixed` overlay, so it never participates in
 *   document flow: when it fades out and unmounts, the app beneath it is already
 *   laid out and nothing moves.
 */

/** Scene cues in seconds. One place, so the whole story reads at a glance. */
const T = {
  meet: 0.2,
  propose: 2.0,
  accept: 4.0,
  embrace: 5.5,
  lockup: 6.8,
  end: 8.0,
} as const;

/**
 * Marks that the intro has played in this tab. `sessionStorage` survives a
 * reload but is cleared when the tab is closed, which is exactly "once per app
 * launch" — the native-app convention.
 */
const SPLASH_PLAYED_KEY = 'splash_played';

/** Fluid, symmetric easing — reads as a drawn sweep rather than a machine. */
const EASE = [0.65, 0, 0.35, 1] as const;

/** Gold material shared by every limb, so the figures read as one brand. */
function SplashDefs() {
  return (
    <defs>
      <linearGradient id="mvSplashGold" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#f0d8b6" />
        <stop offset="0.5" stopColor="#e0bc93" />
        <stop offset="1" stopColor="#cfab83" />
      </linearGradient>
      <linearGradient id="mvSplashGoldMid" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e0bc93" />
        <stop offset="1" stopColor="#d8b38a" />
      </linearGradient>
      <linearGradient id="mvSplashGoldDeep" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#cfa87e" />
        <stop offset="1" stopColor="#b58c5e" />
      </linearGradient>
      <linearGradient id="mvSplashHeadLeft" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#f0d8b6" />
        <stop offset="1" stopColor="#d8b38a" />
      </linearGradient>
      <linearGradient id="mvSplashHeadRight" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#e8cba6" />
        <stop offset="1" stopColor="#cfab83" />
      </linearGradient>
      {/* Pinkish heart. */}
      <linearGradient id="mvSplashHeart" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#d4a3a5" />
        <stop offset="1" stopColor="#c78c8d" />
      </linearGradient>
      {/* Dark maroon / burgundy rose. */}
      <linearGradient id="mvSplashRose" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#8d4a5f" />
        <stop offset="0.6" stopColor="#5d2b3c" />
        <stop offset="1" stopColor="#4a1c2e" />
      </linearGradient>
      <radialGradient id="mvSplashGlow">
        <stop offset="0" stopColor="#c78c8d" stopOpacity="0.5" />
        <stop offset="1" stopColor="#c78c8d" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** The boy's head: a gold circle with a face turned toward the girl (right). */
function BoyHead() {
  return (
    <>
      <circle cx="408" cy="98" r="72" fill="url(#mvSplashHeadLeft)" />
      <g opacity="0.78">
        <circle cx="420" cy="84" r="6" fill="#2c1a22" />
        <circle cx="444" cy="90" r="6" fill="#2c1a22" />
        <path
          d="M 414 116 Q 434 132 454 112"
          fill="none"
          stroke="#2c1a22"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </>
  );
}

/** The girl's head: a gold circle with a face turned toward the boy (left). */
function GirlHead() {
  return (
    <>
      <circle cx="562" cy="116" r="64" fill="url(#mvSplashHeadRight)" />
      <g opacity="0.78">
        <circle cx="546" cy="104" r="6" fill="#2c1a22" />
        <circle cx="524" cy="110" r="6" fill="#2c1a22" />
        <path
          d="M 540 136 Q 524 150 508 132"
          fill="none"
          stroke="#2c1a22"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </g>
    </>
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
  /** 0 = pre-roll, then 1..4 for the four acts. */
  const [phase, setPhase] = useState(0);
  const [showLockup, setShowLockup] = useState(false);
  const timers = useRef<number[]>([]);

  const finish = useCallback(() => {
    setIsVisible(false);
    // The curtain has been seen (or skipped). Record it for this tab so a
    // reload reveals the app immediately instead of replaying the intro.
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(SPLASH_PLAYED_KEY, 'true');
      } catch {
        // Private mode / storage disabled: the intro simply plays again.
      }
    }
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
      // Already played in this tab: this is a reload, not a cold start. Reveal
      // the app immediately without mounting the timeline.
      let alreadyPlayed = false;
      try {
        alreadyPlayed = window.sessionStorage.getItem(SPLASH_PLAYED_KEY) === 'true';
      } catch {
        // Private mode / storage disabled: treat as a first launch.
        alreadyPlayed = false;
      }
      if (alreadyPlayed) {
        setIsVisible(false);
        return;
      }

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Reveal immediately: the timeline is never mounted, so no frames are
        // committed and no work is done. The flag is deliberately NOT set here:
        // reduced motion should short-circuit every launch, not just the first.
        setIsVisible(false);
        return;
      }

      setIsVisible(true);

      // Act cues as timers rather than an animation-complete chain, so the whole
      // story is readable in one place and skipping can clear everything.
      timers.current = [
        window.setTimeout(() => setPhase(1), T.meet * 1000),
        window.setTimeout(() => setPhase(2), T.propose * 1000),
        window.setTimeout(() => setPhase(3), T.accept * 1000),
        window.setTimeout(() => setPhase(4), T.embrace * 1000),
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

  /* ============================ ACT 1–4 TARGETS ============================
     Each group's target is a pure function of `phase`, so the whole story is
     legible here and Framer Motion tweens between whichever act is current. */

  // The boy slides in from the left, kneels, then merges into the mark.
  const boyFigure = {
    animate:
      phase >= 4
        ? { x: 0, y: 0, opacity: 1 }
        : phase >= 2
          ? { x: -120, y: 30, opacity: 1 }
          : phase >= 1
            ? { x: -170, y: 0, opacity: 1 }
            : { x: -430, y: 0, opacity: 0 },
    transition: { duration: phase >= 4 ? 1.1 : 0.9, ease: EASE },
  };

  // The boy's head lowers as he drops to one knee.
  const boyHead = {
    animate:
      phase >= 4 ? { x: 0, y: 0 } : phase >= 2 ? { x: 4, y: 78 } : { x: 0, y: 0 },
    transition: { duration: 0.7, ease: EASE },
  };

  // The girl slides in from the right, leans in, then merges into the mark.
  const girlFigure = {
    animate:
      phase >= 4
        ? { x: 0, y: 0, opacity: 1 }
        : phase >= 3
          ? { x: 110, y: 10, opacity: 1 }
          : phase >= 1
            ? { x: 170, y: 0, opacity: 1 }
            : { x: 430, y: 0, opacity: 0 },
    transition: { duration: phase >= 4 ? 1.1 : 0.9, ease: EASE },
  };

  const girlHeadLean = {
    animate:
      phase >= 4 ? { x: 0, y: 0 } : phase >= 3 ? { x: -6, y: 6 } : { x: 0, y: 0 },
    transition: { duration: 0.7, ease: EASE },
  };

  // The "M"'s top valley only closes once they embrace.
  const valley = {
    animate: { opacity: phase >= 4 ? 1 : 0 },
    transition: { duration: 0.7, ease: EASE },
  };

  // Act 3 only: the heart blooms and beats.
  const heart = {
    animate:
      phase >= 4
        ? { opacity: 1, scale: 1, x: 0, y: 0 }
        : phase >= 3
          ? { opacity: 1, scale: [0.2, 1.25, 1, 1.16, 1], x: 0, y: 0 }
          : { opacity: 0, scale: 0.1, x: 0, y: 0 },
    transition:
      phase >= 3 && phase < 4
        ? { duration: 1.2, ease: EASE, times: [0, 0.4, 0.55, 0.75, 1] }
        : { duration: 0.6, ease: EASE },
  };

  // The rose appears on the proposal, drifts toward the girl, then hangs below
  // the heart at the bottom centre.
  const rose = {
    animate:
      phase >= 4
        ? { opacity: 1, x: 0, y: 0, scale: 1 }
        : phase >= 3
          ? { opacity: 1, x: 60, y: -30, scale: 1 }
          : phase >= 2
            ? { opacity: 1, x: 0, y: -60, scale: 1 }
            : { opacity: 0, x: 0, y: 24, scale: 0.6 },
    transition: { duration: 0.8, ease: EASE },
  };

  const boyBubble = {
    animate: {
      opacity: phase >= 2 ? 0 : phase >= 1 ? 1 : 0,
      scale: phase >= 1 ? 1 : 0.6,
      y: phase >= 1 ? 0 : 12,
    },
    transition: { duration: 0.45, ease: EASE, delay: phase >= 1 && phase < 2 ? 0.4 : 0 },
  };

  const girlBubble = {
    animate: {
      opacity: phase >= 2 ? 0 : phase >= 1 ? 1 : 0,
      scale: phase >= 1 ? 1 : 0.6,
      y: phase >= 1 ? 0 : 12,
    },
    transition: { duration: 0.45, ease: EASE, delay: phase >= 1 && phase < 2 ? 0.9 : 0 },
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          data-testid="intro-splash"
          // Above the app for the length of the story, then unmounted. `fixed`
          // is what guarantees no layout shift: it is out of document flow.
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#131017]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -28 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <svg
            viewBox="0 0 1000 1180"
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Mettivo — Your Next Connection"
          >
            <SplashDefs />

            {/* Soft bloom behind the pair once they accept. */}
            <motion.circle
              cx="500"
              cy="440"
              r="290"
              fill="url(#mvSplashGlow)"
              animate={{ opacity: phase >= 3 ? 0.7 : 0 }}
              transition={{ duration: 0.9, ease: EASE }}
            />

            {/* ===== Act 1: the greetings, drawn above the figures ===== */}
            <motion.g style={{ originX: '300px', originY: '150px' }} {...boyBubble}>
              <rect x="196" y="52" width="132" height="76" rx="30" fill="#211a28" stroke="#34283f" strokeWidth="2" />
              <path d="M 252 128 L 268 152 L 284 128 Z" fill="#211a28" stroke="#34283f" strokeWidth="2" />
              <text x="262" y="104" textAnchor="middle" fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif" fontSize="34" fontWeight={500} fill="#eae2f0">
                Hi
              </text>
            </motion.g>
            <motion.g style={{ originX: '700px', originY: '170px' }} {...girlBubble}>
              <rect x="672" y="66" width="132" height="76" rx="30" fill="#211a28" stroke="#34283f" strokeWidth="2" />
              <path d="M 716 142 L 700 166 L 732 142 Z" fill="#211a28" stroke="#34283f" strokeWidth="2" />
              <text x="738" y="118" textAnchor="middle" fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif" fontSize="34" fontWeight={500} fill="#eae2f0">
                Hi
              </text>
            </motion.g>

            {/* The "M" valley — the pair's joined shoulders. Hidden until they
                embrace, because the two figures are still apart before then. */}
            <motion.path
              d="M 386 258 Q 418 372 500 392 Q 582 372 614 258"
              fill="none"
              stroke="url(#mvSplashGoldDeep)"
              strokeWidth="50"
              strokeLinecap="round"
              {...valley}
            />

            {/* ===== The boy (drawn first, so the girl's arm crosses over his) ===== */}
            <motion.g {...boyFigure}>
              {/* Far leg: deeper tone, behind. */}
              <path
                d="M 392 292 C 378 404 348 574 300 700 C 276 750 270 796 300 808"
                fill="none"
                stroke="url(#mvSplashGoldDeep)"
                strokeWidth="66"
                strokeLinecap="round"
              />
              {/* Near leg + presenting arm. */}
              <path
                d="M 412 292 C 394 400 356 560 306 694 C 282 744 284 790 318 806"
                fill="none"
                stroke="url(#mvSplashGold)"
                strokeWidth="80"
                strokeLinecap="round"
              />
              <path
                d="M 404 258 Q 452 396 552 346 Q 602 318 626 248"
                fill="none"
                stroke="url(#mvSplashGoldMid)"
                strokeWidth="46"
                strokeLinecap="round"
              />
              <motion.g {...boyHead}>
                <BoyHead />
              </motion.g>
            </motion.g>

            {/* ===== The girl ===== */}
            <motion.g {...girlFigure}>
              <path
                d="M 608 292 C 622 404 652 574 700 700 C 724 750 730 796 700 808"
                fill="none"
                stroke="url(#mvSplashGoldDeep)"
                strokeWidth="66"
                strokeLinecap="round"
              />
              <path
                d="M 588 292 C 606 400 644 560 694 694 C 718 744 716 790 682 806"
                fill="none"
                stroke="url(#mvSplashGold)"
                strokeWidth="80"
                strokeLinecap="round"
              />
              <path
                d="M 596 258 Q 548 396 448 346 Q 398 318 374 248"
                fill="none"
                stroke="url(#mvSplashGoldMid)"
                strokeWidth="46"
                strokeLinecap="round"
              />
              <motion.g {...girlHeadLean}>
                <GirlHead />
              </motion.g>
            </motion.g>

            {/* ===== The heart, blooming between their heads ===== */}
            <motion.g style={{ originX: '500px', originY: '206px' }} {...heart}>
              <path
                d="M 500 200 C 500 180 476 174 469 189 C 460 206 476 220 500 238 C 524 220 540 206 531 189 C 524 174 500 180 500 200 Z"
                fill="url(#mvSplashHeart)"
              />
            </motion.g>

            {/* ===== The rose, hanging below the heart ===== */}
            <motion.g style={{ originX: '509px', originY: '600px' }} {...rose}>
              <path d="M 506 508 C 514 572 520 636 524 700" fill="none" stroke="#6b4a3a" strokeWidth="7" strokeLinecap="round" />
              <path d="M 512 598 C 534 584 554 590 560 606 C 546 620 526 616 512 598 Z" fill="#5f3346" />
              <path d="M 517 650 C 495 638 477 646 473 662 C 487 674 506 668 517 650 Z" fill="#4a1c2e" />
              <circle cx="509" cy="478" r="28" fill="url(#mvSplashRose)" />
              <path
                d="M 493 458 C 517 443 543 458 536 480 C 530 496 510 500 499 489 C 492 481 494 469 505 464"
                fill="none"
                stroke="#8d4a5f"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 499 474 C 510 469 521 475 519 486 C 517 495 506 499 501 493"
                fill="none"
                stroke="#a35d72"
                strokeWidth="6"
                strokeLinecap="round"
              />
            </motion.g>

            {/*
              The wordmark and tagline. These fade ONLY — no `y` animation:
              animating `y` on an SVG `<text>` makes Framer Motion write a CSS
              transform that overrides the attribute value and throws the glyph
              off-screen. A plain opacity fade leaves it where the attribute puts
              it.
            */}
            <motion.text
              x="500"
              y="916"
              textAnchor="middle"
              fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
              fontSize="60"
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
              x="500"
              y="962"
              textAnchor="middle"
              fontFamily="Helvetica Neue, Helvetica, Arial, system-ui, sans-serif"
              fontSize="22"
              fontWeight={300}
              letterSpacing="2.6"
              fill="#d8b38a"
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
