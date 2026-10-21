/**
 * M9 — rule-based recommendation engine.
 *
 * WHY PURE AND DETERMINISTIC
 *   This engine decides who a member sees first. It must be explainable,
 *   reproducible and cheap: the same two profiles must always produce the same
 *   number, and a member's feed must not reshuffle between two identical
 *   requests. There is no randomness, no clock, and no network in here.
 *
 * WHY IT IS NOT DATABASE-SIDE
 *   Filtering (blocked, suspended, already-decided) is enforced in PostgreSQL by
 *   `discover_profiles()` because the browser cannot be trusted with it. *Scoring*
 *   is deliberately kept in TypeScript: it is the one part of matching that is
 *   trivially unit-testable, and `CONSTITUTION.md` Article 2 prefers correctness
 *   that can be pinned by a test over cleverness in SQL.
 *
 * INPUT SHAPE
 *   `MatchProfile` is structural, not nominal, so the same function scores the
 *   demo fixtures in `mockData.ts` and a real row from `discover_profiles()`.
 */

import { preferenceAffinity, type PreferenceAffinity } from '@/lib/dating-preferences';

/** Weights sum to the 0-100 score ceiling. Exported so tests can assert them. */
export const RANKING_WEIGHTS = {
  intention: 40,
  interests: 30,
  prompts: 30,
} as const;

/** A candidate below this is not worth showing at all. */
export const MIN_MATCH_SCORE = 30;

/** The minimum a profile must expose for the engine to score it. */
export interface MatchProfile {
  id: string;
  intention?: string | null;
  interests?: readonly string[] | null;
  /** Prompt id -> answer. Mirrors `profiles.prompts` (jsonb) on the DB side. */
  promptAnswers?: Record<string, string> | null;
  hobbies?: readonly string[] | null;
  age?: number | null;
  city?: string | null;
  country?: string | null;
  online?: boolean | null;
  is_online?: boolean | null;
  /** The member's own gender, used only for preference affinity. */
  gender?: string | null;
  /** `profiles.looking_for` labels (`Men`, `Women`, `Everyone`). */
  lookingFor?: readonly string[] | null;
}

export type IntentionAffinity = 'mutual' | 'one-way' | 'none';

/** Which declared intents are acceptable to the other. */
const INTENTION_ACCEPTS: Record<string, readonly string[]> = {
  friendship: ['friendship', 'both'],
  dating: ['dating', 'both'],
  both: ['friendship', 'dating', 'both'],
};

function accepts(intention: string | null | undefined, other: string | null | undefined): boolean {
  if (!intention || !other) return false;
  return (INTENTION_ACCEPTS[intention] ?? []).includes(other);
}

/**
 * How well two declared intentions fit.
 *
 * `none` is the only case the feed filters out (`PRD_V1` `FR-D5`): a member
 * looking strictly for friendship and one looking strictly for dating will
 * never produce a match, so showing them to each other wastes both members'
 * time and, on metered mobile data, their money.
 */
export function intentionAffinity(
  a: string | null | undefined,
  b: string | null | undefined
): IntentionAffinity {
  const aAcceptsB = accepts(a, b);
  const bAcceptsA = accepts(b, a);
  if (aAcceptsB && bAcceptsA) return 'mutual';
  if (aAcceptsB || bAcceptsA) return 'one-way';
  return 'none';
}

/**
 * Case-insensitive word set, ignoring words of two characters or fewer.
 *
 * Punctuation is stripped with an ASCII class rather than a `\p{L}` unicode
 * property escape: answers may be written in Devanagari, and the escape would
 * require an ES2018 build target to be safe.
 */
function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:"'()[\]{}<>«»—–“”‘’]/g, ''))
    .filter((word) => word.length > 2);
}

function intersectionSize(a: readonly string[], b: readonly string[]): number {
  const other = new Set(b);
  const seen = new Set<string>();
  let count = 0;
  for (const value of a) {
    if (!other.has(value) || seen.has(value)) continue;
    seen.add(value);
    count += 1;
  }
  return count;
}

export interface MatchBreakdown {
  intention: number;
  interests: number;
  prompts: number;
  total: number;
}

/**
 * Scores two profiles from 0 to 100 and explains the result.
 *
 * Callers that only need the number should use `matchScore`.
 */
