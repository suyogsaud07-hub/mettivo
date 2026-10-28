import { supabase } from '@/lib/supabase';
import { isMissingRelationError } from '@/lib/postgrest-errors';
import {
  parseDiscoveryCandidate,
  type DiscoveryCandidate,
} from '@/lib/discovery';

/**
 * Explore More — seven curated entry points over ONE database eligible set.
 *
 * The browser does not decide who is eligible, count anybody, filter blocks,
 * or rank the feed. `explore_more_counts()` and `explore_more_feed()` both read
 * `explore_eligible_profiles()` in PostgreSQL, so a count can never advertise
 * a population the cards refuse to show.
 *
 * Distance is deliberately absent: the product stores city/country, not
 * coordinates. A kilometre filter here would be invented precision.
 */

export const EXPLORE_CATEGORY_IDS = [
  'dating-goals',
  'coffee-food',
  'nature-adventure',
  'gamers-entertainment',
  'pet-lovers',
  'travel-partners',
  'new-friends',
] as const;

export type ExploreCategoryId = (typeof EXPLORE_CATEGORY_IDS)[number];

export interface ExploreCategory {
  id: ExploreCategoryId;
  title: string;
  description: string;
  /** Heroicon-style 24x24 stroke path. */
  icon: string;
  /** The category opens a goal chooser rather than a feed directly. */
  requiresGoal?: boolean;
}

export const EXPLORE_CATEGORIES: readonly ExploreCategory[] = [
  {
    id: 'dating-goals',
    title: 'Dating Goals',
    description: 'Browse by what someone is explicitly looking for.',
    icon: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z',
    requiresGoal: true,
  },
  {
    id: 'coffee-food',
    title: 'Coffee & Food Dates',
    description: 'Coffee, street food, dining out and cooking.',
    icon: 'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2m4-2v2m4-2v2',
  },
  {
    id: 'nature-adventure',
    title: 'Nature & Adventure',
    description: 'Hiking, trekking, camping and the outdoors.',
    icon: 'm3 20 7-12 4 7 2-3 5 8H3Zm12-14a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  },
  {
    id: 'gamers-entertainment',
    title: 'Gamers & Entertainment',
    description: 'Gaming, films, music and shared entertainment.',
    icon: 'M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4Zm2 4v3m-1.5-1.5h3M16 11h.01M18 13h.01',
  },
  {
    id: 'pet-lovers',
    title: 'Pet Lovers',
    description: 'People who explicitly love or live with animals.',
    icon: 'M12 21c-4 0-7-2.4-7-5.4 0-2 1.5-3.6 3.5-3.6 1.2 0 2.2.6 3.5 1.6 1.3-1 2.3-1.6 3.5-1.6 2 0 3.5 1.6 3.5 3.6 0 3-3 5.4-7 5.4ZM6.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-5.5-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  },
  {
    id: 'travel-partners',
    title: 'Travel Partners',
    description: 'People who explicitly want more travel in their life.',
    icon: 'M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Zm7 3.5c-2 1.4-4.4 2.2-7 2.2s-5-.8-7-2.2m14 13c-2-1.4-4.4-2.2-7-2.2s-5 .8-7 2.2',
  },
  {
    id: 'new-friends',
    title: 'New Friends',
    description: 'Broader social discovery for people open to friendship.',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m17-10a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 10v-2a4 4 0 0 0-3-3.87',
  },
];

export const EXPLORE_GOAL_KEYS = ['friendship', 'serious', 'casual'] as const;
export type ExploreGoalKey = (typeof EXPLORE_GOAL_KEYS)[number];

export interface ExploreGoal {
  key: ExploreGoalKey;
  title: string;
  description: string;
  /** The stored `profiles.intention` value this goal browses. */
  intention: 'friendship' | 'dating' | 'both';
}

/**
 * Three Dating Goals, never a fourth "Serious Relationship" category at the top
 * level. The labels match the exact product wording; the stored values stay the
 * legacy-safe `friendship` / `dating` / `both`.
 */
export const EXPLORE_GOALS: readonly ExploreGoal[] = [
  {
    key: 'friendship',
    title: 'Friendship and Networking',
    description: 'People who explicitly want friendship first.',
    intention: 'friendship',
  },
  {
    key: 'serious',
    title: 'Serious Relationship',
    description: 'People who explicitly want a committed relationship.',
    intention: 'dating',
  },
  {
    key: 'casual',
    title: 'Casual & Open to Options',
    description: 'People who are open to whatever develops naturally.',
    intention: 'both',
  },
];

export interface ExploreCounts {
  /** Category totals. `dating-goals` is the sum of the three goals. */
  categories: Record<ExploreCategoryId, number>;
  goals: Record<ExploreGoalKey, number>;
}

export interface ExploreCandidate extends DiscoveryCandidate {
  /** Server-computed deterministic rank. Used only to build the next cursor. */
  matchScore: number;
  /** How many real profile signals placed this member in the category. */
  categoryHits: number;
}

export interface ExploreFeedPage {
  candidates: ExploreCandidate[];
  /** Pass back as `cursor`; null means there is no next page. */
  nextCursor: string | null;
}

export interface ExploreFeedOptions {
  category: ExploreCategoryId;
  goal?: ExploreGoalKey | null;
  cursor?: string | null;
  limit?: number;
  minAge?: number;
  maxAge?: number;
  excludeIds?: readonly string[];
}

/** Raised for an expected Explore More failure, with a member-safe message. */
export class ExploreMoreError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ExploreMoreError';
    this.code = code;
  }
}

