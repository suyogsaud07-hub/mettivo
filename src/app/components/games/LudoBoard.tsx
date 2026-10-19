'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { GameOutcome } from '@/lib/types';
import { PALETTE, primaryButtonStyle } from './game-theme';
import { useGameRound } from './surface';
import {
  BASE,
  CENTRE_TRIANGLES,
  FINISH,
  HUMAN_PLAYER,
  LANE_POSITIONS,
  LUDO_COLORS,
  LUDO_MAX_SCORE,
  RING_POSITIONS,
  YARD_ORIGINS,
  applyMove,
  baseSlots,
  botChooseMove,
  centreSpot,
  createLudoState,
  isSafeRingCell,
  legalMoves,
  ludoScore,
  rollAndResolve,
  tokenPosition,
  tokenSlotKey,
  tokensHome,
  uiStateOf,
  type BoardPoint,
  type LudoConfig,
  type LudoState,
} from './ludo';

/**
 * The shared Ludo board for Ludo Royale and Ludo Dash.
 *
 * The rules and the *logical* board geometry live in `./ludo` (pure,
 * deterministic, unit-tested). This file is the React shell around them: it
 * paints the 15×15 cross-shaped board as a single responsive SVG and keeps the
 * game state in a reducer, letting the human roll and pick a token, running the
 * bots on a short timer, and reporting exactly one outcome through `onFinish`.
 *
 * Board coordinates are grid units: `x` right, `y` down, each cell 1 unit. The
 * SVG `viewBox` is the whole 15×15 grid, so every element scales with the
 * container and nothing is positioned in percentages of an unknown box.
 */

type Action =
  | { type: 'roll' }
  | { type: 'move'; token: number }
  | { type: 'bot' }
  | { type: 'reset' };

function reducer(state: LudoState, action: Action): LudoState {
  switch (action.type) {
    case 'roll':
      if (state.phase !== 'roll' || state.turn !== HUMAN_PLAYER) return state;
      return rollAndResolve(state);

    case 'move': {
      if (state.phase !== 'move' || state.turn !== HUMAN_PLAYER || state.die === null) return state;
      const move = legalMoves(state, state.die).find((entry) => entry.token === action.token);
      return move ? applyMove(state, move) : state;
    }

    case 'bot': {
      if (state.phase === 'over' || state.turn === HUMAN_PLAYER) return state;
      if (state.phase === 'roll') return rollAndResolve(state);
      const move = botChooseMove(state, state.die ?? 0);
      return move ? applyMove(state, move) : state;
    }

    case 'reset':
      return createLudoState(state.config, (state.seed + 1) >>> 0);

    default:
      return state;
  }
}

/** How long a bot pauses before acting, so its move is visible. */
const BOT_DELAY_MS = 520;

/** Seat → colour, resolving each arm to a player's colour (or a dim default). */
function seatColors(config: LudoConfig): string[] {
  const names = ['red', 'green', 'yellow', 'blue'] as const;
  return [0, 1, 2, 3].map((seat) => {
    const player = config.starts.findIndex((start) => Math.round(start / 13) === seat);
    return player === -1 ? LUDO_COLORS[names[seat]] : config.colors[player];
  });
}

/** The four pips of a die face, as a 3×3 grid of booleans. */
const DIE_PIPS: Record<number, boolean[]> = {
  1: [false, false, false, false, true, false, false, false, false],
  2: [true, false, false, false, false, false, false, false, true],
  3: [true, false, false, false, true, false, false, false, true],
  4: [true, false, true, false, false, false, true, false, true],
  5: [true, false, true, false, true, false, true, false, true],
  6: [true, false, true, true, false, true, true, false, true],
};

