/**
 * Ludo rules engine — pure, deterministic and React-free.
 *
 * Owns the *rules* and the *logical board geometry* of Ludo Royale and Ludo
 * Dash. It has no React, no `next/*` and no import besides the seeded PRNG in
 * `./deterministic`, so the same functions drive the UI, the bot and the unit
 * tests, and a test can replay a whole game without a browser.
 *
 * LOGICAL BOARD (15×15 grid; x = column, y = row, y grows downward)
 *
 *     ┌───────┬───┬───────┐
 *     │ yard0 │   │ yard1 │   yard0 red (top-left)   yard1 green (top-right)
 *     │  red  ├───┤ green │   yard2 yellow (bottom-right)
 *     ├───────┤ C ├───────┤   yard3 blue  (bottom-left)
 *     │  blue │   │yellow │   C = centre finish (four coloured triangles)
 *     └───────┴───┴───────┘
 *
 *   The shared track is 52 cells forming a cross-shaped loop. It is generated
 *   from one 13-cell segment and three 90° rotations (`rot90(c,r) = (14-r, c)`),
 *   which guarantees the four-fold symmetry a real board has. Start squares sit
 *   at track indices 0, 13, 26 and 39, one per arm.
 *
 *   Each side also has a private five-cell home lane running down the middle of
 *   its arm toward the centre.
 *
 * TOKEN PROGRESS
 *     -1          in the home yard (not released)
 *     0..51       on the shared ring
 *     52..56      in the player's five-square home lane
 *     57          home (centre) — FINISH
 *
 *   A token's ring cell is `(start + progress) % 52`, so two tokens from
 *   different players collide only on the ring; the home lane is private. A
 *   token leaves the yard by rolling a value in `config.enterOn` and needs an
 *   exact roll to reach FINISH.
 *
 * IMPLEMENTED RULES (stated here so the UI never over-claims "standard Ludo")
 *   1. Roll a six to release a token from the yard.
 *   2. A six, or capturing an opponent, grants another turn.
 *   3. Three sixes in a row forfeit the turn.
 *   4. Landing on a lone opponent on an unsafe ring cell sends it back to its
 *      yard and scores no points.
 *   5. Safe ring cells (the four start squares plus four star squares) never
 *      capture.
 *   6. A ring cell holding two or more opponent tokens is blocked and cannot be
 *      landed on (passing over a block is allowed — a documented simplification).
 *   7. The first player to bring every token to FINISH wins and ends the match.
 *
 * RANDOMNESS
 *   Dice are a pure function of an explicit integer seed and the number of rolls
 *   already made (`nextDie`), matching the "no Math.random() in this folder"
 *   rule in `deterministic.ts`. The same seed replays the same game.
 */

import { createRng } from './deterministic';

export const RING_SIZE = 52;
export const HOME_START = 52;
export const LANE_LENGTH = 5;
/** Highest progress value: the centre finish. */
export const FINISH = 57;
export const BASE = -1;
/** Player index reserved for the human at the device. */
export const HUMAN_PLAYER = 0;
/** Both variants cap at 100, mirroring `game_catalog.max_score`. */
export const LUDO_MAX_SCORE = 100;

/** Conventional four-colour Ludo palette. */
export const LUDO_COLORS = {
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#EAB308',
  blue: '#3B82F6',
} as const;

export type LudoVariant = 'royale' | 'dash';

export interface LudoConfig {
  variant: LudoVariant;
  title: string;
  playerCount: 2 | 4;
  tokensPerPlayer: number;
  /** Dice values that release a token from the yard. */
  enterOn: readonly number[];
  /** Reaching this many sixes in a row forfeits the turn. */
  maxConsecutiveSixes: number;
  /** Track index each player starts on — always a multiple of 13. */
  starts: readonly number[];
  labels: readonly string[];
  colors: readonly string[];
  /** Points per token brought home. */
  pointsPerHome: number;
  /** Bonus added when the human is the outright winner. */
  winBonus: number;
  /** Short blurb shown above the board. */
  blurb: string;
}

