'use client';

import { motion } from 'framer-motion';
import { EASE, MORPH_TRANSITION, glideForPhase, isMorphing, type HeroPhase } from './timeline';
import { MAN_BODY } from './morphPaths';

/**
 * The man — a single, solid silhouette that morphs into the left stroke of the
 * "M". No limb rig, no detail paths: one closed outline (head → shoulders →
 * body) is what the timeline moves and morphs, so the shape can never fray or
 * turn into a blob.
 *
 * The fill animates from a deep slate to the brand gold as the morph runs, so
 * the figure literally becomes part of the logo.
 */

const MAN_X: Record<HeroPhase, number> = { idle: 250, walk: 410, kiss: 468, morph: 0, logo: 0 };
const MAN_Y: Record<HeroPhase, number> = { idle: 380, walk: 380, kiss: 380, morph: 0, logo: 0 };
/** A slow lean toward her, pivoting on his feet. */
const MAN_ROTATE: Record<HeroPhase, number> = { idle: 0, walk: 0, kiss: 7, morph: 0, logo: 0 };

const MAN_TONE = '#48505d';
const LOGO_GOLD = '#e0bc93';

export default function Man({ phase }: { phase: HeroPhase }) {
  const morphing = isMorphing(phase);

  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
      animate={{ x: MAN_X[phase], y: MAN_Y[phase], rotate: MAN_ROTATE[phase] }}
      transition={glideForPhase(phase)}
    >
      <motion.path
        d={MAN_BODY.from}
        animate={{
          d: morphing ? MAN_BODY.to : MAN_BODY.from,
          fill: morphing ? LOGO_GOLD : MAN_TONE,
        }}
        transition={morphing ? MORPH_TRANSITION : { fill: { duration: 0.9, ease: EASE } }}
      />
    </motion.g>
  );
}
