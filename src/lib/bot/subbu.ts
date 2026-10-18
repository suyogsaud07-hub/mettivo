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

export interface BotTurn {
  role: BotRole;
  content: string | null;
  imageUrl?: string; // For "Mettivo Clicks"
  tool_calls?: any[];
  tool_call_id?: string;
}

const MAX_RESPONSE_BYTES = 32_768;
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
): Promise<{ reply: string | null; tool_calls?: any[]; model: string }> {
  const env = deps.env ?? readBotEnv();
  if (!env.apiKey) throw new BotError('not_configured', 'Subbu is not configured.');
  if (history.length === 0) throw new BotError('invalid_request', 'There is no message to reply to.');

  const fetchImpl = deps.fetchImpl ?? fetch;

  // Format messages for the API (handling images)
  const formattedMessages = history.map((turn) => {
    if (turn.role === 'tool') {
      return { role: 'tool', content: turn.content, tool_call_id: turn.tool_call_id };
    }
    if (turn.imageUrl) {
      return {
        role: turn.role,
        content: [
          { type: 'text', text: turn.content || 'Look at this Mettivo Click!' },
          { type: 'image_url', image_url: { url: turn.imageUrl } }
        ]
      };
    }
    return { role: turn.role, content: turn.content };
  });

  const body = {
    model: env.botModel,
    temperature: 0.7, // Slightly higher for flirty/creative responses
    max_tokens: 512,
    messages: [
      { role: 'system', content: SUBBU_SYSTEM_PROMPT },
      ...formattedMessages,
    ],
    tools: SUBBU_TOOLS,
    tool_choice: 'auto',
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
    const errText = await response.text().catch(() => '');
    console.error(`[Subbu] API Error: ${response.status}`, errText);
    throw new BotError('upstream_error', 'Subbu is unavailable right now.');
  }

  const text = await response.text();
  const payload = JSON.parse(text);
  const message = payload.choices?.[0]?.message;

  if (!message) throw new BotError('empty_result', 'Subbu did not have an answer.');

  // Handle Tool Calls (Banning users)
  if (message.tool_calls && message.tool_calls.length > 0) {
    return { reply: null, tool_calls: message.tool_calls, model: env.botModel };
  }

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content.length === 0) throw new BotError('empty_result', 'Subbu did not have an answer.');

  return { reply: content, model: env.botModel };
}