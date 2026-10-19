'use client';

import type { GameOutcome } from '@/lib/types';
import Ludo from './LudoBoard';
import { LUDO_VARIANTS } from './ludo';

/**
 * Ludo Dash — the two-player sprint (you against one bot), three tokens each.
 * Shares every rule with Royale through `./Ludo`; only the variant differs.
 */
export default function LudoDash({
  onFinish,
}: {
  onFinish: (outcome: GameOutcome, score: number) => void;
}) {
  return <Ludo config={LUDO_VARIANTS.dash} onFinish={onFinish} />;
}
