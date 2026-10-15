'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { GameOutcome } from '@/lib/types';
import { formatClock } from './deterministic';
import { PALETTE } from './game-theme';
import {
  CanvasHandleProvider,
  GameRoundProvider,
  SandboxHandleProvider,
  type CanvasHandle,
  type CanvasPoint,
  type GamePlayerProps,
  type SandboxHandle,
} from './surface';

import Icebreaker from './Icebreaker';
import MemoryMatch from './MemoryMatch';
import SpeedMatching from './SpeedMatching';
import SpinTheWheel from './SpinTheWheel';
import TicTacToe from './TicTacToe';
import TruthOrDare from './TruthOrDare';
import TwentyQuestions from './TwentyQuestions';
import UnoLite from './UnoLite';
import WordGuess from './WordGuess';
import { SPIN_WHEEL_DOCUMENT } from './spin-wheel-document';

/**
 * The embedded Game Shell.
 *
 * `GameShell` is the only thing a route has to render: it looks the game up in
 * the registry, builds the right surface (a React component, an HTML5
 * `<canvas>`, or a sandboxed `<iframe>`), and owns the chrome every game shares
 * — the title, a running mm:ss timer, Restart, and the outcome banner.
 *
 * Two guarantees matter to the caller:
 *
 *  1. `onFinish` fires exactly once per finished game, even if a player reports
 *     twice or a restart races the report.
 *  2. The score handed to `onFinish` is clamped to `[0, maxScore]`, where
 *     `maxScore` mirrors `public.game_catalog.max_score`. The database's
 *     `record_game_result()` rejects an over-ceiling score outright, so the
 *     clamp is what stops a buggy game from turning a finished round into a
 *     failed write.
 *
 * All hooks run before any early return, so the component is safe to render
 * with an unknown id (it shows an inline explanation rather than a dead end).
 */

export type { CanvasHandle, CanvasPoint, GameOutcome, GamePlayerProps, SandboxHandle };
export { prepareCanvasSurface, useCanvas, useGameRound, useSandbox } from './surface';

/** React-component mode. */
export interface ReactEmbed {
  mode: 'react';
  title: string;
  maxScore: number;
}

/** HTML5 `<canvas>` mode — the shell creates the element, the game paints it. */
export interface CanvasEmbed {
  mode: 'canvas';
  title: string;
  maxScore: number;
  width: number;
  height: number;
  /** Accessible name for the canvas. */
  label: string;
}

/** Sandboxed `<iframe>` mode. */
export interface IframeEmbed {
  mode: 'iframe';
  title: string;
  maxScore: number;
  docTitle: string;
  /** Self-contained document; never same-origin with the app. */
  srcDoc: string;
  sandbox: string;
}

export type GameEmbed = ReactEmbed | CanvasEmbed | IframeEmbed;

/**
 * Every playable game, by `game_catalog.game_id`.
 *
 * Registering a game here does NOT by itself make it writable: the id must also
 * exist in `public.game_catalog` or `record_game_result()` refuses the row.
 */
export const GAME_PLAYERS: Record<string, ComponentType<GamePlayerProps>> = {
  'tic-tac-toe': TicTacToe,
  'uno-lite': UnoLite,
  'memory-match': MemoryMatch,
  'word-guess': WordGuess,
  icebreaker: Icebreaker,
  'twenty-questions': TwentyQuestions,
  'truth-or-dare': TruthOrDare,
  'spin-the-wheel': SpinTheWheel,
  'speed-matching': SpeedMatching,
};

/**
 * Score ceilings. MUST stay identical to `public.game_catalog.max_score`:
 * too low silently truncates a legitimate result, too high makes the server
 * reject the write. `ludo-royale` / `ludo-dash` are not playable and have no
 * ceiling, so they are deliberately absent.
 */
export const GAME_MAX_SCORES: Record<string, number> = {
  'tic-tac-toe': 10,
  'uno-lite': 500,
  'memory-match': 100,
  'word-guess': 60,
  icebreaker: 50,
  'twenty-questions': 30,
  'truth-or-dare': 15,
  'spin-the-wheel': 20,
  'speed-matching': 80,
};

