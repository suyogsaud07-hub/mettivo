import { supabase } from '@/lib/supabase';

/**
 * M45 — pinned messages, client side.
 *
 * Pins live in `public.pinned_messages`, RLS-scoped so conversation participants
 * can read them and only the pinner can write/delete their own. One pin per
 * (match_id, message_id, user_id).
 */

export interface PinnedMessage {
  matchId: string;
  messageId: string;
  userId: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parsePin(row: unknown): PinnedMessage | null {
  if (!isRecord(row)) return null;
  const matchId = str(row.match_id);
  const messageId = str(row.message_id);
  const userId = str(row.user_id);
  const createdAt = str(row.created_at);
  if (!matchId || !messageId || !userId || !createdAt) return null;
  return { matchId, messageId, userId, createdAt };
}

/** Fetch every pin for the given match, keyed by message id. */
export async function fetchPinnedMessages(matchId: string): Promise<string[]> {
  if (!matchId) return [];

  const { data, error } = await supabase
    .from('pinned_messages')
    .select('message_id')
    .eq('match_id', matchId);

  if (error) {
    console.error('[pins] fetch failed:', error.message);
    return [];
  }

  return ((data ?? []) as { message_id: string }[])
    .map((row) => row.message_id)
    .filter(Boolean);
}

/** Pin a message for the signed-in member. Idempotent. */
export async function pinMessage(matchId: string, messageId: string): Promise<void> {
  if (!matchId || !messageId) throw new Error('Match and message are required.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('pinned_messages')
    .upsert(
      { match_id: matchId, message_id: messageId, user_id: user.id },
      { onConflict: 'match_id,message_id,user_id' }
    );

  if (error) {
    console.error('[pins] pin failed:', error.message);
    throw new Error('We could not pin that message.');
  }
}

/** Unpin a message for the signed-in member. */
export async function unpinMessage(matchId: string, messageId: string): Promise<void> {
  if (!matchId || !messageId) throw new Error('Match and message are required.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('match_id', matchId)
    .eq('message_id', messageId)
    .eq('user_id', user.id);

  if (error) {
    console.error('[pins] unpin failed:', error.message);
    throw new Error('We could not unpin that message.');
  }
}
