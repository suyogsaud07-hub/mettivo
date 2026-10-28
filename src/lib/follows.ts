import { supabase } from '@/lib/supabase';

/**
 * Follow relationships.
 *
 * The `follows` table is the source of truth for "who follows whom". Writes go
 * through RLS: a member may only create and delete the edge where they are the
 * `follower_id` (`follows_insert_own` / `follows_delete_own`, added alongside the
 * denormalised counters in M18). Reads are likewise limited to edges the caller
 * is part of, which is why `isFollowing` only ever asks about the caller's own
 * outgoing edges.
 *
 * Kept separate from `moments.ts` so the Follow button on any surface — the
 * Moments feed, Discover, a member's public profile — shares one implementation
 * and cannot drift.
 */

/** Raised for expected follow/unfollow failures. */
export class FollowError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'FollowError';
    this.code = code;
  }
}

/** The signed-in member's id, or a thrown error when there is no session. */
async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new FollowError('You must be signed in.', '28000');
  return user.id;
}

/**
 * Follows another member.
 *
 * The insert is an upsert with `ignoreDuplicates`, so tapping Follow twice is a
 * no-op rather than a 23505 error — the same idempotence the like path relies
 * on. The primary key on (follower_id, following_id) is the conflict target.
 */
export async function followUser(targetUserId: string): Promise<void> {
  const me = await requireUserId();
  if (me === targetUserId) throw new FollowError('You cannot follow yourself.');

  const { error } = await supabase.from('follows').upsert(
    { follower_id: me, following_id: targetUserId },
    { onConflict: 'follower_id,following_id', ignoreDuplicates: true }
  );

  if (error) {
    console.error('[follows] follow failed:', error.message);
    throw new FollowError(error.message, error.code);
  }
}

/** Unfollows another member. Removing an edge that is not there is harmless. */
export async function unfollowUser(targetUserId: string): Promise<void> {
  const me = await requireUserId();

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', me)
    .eq('following_id', targetUserId);

  if (error) {
    console.error('[follows] unfollow failed:', error.message);
    throw new FollowError(error.message, error.code);
  }
}

/** Follow or unfollow in one call, for a toggle button. */
export async function setFollow(targetUserId: string, follow: boolean): Promise<void> {
  if (follow) {
    await followUser(targetUserId);
  } else {
    await unfollowUser(targetUserId);
  }
}

/**
 * Whether the signed-in member follows `targetUserId`.
 *
 * A read failure degrades to `false` (the button shows "Follow") rather than
 * blocking the surface: RLS filters rows instead of raising, and a transient
 * error should not make the page unusable.
 */
export async function isFollowing(targetUserId: string): Promise<boolean> {
  try {
    const me = await requireUserId();
    if (me === targetUserId) return false;

    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', me)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (error) {
      console.error('[follows] follow state failed:', error.message);
      return false;
    }

    return data !== null;
  } catch (err) {
    console.error('[follows] follow state failed:', err);
    return false;
  }
}

/**
 * Every member the signed-in member follows, as an id set.
 *
 * For surfaces that render many follow toggles at once (the Discover feed) a
 * per-candidate query is wasteful, so this hydrates them in one read. A failure
 * degrades to an empty set — the same "show Follow" fallback as `isFollowing`.
 */
export async function fetchMyFollowingIds(): Promise<Set<string>> {
  try {
    const me = await requireUserId();
    const { data, error } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', me);

    if (error || !data) {
      if (error) console.error('[follows] following list failed:', error.message);
      return new Set();
    }

    return new Set(
      data
        .map((row) => row.following_id)
        .filter((id): id is string => typeof id === 'string')
    );
  } catch (err) {
    console.error('[follows] following list failed:', err);
    return new Set();
  }
}
