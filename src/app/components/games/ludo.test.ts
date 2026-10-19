import { describe, expect, it } from 'vitest';
import {
  BASE,
  FINISH,
  HUMAN_PLAYER,
  HOME_START,
  LANE_POSITIONS,
  LUDO_MAX_SCORE,
  LUDO_VARIANTS,
  RING_POSITIONS,
  RING_SIZE,
  YARD_ORIGINS,
  applyMove,
  baseSlots,
  botChooseMove,
  centreSpot,
  createLudoState,
  isSafeRingCell,
  legalMoves,
  ludoScore,
  nextDie,
  ringCell,
  rollAndResolve,
  seatOf,
  tokenPosition,
  tokenSlotKey,
  tokensHome,
  uiStateOf,
  type LudoConfig,
  type LudoState,
} from './ludo';

const dash: LudoConfig = LUDO_VARIANTS.dash;
const royale: LudoConfig = LUDO_VARIANTS.royale;

/** A state whose `tokens` are set directly, for precise rule tests. */
function stateWith(
  config: LudoConfig,
  tokens: number[][],
  overrides: Partial<LudoState> = {}
): LudoState {
  return { ...createLudoState(config), tokens, ...overrides };
}

/** Finds a seed whose first roll is `value`, so a die can be forced in tests. */
function seedFor(config: LudoConfig, value: number): number {
  for (let seed = 0; seed < 5000; seed += 1) {
    if (nextDie(createLudoState(config, seed)) === value) return seed;
  }
  throw new Error(`no seed produced a ${value}`);
}

describe('ludo setup', () => {
  it('creates a full board for each variant', () => {
    const dashState = createLudoState(dash, 0);
    expect(dashState.tokens).toHaveLength(2);
    expect(dashState.tokens[0]).toHaveLength(3);
    expect(dashState.tokens.flat().every((progress) => progress === BASE)).toBe(true);
    expect(dashState.turn).toBe(0);
    expect(dashState.phase).toBe('roll');
    expect(dashState.winner).toBeNull();

    const royaleState = createLudoState(royale, 0);
    expect(royaleState.tokens).toHaveLength(4);
    expect(royaleState.tokens[0]).toHaveLength(4);
  });

  it('keeps both score ceilings at 100', () => {
    expect(royale.tokensPerPlayer * royale.pointsPerHome + royale.winBonus).toBe(LUDO_MAX_SCORE);
    expect(dash.tokensPerPlayer * dash.pointsPerHome + dash.winBonus).toBe(LUDO_MAX_SCORE);
  });

  it('only rolls inside 1..6, deterministically', () => {
    const first = createLudoState(dash, 42);
    const again = createLudoState(dash, 42);
    expect(nextDie(first)).toBe(nextDie(again));
    expect(nextDie(first)).toBeGreaterThanOrEqual(1);
    expect(nextDie(first)).toBeLessThanOrEqual(6);
  });
});

describe('legal moves', () => {
  it('offers no move from base when the die cannot release', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    expect(legalMoves(state, 3)).toHaveLength(0);
    expect(legalMoves(state, 6)).toHaveLength(3);
  });

  it('requires an exact roll to finish', () => {
    const atGoal = stateWith(dash, [
      [FINISH, FINISH, 55],
      [BASE, BASE, BASE],
    ]);
    // 55 + 2 == 57 (FINISH): legal. 55 + 3 == 58: not.
    expect(legalMoves(atGoal, 2).map((move) => move.token)).toContain(2);
    expect(legalMoves(atGoal, 3)).toHaveLength(0);
  });

  it('never mutates the state it reads', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const snapshot = JSON.stringify(state);
    legalMoves(state, 3);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('captures and safety', () => {
  it('captures a lone opponent on an unsafe ring cell', () => {
    // Player 1 token sits on ring cell 3 by starting at progress 29.
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, BASE, BASE],
    ]);
    expect(ringCell(dash, 1, 29)).toBe(3);

    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    expect(move?.to).toBe(3);
    expect(move?.captures).toEqual([{ player: 1, token: 0 }]);
  });

  it('never captures on a safe start cell', () => {
    // Player 1 progress 26 lands on ring cell 0, player 0's safe start.
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [26, BASE, BASE],
    ]);
    expect(ringCell(dash, 1, 26)).toBe(0);
    expect(isSafeRingCell(0)).toBe(true);

    const move = legalMoves(state, 6).find((entry) => entry.token === 0);
    expect(move?.to).toBe(0);
    expect(move?.captures).toEqual([]);
  });

  it('refuses to land on a block of two opponents', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, 29, BASE],
    ]);
    expect(legalMoves(state, 3).find((entry) => entry.token === 0)).toBeUndefined();
  });

  it('sends captured tokens back to base when the move is applied', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, BASE, BASE],
    ]);
    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    const next = applyMove({ ...state, die: 3, phase: 'move' }, move!);

    expect(next.tokens[0][0]).toBe(3);
    expect(next.tokens[1][0]).toBe(BASE);
  });
});

