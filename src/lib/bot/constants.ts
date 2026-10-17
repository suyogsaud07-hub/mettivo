/**
 * M27 — shared, browser-safe constants for the Subbu companion.
 *
 * This module holds ONLY plain values: no `process.env`, no provider code, no
 * `fetch`. It is imported by both the client chat screen and the server helper,
 * so it must never pull a server-only dependency into the browser bundle. The
 * provider call and the credential read live in `src/lib/bot/subbu.ts`.
 */

/** The name every surface shows for the companion. */
export const SUBBU_NAME = 'Subbu';

/**
 * The model Subbu answers with.
 *
 * Groq-served open weights: `openai/gpt-oss-120b` is the default because it is
 * fast, cheap and reliable for short conversational turns. Override with
 * `AI_BOT_MODEL` (e.g. `qwen/qwen3-27b`) without touching code.
 */
export const DEFAULT_BOT_MODEL = 'openai/gpt-oss-120b';

/**
 * The instruction that defines Subbu's persona and scope.
 *
 * Kept verbatim from the product brief. It is the only thing that keeps the
 * model on-topic (navigation help, dating advice, casual chat) and away from
 * inventing data it cannot see — Subbu has no access to matches, messages or
 * profile rows, so it must point the member at the real screens.
 */
export const SUBBU_SYSTEM_PROMPT =
  'You are Subbu, the friendly and helpful AI assistant for Mettivo, a luxury ' +
  'dating app. You are cool, empathetic, and speak like a real human (use ' +
  'emojis occasionally). Your job is to: 1) Help users navigate the app ' +
  '(profile setup, verification, matching rules, reporting). 2) Give dating ' +
  'advice. 3) Chat casually if they are bored. Never be creepy. Keep responses ' +
  'concise, friendly, and helpful. If they ask about their matches, tell them ' +
  'to check the Discover feed. If they report a bug, tell them to email support.';

/**
 * Bounds. The browser owns the transcript, so the server cannot trust its size:
 * history is trimmed to the most recent turns and each turn is truncated before
 * it reaches the provider. This is an abuse/token bound, not a product rule —
 * the UI keeps a shorter window anyway.
 */
export const MAX_HISTORY_TURNS = 20;
export const MAX_TURN_CHARS = 2_000;
