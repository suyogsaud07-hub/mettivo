import { supabase } from '@/lib/supabase';

/**
 * M42 — message reactions, client side.
 *
 * Reactions live in `public.message_reactions`, RLS-scoped so conversation
 * participants can read them and only the reacting member can write/delete
 * their own. One row per (message, user, emoji).
 */

export interface MessageReaction {
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseReaction(row: unknown): MessageReaction | null {
  if (!isRecord(row)) return null;
  const messageId = str(row.message_id);
  const userId = str(row.user_id);
  const emoji = str(row.emoji);
  const createdAt = str(row.created_at);
  if (!messageId || !userId || !emoji || !createdAt) return null;
  return { messageId, userId, emoji, createdAt };
}

/** Fetch every reaction on the given messages, keyed by message id. */
export async function fetchMessageReactions(
  messageIds: readonly string[]
): Promise<Map<string, MessageReaction[]>> {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji, created_at')
    .in('message_id', ids)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[reactions] fetch failed:', error.message);
    return new Map();
  }

  const map = new Map<string, MessageReaction[]>();
  for (const row of (data ?? []).map(parseReaction).filter((r): r is MessageReaction => r !== null)) {
    const bucket = map.get(row.messageId) ?? [];
    bucket.push(row);
    map.set(row.messageId, bucket);
  }
  return map;
}

/** Add or move a reaction. Upserts on (message_id, user_id, emoji). */
export async function addMessageReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  if (!messageId || !emoji) throw new Error('Message and emoji are required.');

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error('[reactions] authentication failed:', authError.message);
    throw new Error('We could not verify your account.');
  }
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('message_reactions')
    .upsert(
      { message_id: messageId, user_id: user.id, emoji },
      { onConflict: 'message_id,user_id,emoji' }
    );

  if (error) {
    console.error('[reactions] add failed:', error.message);
    throw new Error('We could not add that reaction.');
  }
}

/** Remove the signed-in member's reaction to a message. */
export async function removeMessageReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  if (!messageId || !emoji) throw new Error('Message and emoji are required.');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', user.id)
    .eq('emoji', emoji);

  if (error) {
    console.error('[reactions] remove failed:', error.message);
    throw new Error('We could not remove that reaction.');
  }
}

/** Subscribe to reaction inserts/deletes for one thread. */
export function subscribeToMessageReactions(
  matchId: string,
  messageId: string,
  onChange: (reactions: MessageReaction[]) => void
): () => void {
  if (!matchId || !messageId) return () => {};

  // All postgres_changes callbacks MUST be registered before subscribe().
  // Calling .on() after .subscribe() raises a Realtime error on the server.
  // Use unique channel name per message to avoid duplicate channel creation.
  const channel = supabase.channel(`reactions:${matchId}:${messageId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'message_reactions',
        filter: `message_id=eq.${messageId}`,
      },
      () => onChange([])
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'message_reactions',
        filter: `message_id=eq.${messageId}`,
      },
      () => onChange([])
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
