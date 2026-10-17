'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';

/**
 * The cinematic intro — a four-act story drawn with real human figures, ending
 * in the brand wordmark.
 *
 * THE STORY, ON ONE 8s TIMELINE
 *   Act 1 · The walk       0.0s – 2.0s  a man in a suit steps in from the left
 *                                        and a woman in a gown from the right;
 *                                        their legs and arms swing as they cross
 *                                        the floor and stop face to face.
 *   Act 2 · The proposal   2.0s – 4.0s  he drops to one knee, leans in, and
 *                                        extends a hand; a burgundy rose slides
 *                                        from his pocket and hovers between them.
 *   Act 3 · The acceptance 4.0s – 5.5s  she leans toward him, both hands lifted
 *                                        to her chest, and a pink heart blooms
 *                                        between them, pulsing inside a glow.
 *   Act 4 · The embrace    5.5s – 8.0s  they rise, fold into each other, and
 *                                        blend into the "M"; the wordmark fades
 *                                        in, followed by the tagline.
 *
 * HOW THE FIGURES ARE BUILT
 *   Everything is hand-authored vector geometry — no circles for heads and no
 *   stick limbs. Each figure is a small rig of grouped paths (hair, face+jaw,
 *   jacket/gown, two arms, two legs, shoes) so a limb can be posed on its own.
 *   Rotations pivot on the joint itself via `transform-box: fill-box` with a
 *   `transform-origin` at the top of a limb (shoulder / hip) or the bottom of a
 *   head (the neck); a joint therefore never detaches as it swings.
 *
 * THE EMBRACE "MORPH"
 *   True path morphing between a suit, a gown and a letterform is not something
 *   SVG can do convincingly, so the blend is done the way real logo stings do
 *   it: as the two figure-groups converge they scale down into the same point,
 *   and the "M" cross-fades in from that exact point behind them. The eye reads
 *   the bodies dissolving into the mark.
 *
 * WHEN IT PLAYS, AND WHY IT CAN BE SKIPPED
 *   ONCE per app launch. A `sessionStorage` flag (`splash_played`) records that
 *   the curtain has played in this tab: a reload keeps the flag and skips the
 *   intro, while closing the tab clears it and the next launch plays it again —
 *   the native-app "intro on cold start" behaviour. Because the component lives
 *   in the root layout it runs on the first paint of any entry point and does
 *   NOT re-run on client-side navigation. A visible Skip control is present from
 *   the first frame; skipping also records the flag.
 *
 * REDUCED MOTION IS A HARD GATE, NOT A POLISH ITEM
 *   A full-screen sweeping animation is exactly the pattern that triggers
 *   vestibular discomfort. Under `prefers-reduced-motion: reduce` this component
 *   renders NOTHING and reveals the app immediately — the timeline is never
 *   mounted, so no frames are committed. The flag is deliberately NOT set in
 *   that case, so reduced motion short-circuits every launch, not just the first.
 *
 * NO LAYOUT SHIFT
 *   The curtain is a `position: fixed` overlay, so it never participates in
 *   document flow: when it fades out and unmounts, the app beneath is already
 *   laid out and nothing moves.
 */

/** Scene cues in seconds. One place, so the whole story reads at a glance. */
const T = {
  kneel: 2.0,
  accept: 4.0,
  embrace: 5.5,
  morph: 6.6,
  lockup: 7.0,
  end: 8.0,
} as const;

/**
 * Marks that the intro has played in this tab. `sessionStorage` survives a
 * reload but is cleared when the tab is closed — exactly "once per app launch".
 */
const SPLASH_PLAYED_KEY = 'splash_played';

/** Fluid, symmetric easing — reads as a drawn sweep rather than a machine. */
const EASE = [0.65, 0, 0.35, 1] as const;

/** Spring presets. Movement is spring-driven so poses settle with weight. */
const SPRING: Transition = { type: 'spring', stiffness: 90, damping: 18, mass: 1 };
const WALK_SPRING: Transition = { type: 'spring', stiffness: 48, damping: 17, mass: 1 };
const GENTLE: Transition = { type: 'spring', stiffness: 60, damping: 20, mass: 1 };

/**
 * The walk cycle: six keyframes over the two seconds of Act 1, so the stride
 * eases out and the feet come to rest exactly as the pair meets.
 */
const WALK_CYCLE: Transition = {
  duration: 2,
  ease: EASE,
  times: [0, 0.18, 0.38, 0.58, 0.8, 1],
};

