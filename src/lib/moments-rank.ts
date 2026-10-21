import type { MomentFeedRow } from '@/lib/types';

/**
 * Moments feed ranking — a small, documented, testable relevance score.
 *
 * This is deliberately NOT a claim to reproduce Instagram or TikTok. It uses
 * only signals the database already stores for every post:
 *
 *   engagement  likes, comments, saves and shares, dampened with log1p so one
 *               viral post cannot flatten the rest of the page
 *   freshness   an exponential half-life decay, so a new post is visible
 *               without the feed becoming purely chronological
 *   affinity    a boost for creators the viewer follows and for posts whose
 *               tags or hashtags overlap the viewer's saved interests; it both
 *               amplifies engagement and counts on its own
 *
 * Ordering is total and deterministic (score, then created_at, then id) so the
 * result never shuffles between renders.
 *
 * "For You" ranks one fetched page; pagination itself is keyset on
 * `(created_at, id)` in `@/lib/moments`, so pages never duplicate a row.
 */

/** Tunable weights. Change these to shift the feed; tests pin the defaults. */
export const MOMENT_RANK_WEIGHTS = {
  like: 1,
  comment: 2,
  save: 3,
  share: 2,
  /** Hours after which a post's freshness contribution halves. */
  freshnessHalfLifeHours: 24,
  /** Multiplier added when the viewer follows the author. */
  followingBoost: 0.6,
  /** Multiplier added when the post's tags overlap the viewer's interests. */
  interestBoost: 0.4,
} as const;

export interface RankContext {
  /** Authors the viewer follows. */
  following?: ReadonlySet<string>;
  /** The viewer's saved interest labels. */
  interests?: readonly string[];
}

/** Extracts `#hashtags` (lowercased) from a caption for interest matching. */
function captionTags(caption: string | null): string[] {
  if (!caption) return [];
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return matches.map((match) => match.slice(1).toLowerCase());
}

function interestOverlap(row: MomentFeedRow, interests: readonly string[]): boolean {
  if (interests.length === 0) return false;
  const wanted = new Set(interests.map((item) => item.toLowerCase()));
  const tags = [...row.tags, ...captionTags(row.caption)].map((tag) => tag.toLowerCase());
  return tags.some((tag) => wanted.has(tag));
}

/** The raw relevance score for one post. Exposed for tests and debugging. */
export function momentRelevance(
  row: MomentFeedRow,
  context: RankContext = {},
  now: number = Date.now()
): number {
  const weights = MOMENT_RANK_WEIGHTS;

  const engagement =
    (row.like_count ?? 0) * weights.like +
    (row.comment_count ?? 0) * weights.comment +
    (row.save_count ?? 0) * weights.save +
    (row.shares ?? 0) * weights.share;
  const engagementScore = Math.log1p(Math.max(0, engagement));

  const createdMs = Date.parse(row.created_at);
  const ageHours = Number.isFinite(createdMs)
    ? Math.max(0, (now - createdMs) / 3_600_000)
    : Number.POSITIVE_INFINITY;
  const freshnessScore = Math.pow(0.5, ageHours / weights.freshnessHalfLifeHours);

  const followsAuthor = context.following?.has(row.author_id) ?? false;
  const affinity =
    (followsAuthor ? weights.followingBoost : 0) +
    (interestOverlap(row, context.interests ?? []) ? weights.interestBoost : 0);

  // Affinity both amplifies a post's engagement and counts on its own, so a
  // brand-new post from a followed author still surfaces above an unrelated one.
  return engagementScore * (1 + affinity) + freshnessScore + affinity;
}

/**
 * Orders a page of posts by relevance.
 *
 * When `diversifyCreators` is true (the default), a run of consecutive posts by
 * the same author is spread out: the second copy is moved after the next
 * different author. This keeps a single prolific account from filling the feed
 * without hiding anybody.
 */
export function rankMoments(
  rows: readonly MomentFeedRow[],
  context: RankContext = {},
  options: { now?: number; diversifyCreators?: boolean } = {}
): MomentFeedRow[] {
  const now = options.now ?? Date.now();

  const scored = rows.map((row) => ({ row, score: momentRelevance(row, context, now) }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byCreated = Date.parse(b.row.created_at) - Date.parse(a.row.created_at);
    if (byCreated !== 0) return byCreated;
    return a.row.id.localeCompare(b.row.id);
  });

  let ordered = scored.map((entry) => entry.row);

  if (options.diversifyCreators !== false) {
    ordered = spreadCreators(ordered);
  }

  return ordered;
}

/** Greedily reorders so no two adjacent posts share an author when avoidable. */
function spreadCreators(rows: readonly MomentFeedRow[]): MomentFeedRow[] {
  const remaining = [...rows];
  const out: MomentFeedRow[] = [];
  let lastAuthor: string | null = null;

  while (remaining.length > 0) {
    // Prefer the highest-remaining post by a different author; fall back to the
    // next one in order only when that is impossible.
    let pickIndex = remaining.findIndex((row) => row.author_id !== lastAuthor);
    if (pickIndex === -1) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    out.push(picked);
    lastAuthor = picked.author_id;
  }

  return out;
}
