import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * M11 — one-to-one messaging, client side.
 *
 * The security boundary is in PostgreSQL
 * (`supabase/migrations/20261015230000_m11_messaging.sql`): only conversation
 * participants can read a thread, only a participant can write to it, and the
 * badge is computed server-side so it cannot drift from the data.
 *
 * This module owns the boundary on the way in and out: it narrows every row
 * rather than casting, and it turns `{ error }` into a thrown, user-safe
 * `MessageError` so a failed send can never look like a successful one.
 */

export class MessageError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'MessageError';
    this.code = code;
  }
}

export interface MessageRecord {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

/** Maximum length of a single message. Mirrors the UI's `maxLength`. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Default page size when opening a thread. */
export const MESSAGE_PAGE_SIZE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Narrows one `messages` row; `null` rather than a cast. */
function parseMessage(row: unknown): MessageRecord | null {
  if (!isRecord(row)) return null;
  const id = str(row.id);
  const matchId = str(row.match_id);
  const senderId = str(row.sender_id);
  const createdAt = str(row.created_at);
  if (!id || !matchId || !senderId) return null;

  return {
    id,
    matchId,
    senderId,
    content: str(row.content) ?? '',
    createdAt: createdAt ?? '',
  };
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new MessageError('You must be signed in to do that.', '28000');
  }
  return user.id;
}

/**
 * The most recent messages in a thread, returned oldest-first so the caller can
 * render them directly.
 *
 * Throws rather than returning `[]` on error: an empty thread and a failed load
 * look identical to a member, and only one of them is true.
 */
export async function fetchMessages(
  matchId: string,
  limit = MESSAGE_PAGE_SIZE
): Promise<MessageRecord[]> {
  if (!matchId) {
    throw new MessageError('A conversation is required.');
  }

  const { data, error } = await supabase
    .from('messages')
    .select('id, match_id, sender_id, content, created_at')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 500)));

  if (error) {
    console.error('[messages] fetch failed:', error.message);
    throw new MessageError('We could not load this conversation.', error.code);
  }

  return (data ?? [])
    .map(parseMessage)
    .filter((row): row is MessageRecord => row !== null)
    .reverse();
}

/**
 * Sends a message. The sender is taken from the session, never from a caller
 * argument, so a component cannot accidentally attribute a message to someone
 * else (`CONSTITUTION.md` Article 1.2).
 */
export async function sendMessage(matchId: string, content: string): Promise<MessageRecord> {
  if (!matchId) {
    throw new MessageError('A conversation is required.');
  }

  const body = content.trim();
  if (!body) {
    throw new MessageError('Type a message first.');
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new MessageError(`Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const senderId = await requireUserId();

  const { data, error } = await supabase
    .from('messages')
    .insert({ match_id: matchId, sender_id: senderId, content: body })
    .select('id, match_id, sender_id, content, created_at')
    .single();

  if (error) {
    console.error('[messages] send failed:', error.message);
    // A block surfaces as a raised 42501 from the database trigger; give the
    // member that message rather than a generic failure.
    const message =
      error.code === '42501'
        ? error.message
        : 'Your message could not be sent. Please try again.';
    throw new MessageError(message, error.code);
  }

  const parsed = parseMessage(data);
  if (!parsed) {
    throw new MessageError('Your message was sent, but its response was unreadable.');
  }
  return parsed;
}

/**
 * Subscribes to inserts in one thread.
 *
 * Returns an unsubscribe function. Callers MUST call it on unmount: a leaked
 * channel keeps a websocket open and applies state updates to a dead component.
 */
export function subscribeToMessages(
  matchId: string,
  onMessage: (message: MessageRecord) => void,
  onStatus?: (status: string) => void
): () => void {
  if (!matchId) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`chat:${matchId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
      (payload) => {
        const parsed = parseMessage(payload.new);
        if (parsed) onMessage(parsed);
      }
    )
    .subscribe((status) => onStatus?.(status));

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Marks a conversation read up to the server's clock. */
export async function markConversationRead(matchId: string): Promise<void> {
  if (!matchId) return;
  await requireUserId();

  const { error } = await supabase.rpc('mark_conversation_read', { p_match_id: matchId });

  if (error) {
    // Non-fatal: the badge simply stays until the next successful call.
    console.error('[messages] mark_conversation_read failed:', error.message);
  }
}

/**
 * Unread count per conversation, computed by the database.
 *
 * Returns a plain object keyed by match id so the chat list can look up a badge
 * without scanning an array per row.
 */
export async function fetchUnreadCounts(): Promise<Record<string, number>> {
  await requireUserId();

  const { data, error } = await supabase.rpc('unread_counts');

  if (error) {
    console.error('[messages] unread_counts failed:', error.message);
    // A missing badge is better than a broken chat list.
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of Array.isArray(data) ? data : []) {
    if (!isRecord(row)) continue;
    const matchId = str(row.match_id);
    const unread = row.unread;
    if (!matchId || typeof unread !== 'number' || !Number.isFinite(unread)) continue;
    counts[matchId] = unread;
  }
  return counts;
}