/** How each game is embedded, and the wording the shell shows for it. */
export const GAME_EMBEDS: Record<string, GameEmbed> = {
  'tic-tac-toe': { mode: 'react', title: 'Tic Tac Toe', maxScore: 10 },
  'uno-lite': { mode: 'react', title: 'UNO', maxScore: 500 },
  'memory-match': {
    mode: 'canvas',
    title: 'Memory Match',
    maxScore: 100,
    width: 320,
    height: 320,
    label: 'Memory Match board: a four by four grid of face-down cards',
  },
  'word-guess': { mode: 'react', title: 'Word Guessing', maxScore: 60 },
  icebreaker: { mode: 'react', title: 'Icebreaker Trivia', maxScore: 50 },
  'twenty-questions': { mode: 'react', title: '20 Questions', maxScore: 30 },
  'truth-or-dare': { mode: 'react', title: 'Truth or Dare', maxScore: 15 },
  'spin-the-wheel': {
    mode: 'iframe',
    title: 'Spin the Wheel',
    maxScore: 20,
    docTitle: 'Sandboxed spin-the-wheel document',
    srcDoc: SPIN_WHEEL_DOCUMENT,
    // Deliberately no `allow-same-origin`: the document gets an opaque origin,
    // so it cannot read this page, its cookies or its session. `allow-scripts`
    // is what lets the wheel spin; `postMessage` is its only way back.
    sandbox: 'allow-scripts',
  },
  'speed-matching': { mode: 'react', title: 'Speed Matching', maxScore: 80 },
};

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

function CanvasSurface({ embed, children }: { embed: CanvasEmbed; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const pickers = useRef(new Set<(point: CanvasPoint) => void>());

  const handle = useMemo<CanvasHandle>(
    () => ({
      ref,
      onPick: (picker) => {
        pickers.current.add(picker);
        return () => {
          pickers.current.delete(picker);
        };
      },
    }),
    []
  );

  const pick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    for (const picker of pickers.current) picker(point);
  };

  return (
    <CanvasHandleProvider value={handle}>
      <canvas
        ref={ref}
        width={embed.width}
        height={embed.height}
        role="img"
        aria-label={embed.label}
        onClick={pick}
        data-testid="game-canvas"
        style={{
          width: `${embed.width}px`,
          height: `${embed.height}px`,
          maxWidth: '100%',
          borderRadius: '18px',
          border: `1px solid ${PALETTE.accentBorder}`,
          backgroundColor: PALETTE.surface,
          cursor: 'pointer',
          touchAction: 'manipulation',
          display: 'block',
          alignSelf: 'center',
        }}
      />
      {children}
    </CanvasHandleProvider>
  );
}

