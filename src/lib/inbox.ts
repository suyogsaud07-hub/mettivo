import { supabase } from '@/lib/supabase';

/**
 * Inbox projection, client side.
 *
 * `conversation_summaries()` decides request/archive/online state in
 * PostgreSQL. This module narrows its rows rather than casting, and never
 * derives a request from what the browser claims — a reply moves a thread out
 * of Requests only when the database has seen it.
 */

export interface InboxConversation {
  matchId: string;
  otherUserId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageIsMine: boolean;
  unreadCount: number;
  isArchived: boolean;
  isRequest: boolean;
  isOnline: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

function parseConversation(row: unknown): InboxConversation | null {
  if (!isRecord(row)) return null;
  const matchId = str(row.match_id);
  const otherUserId = str(row.other_user_id);
  if (!matchId || !otherUserId) return null;

  const displayName =
    str(row.other_display_name)?.trim() || str(row.other_username) || 'Member';

  return {
    matchId,
    otherUserId,
    displayName,
    username: str(row.other_username),
    avatarUrl: str(row.other_avatar_url),
    lastMessage: str(row.last_message),
    lastMessageAt: str(row.last_message_at),
    lastMessageIsMine: bool(row.last_message_is_mine),
    unreadCount: Math.max(0, Math.round(numberValue(row.unread_count))),
    isArchived: bool(row.is_archived),
    isRequest: bool(row.is_request),
    isOnline: bool(row.is_online),
  };
}

/** Every conversation for the signed-in member, newest activity first. */
export async function fetchInbox(): Promise<InboxConversation[]> {
  const { data, error } = await supabase.rpc('conversation_summaries');

  if (error) {
    console.error('[inbox] conversation_summaries failed:', error.message);
    throw new Error('Your conversations could not be loaded.');
  }

  return (Array.isArray(data) ? data : [])
    .map(parseConversation)
    .filter((row): row is InboxConversation => row !== null);
}

/**
 * Archives or restores one conversation for the caller only.
 *
 * The RPC checks participation server-side, so passing another member's match
 * id cannot archive their thread.
 */
export async function setConversationArchived(
  matchId: string,
  archived: boolean
): Promise<void> {
  if (!matchId) throw new Error('A conversation is required.');

  const { error } = await supabase.rpc('set_conversation_archived', {
    p_match_id: matchId,
    p_archived: archived,
  });

  if (error) {
    console.error('[inbox] set_conversation_archived failed:', error.message);
    throw new Error('That conversation could not be updated.');
  }
}
