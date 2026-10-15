import { supabase } from '@/lib/supabase';

/**
 * Result of a like/pass decision, as returned by the `record_like` database
 * function (see supabase/migrations/20261015130000_m10_likes_and_mutual_matching.sql).
 */
export interface RecordLikeResult {
  /** The decision was persisted. */
  liked: boolean;
  /** True only when this decision made the interest mutual. */
  matched: boolean;
  /** The match row id when `matched` is true, otherwise null. */
  match_id: string | null;
  /** The other member's id when `matched` is true, otherwise null. */
  matched_user_id: string | null;
}

/** Raised for any expected failure while recording a decision. */
export class LikeError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'LikeError';
    this.code = code;
  }
}

/**
 * Validates the RPC payload at the boundary. The database is trusted, but the
 * response is still narrowed rather than cast, so a schema drift surfaces as a
 * clear error instead of `undefined` reaching the UI.
 */
function parseRecordLikeResult(value: unknown): RecordLikeResult | null {
  if (typeof value !== 'object' || value === null) return null;

  const raw = value as Record<string, unknown>;
  if (typeof raw.liked !== 'boolean' || typeof raw.matched !== 'boolean') return null;

  return {
    liked: raw.liked,
    matched: raw.matched,
    match_id: typeof raw.match_id === 'string' ? raw.match_id : null,
    matched_user_id: typeof raw.matched_user_id === 'string' ? raw.matched_user_id : null,
  };
}

/**
 * Records a like or a pass for `targetUserId`, creating a match when the
 * interest is mutual.
 *
 * All the logic lives in one SECURITY DEFINER transaction server-side, so two
 * people liking each other simultaneously still produce exactly one match and
 * clients cannot forge a match directly.
 */
export async function recordLike(
  targetUserId: string,
  isLike = true
): Promise<RecordLikeResult> {
  if (!targetUserId) {
    throw new LikeError('A target user is required.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new LikeError('You must be signed in to do that.', '28000');
  }

  if (user.id === targetUserId) {
    throw new LikeError('You cannot like yourself.');
  }

  const { data, error } = await supabase.rpc('record_like', {
    target_user: targetUserId,
    is_like_value: isLike,
  });

  if (error) {
    console.error('[likes] record_like failed:', error.message);
    throw new LikeError(error.message, error.code);
  }

  const result = parseRecordLikeResult(data);
  if (!result) {
    console.error('[likes] unexpected record_like payload:', data);
    throw new LikeError('Unexpected response from the matching service.');
  }

  return result;
}