function DieFace({ value }: { value: number | null }) {
  const pips = value === null ? [] : DIE_PIPS[value] ?? [];

  return (
    <div
      data-testid="ludo-die"
      aria-label={value === null ? 'No dice rolled' : `Dice shows ${value}`}
      style={{
        width: '46px',
        height: '46px',
        borderRadius: '12px',
        border: `1px solid ${PALETTE.raised}`,
        background: value === null ? PALETTE.bg : PALETTE.text,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: '3px',
        padding: '8px',
        boxSizing: 'border-box',
        transition: 'background 0.15s ease',
      }}
    >
      {Array.from({ length: 9 }).map((_, index) => (
        <span
          key={index}
          style={{
            borderRadius: '50%',
            background: pips[index] ? PALETTE.violet : 'transparent',
          }}
        />
      ))}
    </div>
  );
}

export default function Ludo({
  config,
  onFinish,
}: {
  config: LudoConfig;
  onFinish: (outcome: GameOutcome, score: number) => void;
}) {
  const round = useGameRound();
  const [state, dispatch] = useReducer(reducer, undefined, () => createLudoState(config, round));

  // Bots roll and move on a timer. The cleanup cancels the pending action
  // whenever the state changes, so this cannot double-fire or run past the end.
  useEffect(() => {
    if (state.phase === 'over' || state.turn === HUMAN_PLAYER) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'bot' }), BOT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Report exactly once when the game ends.
  const reported = useRef(false);
  useEffect(() => {
    if (state.phase !== 'over' || reported.current) return;
    reported.current = true;
    const outcome: GameOutcome = state.winner === HUMAN_PLAYER ? 'win' : 'loss';
    onFinish(outcome, ludoScore(state, HUMAN_PLAYER));
  }, [state, onFinish]);

  const reset = useCallback(() => {
    reported.current = false;
    dispatch({ type: 'reset' });
  }, []);

  const humanTurn = state.turn === HUMAN_PLAYER && state.phase !== 'over';
  const moves = useMemo(
    () => (humanTurn && state.phase === 'move' && state.die !== null ? legalMoves(state, state.die) : []),
    [humanTurn, state]
  );
  const movable = useMemo(() => new Set(moves.map((move) => move.token)), [moves]);

  const colors = useMemo(() => seatColors(config), [config]);
  const activeSeats = useMemo(() => new Set(config.starts.map((start) => Math.round(start / 13))), [config]);

  /**
   * Every token's painted centre, in grid units. Tokens sharing a slot (two on
   * the same ring cell, several home) are nudged apart on a small circle so the
   * stack is legible instead of hiding all but the last.
   */
  const tokenViews = useMemo(() => {
    const all: { player: number; token: number; progress: number; key: string }[] = [];
    state.tokens.forEach((row, player) =>
      row.forEach((progress, token) => {
        all.push({ player, token, progress, key: tokenSlotKey(config, player, token, progress) });
      })
    );

    const counts = new Map<string, number>();
    for (const entry of all) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1);

    const seen = new Map<string, number>();
    return all.map((entry) => {
      const base = tokenPosition(config, entry.player, entry.token, entry.progress);
      const total = counts.get(entry.key) ?? 1;
      const index = seen.get(entry.key) ?? 0;
      seen.set(entry.key, index + 1);

      let x = base.x;
      let y = base.y;
      if (total > 1) {
        const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
        x += Math.cos(angle) * 0.22;
        y += Math.sin(angle) * 0.22;
      }

      return { ...entry, x, y };
    });
  }, [config, state.tokens]);

  /** Destinations the human may move to right now, for the move hints. */
  const destinations = useMemo(() => {
    const seen = new Map<string, BoardPoint>();
    for (const move of moves) {
      const point =
        move.to === FINISH
          ? centreSpot(config, HUMAN_PLAYER)
          : tokenPosition(config, HUMAN_PLAYER, move.token, move.to);
      seen.set(`${point.x.toFixed(2)},${point.y.toFixed(2)}`, point);
    }
    return [...seen.values()];
  }, [moves, config]);

  const uiState = uiStateOf(state);

  const status = (() => {
    if (state.phase === 'over') {
      return state.winner === HUMAN_PLAYER ? 'You win! 🎉' : `${config.labels[state.winner ?? 0]} wins.`;
    }
    if (state.turn === HUMAN_PLAYER) {
      return state.phase === 'roll' ? 'Your turn — roll the dice.' : 'Your turn — pick a token.';
    }
    return `${config.labels[state.turn]} is playing…`;
  })();

  const cellFill = (index: number): string => {
    const startOwner = config.starts.indexOf(index);
    if (startOwner !== -1) return config.colors[startOwner];
    if (isSafeRingCell(index)) return PALETTE.gold;
    return PALETTE.raised;
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' }}
      data-testid="ludo"
      data-variant={config.variant}
      data-turn={state.turn}
      data-phase={state.phase}
      data-ui-state={uiState}
      data-die={state.die ?? ''}
      data-your-tokens-home={tokensHome(state, HUMAN_PLAYER)}
      data-winner={state.winner ?? ''}
    >
      <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, textAlign: 'center' }}>{config.blurb}</p>

      <p
        role="status"
        data-testid="ludo-status"
        style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.gold, minHeight: '22px', textAlign: 'center' }}
      >
        {status}
      </p>

      {/* Player legend with live token counts. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
        {config.labels.map((name, player) => (
          <span
            key={name}
            data-testid={`ludo-player-${player}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: state.turn === player && state.phase !== 'over' ? PALETTE.text : PALETTE.muted,
            }}
          >
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: config.colors[player] }} />
            {name} · {tokensHome(state, player)}/{config.tokensPerPlayer}
          </span>
        ))}
      </div>

      {/* Board — one responsive SVG in grid coordinates. */}
      <svg
        role="group"
        aria-label={`${config.title} board`}
        viewBox="-0.3 -0.3 15.6 15.6"
        style={{ width: '100%', maxWidth: '380px', display: 'block', aspectRatio: '1 / 1' }}
      >
        <defs>
          <filter id="ludo-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="0.14" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Board backdrop. */}
        <rect x="0" y="0" width="15" height="15" rx="1.2" fill={PALETTE.surface} />

        {/* Home yards, one 6×6 block per seat; inactive seats are dimmed. */}
        {[0, 1, 2, 3].map((seat) => {
          const origin = YARD_ORIGINS[seat];
          const active = activeSeats.has(seat);
          return (
            <rect
              key={`yard-${seat}`}
              x={origin.x + 0.4}
              y={origin.y + 0.4}
              width={5.2}
              height={5.2}
              rx="0.8"
              fill={colors[seat]}
              fillOpacity={active ? 0.18 : 0.05}
              stroke={colors[seat]}
              strokeOpacity={active ? 0.85 : 0.2}
              strokeWidth="0.1"
            />
          );
        })}

        {/* Parking slots inside each active yard. */}
        {config.labels.map((_, player) =>
          baseSlots(config, player).map((slot, token) => (
            <circle
              key={`slot-${player}-${token}`}
              cx={slot.x}
              cy={slot.y}
              r="0.4"
              fill="none"
              stroke={config.colors[player]}
              strokeOpacity="0.5"
              strokeWidth="0.06"
            />
          ))
        )}

        {/* Home lanes running toward the centre. */}
        {[0, 1, 2, 3].map((seat) => {
          if (!activeSeats.has(seat)) return null;
          return LANE_POSITIONS[seat].map((cell, step) => (
            <rect
              key={`lane-${seat}-${step}`}
              x={cell.x + 0.06}
              y={cell.y + 0.06}
              width={0.88}
              height={0.88}
              rx="0.16"
              fill={colors[seat]}
              fillOpacity={0.55}
            />
          ));
        })}

        {/* The 52-cell shared track. */}
        {RING_POSITIONS.map((cell, index) => {
          const isStart = config.starts.includes(index);
          const safe = isSafeRingCell(index);
          return (
            <g key={`cell-${index}`}>
              <rect
                x={cell.x + 0.06}
                y={cell.y + 0.06}
                width={0.88}
                height={0.88}
                rx="0.16"
                fill={cellFill(index)}
                fillOpacity={isStart ? 1 : safe ? 0.6 : 0.85}
                stroke={PALETTE.bg}
                strokeOpacity="0.55"
                strokeWidth="0.04"
              />
              {safe && !isStart ? (
                <circle cx={cell.x + 0.5} cy={cell.y + 0.5} r="0.14" fill={PALETTE.bg} fillOpacity="0.65" />
              ) : null}
            </g>
          );
        })}

        {/* Centre finish: four triangles meeting at the middle. */}
        {CENTRE_TRIANGLES.map((triangle, seat) => (
          <polygon
            key={`centre-${seat}`}
            points={triangle.map((point) => `${point.x},${point.y}`).join(' ')}
            fill={colors[seat]}
            fillOpacity={activeSeats.has(seat) ? 0.85 : 0.25}
            stroke={PALETTE.bg}
            strokeOpacity="0.5"
            strokeWidth="0.05"
          />
        ))}
        <circle cx="7.5" cy="7.5" r="0.22" fill={PALETTE.gold} />

        {/* Move hints: a gold ring at each legal destination. */}
        {destinations.map((point, index) => (
          <circle
            key={`dest-${index}`}
            cx={point.x}
            cy={point.y}
            r="0.42"
            fill="none"
            stroke={PALETTE.gold}
            strokeWidth="0.1"
            strokeDasharray="0.18 0.14"
          />
        ))}

        {/* Tokens, drawn last so they sit above the board. */}
        {tokenViews.map(({ player, token, progress, x, y }) => {
          const isHuman = player === HUMAN_PLAYER;
          const isMovable = isHuman && movable.has(token);
          const label = isHuman
            ? `Your token ${token + 1}${isMovable ? ' (movable)' : ''}`
            : `${config.labels[player]} token ${token + 1}`;

          return (
            <g
              key={`token-${player}-${token}`}
              data-testid={`ludo-token-${player}-${token}`}
              data-player={player}
              data-token={token}
              data-progress={progress}
              data-movable={isMovable}
              role={isHuman ? 'button' : undefined}
              tabIndex={isMovable ? 0 : undefined}
              aria-label={label}
              aria-disabled={isHuman ? !isMovable : undefined}
              onClick={isMovable ? () => dispatch({ type: 'move', token }) : undefined}
              onKeyDown={
                isMovable
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        dispatch({ type: 'move', token });
                      }
                    }
                  : undefined
              }
              style={{ cursor: isMovable ? 'pointer' : 'default' }}
            >
              <circle cx={x} cy={y} r="0.46" fill="transparent" />
              {isMovable ? (
                <circle cx={x} cy={y} r="0.4" fill="none" stroke={PALETTE.gold} strokeWidth="0.1" filter="url(#ludo-glow)" />
              ) : null}
              <circle
                cx={x}
                cy={y}
                r="0.3"
                fill={config.colors[player]}
                stroke={isMovable ? PALETTE.gold : 'rgba(0,0,0,0.45)'}
                strokeWidth={isMovable ? 0.09 : 0.06}
                opacity={progress === BASE ? 0.85 : 1}
              />
              <circle cx={x} cy={y - 0.09} r="0.09" fill="#FFFFFF" fillOpacity="0.45" />
            </g>
          );
        })}
      </svg>

      {state.event ? (
        <p data-testid="ludo-event" style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, minHeight: '16px', textAlign: 'center' }}>
          {state.event}
        </p>
      ) : null}

      {/* Controls */}
      {state.phase === 'over' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
            Result: {ludoScore(state, HUMAN_PLAYER)} / {LUDO_MAX_SCORE}
          </div>
          <button type="button" onClick={reset} data-testid="ludo-new-game" style={primaryButtonStyle}>
            New game
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <DieFace value={state.die} />
          <button
            type="button"
            onClick={() => dispatch({ type: 'roll' })}
            disabled={!humanTurn || state.phase !== 'roll'}
            data-testid="ludo-roll"
            style={{
              ...primaryButtonStyle,
              opacity: !humanTurn || state.phase !== 'roll' ? 0.45 : 1,
              cursor: !humanTurn || state.phase !== 'roll' ? 'default' : 'pointer',
            }}
          >
            Roll dice
          </button>
        </div>
      )}
    </div>
  );
}
