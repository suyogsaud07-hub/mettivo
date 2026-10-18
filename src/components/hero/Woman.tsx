'use client';

import { motion } from 'framer-motion';
import { EASE, MORPH_TRANSITION, glideForPhase, isMorphing, type HeroPhase } from './timeline';
import { WOMAN_BODY } from './morphPaths';

/**
 * The woman — a single, solid silhouette with a flared hem, which morphs into
 * the right stroke of the "M". Same contract as `Man`: one closed outline is
 * moved and morphed, and its fill warms to the brand gold as she becomes part
 * of the logo.
 */

const WOMAN_X: Record<HeroPhase, number> = { idle: 750, walk: 590, kiss: 532, morph: 0, logo: 0 };
const WOMAN_Y: Record<HeroPhase, number> = { idle: 380, walk: 380, kiss: 380, morph: 0, logo: 0 };
/** A slow lean toward him, pivoting on her feet. */
const WOMAN_ROTATE: Record<HeroPhase, number> = { idle: 0, walk: 0, kiss: -7, morph: 0, logo: 0 };

const WOMAN_TONE = '#33507e';
const LOGO_GOLD = '#e0bc93';

export default function Woman({ phase }: { phase: HeroPhase }) {
  const morphing = isMorphing(phase);

  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
      animate={{ x: WOMAN_X[phase], y: WOMAN_Y[phase], rotate: WOMAN_ROTATE[phase] }}
      transition={glideForPhase(phase)}
    >
      <motion.path
        d={WOMAN_BODY.from}
        animate={{
          d: morphing ? WOMAN_BODY.to : WOMAN_BODY.from,
          fill: morphing ? LOGO_GOLD : WOMAN_TONE,
        }}
        transition={morphing ? MORPH_TRANSITION : { fill: { duration: 0.9, ease: EASE } }}
      />
    </motion.g>
  );
}
