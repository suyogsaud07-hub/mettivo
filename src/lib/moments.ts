import { supabase } from '@/lib/supabase';
import { isMissingColumnError } from '@/lib/postgrest-errors';
import type {
  MomentArchiveRow,
  MomentAuthor,
  MomentCommentRow,
  MomentFeedRow,
  MomentMediaType,
  MomentVisibility,
} from '@/lib/types';

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

/** Quick-insert emoji for a status caption. */
export const MOMENT_EMOJI = [
  '❤️', '🔥', '😂', '😍', '👏', '🥳',
  '😮', '💯', '🌹', '✨', '😎', '🙌',
] as const;

/** The maximum number of tags a moment may carry (mirrors the SQL constraint). */
export const MAX_MOMENT_TAGS = 6;

/**
 * The archive caps, mirrored from the `enforce_archive_capacity` trigger.
 *
 * The database is the authority — these exist so the UI can warn *before* a
 * write is rejected, not to replace the check.
 */
export const ARCHIVE_LIMITS = { photo: 5, video: 2 } as const;

/** The three privacy tiers in the order the picker shows them. */
export const MOMENT_VISIBILITIES: readonly MomentVisibility[] = [
  'public',
  'matches',
  'only_me',
] as const;

/** Human labels for the privacy tiers. */
export const MOMENT_VISIBILITY_LABELS: Record<MomentVisibility, string> = {
  public: 'Public',
  matches: 'Followers & matches',
  only_me: 'Only me',
};

/** One-line explanations shown under each tier in the privacy picker. */
export const MOMENT_VISIBILITY_HELP: Record<MomentVisibility, string> = {
  public: 'Anyone signed in to Mettivo',
  matches: 'People who follow you or share a match',
  only_me: 'Only you can see this',
};

/**
 * Pulls `#hashtags` out of a caption, de-duplicated and bounded.
 *
 * Captions and tags are two different columns, but a member typing
 * "#LateNight" expects it to behave like the picker chip. This folds the
 * hashtags into the tag list so both routes reach the same filter.
 */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return matches.map((match) => match.slice(1));
}

/** Merges picker tags with caption hashtags, capped at the SQL limit. */
export function mergeMomentTags(tags: string[], caption: string): string[] {
  const seen = new Set<string>();
  for (const tag of [...tags, ...extractHashtags(caption)]) {
    const clean = tag.trim();
    if (clean) seen.add(clean);
    if (seen.size >= MAX_MOMENT_TAGS) break;
  }
  return Array.from(seen);
}

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
 * `moment_feed` columns, split so the M19 media/engagement columns are optional.
 *
 * A deployment that has not run the Moments engagement migration still has the
 * base view, so a select naming `media_type`/`views_count`/`unique_views` fails
 * with `42703` and the feed — and the profile Posts tab — would go blank. The
 * core list is tried first and upgraded only when the schema supports it.
 *
 * Single literals (not a `.join()`): supabase-js parses the column list at the
 * type level.
 */
const MOMENT_FEED_CORE_COLUMNS =
  'id, author_id, caption, media, tags, shares, created_at, updated_at, like_count, comment_count, liked_by_me' as const;

const MOMENT_FEED_ENGAGEMENT_COLUMNS = 'media_type, views_count, unique_views, visibility' as const;

const MOMENT_FEED_COLUMNS = `${MOMENT_FEED_CORE_COLUMNS}, ${MOMENT_FEED_ENGAGEMENT_COLUMNS}` as const;

/** `moment_archive` adds the archival timestamp to the feed shape. */
const MOMENT_ARCHIVE_COLUMNS = `${MOMENT_FEED_COLUMNS}, archived_at` as const;

/** A feed row without the optional media/engagement/privacy columns. */
type MomentFeedCoreRow = Omit<
  MomentFeedRow,
  'media_type' | 'views_count' | 'unique_views' | 'visibility'
>;

/** Defaults the optional columns so a legacy view row still renders. */
function withDefaultEngagement(row: MomentFeedCoreRow): MomentFeedRow {
  return { ...row, media_type: null, views_count: 0, unique_views: 0, visibility: 'public' };
}

interface FeedQueryOptions {
  tab: MomentTab;
  tag: string | null;
  limit: number;
}

