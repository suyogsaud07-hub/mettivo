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

export type BotRole = 'user' | 'assistant' | 'tool';

/** One tool invocation the model returned (Groq / OpenAI shape). */
export interface SubbuToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface BotTurn {
  role: BotRole;
  content: string | null;
  imageUrl?: string; // For "Mettivo Clicks"
  tool_calls?: SubbuToolCall[];
  tool_call_id?: string;
}

const MAX_RESPONSE_BYTES = 32_768;
/** Mirrors the moderation scanner: a vision request accepts one compressed image. */
const MAX_IMAGE_URL_CHARS = 700_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

export type BotErrorCode = 'invalid_request' | 'not_configured' | 'upstream_error' | 'empty_result';

/**
 * Why a provider call failed, so the route can answer with a status that means
 * something. Collapsing every failure into a generic 502 tells an operator
 * nothing and tells a member to retry when a retry cannot possibly help.
 *
 *   config     — missing/invalid provider credentials or a rejected request
 *                shape (bad model). A deployment mistake, not an outage.
 *   rate_limit — the provider throttled us (429/quota).
 *   timeout    — the fetch aborted or the network refused (no HTTP response).
 *   provider   — the provider itself failed (5xx).
 *   malformed  — the provider answered with an unreadable/oversized body.
 *   empty      — the provider answered 200 with no usable completion.
 */
export type BotFailureCategory =
  | 'config'
  | 'rate_limit'
  | 'timeout'
  | 'provider'
  | 'malformed'
  | 'empty';

export class BotError extends Error {
  readonly code: BotErrorCode;
  readonly category: BotFailureCategory | null;

  constructor(code: BotErrorCode, message: string, category: BotFailureCategory | null = null) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.category = category;
  }
}

/** Buckets an upstream HTTP status into the failure the route acts on. */
export function classifyHttpFailure(status: number): BotFailureCategory {
  if (status === 401 || status === 403) return 'config';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  // Any other 4xx is the provider rejecting our request (e.g. an unknown model):
  // a configuration problem, not a transient outage.
  return 'config';
}

/** The HTTP answer the chat route should return for a failed Subbu call. */
export interface BotFailure {
  status: number;
  error: string;
  message: string;
}

/**
 * Maps any thrown value from `chatWithSubbu` to a client-facing response.
 *
 * The provider's own error body is deliberately never echoed here: it can carry
 * request details. The full reason is logged server-side by the caller. Client
 * errors keep their status (400/401), a misconfiguration is a 500, a throttled
 * provider is a retryable 503, and only genuine upstream failures are a 502.
 */
