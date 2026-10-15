'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE, mutedTextStyle, panelStyle, statusTextStyle } from './game-theme';
import {
  prepareCanvasSurface,
  useCanvas,
  useGameRound,
  type CanvasPoint,
  type GamePlayerProps,
} from './surface';
import { formatClock, shuffleWithSeed } from './deterministic';

/**
 * `memory-match` — the shell's HTML5 `<canvas>` mode.
 *
 * The shell owns the `<canvas>` element; this component owns the rules and
 * paints through `useCanvas()`. 4x4 grid, 8 pairs, move counting, its own
 * timer, and a score out of 100 that mixes efficiency (perfect play is eight
 * moves) with speed.
 *
 * The board is a seeded shuffle, not a random one: the same round always deals
 * the same layout, on the server and in the browser, which keeps hydration
 * honest and lets the Playwright journey solve it exactly.
 */

const COLUMNS = 4;
const ROWS = 4;
const CARD = 80;
const WIDTH = COLUMNS * CARD;
const HEIGHT = ROWS * CARD;
const TOTAL_CARDS = COLUMNS * ROWS;
const PAIRS = TOTAL_CARDS / 2;
const MISMATCH_DELAY_MS = 700;
const MAX_SCORE = 100;

const SYMBOLS = ['🌙', '☕', '🎧', '🏔️', '🍜', '🎸', '🐘', '🌸'];

/** Card faces as symbol *indices*, so a test can group pairs without emoji parsing. */
function boardFor(round: number): number[] {
  const deck = SYMBOLS.flatMap((_, index) => [index, index]);
  return shuffleWithSeed(deck, 20261015 + round * 31);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function paintBoard(
  context: CanvasRenderingContext2D,
  board: number[],
  flipped: number[],
  matched: number[]
): void {
  context.fillStyle = PALETTE.bg;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (let index = 0; index < TOTAL_CARDS; index += 1) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = column * CARD + 5;
    const y = row * CARD + 5;
    const size = CARD - 10;
    const isMatched = matched.includes(index);
    const faceUp = isMatched || flipped.includes(index);

    roundedRect(context, x, y, size, size, 12);
    context.fillStyle = isMatched ? PALETTE.greenBg : faceUp ? PALETTE.raised : PALETTE.surface;
    context.fill();
    context.strokeStyle = isMatched ? PALETTE.greenBorder : faceUp ? PALETTE.gold : PALETTE.accentBorder;
    context.lineWidth = 2;
    context.stroke();

    if (faceUp) {
      context.font = '34px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      context.fillText(SYMBOLS[board[index]], x + size / 2, y + size / 2 + 2);
    } else {
      context.fillStyle = PALETTE.muted;
      context.font = '800 20px system-ui, sans-serif';
      context.fillText('?', x + size / 2, y + size / 2 + 1);
    }
  }
}

interface BoardState {
  flipped: number[];
  matched: number[];
  moves: number;
}

export default function MemoryMatch({ onFinish }: GamePlayerProps) {
  const round = useGameRound();
  const canvas = useCanvas();
  const board = useMemo(() => boardFor(round), [round]);

  const [state, setState] = useState<BoardState>({ flipped: [], matched: [], moves: 0 });
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const finishedRef = useRef(false);

  const completed = state.matched.length === TOTAL_CARDS;

  // Paint after every commit. Never during render: `prepareCanvasSurface`
  // touches `devicePixelRatio` and the canvas backing store.
  useEffect(() => {
    const element = canvas?.ref.current;
    if (!element) return;
    const context = prepareCanvasSurface(element, WIDTH, HEIGHT);
    if (!context) return;
    paintBoard(context, board, state.flipped, state.matched);
  }, [canvas, board, state.flipped, state.matched]);

  const pick = useCallback(
    (point: CanvasPoint) => {
      // The canvas is responsive (`maxWidth: 100%`), so the grid is resolved
      // against the rendered size the shell reports rather than the logical
      // 320px one — otherwise a narrow phone would map a tap to the wrong card.
      const cellWidth = point.width > 0 ? point.width / COLUMNS : CARD;
      const cellHeight = point.height > 0 ? point.height / ROWS : CARD;

      const column = Math.floor(point.x / cellWidth);
      const row = Math.floor(point.y / cellHeight);
      if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return;

      const index = row * COLUMNS + column;
      if (locked || state.matched.includes(index) || state.flipped.includes(index)) return;

      if (state.flipped.length === 0) {
        setState((prev) => ({ ...prev, flipped: [index] }));
        return;
      }

      const first = state.flipped[0];
      const isMatch = board[first] === board[index];

      setState((prev) => ({
        moves: prev.moves + 1,
        flipped: isMatch ? [] : [first, index],
        matched: isMatch ? [...prev.matched, first, index] : prev.matched,
      }));

      if (!isMatch) setLocked(true);
    },
    [board, locked, state]
  );

  useEffect(() => {
    if (!canvas) return undefined;
    return canvas.onPick(pick);
  }, [canvas, pick]);

  // Turn the two mismatched cards back over.
  useEffect(() => {
    if (!locked) return;
    const handle = window.setTimeout(() => {
      setState((prev) => ({ ...prev, flipped: [] }));
      setLocked(false);
    }, MISMATCH_DELAY_MS);

    return () => window.clearTimeout(handle);
  }, [locked]);

  // The per-game clock, stopped the moment the board is cleared.
  useEffect(() => {
    if (completed) return;
    const handle = window.setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => window.clearInterval(handle);
  }, [completed]);

  useEffect(() => {
    if (!completed || finishedRef.current) return;
    finishedRef.current = true;

    const efficiency = Math.round((PAIRS / Math.max(PAIRS, state.moves)) * 80);
    const speed = Math.max(0, 20 - Math.floor(elapsed / 15) * 5);
    onFinish('win', Math.min(MAX_SCORE, efficiency + speed));
  }, [completed, elapsed, state.moves, onFinish]);

  const layoutKey = board.join(',');

  return (
    <div style={{ ...panelStyle, alignItems: 'stretch' }}>
      <p style={statusTextStyle} data-testid="memory-match-status">
        Pairs {state.matched.length / 2}/{PAIRS} · Moves {state.moves} · Time {formatClock(elapsed)}
      </p>
      <p style={mutedTextStyle}>
        Tap two cards to turn them over. Match all {PAIRS} pairs — fewer moves and a faster clock score
        higher, up to {MAX_SCORE}.
      </p>
      {/*
        The board layout, as symbol indices. Hidden, and deliberately so: it is
        the hook the Playwright journey uses to click the real matching pairs on
        a real canvas.
      */}
      <span
        hidden
        data-testid="memory-match-state"
        data-layout={layoutKey}
        data-pairs={state.matched.length / 2}
        data-moves={state.moves}
      />
    </div>
  );
}