export const LUDO_VARIANTS: Record<LudoVariant, LudoConfig> = {
  royale: {
    variant: 'royale',
    title: 'Ludo Royale',
    playerCount: 4,
    tokensPerPlayer: 4,
    enterOn: [6],
    maxConsecutiveSixes: 3,
    // Red (top-left), green (top-right), yellow (bottom-right), blue (bottom-left).
    starts: [0, 13, 26, 39],
    labels: ['You', 'Aama', 'Bhai', 'Didi'],
    colors: [LUDO_COLORS.red, LUDO_COLORS.green, LUDO_COLORS.yellow, LUDO_COLORS.blue],
    pointsPerHome: 15,
    winBonus: 40,
    blurb: 'Four players, four tokens each. Get all four home first.',
  },
  dash: {
    variant: 'dash',
    title: 'Ludo Dash',
    playerCount: 2,
    tokensPerPlayer: 3,
    enterOn: [6],
    maxConsecutiveSixes: 3,
    // Opposite corners: red (top-left) and yellow (bottom-right).
    starts: [0, 26],
    labels: ['You', 'Subbu'],
    colors: [LUDO_COLORS.red, LUDO_COLORS.yellow],
    pointsPerHome: 20,
    winBonus: 40,
    blurb: 'A two-player sprint: three tokens each, first one home wins.',
  },
};

/** Which yard/arm a player belongs to (0=top-left … 3=bottom-left). */
export function seatOf(config: LudoConfig, player: number): number {
  return Math.round(config.starts[player] / 13);
}

export interface LudoCapture {
  player: number;
  token: number;
}

export interface LudoMove {
  /** Token index within the current player's row. */
  token: number;
  from: number;
  to: number;
  /** Opponent tokens this move sends back to the yard. */
  captures: LudoCapture[];
}

export type LudoPhase = 'roll' | 'move' | 'over';

/** The four prompts the board shows, derived only from `phase` and `turn`. */
export type LudoUiState = 'WAITING_FOR_ROLL' | 'SELECTING_TOKEN' | 'BOT_TURN' | 'GAME_OVER';

export interface LudoState {
  config: LudoConfig;
  /** `tokens[player][token]` = progress (-1..57). */
  tokens: number[][];
  turn: number;
  phase: LudoPhase;
  /** Last rolled value, kept for display. */
  die: number | null;
  consecutiveSixes: number;
  finishedOrder: number[];
  winner: number | null;
  seed: number;
  rolls: number;
  /** Human-readable note about the last thing that happened. */
  event: string | null;
}

/* -------------------------------------------------------------------------- */
/* Seeded dice                                                                */
/* -------------------------------------------------------------------------- */

/** Scrambles (seed, rollIndex) into a fresh 32-bit seed for one die. */
function mixSeed(seed: number, index: number): number {
  let hash = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0;
}

/** The next die value for a state, without mutating it. */
export function nextDie(state: LudoState): number {
  return Math.floor(createRng(mixSeed(state.seed, state.rolls))() * 6) + 1;
}

/* -------------------------------------------------------------------------- */
/* Board helpers                                                              */
/* -------------------------------------------------------------------------- */

/** The ring cell a token occupies, for tokens on the ring (progress 0..51). */
export function ringCell(config: LudoConfig, player: number, progress: number): number {
  return (config.starts[player] + progress) % RING_SIZE;
}

/** Start squares and star squares — ring cells where capture is impossible. */
export const SAFE_RING_CELLS: readonly number[] = [0, 8, 13, 21, 26, 34, 39, 47];

export function isSafeRingCell(cell: number): boolean {
  return SAFE_RING_CELLS.includes(cell);
}

/** Opponent tokens sitting on a given ring cell. */
function opponentsOnCell(state: LudoState, player: number, cell: number): LudoCapture[] {
  const found: LudoCapture[] = [];

  for (let other = 0; other < state.config.playerCount; other += 1) {
    if (other === player) continue;
    const row = state.tokens[other];
    for (let token = 0; token < row.length; token += 1) {
      const progress = row[token];
      if (progress >= 0 && progress <= RING_SIZE - 1 && ringCell(state.config, other, progress) === cell) {
        found.push({ player: other, token });
      }
    }
  }

  return found;
}