describe('turn flow', () => {
  it('grants another roll after a six', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(state, 6)[0];
    const next = applyMove({ ...state, die: 6, phase: 'move' }, move);

    expect(next.turn).toBe(HUMAN_PLAYER);
    expect(next.phase).toBe('roll');
  });

  it('grants another turn after a capture', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, BASE, BASE],
    ]);
    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    const next = applyMove({ ...state, die: 3, phase: 'move' }, move!);

    expect(next.turn).toBe(HUMAN_PLAYER);
  });

  it('passes the turn when there is no legal move', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const next = rollAndResolve({ ...state, seed: seedFor(dash, 3) });

    expect(next.turn).toBe(1);
    expect(next.phase).toBe('roll');
    expect(next.event).toMatch(/no legal move/i);
  });

  it('forfeits the turn on three sixes in a row', () => {
    const base = createLudoState(dash, seedFor(dash, 6));
    const next = rollAndResolve({ ...base, consecutiveSixes: 2 });

    expect(next.turn).toBe(1);
    expect(next.consecutiveSixes).toBe(0);
    expect(next.event).toMatch(/forfeit/i);
  });
});

describe('winning and scoring', () => {
  it('declares a winner when a player brings every token home', () => {
    const state = stateWith(dash, [
      [FINISH, FINISH, 55],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(state, 2).find((entry) => entry.token === 2);
    const next = applyMove({ ...state, die: 2, phase: 'move' }, move!);

    expect(next.winner).toBe(HUMAN_PLAYER);
    expect(next.phase).toBe('over');
    expect(tokensHome(next, HUMAN_PLAYER)).toBe(3);
    expect(ludoScore(next, HUMAN_PLAYER)).toBe(LUDO_MAX_SCORE);
  });

  it('pays only for tokens home when the human did not win', () => {
    const state = stateWith(dash, [
      [FINISH, FINISH, BASE],
      [FINISH, FINISH, FINISH],
    ], { winner: 1 });

    expect(ludoScore(state, HUMAN_PLAYER)).toBe(2 * dash.pointsPerHome);
    expect(ludoScore(state, HUMAN_PLAYER)).toBeLessThan(LUDO_MAX_SCORE);
  });
});

describe('bot', () => {
  it('prefers a capturing move', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, BASE, BASE],
    ], { turn: 0 });
    const move = botChooseMove(state, 3);
    expect(move?.captures).toHaveLength(1);
  });

  it('prefers bringing a token home', () => {
    const state = stateWith(dash, [
      [55, 0, BASE],
      [BASE, BASE, BASE],
    ], { turn: 0 });
    const move = botChooseMove(state, 2);
    expect(move?.to).toBe(FINISH);
  });

  it('returns null when nothing can move', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    expect(botChooseMove(state, 2)).toBeNull();
  });
});

