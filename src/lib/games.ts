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

/**
 * How the Game Hub groups a game. Every entry in `GAMES` must set exactly one
 * of these, because the hub renders one section per value.
 */
export type GameCategory = 'icebreaker' | 'competitive' | 'quick';

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
  /** The hub section this game belongs to. Never optional: the hub groups on it. */
  category: GameCategory;
  /** Why it is not playable, shown instead of a dead-end alert. */
  pendingReason?: string;
}

/**
 * The games surfaced in the UI. `playable: true` entries have a real,
 * fully-playable route; the rest state honestly what they are waiting on.
 *
 * Every playable id here mirrors a row in `public.game_catalog`
 * (`20261015180000_game_zone.sql` seeds the original four;
 * `20261015270000_m16_game_catalog_expansion.sql` seeds the seven mini-games).
 * `record_game_result()` rejects an id that is not in that table, and rejects a
 * score above its `max_score`, so the two lists must stay in step. The matching
 * score ceilings live next to each player in
 * `src/app/components/games/engine.tsx` (`GAME_MAX_SCORES`).
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
    category: 'competitive',
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
    category: 'competitive',
  },
  {
    id: 'ludo-royale',
    title: 'Ludo Royale',
    description: 'Full-board Ludo for up to four players.',
    icon: '🎲',
    image: 'https://images.unsplash.com/photo-1605870445919-838d190e8e1b?q=80&w=400&auto=format&fit=crop',
    players: 6,
    duration: '15m',
    playable: true,
    category: 'competitive',
  },
  {
    id: 'ludo-dash',
    title: 'Ludo Dash',
    description: 'A faster two-player Ludo variant.',
    icon: '🎲',
    image: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?q=80&w=400&auto=format&fit=crop',
    players: 8,
    duration: '8m',
    playable: true,
    category: 'competitive',
  },
  {
    id: 'memory-match',
    title: 'Memory Match',
    description: 'Flip and pair all eight symbols on a 4×4 canvas board before your moves run away with you.',
    icon: '🧠',
    image: 'https://images.unsplash.com/photo-1606503153255-59d8b8b82176?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '3m',
    playable: true,
    category: 'quick',
  },
  {
    id: 'word-guess',
    title: 'Word Guessing',
    description: 'Guess the Nepali word letter by letter — six wrong guesses and the round is gone.',
    icon: '🔤',
    image: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '4m',
    playable: true,
    category: 'quick',
  },
  {
    id: 'icebreaker',
    title: 'Icebreaker Trivia',
    description: 'Six quick questions about Nepal and about you — the easiest way to start a conversation.',
    icon: '💬',
    image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '5m',
    playable: true,
    category: 'icebreaker',
  },
  {
    id: 'twenty-questions',
    title: '20 Questions',
    description: 'Answer yes or no while the app narrows in on the thing you are thinking of.',
    icon: '🤔',
    image: 'https://images.unsplash.com/photo-1543269865-cbf427effbad?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '3m',
    playable: true,
    category: 'icebreaker',
  },
  {
    id: 'truth-or-dare',
    title: 'Truth or Dare',
    description: 'A gentle pass-and-play deck of truths and dares, no prompt repeated until the deck runs out.',
    icon: '🎭',
    image: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '5m',
    playable: true,
    category: 'icebreaker',
  },
  {
    id: 'spin-the-wheel',
    title: 'Spin the Wheel',
    description: 'Six date ideas on a wheel — spin it inside a sandboxed view and land on every one.',
    icon: '🎡',
    image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '2m',
    playable: true,
    category: 'icebreaker',
  },
  {
    id: 'speed-matching',
    title: 'Speed Matching',
    description: 'Ten this-or-that rounds against the clock. Every answer you and your match agree on scores.',
    icon: '⚡',
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=400&auto=format&fit=crop',
    players: 2,
    duration: '2m',
    playable: true,
    category: 'competitive',
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
