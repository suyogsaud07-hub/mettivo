'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameOutcome } from '@/lib/types';

/**
 * Re-exported for the existing import in `/game-zone/[gameId]` and in
 * `UnoLite.tsx`. `GameOutcome` is owned by `src/lib/types.ts`, which is also
 * what `src/lib/games.ts` records results with — there is one definition.
 */
export type { GameOutcome };

type Cell = 'X' | 'O' | null;
type Board = Cell[];

const LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

const PLAYER: Cell = 'X';
const AI: Cell = 'O';

function findWinner(board: Board): { winner: Cell; line: number[] | null } {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return { winner: null, line: null };
}

function isFull(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

/**
 * Perfect play on a 3x3 board: +1 AI wins, -1 player wins, 0 draw. The search
 * space is tiny (at most 9! paths), so no memoisation is needed.
 */
function minimax(board: Board, isMaximising: boolean): number {
  const { winner } = findWinner(board);
  if (winner === AI) return 1;
  if (winner === PLAYER) return -1;
  if (isFull(board)) return 0;

  const scores: number[] = [];
  for (let index = 0; index < 9; index += 1) {
    if (board[index] !== null) continue;
    const next = [...board];
    next[index] = isMaximising ? AI : PLAYER;
    scores.push(minimax(next, !isMaximising));
  }

  return isMaximising ? Math.max(...scores) : Math.min(...scores);
}

function bestMove(board: Board): number {
  let best = Number.NEGATIVE_INFINITY;
  let move = -1;

  for (let index = 0; index < 9; index += 1) {
    if (board[index] !== null) continue;
    const next = [...board];
    next[index] = AI;
    const score = minimax(next, false);
    if (score > best) {
      best = score;
      move = index;
    }
  }

  return move;
}

export default function TicTacToe({
  onFinish,
}: {
  onFinish: (outcome: GameOutcome, score: number) => void;
}) {
  const [board, setBoard] = useState<Board>(() => Array<Cell>(9).fill(null));
  const [aiThinking, setAiThinking] = useState(false);
  /** Guards against reporting the same finished game twice. */
  const finishedRef = useRef(false);

  const { winner, line } = findWinner(board);
  const full = isFull(board);
  // Derived rather than stored: the game is over exactly when the board says so.
  const ended = Boolean(winner) || full;

  const reset = useCallback(() => {
    setBoard(Array<Cell>(9).fill(null));
    setAiThinking(false);
    finishedRef.current = false;
  }, []);

  const play = (index: number) => {
    if (board[index] || winner || aiThinking || ended) return;
    setBoard((prev) => {
      const next = [...prev];
      next[index] = PLAYER;
      return next;
    });
    setAiThinking(true);
  };

  // The AI replies after a short pause so the move is visible.
  useEffect(() => {
    if (!aiThinking || ended) return;

    const timer = window.setTimeout(() => {
      const move = bestMove(board);
      if (move >= 0) {
        setBoard((prev) => {
          const next = [...prev];
          next[move] = AI;
          return next;
        });
      }
      setAiThinking(false);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [aiThinking, board, ended]);

  // Report exactly once per game; `finishedRef` stops the effect re-firing for
  // the same finished board.
  useEffect(() => {
    if (!ended || finishedRef.current) return;

    finishedRef.current = true;
    const outcome: GameOutcome = winner === PLAYER ? 'win' : winner === AI ? 'loss' : 'draw';
    onFinish(outcome, outcome === 'win' ? 10 : outcome === 'draw' ? 5 : 0);
  }, [ended, winner, onFinish]);

  const status = winner === PLAYER
    ? 'You win! 🎉'
    : winner === AI
      ? 'The AI wins this one.'
      : full
        ? "It's a draw."
        : aiThinking
          ? 'Opponent is thinking...'
          : 'Your turn — you are X';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
      <p
        style={{ fontSize: '15px', fontWeight: 700, color: '#D4B18A', margin: 0, minHeight: '22px' }}
        role="status"
      >
        {status}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 92px)',
          gap: '8px',
        }}
      >
        {board.map((cell, index) => {
          const winning = Boolean(line?.includes(index));
          return (
            <button
              key={index}
              type="button"
              aria-label={`Square ${index + 1}${cell ? `, ${cell}` : ', empty'}`}
              onClick={() => play(index)}
              disabled={Boolean(cell) || Boolean(winner) || aiThinking || ended}
              style={{
                width: '92px',
                height: '92px',
                borderRadius: '16px',
                border: winning ? '2px solid #34D399' : '1px solid #4A1828',
                backgroundColor: cell ? '#29202D' : '#1C1822',
                color: cell === PLAYER ? '#D4B18A' : '#A855F7',
                fontSize: '40px',
                fontWeight: 800,
                cursor: cell || winner || aiThinking || ended ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.15s ease',
              }}
            >
              {cell === 'X' ? '✕' : cell === 'O' ? '◯' : ''}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={reset}
        style={{
          padding: '14px 32px',
          borderRadius: '30px',
          border: 'none',
          background: 'linear-gradient(135deg, #7C3AED, #A855F7)',
          color: '#FFFFFF',
          fontSize: '15px',
          fontWeight: 800,
          cursor: 'pointer',
        }}
      >
        {ended ? 'Play again' : 'Restart'}
      </button>
    </div>
  );
}