/** Builds a move, or `null` when the destination is a blocked cell. */
function buildMove(
  state: LudoState,
  player: number,
  token: number,
  from: number,
  to: number
): LudoMove | null {
  const captures: LudoCapture[] = [];

  if (to <= RING_SIZE - 1) {
    const cell = ringCell(state.config, player, to);
    const occupants = opponentsOnCell(state, player, cell);

    // A stack of two or more opponents blocks the cell, but only off a safe
    // square — a safe square can never be blocked.
    if (occupants.length >= 2 && !isSafeRingCell(cell)) return null;

    if (!isSafeRingCell(cell)) {
      for (const occupant of occupants) captures.push(occupant);
    }
  }

  return { token, from, to, captures };
}

/* -------------------------------------------------------------------------- */
/* Moves                                                                      */
/* -------------------------------------------------------------------------- */

/** Every legal move for the current player with a given die value. */
export function legalMoves(state: LudoState, die: number): LudoMove[] {
  const moves: LudoMove[] = [];
  const player = state.turn;
  const row = state.tokens[player];

  for (let token = 0; token < row.length; token += 1) {
    const from = row[token];
    if (from === FINISH) continue;

    if (from === BASE) {
      if (!state.config.enterOn.includes(die)) continue;
      const move = buildMove(state, player, token, from, 0);
      if (move) moves.push(move);
      continue;
    }

    const to = from + die;
    if (to > FINISH) continue; // an exact roll is required to come home
    const move = buildMove(state, player, token, from, to);
    if (move) moves.push(move);
  }

  return moves;
}

/* -------------------------------------------------------------------------- */
/* State transitions                                                          */
/* -------------------------------------------------------------------------- */

export function createLudoState(config: LudoConfig, seed = 0): LudoState {
  return {
    config,
    tokens: Array.from({ length: config.playerCount }, () =>
      Array.from({ length: config.tokensPerPlayer }, () => BASE)
    ),
    turn: 0,
    phase: 'roll',
    die: null,
    consecutiveSixes: 0,
    finishedOrder: [],
    winner: null,
    seed: seed >>> 0,
    rolls: 0,
    event: null,
  };
}

/**
 * The prompt the board should show. A pure read of `phase`/`turn`, so the UI
 * never contradicts the engine and the mapping can be unit-tested.
 */
export function uiStateOf(state: LudoState): LudoUiState {
  if (state.phase === 'over') return 'GAME_OVER';
  if (state.turn !== HUMAN_PLAYER) return 'BOT_TURN';
  return state.phase === 'roll' ? 'WAITING_FOR_ROLL' : 'SELECTING_TOKEN';
}

function nextTurn(turn: number, playerCount: number): number {
  return (turn + 1) % playerCount;
}

function label(config: LudoConfig, player: number): string {
  return config.labels[player] ?? `Player ${player + 1}`;
}

/**
 * Rolls for the current player and moves the state to the next decision point.
 * A roll with no legal move — or a third consecutive six — passes the turn
 * immediately, so `phase` is always 'move' (a real choice exists) or 'over'.
 */
export function rollAndResolve(state: LudoState): LudoState {
  if (state.phase !== 'roll') return state;

  const die = nextDie(state);
  const rolls = state.rolls + 1;
  const sixes = die === 6 ? state.consecutiveSixes + 1 : 0;

  if (die === 6 && sixes >= state.config.maxConsecutiveSixes) {
    return {
      ...state,
      die,
      rolls,
      consecutiveSixes: 0,
      turn: nextTurn(state.turn, state.config.playerCount),
      phase: 'roll',
      event: `${label(state.config, state.turn)} rolled a third six — turn forfeited.`,
    };
  }

  const rolled: LudoState = { ...state, die, rolls, consecutiveSixes: sixes };
  const moves = legalMoves(rolled, die);

  if (moves.length === 0) {
    return {
      ...rolled,
      consecutiveSixes: 0,
      turn: nextTurn(state.turn, state.config.playerCount),
      phase: 'roll',
      event:
        die === 6
          ? `${label(state.config, state.turn)} rolled a 6 but had no legal move.`
          : `${label(state.config, state.turn)} rolled a ${die} — no legal move.`,
    };
  }

  return { ...rolled, phase: 'move', event: null };
}

