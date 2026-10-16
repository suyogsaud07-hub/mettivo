import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ChatMediaRow } from '@/lib/types';
import { MediaError, prepareMedia, type PreparedMedia } from '@/lib/media';

/**
 * Disappearing / two-view chat media, client side.
 *
 * WHY THE BYTES GO TO STORAGE, NOT THE DATABASE
 *   A chat photo or clip is both too big for a row and too sensitive to leave
 *   in one. The bytes live in the private `chat-media` bucket; a `chat_media`
 *   row is the ledger that says who may read them, how many views remain, and
 *   when they expire. This module never decides any of that — the bucket policy
 *   and `redeem_chat_media()` do. It only prepares, uploads, asks for
 *   permission, and fetches.
 *
 * THE TWO-VIEW FLOW (M26)
 *   1. `redeemChatMedia(id)` runs server-side and, for the recipient, increments
 *      `view_count` and returns the storage path.
 *   2. The recipient downloads within a short grace window the bucket policy
 *      allows AFTER the increment. The second open exhausts the item.
 *   3. Once `view_count >= view_limit` the item reads as gone and is hidden from
 *      the thread — as if it never existed.
 */

/** The private Storage bucket the M25 migration creates. */
export const CHAT_MEDIA_BUCKET = 'chat-media';

/** Every chat item is a strict 2-view (M26). */
export const CHAT_MEDIA_VIEW_LIMIT = 2;

/** Raised for an expected media failure (bad file, upload/redeem failure). */
export class ChatMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatMediaError';
  }
}

/** The ledger rows for one conversation, keyed by the message they belong to. */
export type ChatMediaByMessage = Record<string, ChatMediaRow>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Loads every live media ledger row for a conversation, keyed by message id. */
export async function fetchChatMedia(matchId: string): Promise<ChatMediaByMessage> {
  const { data, error } = await supabase
    .from('chat_media')
    .select(
      'id, message_id, match_id, sender_id, storage_path, media_type, view_once, view_limit, view_count, expires_at, viewed_at, created_at'
    )
    .eq('match_id', matchId);

  if (error) {
    console.warn('[chatMedia] ledger load failed:', error.message);
    return {};
  }

  const map: ChatMediaByMessage = {};
  for (const row of (data ?? []) as ChatMediaRow[]) {
    map[row.message_id] = row;
  }
  return map;
}

/**
 * Uploads a picked file and sends it as a media message.
 *
 * The `messages` row and the `chat_media` ledger row are written by
 * `send_chat_media()` in one transaction. If that call fails the orphaned
 * object is removed, so a refused send never leaves bytes behind.
 */
export async function sendChatMedia(
  matchId: string,
  senderId: string,
  file: File,
  options: { viewLimit?: number; ttlSeconds?: number } = {}
): Promise<{ mediaId: string; messageId: string; media: PreparedMedia; viewLimit: number }> {
  let prepared: PreparedMedia;
  try {
    prepared = await prepareMedia(file);
  } catch (err) {
    throw err instanceof MediaError ? new ChatMediaError(err.message) : err;
  }

  const extension = extensionFor(prepared);
  const path = `${matchId}/${senderId}/${crypto.randomUUID()}.${extension}`;
  const contentType = prepared.blob.type || (prepared.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

  const { error: uploadError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, prepared.blob, { contentType, upsert: false, cacheControl: '3600' });

  if (uploadError) {
    URL.revokeObjectURL(prepared.previewUrl);
    console.error('[chatMedia] upload failed:', uploadError.message);
    throw new ChatMediaError('The media could not be uploaded. Please try again.');
  }

  const viewLimit = options.viewLimit ?? CHAT_MEDIA_VIEW_LIMIT;
  const { data, error } = await supabase.rpc('send_chat_media', {
    p_match_id: matchId,
    p_storage_path: path,
    p_media_type: prepared.mediaType,
    p_view_limit: viewLimit,
    p_ttl_seconds: options.ttlSeconds ?? 86400,
  });

  if (error || !isRecord(data)) {
    // Roll back the object so a failed send leaves nothing behind.
    await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([path]);
    URL.revokeObjectURL(prepared.previewUrl);
    console.error('[chatMedia] send failed:', error?.message ?? 'unexpected response');
    throw new ChatMediaError('The media could not be sent.');
  }

  return {
    mediaId: readString(data, 'media_id'),
    messageId: readString(data, 'message_id'),
    media: prepared,
    viewLimit: readNumber(data, 'view_limit', viewLimit),
  };
}

export interface RedeemedMedia {
  url: string;
  mediaType: ChatMediaRow['media_type'];
  /** Views the recipient has left after this open. */
  remaining: number;
}

/**
 * Asks the database to count one view of an item and returns an object URL for
 * the bytes, or `null` when it has expired or been exhausted.
 *
 * The caller must revoke the URL with `releaseChatMedia` when done.
 */
export async function redeemChatMedia(mediaId: string): Promise<RedeemedMedia | null> {
  const { data, error } = await supabase.rpc('redeem_chat_media', { p_media_id: mediaId });

  if (error) {
    console.error('[chatMedia] redeem failed:', error.message);
    throw new ChatMediaError('This media is no longer available.');
  }
  if (!isRecord(data) || !readBoolean(data, 'available')) {
    return null;
  }

  const path = readString(data, 'storage_path');
  const mediaType: ChatMediaRow['media_type'] =
    readString(data, 'media_type') === 'video' ? 'video' : 'image';

  const { data: blob, error: downloadError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .download(path);

  if (downloadError || !blob) {
    console.error('[chatMedia] download failed:', downloadError?.message ?? 'empty blob');
    throw new ChatMediaError('This media is no longer available.');
  }

  return {
    url: URL.createObjectURL(blob),
    mediaType,
    remaining: readNumber(data, 'remaining', 0),
  };
}

/** Revokes an object URL handed out by `redeemChatMedia`. */
export function releaseChatMedia(url: string | null): void {
  if (url) URL.revokeObjectURL(url);
}

/** True when a ledger row is past its expiry and should read as gone. */
export function isExpired(row: ChatMediaRow, now: number = Date.now()): boolean {
  const end = new Date(row.expires_at).getTime();
  return Number.isFinite(end) && end <= now;
}

/** True when the recipient has used up every allowed view (M26). */
export function isExhausted(row: ChatMediaRow): boolean {
  return row.view_count >= row.view_limit;
}

/** True when the item must be hidden from the thread entirely. */
export function isGone(row: ChatMediaRow, now: number = Date.now()): boolean {
  return isExpired(row, now) || isExhausted(row);
}

/** Views remaining before an item disappears. */
export function viewsRemaining(row: ChatMediaRow): number {
  return Math.max(row.view_limit - row.view_count, 0);
}

/**
 * Subscribes to ledger changes for one conversation, so an item that the
 * recipient exhausts vanishes on the sender's screen too.
 *
 * Returns an unsubscribe function; callers MUST call it on unmount.
 */
export function subscribeToChatMedia(
  matchId: string,
  onChange: () => void
): () => void {
  if (!matchId) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`chat-media:${matchId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'chat_media', filter: `match_id=eq.${matchId}` },
      () => onChange()
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

function extensionFor(media: PreparedMedia): string {
  if (media.mediaType === 'video') {
    if (media.blob.type === 'video/webm') return 'webm';
    if (media.blob.type === 'video/quicktime') return 'mov';
    return 'mp4';
  }
  if (media.blob.type === 'image/webp') return 'webp';
  if (media.blob.type === 'image/png') return 'png';
  return 'jpg';
}