export function explainMatch(a: MatchProfile, b: MatchProfile): MatchBreakdown {
  // 1. Intention fit — the strongest signal, and the one that can veto a feed.
  const affinity = intentionAffinity(a.intention, b.intention);
  const intention =
    affinity === 'mutual'
      ? RANKING_WEIGHTS.intention
      : affinity === 'one-way'
        ? RANKING_WEIGHTS.intention / 2
        : 0;

  // 2. Interest overlap, normalised by the larger set.
  //    Guarded against division by zero: two profiles with no interests would
  //    otherwise produce 0/0 = NaN and poison the whole score. This was a real
  //    bug, and `matching.test.ts` pins it.
  const aInterests = a.interests ?? [];
  const bInterests = b.interests ?? [];
  const largestInterestSet = Math.max(aInterests.length, bInterests.length);
  const interests =
    largestInterestSet === 0
      ? 0
      : (intersectionSize(aInterests, bInterests) / largestInterestSet) *
        RANKING_WEIGHTS.interests;

  // 3. Prompt affinity — of the prompts BOTH members answered, how many share a
  //    meaningful word.
  //    Iterating the intersection (rather than a hard-coded prompt list) means a
  //    newly curated prompt starts scoring the moment two members answer it.
  //
  //    The denominator is deliberately the shared set, not the union: with a
  //    union, answering an extra prompt the other member left blank would DILUTE
  //    the score, so a member would be penalised for sharing more. That is
  //    backwards, and `matching.test.ts` pins it.
  const aPrompts = a.promptAnswers ?? {};
  const bPrompts = b.promptAnswers ?? {};
  const sharedPromptIds = Object.keys(aPrompts).filter((id) => id in bPrompts);

  let promptMatches = 0;
  for (const id of sharedPromptIds) {
    const wordsA = significantWords(aPrompts[id] ?? '');
    const wordsB = significantWords(bPrompts[id] ?? '');
    if (wordsA.length > 0 && wordsB.length > 0 && intersectionSize(wordsA, wordsB) > 0) {
      promptMatches += 1;
    }
  }

  const prompts =
    sharedPromptIds.length === 0
      ? 0
      : (promptMatches / sharedPromptIds.length) * RANKING_WEIGHTS.prompts;

  const total = Math.min(intention + interests + prompts, 100);
  return { intention, interests, prompts, total };
}

/** Score 0-100 for how well two profiles match. Pure and deterministic. */
export function matchScore(userA: MatchProfile, userB: MatchProfile): number {
  return explainMatch(userA, userB).total;
}

export interface RankedCandidate<T extends MatchProfile = MatchProfile> {
  profile: T;
  score: number;
  breakdown: MatchBreakdown;
  /** Whether the pair's saved gender preferences line up. */
  preferenceFit: PreferenceAffinity;
}

export interface RankOptions {
  /** Candidates to drop before scoring — blocked members, hidden ids, … */
  excludeIds?: Iterable<string>;
  limit?: number;
  /** Drop scores at or below this. Defaults to `MIN_MATCH_SCORE`. */
  minScore?: number;
  /** Drop pairs whose declared intentions cannot both be satisfied (`FR-D5`). */
  requireIntentionalFit?: boolean;
  /** Put currently-online candidates first, before score and preferences. */
  onlineFirst?: boolean;
}

/**
 * Ranks `pool` against `me`.
 *
 * Deterministic by construction: the comparator falls back to the id, so two
 * candidates with the same score always appear in the same order regardless of
 * the database's row order or the JavaScript engine.
 *
 * The id tie-break is the whole point — a feed that reshuffles between two
 * identical refreshes looks broken to a member and makes "why am I seeing this"
 * impossible to answer.
 */
export function rankCandidates<T extends MatchProfile>(
  me: MatchProfile,
  pool: readonly T[],
  options: RankOptions = {}
): RankedCandidate<T>[] {
  const exclude = new Set(options.excludeIds ?? []);
  const limit = Math.max(0, options.limit ?? 10);
  const minScore = options.minScore ?? MIN_MATCH_SCORE;

  return pool
    .filter((candidate) => candidate.id !== me.id && !exclude.has(candidate.id))
    .filter(
      (candidate) =>
        !options.requireIntentionalFit ||
        intentionAffinity(me.intention, candidate.intention) !== 'none'
    )
    .map((profile) => {
      const breakdown = explainMatch(me, profile);
      return {
        profile,
        score: breakdown.total,
        breakdown,
        preferenceFit: preferenceAffinity(me, profile),
      };
    })
    .filter((entry) => entry.score > minScore)
    .sort((a, b) => {
      if (options.onlineFirst) {
        const onlineA = a.profile.online === true || a.profile.is_online === true ? 1 : 0;
        const onlineB = b.profile.online === true || b.profile.is_online === true ? 1 : 0;
        if (onlineA !== onlineB) return onlineB - onlineA;
      }

      const preferenceRank: Record<PreferenceAffinity, number> = {
        mutual: 3,
        'one-way': 2,
        unknown: 1,
        none: 0,
      };
      const preferenceDelta = preferenceRank[b.preferenceFit] - preferenceRank[a.preferenceFit];
      if (preferenceDelta !== 0) return preferenceDelta;

      return (b.score - a.score) || a.profile.id.localeCompare(b.profile.id);
    })
    .slice(0, limit);
}

/**
 * Backwards-compatible wrapper kept for existing callers and tests.
 * New code should call `rankCandidates` and read the breakdown.
 */
export function getMatchesForUser<T extends MatchProfile>(
  user: MatchProfile,
  pool: readonly T[],
  limit = 10
): { profile: T; score: number }[] {
  return rankCandidates(user, pool, { limit }).map(({ profile, score }) => ({ profile, score }));
}