/** Applies a chosen move and advances the turn, checking for a winner. */
export function applyMove(state: LudoState, move: LudoMove): LudoState {
  if (state.phase !== 'move') return state;
  const die = state.die ?? 0;

  const tokens = state.tokens.map((row) => [...row]);
  const player = state.turn;
  tokens[player][move.token] = move.to;
  for (const capture of move.captures) {
    tokens[capture.player][capture.token] = BASE;
  }

  const allHome = tokens[player].every((progress) => progress === FINISH);
  const finishedOrder = allHome && !state.finishedOrder.includes(player)
    ? [...state.finishedOrder, player]
    : state.finishedOrder;
  const winner = state.winner === null && allHome ? player : state.winner;

  const grammar = player === HUMAN_PLAYER ? 'You' : label(state.config, player);
  let event: string;
  if (allHome) {
    event = `${grammar} brought every token home.`;
  } else if (move.captures.length > 0) {
    event = `${grammar} captured a token.`;
  } else if (die === 6) {
    event = `${grammar} rolled a 6 — roll again.`;
  } else if (move.from === BASE) {
    event = `${grammar} released a token.`;
  } else if (move.to === FINISH) {
    event = `${grammar} got a token home.`;
  } else {
    event = `${grammar} moved.`;
  }

  const extraTurn = !allHome && (die === 6 || move.captures.length > 0);

  if (winner !== null) {
    return { ...state, tokens, finishedOrder, winner, phase: 'over', die, event };
  }

  if (extraTurn) {
    return {
      ...state,
      tokens,
      finishedOrder,
      winner,
      phase: 'roll',
      consecutiveSixes: die === 6 ? state.consecutiveSixes : 0,
      event,
    };
  }

  return {
    ...state,
    tokens,
    finishedOrder,
    winner,
    turn: nextTurn(player, state.config.playerCount),
    phase: 'roll',
    consecutiveSixes: 0,
    event,
  };
}

/* -------------------------------------------------------------------------- */
/* Bot                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Picks a move for a bot player. The heuristic is deliberately simple and
 * deterministic: finishing and capturing dominate, then releasing and reaching
 * safety, then plain advancement. With no legal move it returns `null`.
 */
