import { supabase } from '@/lib/supabase';
import type { GameOutcome, GameResultRow, GameStats } from '@/lib/types';

/**
 * Game Zone data access.
 *
 * Results are written through the `record_game_result()` RPC, which validates
 * the game id against `game_catalog` and derives the member from `auth.uid()`.
 * Reads are restricted to the caller's own rows by RLS.
 */

export class GameError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export interface GameDefinition {
  /** Matches `game_catalog.game_id`. */
  id: string;
  title: string;
  description: string;
  icon: string;
  image: string;
  /** Head-count shown on the card — the target for the multiplayer version. */
  players: number;
  duration: string;
  /** False when the game needs realtime multiplayer and is not built yet. */
  playable: boolean;
  /** Why it is not playable, shown instead of a dead-end alert. */
  pendingReason?: string;
}

/**
 * The games surfaced in the UI. `playable: true` entries have a real,
 * fully-playable route; the rest state honestly what they are waiting on.
 */
export const GAMES: GameDefinition[] = [
  {
    id: 'uno-lite',
    title: 'UNO',
    description:
      'Classic UNO — match colour or number, unleash Skips, Reverses, Draw Twos and Wilds, and…',
    icon: '🃏',
    image: 'https://images.unsplash.com/photo-1596451190630-186e58a1e1c6?q=80&w=400&auto=format&fit=crop',
    players: 12,
    duration: '6m',
    playable: true,
  },
  {
    id: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    description: 'Three in a row against an opponent that never misses a win.',
    icon: '❌',
    image: 'https://images.unsplash.com/photo-1585504198199-20277593b94f?q=80&w=400&auto=format&fit=crop',
    players: 6,
    duration: '5m',
    playable: true,
  },
  {
    id: 'ludo-royale',
    title: 'Ludo Royale',
    description: 'Full-board Ludo for up to four players.',
    icon: '🎲',
    image: 'https://images.unsplash.com/photo-1605870445919-838d190e8e1b?q=80&w=400&auto=format&fit=crop',
    players: 6,
    duration: '15m',
    playable: false,
    pendingReason:
      'Ludo needs realtime turn synchronisation between up to four players, which this build does not have yet. The board, rules engine and Supabase Realtime turn channel are the next piece of work.',
  },
  {
    id: 'ludo-dash',
    title: 'Ludo Dash',
    description: 'A faster two-player Ludo variant.',
    icon: '🎲',
    image: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?q=80&w=400&auto=format&fit=crop',
    players: 8,
    duration: '8m',
    playable: false,
    pendingReason:
      'Ludo Dash shares the realtime turn system with Ludo Royale, so it lands at the same time.',
  },
];

/** Featured game, matching the original "Featured Today" card. */
export const FEATURED_GAME = GAMES[0];

export function getGame(gameId: string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === gameId);
}

/** Loads the caller's game ledger, newest first. */
export async function fetchGameResults(limit = 200): Promise<GameResultRow[]> {
  const { data, error } = await supabase
    .from('game_results')
    .select('id, user_id, game_id, outcome, score, duration_seconds, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[games] load results failed:', error.message);
    throw new GameError(error.message, error.code);
  }

  return (data ?? []) as GameResultRow[];
}

/** Aggregates the caller's record for the banner stats. */
export function summariseResults(results: GameResultRow[]): GameStats {
  const wins = results.filter((row) => row.outcome === 'win').length;
  const losses = results.filter((row) => row.outcome === 'loss').length;
  const draws = results.filter((row) => row.outcome === 'draw').length;
  const gamesPlayed = results.length;

  return {
    gamesPlayed,
    wins,
    losses,
    draws,
    winRate: gamesPlayed === 0 ? null : Math.round((wins / gamesPlayed) * 100),
  };
}

export async function fetchGameStats(): Promise<GameStats> {
  return summariseResults(await fetchGameResults());
}

/** Persists a finished game. Validated server-side against the catalogue. */
export async function recordGameResult(
  gameId: string,
  outcome: GameOutcome,
  score = 0,
  durationSeconds: number | null = null
): Promise<void> {
  const { error } = await supabase.rpc('record_game_result', {
    p_game_id: gameId,
    p_outcome: outcome,
    p_score: Math.max(0, Math.round(score)),
    p_duration_seconds: durationSeconds,
  });

  if (error) {
    console.error('[games] record result failed:', error.message);
    throw new GameError(error.message, error.code);
  }
}