/** Runs the tab/tag/order query against a given column list. */
function momentFeedQuery(tab: MomentTab, tag: string | null, limit: number) {
  let query = supabase.from('moment_feed').select(MOMENT_FEED_COLUMNS);

  if (tag) query = query.contains('tags', [tag]);

  if (tab === 'For You') {
    query = query.order('like_count', { ascending: false }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  return query.limit(limit);
}

/** The same query against the base columns, for a schema without M19. */
function momentFeedCoreQuery(tab: MomentTab, tag: string | null, limit: number) {
  let query = supabase.from('moment_feed').select(MOMENT_FEED_CORE_COLUMNS);

  if (tag) query = query.contains('tags', [tag]);

  if (tab === 'For You') {
    query = query.order('like_count', { ascending: false }).order('created_at', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  return query.limit(limit);
}

/** Loads feed rows, transparently dropping the optional columns if needed. */
async function loadFeedRows({ tab, tag, limit }: FeedQueryOptions): Promise<MomentFeedRow[]> {
  const { data, error } = await momentFeedQuery(tab, tag, limit);

  if (!error) return (data ?? []) as MomentFeedRow[];

  if (isMissingColumnError(error)) {
    const fallback = await momentFeedCoreQuery(tab, tag, limit);
    if (fallback.error) {
      console.error('[moments] load feed failed (core fallback):', fallback.error.message);
      throw new MomentError(fallback.error.message, fallback.error.code);
    }
    return ((fallback.data ?? []) as MomentFeedCoreRow[]).map(withDefaultEngagement);
  }

  console.error('[moments] load feed failed:', error.message);
  throw new MomentError(error.message, error.code);
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

  let rows = await loadFeedRows({ tab, tag, limit });

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

/**
 * Loads one member's own moments, newest first.
 *
 * Used by the profile dashboard's "Posts" tab, which shows only what the
 * signed-in member has shared. Reads the same `moment_feed` view as
 * `fetchMomentFeed` so the aggregated counts and `liked_by_me` flag are
 * consistent between the feed and the profile.
 */
export async function fetchUserMoments(
  userId: string,
  limit = 60
): Promise<MomentFeedRow[]> {
  const { data, error } = await supabase
    .from('moment_feed')
    .select(MOMENT_FEED_COLUMNS)
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!error) return (data ?? []) as MomentFeedRow[];

  // A schema without the M19 media/engagement columns still has the base view;
  // read it rather than failing the profile's Posts tab.
  if (isMissingColumnError(error)) {
    const fallback = await supabase
      .from('moment_feed')
      .select(MOMENT_FEED_CORE_COLUMNS)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (fallback.error) {
      console.error('[moments] load user moments failed (core fallback):', fallback.error.message);
      throw new MomentError(fallback.error.message, fallback.error.code);
    }

    return ((fallback.data ?? []) as MomentFeedCoreRow[]).map(withDefaultEngagement);
  }

  console.error('[moments] load user moments failed:', error.message);
  throw new MomentError(error.message, error.code);
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

/**
 * Publishes a moment authored by the signed-in member.
 *
 * `media` holds Storage URLs (see `@/lib/media`); `mediaType` labels them so the
 * feed knows to autoplay a video. Legacy rows written before `media_type`
 * existed simply pass `null` and are treated as images.
 */
export async function createMoment(
  caption: string,
  media: string[] = [],
  tags: string[] = [],
  mediaType: MomentMediaType | null = null
): Promise<void> {
  const text = caption.trim();

  if (!text && media.length === 0) {
    throw new MomentError('Please add a caption or media.');
  }

  // Inline data URLs are stored as text; keep any that sneak through small.
  // Uploaded Storage URLs are short, so this only guards legacy/base64 input.
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
    media_type: mediaType,
    tags: tags.slice(0, MAX_MOMENT_TAGS),
  });

  if (error) {
    console.error('[moments] create failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
}

/**
 * Edits the caption of a post the caller authored.
 *
 * Owner-only. A bare `.update()` would silently match nothing if the id were not
 * the caller's, so the affected rows are requested and a zero-row result is
 * reported as a failure rather than a silent no-op.
 */
export async function updateMomentCaption(momentId: string, caption: string): Promise<void> {
  const text = caption.trim();

  const { data, error } = await supabase
    .from('moments')
    .update({ caption: text || null, updated_at: new Date().toISOString() })
    .eq('id', momentId)
    .select('id');

  if (error) {
    console.error('[moments] edit caption failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
  if (!data || data.length === 0) {
    throw new MomentError('That post could not be updated.', 'PGRST116');
  }
}

/** Changes a post's privacy tier. Owner-only, same zero-row guard as the caption. */
export async function setMomentVisibility(
  momentId: string,
  visibility: MomentVisibility
): Promise<void> {
  const { data, error } = await supabase
    .from('moments')
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq('id', momentId)
    .select('id');

  if (error) {
    console.error('[moments] set visibility failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
  if (!data || data.length === 0) {
    throw new MomentError('That post could not be updated.', 'PGRST116');
  }
}

/** Permanently deletes a post the caller authored. */
export async function deleteMoment(momentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('moments')
    .delete()
    .eq('id', momentId)
    .select('id');

  if (error) {
    console.error('[moments] delete failed:', error.message);
    throw new MomentError(error.message, error.code);
  }
  if (!data || data.length === 0) {
    throw new MomentError('That post could not be deleted.', 'PGRST116');
  }
}

/**
 * Translates the archive-capacity trigger's error into a friendly sentence.
 *
 * The trigger raises `archive_limit:photo` / `archive_limit:video` (errcode
 * P0001); Postgres wraps it in the returned `message`. Anything else passes
 * through untouched so a genuine failure is not mislabelled.
 */
function archiveLimitError(error: { message: string; code?: string }): MomentError {
  const which = /archive_limit:(photo|video)/.exec(error.message)?.[1];
  if (which === 'photo') {
    return new MomentError(
      `Your archive is full — it holds at most ${ARCHIVE_LIMITS.photo} photo posts. Delete or restore one first.`,
      error.code
    );
  }
  if (which === 'video') {
    return new MomentError(
      `Your archive is full — it holds at most ${ARCHIVE_LIMITS.video} video posts. Delete or restore one first.`,
      error.code
    );
  }
  return new MomentError(error.message, error.code);
}

/** Moves a post off the profile and into the archive. Returns false if not owned. */
export async function archiveMoment(momentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('archive_moment', { p_moment_id: momentId });

  if (error) {
    console.error('[moments] archive failed:', error.message);
    throw archiveLimitError(error);
  }

  return data === true;
}

/** Returns an archived post to the profile (public tier). False if not owned. */
export async function restoreMoment(momentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('restore_moment', { p_moment_id: momentId });

  if (error) {
    console.error('[moments] restore failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  return data === true;
}

/** One member's archived posts, newest first (visible only to that member). */
export async function fetchArchivedMoments(limit = 60): Promise<MomentArchiveRow[]> {
  const { data, error } = await supabase
    .from('moment_archive')
    .select(MOMENT_ARCHIVE_COLUMNS)
    .order('archived_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[moments] load archive failed:', error.message);
    throw new MomentError(error.message, error.code);
  }

  return (data ?? []) as MomentArchiveRow[];
}

/** Archive usage for the capacity meter. */
export interface ArchiveCounts {
  photoCount: number;
  videoCount: number;
  photoLimit: number;
  videoLimit: number;
}

/** Reads the caller's archive usage and the hard caps from the database. */
export async function fetchArchiveCounts(): Promise<ArchiveCounts | null> {
  const { data, error } = await supabase.rpc('moment_archive_counts');

  if (error) {
    console.error('[moments] load archive counts failed:', error.message);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        photo_count?: unknown;
        video_count?: unknown;
        photo_limit?: unknown;
        video_limit?: unknown;
      }
    | undefined;

  if (!row || typeof row !== 'object') return null;

  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' ? value : fallback;

  return {
    photoCount: num(row.photo_count, 0),
    videoCount: num(row.video_count, 0),
    photoLimit: num(row.photo_limit, ARCHIVE_LIMITS.photo),
    videoLimit: num(row.video_limit, ARCHIVE_LIMITS.video),
  };
}

/** View totals returned by `record_moment_view()`. */
export interface MomentViewCounts {
  views_count: number;
  unique_views: number;
}

/**
 * Records that the signed-in member viewed a moment.
 *
 * Best-effort: counting a view must never break the feed, so a failure resolves
 * to `null` (the caller simply keeps showing the count it already had) rather
 * than throwing. The counter itself lives in a SECURITY DEFINER function, so a
 * client can request a view but cannot set the number.
 */
export async function recordMomentView(momentId: string): Promise<MomentViewCounts | null> {
  const { data, error } = await supabase.rpc('record_moment_view', { p_moment_id: momentId });

  if (error) {
    console.error('[moments] record view failed:', error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;

  const values = row as { views_count?: unknown; unique_views?: unknown };
  return {
    views_count: typeof values.views_count === 'number' ? values.views_count : 0,
    unique_views: typeof values.unique_views === 'number' ? values.unique_views : 0,
  };
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

/**
 * Follows another member.
 *
 * Re-exported from `@/lib/follows` so every Follow button shares one
 * implementation. Kept in this module's public surface because the Moments feed
 * imports it from here.
 */
export { followUser, FollowError } from '@/lib/follows';

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

/**
 * Streams comment changes for one open post.
 *
 * Scoped to a moment id so an open comment drawer refreshes the instant someone
 * replies, while the main feed does not re-render on unrelated comments.
 */
export function subscribeToMomentComments(momentId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`moment:${momentId}:comments`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'moment_comments',
        filter: `moment_id=eq.${momentId}`,
      },
      () => onChange()
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