export function botFailureFromError(error: unknown): BotFailure {
  if (error instanceof BotError) {
    switch (error.code) {
      case 'invalid_request':
        return { status: 400, error: 'invalid_request', message: error.message };
      case 'not_configured':
        return {
          status: 500,
          error: 'ai_misconfigured',
          message: 'Subbu is not configured correctly.',
        };
      case 'empty_result':
        return {
          status: 502,
          error: 'upstream_error',
          message: 'Subbu is unavailable right now.',
        };
      case 'upstream_error':
        switch (error.category) {
          case 'config':
            return {
              status: 500,
              error: 'ai_misconfigured',
              message: 'Subbu is not configured correctly.',
            };
          case 'rate_limit':
            return {
              status: 503,
              error: 'ai_unavailable',
              message: 'Subbu is busy right now. Please try again shortly.',
            };
          default:
            return {
              status: 502,
              error: 'upstream_error',
              message: 'Subbu is unavailable right now.',
            };
        }
    }
  }
  // An unexpected throw is an internal fault, not a provider outage.
  return { status: 500, error: 'internal_error', message: 'Subbu is unavailable right now.' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normaliseHistory(raw: unknown): BotTurn[] {
  if (!Array.isArray(raw)) throw new BotError('invalid_request', 'No conversation was supplied.');

  const turns: BotTurn[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const role = item.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = item.content;
    const imageUrl = item.imageUrl;
    
    if (typeof content !== 'string' && typeof imageUrl !== 'string') continue;
    const trimmed = typeof content === 'string' ? content.trim().slice(0, MAX_TURN_CHARS) : null;
    
    if ((!trimmed || trimmed.length === 0) && !imageUrl) continue;
    
    turns.push({ role, content: trimmed, imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined });
  }

  const recent = turns.slice(-MAX_HISTORY_TURNS);
  if (recent.length === 0) {
    throw new BotError('invalid_request', 'There is no message to reply to.');
  }
  return recent;
}

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

export async function chatWithSubbu(
  history: BotTurn[],
  deps: ChatDeps = {}
): Promise<{ reply: string | null; tool_calls?: SubbuToolCall[]; model: string }> {
  const env = deps.env ?? readBotEnv();
  if (!env.apiKey) throw new BotError('not_configured', 'Subbu is not configured.', 'config');
  if (history.length === 0) throw new BotError('invalid_request', 'There is no message to reply to.');

  const fetchImpl = deps.fetchImpl ?? fetch;

  // Format messages for the API (handling images and tool calls).
  //
  // The assistant turn that carried `tool_calls` MUST keep them: Groq rejects a
  // `tool` message whose preceding assistant turn has no matching `tool_calls`
  // with a 400. Re-feeding the history after a tool ran is exactly that case.
  const formattedMessages = history.map((turn) => {
    if (turn.role === 'tool') {
      return { role: 'tool', content: turn.content, tool_call_id: turn.tool_call_id };
    }
    if (turn.tool_calls && turn.tool_calls.length > 0) {
      return { role: turn.role, content: turn.content, tool_calls: turn.tool_calls };
    }
    if (turn.imageUrl) {
      return {
        role: turn.role,
        content: [
          { type: 'text', text: turn.content || 'Look at this Mettivo Click!' },
          { type: 'image_url', image_url: { url: turn.imageUrl.slice(0, MAX_IMAGE_URL_CHARS) } }
        ]
      };
    }
    return { role: turn.role, content: turn.content };
  });

  // A text-only bot model (the default, `openai/gpt-oss-120b`) rejects
  // `image_url` parts with a 400, so an image turn must go to the vision model —
  // the same split `classifyContent` makes.
  //
  // There is deliberately no tool schema: moderation is a structured JSON flag
  // in the reply (see `SUBBU_SYSTEM_PROMPT`), which the API parses. A tool can
  // name a target; the JSON flag cannot, which is what keeps a prompt-injected
  // model from banning somebody else.
  const hasImage = history.some((turn) => Boolean(turn.imageUrl));
  const model = hasImage ? env.visionModel : env.botModel;

  const body = {
    model,
    temperature: 0.7, // Slightly higher for flirty/creative responses
    max_tokens: 512,
    messages: [
      { role: 'system', content: SUBBU_SYSTEM_PROMPT },
      ...formattedMessages,
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
  } catch (error) {
    // Transport failure or the 30 s abort. Log the exact error (message + stack)
    // so the raw cause — DNS, TLS, "fetch failed", abort — reaches the logs.
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[SUBBU CHAT ERROR]', message, stack);
    throw new BotError('upstream_error', `Subbu did not answer in time (${message}).`, 'timeout');
  }

  if (!response.ok) {
    // A 400/401/429 here is a payload/key/throttle problem, not an outage. The
    // provider's own body is logged server-side but NOT echoed to the client.
    const errText = await response.text().catch(() => '');
    console.error('[SUBBU CHAT ERROR]', `HTTP ${response.status}`, errText.slice(0, 500));
    throw new BotError(
      'upstream_error',
      `Subbu is unavailable right now (HTTP ${response.status}).`,
      classifyHttpFailure(response.status)
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[SUBBU CHAT ERROR]', message, stack);
    throw new BotError(
      'upstream_error',
      `Subbu returned an unreadable response: ${message}`,
      'malformed'
    );
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    console.error(
      `[SUBBU CHAT ERROR] response was ${text.length} bytes (cap ${MAX_RESPONSE_BYTES})`
    );
    throw new BotError('upstream_error', 'Subbu returned an oversized response.', 'malformed');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[SUBBU CHAT ERROR]', message, stack);
    throw new BotError(
      'upstream_error',
      `Subbu returned an unreadable response: ${message}`,
      'malformed'
    );
  }
  const message = isRecord(payload) ? (payload.choices as unknown[] | undefined)?.[0] : undefined;
  const assistantMessage = isRecord(message) ? message.message : undefined;

  if (!isRecord(assistantMessage)) {
    throw new BotError('empty_result', 'Subbu did not have an answer.', 'empty');
  }

  // Handle Tool Calls (Banning users)
  const toolCalls = assistantMessage.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return { reply: null, tool_calls: toolCalls as SubbuToolCall[], model };
  }

  const content = typeof assistantMessage.content === 'string' ? assistantMessage.content.trim() : '';
  if (content.length === 0) throw new BotError('empty_result', 'Subbu did not have an answer.', 'empty');

  return { reply: content, model };
}