export const EXPLORE_PAGE_SIZE = 12;
export const EXPLORE_MAX_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function isExploreCategoryId(value: string | null | undefined): value is ExploreCategoryId {
  return typeof value === 'string' && (EXPLORE_CATEGORY_IDS as readonly string[]).includes(value);
}

export function isExploreGoalKey(value: string | null | undefined): value is ExploreGoalKey {
  return typeof value === 'string' && (EXPLORE_GOAL_KEYS as readonly string[]).includes(value);
}

export function exploreCategory(id: ExploreCategoryId): ExploreCategory {
  return EXPLORE_CATEGORIES.find((category) => category.id === id) ?? EXPLORE_CATEGORIES[0];
}

export function exploreGoal(key: ExploreGoalKey): ExploreGoal {
  return EXPLORE_GOALS.find((goal) => goal.key === key) ?? EXPLORE_GOALS[0];
}

function parseFeedRow(row: unknown): ExploreCandidate | null {
  const candidate = parseDiscoveryCandidate(row);
  if (!candidate || !isRecord(row)) return null;
  return {
    ...candidate,
    matchScore: num(row.match_score),
    categoryHits: num(row.category_hits),
  };
}

function emptyCounts(): ExploreCounts {
  return {
    categories: {
      'dating-goals': 0,
      'coffee-food': 0,
      'nature-adventure': 0,
      'gamers-entertainment': 0,
      'pet-lovers': 0,
      'travel-partners': 0,
      'new-friends': 0,
    },
    goals: { friendship: 0, serious: 0, casual: 0 },
  };
}

/**
 * Real category and goal counts for the supplied age window.
 *
 * A missing row is treated as zero, but a network/RLS error throws: showing
 * "0 people" for an outage would be a lie and would blame the community.
 */
export async function fetchExploreCounts(
  minAge = 18,
  maxAge = 99
): Promise<ExploreCounts> {
  const { data, error } = await supabase.rpc('explore_more_counts', {
    p_min_age: minAge,
    p_max_age: maxAge,
  });

  if (error) {
    console.error('[explore-more] explore_more_counts failed:', error.message);
    if (isMissingRelationError(error)) {
      // The deployed function is behind the client. Keep the operator detail in
      // the console and give the member a safe, retryable message.
      throw new ExploreMoreError(
        'Explore More is temporarily unavailable. Please try again shortly.',
        error.code
      );
    }
    throw new ExploreMoreError(
      'We could not load Explore More right now. Please try again.',
      error.code
    );
  }

  const counts = emptyCounts();
  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const categoryId = typeof row.category_id === 'string' ? row.category_id : null;
    const goalKey = typeof row.goal_key === 'string' ? row.goal_key : null;

    if (goalKey && isExploreGoalKey(goalKey)) {
      counts.goals[goalKey] = num(row.profile_count);
      continue;
    }

    if (isExploreCategoryId(categoryId)) {
      counts.categories[categoryId] = num(row.profile_count);
    }
  }

  return counts;
}

/**
 * One ranked page. The cursor is opaque to the caller; exclusions are a second
 * guard so a score changing between requests can never duplicate a card.
 */
export async function fetchExploreFeed(
  options: ExploreFeedOptions
): Promise<ExploreFeedPage> {
  const {
    category,
    goal = null,
    cursor = null,
    limit = EXPLORE_PAGE_SIZE,
    minAge = 18,
    maxAge = 99,
    excludeIds = [],
  } = options;

  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), EXPLORE_MAX_LIMIT));

  const { data, error } = await supabase.rpc('explore_more_feed', {
    p_category_id: category,
    p_goal: category === 'dating-goals' ? goal : null,
    p_cursor: cursor,
    p_limit: safeLimit,
    p_min_age: minAge,
    p_max_age: maxAge,
    p_exclude_ids: [...excludeIds],
  });

  if (error) {
    console.error('[explore-more] explore_more_feed failed:', error.message);
    if (isMissingRelationError(error)) {
      throw new ExploreMoreError(
        'Explore More is temporarily unavailable. Please try again shortly.',
        error.code
      );
    }
    if (error.code === '28000') {
      throw new ExploreMoreError('You must be signed in to explore members.', error.code);
    }
    if (error.code === '22023') {
      throw new ExploreMoreError('That Explore category is not available.', error.code);
    }
    throw new ExploreMoreError(
      'We could not load this category right now. Please try again.',
      error.code
    );
  }

  const rows = Array.isArray(data) ? data : [];
  const candidates = rows
    .map(parseFeedRow)
    .filter((row): row is ExploreCandidate => row !== null);
  const last = candidates[candidates.length - 1];
  const nextCursor = candidates.length === safeLimit && last
    ? `${last.matchScore}:${last.id}`
    : null;

  return { candidates, nextCursor };
}

export interface ExploreAccess {
  userId: string;
  /** False means the member still needs to finish the profile wizard. */
  onboardingComplete: boolean;
}

/**
 * The same two gates Discover uses, in one place: a session and a completed
 * profile. Returns null for a signed-out visitor so the page can redirect
 * without treating "not signed in" as an outage.
 */
export async function fetchExploreAccess(): Promise<ExploreAccess | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_completed')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[explore-more] access check failed:', error.message);
    throw new ExploreMoreError(
      'We could not check your profile right now. Please try again.',
      error.code
    );
  }

  return {
    userId: user.id,
    onboardingComplete: data?.onboarding_completed === true,
  };
}