/** Gold material for every figure, so the pair reads as one brand. */
function SplashDefs() {
  return (
    <defs>
      <linearGradient id="mvSplashGold" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#f2dcbc" />
        <stop offset="0.5" stopColor="#e0bc93" />
        <stop offset="1" stopColor="#cfab83" />
      </linearGradient>
      <linearGradient id="mvSplashGoldDeep" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stopColor="#d3a978" />
        <stop offset="1" stopColor="#a97b4e" />
      </linearGradient>
      <linearGradient id="mvSplashHairLeft" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#c79a67" />
        <stop offset="1" stopColor="#8f6238" />
      </linearGradient>
      <linearGradient id="mvSplashHairRight" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0" stopColor="#b98a5e" />
        <stop offset="1" stopColor="#7a4f2c" />
      </linearGradient>
      {/* Dark maroon / burgundy rose. */}
      <linearGradient id="mvSplashRose" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stopColor="#934f64" />
        <stop offset="0.6" stopColor="#5d2b3c" />
        <stop offset="1" stopColor="#40192a" />
      </linearGradient>
      {/* Pinkish heart. */}
      <linearGradient id="mvSplashHeart" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#e0b0b1" />
        <stop offset="1" stopColor="#c78c8d" />
      </linearGradient>
      <radialGradient id="mvSplashGlow">
        <stop offset="0" stopColor="#d69aa0" stopOpacity="0.55" />
        <stop offset="0.6" stopColor="#b56f7c" stopOpacity="0.22" />
        <stop offset="1" stopColor="#b56f7c" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="mvSplashShadow">
        <stop offset="0" stopColor="#000000" stopOpacity="0.42" />
        <stop offset="1" stopColor="#000000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/** The man's head: short cropped hair over a face that tapers to a jaw. */
function ManHead() {
  return (
    <>
      <path
        d="M -30 40 C -34 12 -18 -6 2 -6 C 24 -6 36 12 32 42 C 26 26 14 18 0 20 C -14 22 -24 30 -30 40 Z"
        fill="url(#mvSplashHairLeft)"
      />
      <path
        d="M -26 42 C -26 18 -14 4 2 4 C 18 4 26 18 26 42 C 26 62 18 76 6 82 C 12 88 16 96 16 108 L 16 114 L -12 114 L -12 108 C -12 96 -8 88 -2 82 C -14 76 -26 62 -26 42 Z"
        fill="url(#mvSplashGold)"
      />
    </>
  );
}

/** The woman's head: a soft face under a swept hairline (the long hair is drawn separately). */
function WomanHead() {
  return (
    <>
      <path
        d="M -28 34 C -34 0 -12 -18 4 -18 C 24 -18 38 0 32 36 C 26 20 14 12 0 14 C -14 16 -24 24 -28 34 Z"
        fill="url(#mvSplashHairRight)"
      />
      <path
        d="M -24 42 C -24 20 -12 6 2 6 C 16 6 24 20 24 42 C 24 62 16 74 5 80 C 10 86 13 94 13 108 L 13 116 L -11 116 L -11 108 C -11 94 -8 86 -3 80 C -14 74 -24 62 -24 42 Z"
        fill="url(#mvSplashGold)"
      />
    </>
  );
}

/** A layered burgundy rose: bloom spiral, stem, and two leaves. Drawn around the origin. */
function Rose() {
  return (
    <>
      <path d="M 2 26 C 8 92 10 158 12 224" fill="none" stroke="#6b4a3a" strokeWidth="7" strokeLinecap="round" />
      <path d="M 8 108 C 34 92 58 100 64 120 C 46 136 22 130 8 108 Z" fill="#5f3346" />
      <path d="M 12 160 C -14 146 -36 156 -42 176 C -24 190 -2 182 12 160 Z" fill="#4a1c2e" />
      <path
        d="M 0 -4 C -30 -34 -66 -8 -48 24 C -34 48 2 52 24 32 C 50 10 34 -30 0 -4 Z"
        fill="url(#mvSplashRose)"
      />
      <path
        d="M -2 8 C -24 -6 -40 10 -30 28 C -22 42 2 44 14 32 C 28 18 18 -6 -2 8 Z"
        fill="url(#mvSplashRose)"
        opacity="0.9"
      />
      <path
        d="M 0 6 C -12 -2 -22 6 -16 18 C -11 28 4 30 12 22 C 20 14 12 0 0 6 Z"
        fill="#a35d72"
      />
      <path
        d="M -2 12 C -8 8 -12 12 -9 17 C -6 21 1 22 5 18 C 8 15 4 9 -2 12 Z"
        fill="none"
        stroke="#c98ea0"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </>
  );
}

/** The pink heart. Drawn around the origin so it can be placed and pulsed freely. */
function Heart() {
  return (
    <path
      d="M 0 -18 C -13 -42 -46 -35 -46 -8 C -46 15 -18 36 0 55 C 18 36 46 15 46 -8 C 46 -35 13 -42 0 -18 Z"
      fill="url(#mvSplashHeart)"
    />
  );
}

/** The final mark: an elegant "M", drawn in the world frame of the scene. */
function MarkM() {
  return (
    <path
      d="M 322 626 L 322 302 L 500 552 L 678 302 L 678 626"
      fill="none"
      stroke="url(#mvSplashGold)"
      strokeWidth="46"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export interface IntroSplashAnimationProps {
  /** Called once the curtain has lifted. */
  onDone?: () => void;
}

export default function IntroSplashAnimation({ onDone }: IntroSplashAnimationProps) {
  /** `null` = undecided. Keeps the server and first client render identical. */
  const [isVisible, setIsVisible] = useState<boolean | null>(null);
  /** 0 = the walk, then 1..4 for kneel / accept / embrace / morph. */
  const [phase, setPhase] = useState(0);
  const [showLockup, setShowLockup] = useState(false);
  const timers = useRef<number[]>([]);

  const finish = useCallback(() => {
    setIsVisible(false);
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
    // it cannot be read during render; the first paint is therefore "undecided".
    if (typeof window === 'undefined') return;

    // Deferred by one frame: `react-hooks/set-state-in-effect` rejects a direct
    // setState here, and the deferral is imperceptible on the first paint.
    const decide = () => {
      let alreadyPlayed = false;
      try {
        alreadyPlayed = window.sessionStorage.getItem(SPLASH_PLAYED_KEY) === 'true';
      } catch {
        alreadyPlayed = false;
      }
      if (alreadyPlayed) {
        setIsVisible(false);
        return;
      }

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Reveal immediately: the timeline is never mounted, and the flag is
        // deliberately NOT set, so reduced motion short-circuits every launch.
        setIsVisible(false);
        return;
      }

      setIsVisible(true);

      timers.current = [
        window.setTimeout(() => setPhase(1), T.kneel * 1000),
        window.setTimeout(() => setPhase(2), T.accept * 1000),
        window.setTimeout(() => setPhase(3), T.embrace * 1000),
        window.setTimeout(() => setPhase(4), T.morph * 1000),
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

  /* ============================ ACT TARGETS ============================
     Each target is a pure function of `phase`, so the whole story is legible
     here and Framer Motion springs between whichever act is current. */

  const walking = phase === 0;
  const kneeling = phase === 1;
  const accepting = phase === 2;
  const embracing = phase === 3;
  const morphing = phase >= 4;

  // The man strides in from the left, drops to a knee, then folds into centre.
  const manRoot = {
    x: embracing || morphing ? 46 : 0,
    y: kneeling ? 118 : 0,
    opacity: morphing ? 0 : 1,
    scale: embracing ? 0.96 : 1,
    transition: walking ? WALK_SPRING : SPRING,
  };

  // The back leg trails; the front leg plants. In the kneel the front leg
  // swings forward and the back leg folds underneath him.
  const manLegBack = {
    rotate: kneeling ? 16 : walking ? [17, -17, 17, -17, 5, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  const manLegFront = {
    rotate: kneeling ? -56 : walking ? [-17, 17, -17, 17, -5, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  // The torso leans toward the woman as he kneels.
  const manTorso = {
    rotate: kneeling ? 9 : 0,
    transition: GENTLE,
  };
  const manHead = {
    rotate: kneeling ? -5 : embracing ? 7 : 0,
    y: kneeling ? 3 : 0,
    transition: GENTLE,
  };
  const manArmBack = {
    rotate: walking ? [12, -12, 12, -12, 0, 0] : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  // His near arm swings while walking, then extends to present the rose.
  const manArmFront = {
    rotate: kneeling ? -74 : walking ? [-12, 12, -12, 12, 0, 0] : embracing ? -26 : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  // The woman drifts in from the right, leans in to accept, then folds in.
  const womanRoot = {
    x: embracing || morphing ? -46 : 0,
    opacity: morphing ? 0 : 1,
    scale: embracing ? 0.96 : 1,
    transition: walking ? WALK_SPRING : SPRING,
  };
  const womanTorso = {
    rotate: accepting || embracing ? -7 : 0,
    transition: GENTLE,
  };
  const womanHead = {
    rotate: accepting || embracing ? -9 : 0,
    x: accepting || embracing ? -7 : 0,
    transition: GENTLE,
  };
  // Her hands lift to her chest in surprise, then open to embrace him.
  const womanArmBack = {
    rotate: walking ? [10, -10, 10, -10, 0, 0] : accepting ? -118 : embracing ? -50 : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };
  const womanArmFront = {
    rotate: walking ? [-10, 10, -10, 10, 0, 0] : accepting ? 118 : embracing ? 50 : 0,
    transition: walking ? WALK_CYCLE : SPRING,
  };

  // The rose slides from his pocket, hovers, then is offered to her.
  const rose = {
    opacity: morphing ? 0 : phase >= 1 ? 1 : 0,
    x: embracing || morphing ? 516 : accepting ? 548 : 505,
    y: kneeling ? 432 : accepting ? 404 : embracing ? 418 : 470,
    scale: phase >= 1 ? 1 : 0.4,
    rotate: embracing ? 14 : 0,
    transition: SPRING,
  };

  // The heart blooms on acceptance and pulses inside a soft glow.
  const heart = {
    opacity: morphing ? 0 : accepting ? 1 : embracing ? 0.8 : 0,
    scale: accepting ? [0.2, 1.25, 1, 1.15, 1] : 1,
    x: 505,
    y: 318,
    transition: accepting
      ? { duration: 1.2, ease: EASE, times: [0, 0.4, 0.55, 0.75, 1] }
      : SPRING,
  };
  const heartGlow = {
    opacity: phase >= 2 ? 0.8 : 0,
    scale: accepting ? [0.85, 1.1, 1] : 1,
    transition: accepting
      ? { duration: 1.2, ease: EASE, times: [0, 0.5, 1] }
      : SPRING,
  };

  // The mark rises from the same point the bodies converge into.
  const mark = {
    opacity: morphing ? 1 : 0,
    scale: morphing ? 1 : 0.55,
    transition: { type: 'spring', stiffness: 68, damping: 15, mass: 1 } as const,
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          data-testid="intro-splash"
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#131017]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, y: -28 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <svg
            viewBox="0 0 1000 1000"
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Mettivo — Your Next Connection"
          >
            <SplashDefs />

            {/* Soft bloom behind the pair, blooming as the heart appears. */}
            <motion.circle
              cx="505"
              cy="380"
              r="300"
              fill="url(#mvSplashGlow)"
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
              animate={heartGlow}
            />

            {/* Ground contact shadows, so the pair are standing, not floating. */}
            <motion.g animate={{ opacity: morphing ? 0 : 0.9 }} transition={{ duration: 0.4 }}>
              <ellipse cx="430" cy="802" rx="86" ry="15" fill="url(#mvSplashShadow)" />
              <ellipse cx="575" cy="806" rx="98" ry="16" fill="url(#mvSplashShadow)" />
            </motion.g>

            {/* ============================== THE MAN ============================== */}
            <g transform="translate(430 240)">
              <motion.g initial={{ x: -560 }} animate={manRoot}>
                {/* Legs first, so the jacket sits over the hips. */}
                <motion.g
                  style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                  animate={manLegBack}
                >
                  <path d="M -56 268 L -16 268 L -22 540 L -50 540 Z" fill="url(#mvSplashGoldDeep)" />
                  <path
                    d="M -58 538 C -66 552 -62 562 -48 562 L -16 562 C -10 562 -8 552 -14 542 L -18 538 Z"
                    fill="#7a4f2c"
                  />
                </motion.g>
                <motion.g
                  style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                  animate={manLegFront}
                >
                  <path d="M 16 268 L 56 268 L 50 540 L 22 540 Z" fill="url(#mvSplashGold)" />
                  <path
                    d="M 18 538 L 14 542 C 8 552 10 562 16 562 L 48 562 C 62 562 66 552 58 538 Z"
                    fill="#7a4f2c"
                  />
                </motion.g>

                {/* The upper body leans as one rig: jacket, arms and head. */}
                <motion.g
                  style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
                  animate={manTorso}
                >
                  {/* Back arm behind the jacket. */}
                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                    animate={manArmBack}
                  >
                    <path
                      d="M -60 128 C -74 160 -76 210 -70 258 L -46 258 C -52 210 -48 160 -42 132 Z"
                      fill="url(#mvSplashGoldDeep)"
                    />
                  </motion.g>

                  {/* Suit jacket: squared shoulders, notched lapels, tapered waist. */}
                  <path
                    d="M -62 140 C -60 124 -42 114 -26 110 L -10 108 L -8 128 L 8 128 L 10 108 L 26 110 C 42 114 60 124 62 140 L 56 270 L -56 270 Z"
                    fill="url(#mvSplashGold)"
                  />
                  <path d="M -10 108 L -8 128 L 2 176 L 8 128 L 10 108 Z" fill="#b58c5e" />
                  <path d="M -8 128 L 8 128 L 2 176 Z" fill="#f2dcbc" />
                  <path d="M 0 176 L 0 270" stroke="#b58c5e" strokeWidth="3" strokeLinecap="round" />

                  {/* Presenting arm in front of the jacket. */}
                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                    animate={manArmFront}
                  >
                    <path
                      d="M 42 132 C 48 160 52 210 46 258 L 70 258 C 76 210 74 160 60 128 Z"
                      fill="url(#mvSplashGold)"
                    />
                  </motion.g>

                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
                    animate={manHead}
                  >
                    <ManHead />
                  </motion.g>
                </motion.g>
              </motion.g>
            </g>

            {/* ============================= THE WOMAN ============================ */}
            <g transform="translate(575 250)">
              <motion.g initial={{ x: 560 }} animate={womanRoot}>
                {/* The long hair falls behind the gown. */}
                <path
                  d="M -30 24 C -46 92 -48 172 -42 236 C -34 182 -32 122 -34 92 C -30 60 -20 40 -30 24 Z"
                  fill="url(#mvSplashHairRight)"
                />
                <path
                  d="M 30 24 C 46 92 48 172 42 236 C 34 182 32 122 34 92 C 30 60 20 40 30 24 Z"
                  fill="url(#mvSplashHairRight)"
                />

                <motion.g
                  style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
                  animate={womanTorso}
                >
                  {/* Back arm behind the gown. */}
                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                    animate={womanArmBack}
                  >
                    <path
                      d="M -42 132 C -56 164 -58 210 -52 252 L -30 252 C -36 210 -32 164 -26 136 Z"
                      fill="url(#mvSplashGoldDeep)"
                    />
                  </motion.g>

                  {/* A-line gown: fitted bodice flaring to the floor. */}
                  <path
                    d="M -44 138 C -46 122 -30 110 -16 106 L 16 106 C 30 110 46 122 44 138 L 28 244 L 120 500 L 132 556 L -132 556 L -120 500 L -28 244 Z"
                    fill="url(#mvSplashGold)"
                  />
                  <path d="M -30 238 L 30 238 L 34 262 L -34 262 Z" fill="#b58c5e" opacity="0.55" />

                  {/* Front arm in front of the gown. */}
                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 0%' }}
                    animate={womanArmFront}
                  >
                    <path
                      d="M 26 136 C 32 164 36 210 30 252 L 52 252 C 58 210 56 164 42 132 Z"
                      fill="url(#mvSplashGold)"
                    />
                  </motion.g>

                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
                    animate={womanHead}
                  >
                    <WomanHead />
                  </motion.g>
                </motion.g>
              </motion.g>
            </g>

            {/* ============================== THE ROSE ============================= */}
            <motion.g
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
              animate={rose}
            >
              <Rose />
            </motion.g>

            {/* ============================== THE HEART ============================ */}
            <motion.g
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
              animate={heart}
            >
              <Heart />
            </motion.g>

            {/* ============================ THE MARK, "M" ========================== */}
            <motion.g
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
              animate={mark}
            >
              <MarkM />
            </motion.g>

            {/*
              The wordmark and tagline fade ONLY — no `y` animation: animating `y`
              on an SVG `<text>` makes Framer Motion write a CSS transform that
              overrides the attribute value and throws the glyph off-screen.
            */}
            <motion.text
              x="500"
              y="772"
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
              y="822"
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