describe('board geometry', () => {
  it('exposes 52 distinct on-board ring cells with orthogonal or corner joins', () => {
    expect(RING_POSITIONS).toHaveLength(RING_SIZE);
    expect(new Set(RING_POSITIONS.map((point) => `${point.x},${point.y}`)).size).toBe(RING_SIZE);

    let diagonals = 0;
    for (let index = 0; index < RING_POSITIONS.length; index += 1) {
      const point = RING_POSITIONS[index];
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(14);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(14);

      const next = RING_POSITIONS[(index + 1) % RING_POSITIONS.length];
      const dx = Math.abs(point.x - next.x);
      const dy = Math.abs(point.y - next.y);
      // Every step is orthogonal, except the four inner corners where two arms
      // meet — those touch only at a corner, exactly as a printed board does.
      expect(dx + dy === 1 || (dx === 1 && dy === 1)).toBe(true);
      if (dx === 1 && dy === 1) diagonals += 1;
    }
    expect(diagonals).toBe(4);
  });

  it('starts each seat on a different arm of the cross', () => {
    expect(RING_POSITIONS[0]).toEqual({ x: 0, y: 6 });
    expect(RING_POSITIONS[13]).toEqual({ x: 8, y: 0 });
    expect(RING_POSITIONS[26]).toEqual({ x: 14, y: 8 });
    expect(RING_POSITIONS[39]).toEqual({ x: 6, y: 14 });
  });

  it('gives every seat a five-cell home lane ending beside the centre', () => {
    for (let seat = 0; seat < 4; seat += 1) {
      expect(LANE_POSITIONS[seat]).toHaveLength(5);
      const last = LANE_POSITIONS[seat][4];
      // The last lane cell is the one immediately outside the 3×3 centre.
      expect(Math.hypot(last.x - 7.5, last.y - 7.5)).toBeLessThan(2.6);
    }
  });

  it('places a token on its ring cell, in its lane, in its base and at its finish', () => {
    const start = tokenPosition(dash, 0, 0, 0);
    const cell = RING_POSITIONS[ringCell(dash, 0, 0)];
    expect(start).toEqual({ x: cell.x + 0.5, y: cell.y + 0.5 });

    const lane = tokenPosition(dash, 0, 0, HOME_START);
    const laneCell = LANE_POSITIONS[seatOf(dash, 0)][0];
    expect(lane).toEqual({ x: laneCell.x + 0.5, y: laneCell.y + 0.5 });

    const home = tokenPosition(dash, 0, 0, FINISH);
    expect(home).toEqual(centreSpot(dash, 0));
    expect(Math.hypot(home.x - 7.5, home.y - 7.5)).toBeLessThan(1.5);

    const base = tokenPosition(dash, 0, 0, BASE);
    expect(base).toEqual(baseSlots(dash, 0)[0]);
    // The first parking slot sits inside the top-left yard.
    const origin = YARD_ORIGINS[seatOf(dash, 0)];
    expect(base.x - origin.x).toBeGreaterThan(0);
    expect(base.y - origin.y).toBeGreaterThan(0);
  });

  it('groups stacked tokens by a stable slot key', () => {
    expect(tokenSlotKey(dash, 0, 0, BASE)).toBe('base:0:0');
    expect(tokenSlotKey(dash, 0, 0, 0)).toBe(`ring:${ringCell(dash, 0, 0)}`);
    expect(tokenSlotKey(dash, 0, 0, HOME_START)).toBe(`lane:${seatOf(dash, 0)}:${HOME_START}`);
    expect(tokenSlotKey(dash, 0, 0, FINISH)).toBe('home:0');
  });
});

