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

/**
 * Likes another member's profile.
 *
 * Delegates to the existing `record_like` RPC, so the `likes` unique pair,
 * the no-self-like CHECK and the blocked-pair rejection all still apply. Liking
 * twice is idempotent: the same row is updated, never duplicated.
 */
export async function likeProfile(targetUserId: string): Promise<RecordLikeResult> {
  return recordLike(targetUserId, true);
}

/**
 * Removes the caller's like from another member's profile.
 *
 * Deleting the row (rather than writing `is_like = false`) is the honest
 * "unlike": the `likes_sync_profile_counts` trigger decrements the target's
 * `profile_likes_count`, and the member is no longer recorded as having liked
 * the profile. A pass recorded elsewhere in the product is left untouched.
 */
export async function unlikeProfile(targetUserId: string): Promise<void> {
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

  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('liker_id', user.id)
    .eq('liked_id', targetUserId)
    .eq('is_like', true);

  if (error) {
    console.error('[likes] unlike failed:', error.message);
    throw new LikeError(error.message, error.code);
  }
}

/**
 * Whether the signed-in member currently has an ACTIVE like on `targetUserId`.
 *
 * A pass (`is_like = false`) is not a like. Reads are permitted by
 * `likes_select_involved` (the caller is the liker). A read failure degrades to
 * `false`, matching `isFollowing`, so a transient error cannot show a false
 * "Liked" state.
 */
export async function isProfileLiked(targetUserId: string): Promise<boolean> {
  if (!targetUserId) return false;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id === targetUserId) return false;

  const { data, error } = await supabase
    .from('likes')
    .select('id')
    .eq('liker_id', user.id)
    .eq('liked_id', targetUserId)
    .eq('is_like', true)
    .maybeSingle();

  if (error) {
    console.error('[likes] isProfileLiked failed:', error.message);
    return false;
  }

  return Boolean(data);
}