export function botChooseMove(state: LudoState, die: number): LudoMove | null {
  const moves = legalMoves(state, die);
  if (moves.length === 0) return null;

  let best: LudoMove | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const move of moves) {
    let score = move.to; // advancing is always worth something

    if (move.to === FINISH) score += 100;
    score += move.captures.length * 80;
    if (move.from === BASE) score += 40;
    if (move.to <= RING_SIZE - 1 && isSafeRingCell(ringCell(state.config, state.turn, move.to))) {
      score += 25;
    }

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return best;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

export function tokensHome(state: LudoState, player: number): number {
  return state.tokens[player].filter((progress) => progress === FINISH).length;
}

/** The clamped score a finished game is worth, mirroring `game_catalog.max_score`. */
export function ludoScore(state: LudoState, player: number): number {
  const home = tokensHome(state, player);
  const win = state.winner === player;
  const raw = home * state.config.pointsPerHome + (win ? state.config.winBonus : 0);
  return Math.max(0, Math.min(raw, LUDO_MAX_SCORE));
}

/* -------------------------------------------------------------------------- */
/* Logical board geometry (15×15 grid units; the renderer maps these to pixels) */
/* -------------------------------------------------------------------------- */

export interface BoardPoint {
  x: number;
  y: number;
}

/** Rotate a cell 90° about the board centre, per the four-fold symmetry. */
function rot90(c: number, r: number): BoardPoint {
  return { x: 14 - r, y: c };
}

function rotate(points: readonly BoardPoint[], times: number): BoardPoint[] {
  let current = points.map((point) => ({ ...point }));
  for (let step = 0; step < times; step += 1) {
    current = current.map((point) => rot90(point.x, point.y));
  }
  return current;
}

/**
 * One 13-cell segment of the shared ring, starting at red's start square
 * (0,6). Rotating it three times yields the full 52-cell cross-shaped loop with
 * starts at indices 0, 13, 26 and 39.
 */
const RING_SEGMENT: readonly BoardPoint[] = [
  { x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 },
  { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 4 },
  { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 }, { x: 6, y: 0 },
  { x: 7, y: 0 },
];

export const RING_POSITIONS: readonly BoardPoint[] = [
  ...rotate(RING_SEGMENT, 0),
  ...rotate(RING_SEGMENT, 1),
  ...rotate(RING_SEGMENT, 2),
  ...rotate(RING_SEGMENT, 3),
];

/** The five-cell home lane of each seat, running toward the centre. */
const LANE_SEGMENT: readonly BoardPoint[] = [
  { x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 },
];

export const LANE_POSITIONS: readonly (readonly BoardPoint[])[] = [
  rotate(LANE_SEGMENT, 0),
  rotate(LANE_SEGMENT, 1),
  rotate(LANE_SEGMENT, 2),
  rotate(LANE_SEGMENT, 3),
];

/** Top-left corner of each 6×6 home yard, by seat. */
export const YARD_ORIGINS: readonly BoardPoint[] = [
  { x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 },
];

/** Four parking slots inside a yard, as offsets from its origin. */
const YARD_SLOT_OFFSETS: readonly BoardPoint[] = [
  { x: 1.5, y: 1.5 }, { x: 4.5, y: 1.5 }, { x: 1.5, y: 4.5 }, { x: 4.5, y: 4.5 },
];

/** The centre square is split into four triangles, one per seat. */
export const CENTRE_TRIANGLES: readonly (readonly BoardPoint[])[] = [
  [{ x: 6, y: 6 }, { x: 6, y: 9 }, { x: 7.5, y: 7.5 }], // seat 0 (red, left arm)
  [{ x: 6, y: 6 }, { x: 9, y: 6 }, { x: 7.5, y: 7.5 }], // seat 1 (green, top arm)
  [{ x: 9, y: 6 }, { x: 9, y: 9 }, { x: 7.5, y: 7.5 }], // seat 2 (yellow, right arm)
  [{ x: 6, y: 9 }, { x: 9, y: 9 }, { x: 7.5, y: 7.5 }], // seat 3 (blue, bottom arm)
];

/** The four parking-slot centres of a player's yard. */
export function baseSlots(config: LudoConfig, player: number): BoardPoint[] {
  const origin = YARD_ORIGINS[seatOf(config, player)];
  return YARD_SLOT_OFFSETS.slice(0, config.tokensPerPlayer).map((offset) => ({
    x: origin.x + offset.x,
    y: origin.y + offset.y,
  }));
}

/** The centroid of a player's finish triangle, where finished tokens sit. */
export function centreSpot(config: LudoConfig, player: number): BoardPoint {
  const triangle = CENTRE_TRIANGLES[seatOf(config, player)];
  const x = triangle.reduce((sum, point) => sum + point.x, 0) / triangle.length;
  const y = triangle.reduce((sum, point) => sum + point.y, 0) / triangle.length;
  return { x, y };
}

/** A stable key identifying the board slot a token occupies, for stacking. */
export function tokenSlotKey(
  config: LudoConfig,
  player: number,
  token: number,
  progress: number
): string {
  if (progress === BASE) return `base:${player}:${token}`;
  if (progress <= RING_SIZE - 1) return `ring:${ringCell(config, player, progress)}`;
  if (progress < FINISH) return `lane:${seatOf(config, player)}:${progress}`;
  return `home:${player}`;
}

/**
 * The logical centre of one token, in 15×15 grid units. Multiple tokens on the
 * same slot are separated by the renderer, which groups them by `tokenSlotKey`.
 */
export function tokenPosition(
  config: LudoConfig,
  player: number,
  token: number,
  progress: number
): BoardPoint {
  if (progress === BASE) {
    const slots = baseSlots(config, player);
    return slots[token % slots.length];
  }

  if (progress <= RING_SIZE - 1) {
    const cell = RING_POSITIONS[ringCell(config, player, progress)];
    return { x: cell.x + 0.5, y: cell.y + 0.5 };
  }

  if (progress < FINISH) {
    const cell = LANE_POSITIONS[seatOf(config, player)][progress - HOME_START];
    return { x: cell.x + 0.5, y: cell.y + 0.5 };
  }

  return centreSpot(config, player);
}