describe('regression — board and rules', () => {
  it('1. parks every un-released token in its own yard', () => {
    const state = createLudoState(royale, 0);
    for (let player = 0; player < royale.playerCount; player += 1) {
      baseSlots(royale, player).forEach((slot, token) => {
        expect(tokenPosition(royale, player, token, BASE)).toEqual(slot);
      });
    }
    expect(state.tokens.flat().every((progress) => progress === BASE)).toBe(true);
  });

  it('2. releases a token onto its own start square', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(state, 6).find((entry) => entry.token === 0);
    const next = applyMove({ ...state, die: 6, phase: 'move' }, move!);

    expect(next.tokens[0][0]).toBe(0);
    expect(ringCell(dash, 0, 0)).toBe(dash.starts[0]);
    expect(tokenPosition(dash, 0, 0, 0)).toEqual({
      x: RING_POSITIONS[dash.starts[0]].x + 0.5,
      y: RING_POSITIONS[dash.starts[0]].y + 0.5,
    });
  });

  it('3. cannot leave the yard without a six', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    for (const die of [1, 2, 3, 4, 5]) {
      expect(legalMoves(state, die)).toHaveLength(0);
    }
    expect(legalMoves(state, 6)).toHaveLength(3);
  });

  it('4. advances a token by exactly the rolled amount', () => {
    const state = stateWith(dash, [
      [10, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    expect(move?.from).toBe(10);
    expect(move?.to).toBe(13);
  });

  it('5. leaves the ring and enters the home lane past the last ring cell', () => {
    expect(RING_SIZE - 1).toBe(51);
    const state = stateWith(dash, [
      [50, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    expect(move?.to).toBe(53);
    expect(move!.to).toBeGreaterThanOrEqual(HOME_START);
    const next = applyMove({ ...state, die: 3, phase: 'move' }, move!);
    expect(next.tokens[0][0]).toBe(53);
    const laneCell = LANE_POSITIONS[seatOf(dash, 0)][53 - HOME_START];
    expect(tokenPosition(dash, 0, 0, 53)).toEqual({ x: laneCell.x + 0.5, y: laneCell.y + 0.5 });
  });

  it('6. captures a lone opponent and sends it home to the yard', () => {
    const state = stateWith(dash, [
      [0, BASE, BASE],
      [29, BASE, BASE],
    ]);
    const move = legalMoves(state, 3).find((entry) => entry.token === 0);
    expect(move?.captures).toEqual([{ player: 1, token: 0 }]);
    const next = applyMove({ ...state, die: 3, phase: 'move' }, move!);
    expect(next.tokens[1][0]).toBe(BASE);
  });

  it('7. never captures on a safe ring cell', () => {
    const state = stateWith(dash, [
      [BASE, BASE, BASE],
      [26, BASE, BASE],
    ]);
    expect(isSafeRingCell(ringCell(dash, 1, 26))).toBe(true);
    const move = legalMoves(state, 6).find((entry) => entry.token === 0);
    expect(move?.captures).toEqual([]);
  });

  it('8. refuses an illegal move without mutating the state', () => {
    const state = createLudoState(dash, 7);
    const snapshot = JSON.stringify(state);
    // Wrong phase: a move is only valid while a die is pending.
    expect(applyMove(state, { token: 0, from: BASE, to: 0, captures: [] })).toBe(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('9. refuses to overshoot the finish', () => {
    const state = stateWith(dash, [
      [55, BASE, BASE],
      [BASE, BASE, BASE],
    ]);
    // 55 + 3 == 58 > FINISH, so no legal move exists.
    expect(legalMoves(state, 3)).toHaveLength(0);
    expect(legalMoves(state, 2).find((entry) => entry.token === 0)?.to).toBe(FINISH);
  });

  it('10. only declares a winner once every token is home', () => {
    const nearly = stateWith(dash, [
      [FINISH, FINISH, FINISH],
      [BASE, BASE, BASE],
    ]);
    expect(nearly.winner).toBeNull();

    const partial = applyMove(
      { ...nearly, tokens: [[FINISH, FINISH, 0], [BASE, BASE, BASE]], die: 1, phase: 'move' },
      legalMoves({ ...nearly, tokens: [[FINISH, FINISH, 0], [BASE, BASE, BASE]] }, 1)[0]
    );
    expect(partial.winner).toBeNull();
    expect(partial.phase).not.toBe('over');

    const finalState = stateWith(dash, [
      [FINISH, FINISH, 56],
      [BASE, BASE, BASE],
    ]);
    const move = legalMoves(finalState, 1).find((entry) => entry.token === 2)!;
    const done = applyMove({ ...finalState, die: 1, phase: 'move' }, move);
    expect(done.winner).toBe(HUMAN_PLAYER);
    expect(done.phase).toBe('over');
    expect(tokensHome(done, HUMAN_PLAYER)).toBe(dash.tokensPerPlayer);
  });

  it('11. grants an extra turn on a six and forfeits three sixes in a row', () => {
    const base = stateWith(dash, [
      [0, BASE, BASE],
      [BASE, BASE, BASE],
    ]);

    const rolledSix = rollAndResolve({ ...base, seed: seedFor(dash, 6) });
    expect(rolledSix.turn).toBe(HUMAN_PLAYER);
    expect(rolledSix.phase).toBe('move');

    const forfeit = rollAndResolve({ ...createLudoState(dash, seedFor(dash, 6)), consecutiveSixes: 2 });
    expect(forfeit.turn).toBe(1);
    expect(forfeit.event).toMatch(/forfeit/i);
  });

  it('12. makes the bot choose only legal moves', () => {
    const state = stateWith(royale, [
      [10, 20, BASE, BASE],
      [5, BASE, BASE, BASE],
      [BASE, BASE, BASE, BASE],
      [30, 40, 50, BASE],
    ], { turn: 2 });

    for (const die of [1, 2, 3, 4, 5, 6]) {
      const move = botChooseMove(state, die);
      if (move) {
        expect(legalMoves(state, die)).toContainEqual(move);
      }
    }
  });

  it('13. derives the UI prompt from the engine, never contradicting it', () => {
    expect(uiStateOf(createLudoState(dash, 0))).toBe('WAITING_FOR_ROLL');

    const selecting = stateWith(dash, [[0, BASE, BASE], [BASE, BASE, BASE]], {
      turn: HUMAN_PLAYER,
      phase: 'move',
      die: 3,
    });
    expect(uiStateOf(selecting)).toBe('SELECTING_TOKEN');

    const bot = stateWith(dash, [[BASE, BASE, BASE], [BASE, BASE, BASE]], { turn: 1, phase: 'roll' });
    expect(uiStateOf(bot)).toBe('BOT_TURN');

    const over = stateWith(dash, [[FINISH, FINISH, FINISH], [BASE, BASE, BASE]], {
      phase: 'over',
      winner: HUMAN_PLAYER,
    });
    expect(uiStateOf(over)).toBe('GAME_OVER');
  });

  it('14. leaves no match state behind after a restart', () => {
    const dirty = stateWith(royale, [
      [FINISH, FINISH, FINISH, FINISH],
      [BASE, BASE, BASE, BASE],
      [BASE, BASE, BASE, BASE],
      [BASE, BASE, BASE, BASE],
    ], { turn: 3, phase: 'over', winner: 0, rolls: 42, consecutiveSixes: 2 });

    const fresh = createLudoState(royale, (dirty.seed + 1) >>> 0);
    expect(fresh.turn).toBe(0);
    expect(fresh.phase).toBe('roll');
    expect(fresh.winner).toBeNull();
    expect(fresh.rolls).toBe(0);
    expect(fresh.consecutiveSixes).toBe(0);
    expect(fresh.tokens.flat().every((progress) => progress === BASE)).toBe(true);
  });

  it('15. keeps Dash a two-player, three-token sprint distinct from Royale', () => {
    expect(dash.playerCount).toBe(2);
    expect(dash.tokensPerPlayer).toBe(3);
    expect(dash.starts).toHaveLength(2);
    expect(royale.playerCount).toBe(4);
    expect(royale.tokensPerPlayer).toBe(4);
    expect(royale.starts).toHaveLength(4);

    const state = createLudoState(dash, 0);
    expect(state.tokens).toHaveLength(2);
    expect(state.tokens[0]).toHaveLength(3);
  });
});
