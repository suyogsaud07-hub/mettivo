'use client';

import { createContext, useContext, type RefObject } from 'react';
import type { GameOutcome } from '@/lib/types';

/**
 * The embedded-surface contracts of the Game Shell.
 *
 * `engine.tsx` owns the chrome (timer, restart, outcome banner) and builds one
 * of three surfaces: a plain React component, an HTML5 `<canvas>`, or a
 * sandboxed `<iframe>`. The surface element is created by the shell — not by the
 * game — so that `sandbox`, sizing and pointer plumbing are decided in one
 * place. A canvas or iframe game reads its surface through the hooks below.
 *
 * This module deliberately imports nothing from `engine.tsx`, so
 * `engine.tsx -> games -> surface.tsx` is a straight line, never a cycle.
 */

export type { GameOutcome };

/** The only prop any registered game receives. */
export interface GamePlayerProps {
  /**
   * Call exactly once, when the game ends. `engine.tsx` clamps the score to the
   * game's `game_catalog.max_score` before it reaches the caller, and ignores
   * every call after the first for the same round.
   */
  onFinish: (outcome: GameOutcome, score: number) => void;
}

/* -------------------------------------------------------------------------- */
/* Canvas surface                                                             */
/* -------------------------------------------------------------------------- */

export interface CanvasPoint {
  /** CSS pixels from the canvas' top-left corner. */
  x: number;
  y: number;
  /**
   * The canvas' rendered size in CSS pixels. Carried on the point so a game can
   * map a tap to a grid cell without reaching into the ref, which would defeat
   * the renderer's memoization of its own handlers.
   */
  width: number;
  height: number;
}

export interface CanvasHandle {
  /** The live `<canvas>`; populated before any effect inside a player runs. */
  ref: RefObject<HTMLCanvasElement | null>;
  /**
   * Subscribe to pointer picks. The handler receives canvas-relative CSS pixel
   * coordinates. Returns an unsubscribe function (safe as an effect cleanup).
   */
  onPick: (handler: (point: CanvasPoint) => void) => () => void;
}

const CanvasHandleContext = createContext<CanvasHandle | null>(null);

/** The canvas surface, or `null` when the game is rendered outside the shell. */
export function useCanvas(): CanvasHandle | null {
  return useContext(CanvasHandleContext);
}

export const CanvasHandleProvider = CanvasHandleContext.Provider;

/**
 * Sizes the backing store for the device pixel ratio and clears the surface.
 * Must be called from an effect or a paint callback — never during render, which
 * is what keeps the server and browser markup identical (CODING_STANDARDS §2).
 *
 * Afterwards the context draws in CSS pixels, the same coordinates
 * `CanvasPoint` reports.
 */
export function prepareCanvasSurface(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const targetWidth = Math.round(width * ratio);
  const targetHeight = Math.round(height * ratio);

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  const context = canvas.getContext('2d');
  if (!context) return null;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/* -------------------------------------------------------------------------- */
/* Sandboxed iframe surface                                                   */
/* -------------------------------------------------------------------------- */

export interface SandboxHandle {
  /** Send a structured-cloneable message into the sandboxed document. */
  post: (message: unknown) => void;
  /**
   * Subscribe to messages that arrived from *this* document's window. Returns
   * an unsubscribe function. Messages from anywhere else are dropped.
   */
  onMessage: (handler: (data: unknown) => void) => () => void;
}

const SandboxHandleContext = createContext<SandboxHandle | null>(null);

/** The sandboxed document handle, or `null` outside the shell. */
export function useSandbox(): SandboxHandle | null {
  return useContext(SandboxHandleContext);
}

export const SandboxHandleProvider = SandboxHandleContext.Provider;

/* -------------------------------------------------------------------------- */
/* Round                                                                      */
/* -------------------------------------------------------------------------- */

const GameRoundContext = createContext(0);

/**
 * The current round number: 0 on the first game, incremented by every restart.
 *
 * It is stable for the lifetime of a mount, so seeding a board or deck with it
 * during render is deterministic and hydration-safe, while a restart still deals
 * a different round.
 */
export function useGameRound(): number {
  return useContext(GameRoundContext);
}

export const GameRoundProvider = GameRoundContext.Provider;
