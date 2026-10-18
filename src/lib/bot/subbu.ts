import { readAiEnv, type AiEnv } from '@/lib/moderation/ai';
import {
  DEFAULT_BOT_MODEL,
  MAX_HISTORY_TURNS,
  MAX_TURN_CHARS,
  SUBBU_SYSTEM_PROMPT,
  SUBBU_TOOLS,
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
  if (!env.apiKey) throw new BotError('not_configured', 'Subbu is not configured.');
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
  // the same split `classifyContent` makes. The vision model is not asked to
  // drive the ban tool, so the tool schema is only attached to text turns.
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
    ...(hasImage ? {} : { tools: SUBBU_TOOLS, tool_choice: 'auto' as const }),
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
    throw new BotError('upstream_error', `Subbu did not answer in time: ${message}`);
  }

  if (!response.ok) {
    // A 400/401/429 here is a payload/key/throttle problem, not an outage. Keep
    // the provider's own words in the message so the client's `details` is useful.
    const errText = await response.text().catch(() => '');
    console.error('[SUBBU CHAT ERROR]', `HTTP ${response.status}`, errText.slice(0, 500));
    const detail = errText.trim().slice(0, 200);
    throw new BotError(
      'upstream_error',
      `Subbu is unavailable right now (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[SUBBU CHAT ERROR]', message, stack);
    throw new BotError('upstream_error', `Subbu returned an unreadable response: ${message}`);
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    console.error(
      `[SUBBU CHAT ERROR] response was ${text.length} bytes (cap ${MAX_RESPONSE_BYTES})`
    );
    throw new BotError('upstream_error', 'Subbu returned an oversized response.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[SUBBU CHAT ERROR]', message, stack);
    throw new BotError('upstream_error', `Subbu returned an unreadable response: ${message}`);
  }
  const message = isRecord(payload) ? (payload.choices as unknown[] | undefined)?.[0] : undefined;
  const assistantMessage = isRecord(message) ? message.message : undefined;

  if (!isRecord(assistantMessage)) {
    throw new BotError('empty_result', 'Subbu did not have an answer.');
  }

  // Handle Tool Calls (Banning users)
  const toolCalls = assistantMessage.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return { reply: null, tool_calls: toolCalls as SubbuToolCall[], model };
  }

  const content = typeof assistantMessage.content === 'string' ? assistantMessage.content.trim() : '';
  if (content.length === 0) throw new BotError('empty_result', 'Subbu did not have an answer.');

  return { reply: content, model };
}