function SandboxSurface({ embed, children }: { embed: IframeEmbed; children: ReactNode }): ReactElement {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const listeners = useRef(new Set<(data: unknown) => void>());

  const handle = useMemo<SandboxHandle>(
    () => ({
      post: (message) => {
        ref.current?.contentWindow?.postMessage(message, '*');
      },
      onMessage: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    []
  );

  // Only a message whose source is THIS document's window is accepted; the
  // document's origin is opaque, so identity of the window is the check that
  // actually holds.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      for (const listener of listeners.current) listener(event.data);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <SandboxHandleProvider value={handle}>
      <iframe
        ref={ref}
        title={embed.docTitle}
        srcDoc={embed.srcDoc}
        sandbox={embed.sandbox}
        // The document announces itself on load; this is the reply half of the
        // handshake, and the reason `post` is not a dead prop.
        onLoad={() => {
          ref.current?.contentWindow?.postMessage({ type: 'mettivo:hello' }, '*');
        }}
        data-testid="game-sandbox"
        style={{
          width: '100%',
          maxWidth: '340px',
          height: '380px',
          alignSelf: 'center',
          border: `1px solid ${PALETTE.accentBorder}`,
          borderRadius: '18px',
          backgroundColor: PALETTE.surface,
        }}
      />
      {children}
    </SandboxHandleProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export interface GameShellProps {
  /** Matches `game_catalog.game_id` and a key of `GAME_PLAYERS`. */
  gameId: string;
  /** Called at most once per finished round, with a score inside the ceiling. */
  onFinish: (outcome: GameOutcome, score: number) => void;
  /** Defaults to the registered title. */
  title?: string;
  subtitle?: string;
  /** Defaults to `GAME_MAX_SCORES[gameId]`. */
  maxScore?: number;
}

const SHELL_STYLE: CSSProperties = {
  backgroundColor: PALETTE.bg,
  color: PALETTE.text,
  borderRadius: '24px',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  fontFamily: 'system-ui',
};

const BANNER_TONES: Record<GameOutcome, CSSProperties> = {
  win: { backgroundColor: PALETTE.greenBg, border: `1px solid ${PALETTE.greenBorder}`, color: PALETTE.greenText },
  draw: { backgroundColor: PALETTE.surface, border: `1px solid ${PALETTE.gold}`, color: PALETTE.gold },
  loss: { backgroundColor: PALETTE.redBg, border: `1px solid ${PALETTE.redBorder}`, color: PALETTE.red },
};

function outcomeMessage(outcome: GameOutcome, score: number): string {
  switch (outcome) {
    case 'win':
      return `You won! Score ${score}.`;
    case 'draw':
      return `Draw — score ${score}.`;
    default:
      return `Game over — score ${score}.`;
  }
}

export function GameShell({ gameId, onFinish, title, subtitle, maxScore }: GameShellProps): ReactElement {
  const embed: GameEmbed | undefined = GAME_EMBEDS[gameId];
  const Player: ComponentType<GamePlayerProps> | undefined = GAME_PLAYERS[gameId];
  const ceiling = maxScore ?? embed?.maxScore ?? 0;

  const [round, setRound] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState<{ outcome: GameOutcome; score: number } | null>(null);

  const reportedRef = useRef(false);
  const onFinishRef = useRef(onFinish);

  // Keep the latest callback without making the stable `report` below change
  // identity on every parent render.
  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  // The shared running timer. Cleared on unmount and frozen once the game ends.
  useEffect(() => {
    if (finished) return undefined;
    const handle = window.setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => window.clearInterval(handle);
  }, [finished, round]);

  const report = useCallback(
    (outcome: GameOutcome, score: number) => {
      if (reportedRef.current) return;
      reportedRef.current = true;

      const clamped = Math.max(0, Math.min(Math.round(score), ceiling));
      setFinished({ outcome, score: clamped });
      onFinishRef.current(outcome, clamped);
    },
    [ceiling]
  );

  const restart = useCallback(() => {
    reportedRef.current = false;
    setFinished(null);
    setElapsed(0);
    setRound((prev) => prev + 1);
  }, []);

  if (!embed || !Player) {
    return (
      <section style={SHELL_STYLE} data-testid="game-shell" data-game-id={gameId} data-mode="missing">
        <div
          role="alert"
          style={{
            backgroundColor: PALETTE.redBg,
            border: `1px solid ${PALETTE.redBorder}`,
            color: PALETTE.red,
            borderRadius: '14px',
            padding: '14px 16px',
            fontSize: '13px',
          }}
        >
          There is no playable game registered for “{gameId}” in this build. Pick another game from the
          Game Zone.
        </div>
      </section>
    );
  }

  const surface = (() => {
    switch (embed.mode) {
      case 'canvas':
        return (
          <CanvasSurface key={round} embed={embed}>
            <Player onFinish={report} />
          </CanvasSurface>
        );
      case 'iframe':
        return (
          <SandboxSurface key={round} embed={embed}>
            <Player onFinish={report} />
          </SandboxSurface>
        );
      default:
        return (
          <div key={round}>
            <Player onFinish={report} />
          </div>
        );
    }
  })();

  return (
    <section
      style={SHELL_STYLE}
      data-testid="game-shell"
      data-game-id={gameId}
      data-mode={embed.mode}
      data-max-score={ceiling}
      aria-label={`${title ?? embed.title} game`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>{title ?? embed.title}</h2>
          {subtitle ? (
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: PALETTE.muted }}>{subtitle}</p>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            role="timer"
            data-testid="game-timer"
            style={{
              fontVariantNumeric: 'tabular-nums',
              fontSize: '14px',
              fontWeight: 800,
              color: PALETTE.gold,
              backgroundColor: PALETTE.surface,
              border: `1px solid ${PALETTE.border}`,
              borderRadius: '20px',
              padding: '6px 12px',
            }}
          >
            {formatClock(elapsed)}
          </span>
          <button
            type="button"
            onClick={restart}
            data-testid="game-restart"
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              border: `1px solid ${PALETTE.raised}`,
              backgroundColor: 'transparent',
              color: PALETTE.text,
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Restart
          </button>
        </div>
      </div>

      {finished ? (
        <p
          role="status"
          data-testid="game-outcome"
          style={{ ...BANNER_TONES[finished.outcome], borderRadius: '14px', padding: '12px 16px', margin: 0, fontSize: '14px', fontWeight: 800 }}
        >
          {outcomeMessage(finished.outcome, finished.score)}
        </p>
      ) : null}

      <GameRoundProvider value={round}>{surface}</GameRoundProvider>
    </section>
  );
}
