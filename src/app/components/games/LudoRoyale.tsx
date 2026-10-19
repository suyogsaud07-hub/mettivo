'use client';

import type { GameOutcome } from '@/lib/types';
import Ludo from './LudoBoard';
import { LUDO_VARIANTS } from './ludo';

/**
 * Ludo Royale — the four-player board (you against three bots).
 *
 * The rules, board and bot all live in `./Ludo` / `./ludo`; this wrapper only
 * pins the variant, so the registry in `engine.tsx` can treat it like any other
 * game component.
 */
export default function LudoRoyale({
  onFinish,
}: {
  onFinish: (outcome: GameOutcome, score: number) => void;
}) {
  return <Ludo config={LUDO_VARIANTS.royale} onFinish={onFinish} />;
}
