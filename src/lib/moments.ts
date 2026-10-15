import { supabase } from '@/lib/supabase';
import type { MomentAuthor, MomentCommentRow, MomentFeedRow } from '@/lib/types';

/**
 * Moments data access.
 *
 * Reads go through the `moment_feed` view so the like/comment counts and the
 * per-caller `liked_by_me` flag arrive in one request and cannot drift apart in
 * client arithmetic. Writes rely on RLS: a member may only author, edit, delete
 * and like as themselves.
 */

/** Raised for expected Moments failures. */
export class MomentError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'MomentError';
    this.code = code;
  }
}

export const MOMENT_TABS = ['Following', 'For You', 'Latest'] as const;
export type MomentTab = (typeof MOMENT_TABS)[number];

export const MOMENT_TAGS = [
  'Trending',
  'Associate',
  'Vibes',
  'LateNight',
  'Music',
  'Travel',
] as const;

/** Reject oversized inline media before it reaches the database. */
const MAX_MEDIA_BYTES = 1024 * 1024; // 1 MB

/** Emoji flag for the country stored on a profile. */
export function countryFlag(country: string | null | undefined): string {
  const flags: Record<string, string> = {
    Nepal: '🇳🇵', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', India: '🇮🇳',
    Australia: '🇦🇺', Canada: '🇨🇦', Philippines: '🇵🇭', Indonesia: '🇮🇩',
    Singapore: '🇸🇬', Japan: '🇯🇵', 'South Korea': '🇰🇷', Germany: '🇩🇪',
    France: '🇫🇷', Brazil: '🇧🇷',
  };
  return (country && flags[country]) || '🌐';
}

export function genderIcon(gender: string): string {
  if (gender === 'Woman') return '♀️';
  if (gender === 'Man') return '♂️';
  return '⚧';
}

/** IDs the signed-in member follows, used by the "Following" tab. */
async function fetchFollowingIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);

  if (error) {
    console.error('[moments] load following failed:', error.message);
    // A failure here should degrade to an empty Following tab, not break the page.
    return new Set();
  }

  return new Set(
    ((data ?? []) as { following_id: string | null }[])
      .map((row) => row.following_id)
      .filter((id): id is string => typeof id === 'string')
  );
}

export interface FetchFeedOptions {
  tab?: MomentTab;
  tag?: string | null;
  limit?: number;
  /** Defaults to the signed-in user; pass explicitly to avoid an extra round trip. */
  userId?: string;
}

/**
 * Loads the feed for a tab.
 *
 *   Latest    -> newest first
 *   For You   -> most engaged first, then newest
 *   Following -> only moments from members the caller follows
 */
export async function fetchMomentFeed(
  options: FetchFeedOptions = {}
): Promise<MomentFeedRow[]> {
  const { tab = 'Latest', tag = null, limit = 50, userId } = options;

  let query = supabase
    .from('moment_feed')
    .select(
      'id, author_id, caption, media, tags, shares, created_at, updated_at, like_count, comment_count, liked_by_me'
    );

  if (tag) {
    query = query.contains('tags', [tag]);
  }

  if (tab === 'For You') {
    query = query.order('like_count', { ascending: false }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query.limit(limit);

  if (error) {
    console.error('[moments] load feed failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  let rows = (data ?? []) as MomentFeedRow[];

  if (tab === 'Following') {
    let me = userId;
    if (!me) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      me = user?.id;
    }
    if (!me) return [];

    const following = await fetchFollowingIds(me);
    rows = rows.filter((row) => following.has(row.author_id));
  }

  return rows;
}

/** Display data for the authors of a set of moments. */
export async function fetchMomentAuthors(
  authorIds: string[]
): Promise<Record<string, MomentAuthor>> {
  const ids = Array.from(new Set(authorIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, gender, country')
    .in('id', ids);

  if (error) {
    console.error('[moments] load authors failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  const authors: Record<string, MomentAuthor> = {};
  for (const row of (data ?? []) as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    gender: string | null;
    country: string | null;
  }[]) {
    authors[row.id] = {
      id: row.id,
      displayName: row.display_name ?? 'Someone',
      avatarUrl: row.avatar_url,
      gender: row.gender ?? '',
      country: row.country ?? '',
    };
  }
  return authors;
}

/** Publishes a moment authored by the signed-in member. */
export async function createMoment(
  caption: string,
  media: string[] = [],
  tags: string[] = []
): Promise<void> {
  const text = caption.trim();

  if (!text && media.length === 0) {
    throw new MomentError('Please add a caption or media.');
  }

  // Inline data URLs are stored as text; keep them small until media moves to
  // Supabase Storage. Measured in bytes, not characters.
  for (const item of media) {
    if (new Blob([item]).size > MAX_MEDIA_BYTES) {
      throw new MomentError('That file is too large. Please choose an image under 1 MB.');
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new MomentError('You must be signed in to post.', '28000');
  }

  const { error } = await supabase.from('moments').insert({
    author_id: user.id,
    caption: text || null,
    media,
    tags,
  });

  if (error) {
    console.error('[moments] create failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
}

/** Likes a moment. The composite primary key makes a repeat a no-op conflict. */
export async function likeMoment(momentId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new MomentError('You must be signed in.', '28000');

  const { error } = await supabase
    .from('moment_likes')
    .insert({ moment_id: momentId, user_id: user.id });

  // 23505 = unique violation: already liked, which is not an error for the UI.
  if (error && error.code !== '23505') {
    console.error('[moments] like failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
}

export async function unlikeMoment(momentId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new MomentError('You must be signed in.', '28000');

  const { error } = await supabase
    .from('moment_likes')
    .delete()
    .eq('moment_id', momentId)
    .eq('user_id', user.id);

  if (error) {
    console.error('[moments] unlike failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
}

export async function addMomentComment(momentId: string, body: string): Promise<MomentCommentRow> {
  const text = body.trim();
  if (!text) throw new MomentError('A comment cannot be empty.');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new MomentError('You must be signed in.', '28000');

  const { data, error } = await supabase
    .from('moment_comments')
    .insert({ moment_id: momentId, author_id: user.id, body: text })
    .select('id, moment_id, author_id, body, created_at')
    .single();

  if (error) {
    console.error('[moments] comment failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  return data as MomentCommentRow;
}

export async function fetchMomentComments(
  momentId: string
): Promise<MomentCommentRow[]> {
  const { data, error } = await supabase
    .from('moment_comments')
    .select('id, moment_id, author_id, body, created_at')
    .eq('moment_id', momentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[moments] load comments failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  return (data ?? []) as MomentCommentRow[];
}

/** Server-side share counter; returns the new total. */
export async function shareMoment(momentId: string): Promise<number> {
  const { data, error } = await supabase.rpc('share_moment', { p_moment_id: momentId });

  if (error) {
    console.error('[moments] share failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  return typeof data === 'number' ? data : 0;
}

/** Follows another member (used by the card's Follow button). */
export async function followUser(targetUserId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new MomentError('You must be signed in.', '28000');
  if (user.id === targetUserId) throw new MomentError('You cannot follow yourself.');

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: user.id, following_id: targetUserId });

  if (error && error.code !== '23505') {
    console.error('[moments] follow failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
}

/** Streams newly published moments so the feed updates without a refresh. */
export function subscribeToMoments(onInsert: () => void): () => void {
  const channel = supabase
    .channel('moments:feed')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'moments' },
      () => onInsert()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
