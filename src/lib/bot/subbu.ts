/**
 * M27 — the "Subbu" in-app AI companion.
 *
 * SERVER ONLY. Like `src/lib/moderation/ai.ts`, this reads its credentials
 * through the injected-source pattern so no literal environment-variable member
 * read is needed inside a module that could be bundled for the browser (see the
 * secrets scan in `tests/security/security.test.ts`). It is imported by the
 * `/api/bot/chat` route handler and its unit test, and by nothing in the UI.
 *
 * NO DATABASE, NO RLS SURFACE
 *   Subbu is a stateless chat completion: the conversation lives in the member's
 *   browser (local state) and is replayed on each request, so this feature adds
 *   no table and therefore no new authorisation boundary. The one rule that
 *   still applies is Article 1.5 — the model key never leaves the server.
 *
 * PROVIDER SHAPE
 *   An OpenAI-compatible `/chat/completions` endpoint, so the same code works
 *   against OpenAI, Groq, Azure-style gateways, or a local model. `fetchImpl` is
 *   injectable so every branch is unit-testable offline.
 */

import { readAiEnv, type AiEnv } from '@/lib/moderation/ai';
import {
  DEFAULT_BOT_MODEL,
  MAX_HISTORY_TURNS,
  MAX_TURN_CHARS,
  SUBBU_SYSTEM_PROMPT,
} from '@/lib/bot/constants';

export interface BotEnv extends AiEnv {
  botModel: string;
}

export function readBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  const base = readAiEnv(source);
  const botModel = (source['AI_BOT_MODEL'] ?? '').trim() || DEFAULT_BOT_MODEL;
  return { ...base, botModel };
}

/** The roles a replayed conversation turn may carry. */
export type BotRole = 'user' | 'assistant';

export interface BotTurn {
  role: BotRole;
  content: string;
}

const MAX_RESPONSE_BYTES = 32_768;
const UPSTREAM_TIMEOUT_MS = 30_000;

export type BotErrorCode = 'invalid_request' | 'not_configured' | 'upstream_error' | 'empty_result';

/** A typed failure the route maps onto an HTTP status and a user-safe message. */
export class BotError extends Error {
  readonly code: BotErrorCode;

  constructor(code: BotErrorCode, message: string) {
    super(message);
    this.name = 'BotError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses and clamps the client-supplied history.
 *
 * Unknown roles are dropped (an injected `system` turn cannot hijack the
 * prompt), empty turns are dropped, and only the trailing `MAX_HISTORY_TURNS`
 * survive. Throws `BotError('invalid_request')` when nothing usable remains, so
 * the route can answer 400 instead of paying for an empty provider call.
 */
export function normaliseHistory(raw: unknown): BotTurn[] {
  if (!Array.isArray(raw)) throw new BotError('invalid_request', 'No conversation was supplied.');

  const turns: BotTurn[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const role = item.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = item.content;
    if (typeof content !== 'string') continue;
    const trimmed = content.trim().slice(0, MAX_TURN_CHARS);
    if (trimmed.length === 0) continue;
    turns.push({ role, content: trimmed });
  }

  const recent = turns.slice(-MAX_HISTORY_TURNS);
  if (recent.length === 0) {
    throw new BotError('invalid_request', 'There is no message to reply to.');
  }
  return recent;
}

/** Runs one fetch under a timeout budget. The timer is always cleared. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ChatDeps {
  fetchImpl?: typeof fetch;
  env?: BotEnv;
}

/**
 * Sends the replayed conversation to Subbu and returns the assistant reply.
 *
 * Throws `BotError` for every failure mode so the route never has to guess:
 * `not_configured` (503), `upstream_error` (502), `empty_result` (502). A
 * missing key is a hard failure rather than a silent fallback — a companion
 * that cannot answer should say so, not pretend.
 */
export async function chatWithSubbu(
  history: BotTurn[],
  deps: ChatDeps = {}
): Promise<{ reply: string; model: string }> {
  const env = deps.env ?? readBotEnv();
  if (!env.apiKey) throw new BotError('not_configured', 'Subbu is not configured.');

  if (history.length === 0) {
    throw new BotError('invalid_request', 'There is no message to reply to.');
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  const body = {
    model: env.botModel,
    temperature: 0.6,
    max_tokens: 512,
    messages: [
      { role: 'system', content: SUBBU_SYSTEM_PROMPT },
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    ],
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${env.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BotError('upstream_error', 'Subbu did not answer in time.');
  }

  if (!response.ok) {
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }
  if (!isRecord(payload)) {
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new BotError('empty_result', 'Subbu did not have an answer.');
  }
  const first = choices[0];
  if (!isRecord(first)) throw new BotError('empty_result', 'Subbu did not have an answer.');
  const message = first.message;
  if (!isRecord(message)) throw new BotError('empty_result', 'Subbu did not have an answer.');

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content.length === 0) {
    throw new BotError('empty_result', 'Subbu did not have an answer.');
  }

  return { reply: content, model: env.botModel };
}
