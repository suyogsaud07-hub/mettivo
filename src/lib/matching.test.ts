import { describe, expect, it } from 'vitest';
import {
  explainMatch,
  getMatchesForUser,
  intentionAffinity,
  matchScore,
  rankCandidates,
} from '@/lib/matching';
import { MOCK_USERS } from '@/lib/mockData';

/**
 * `matchScore` is the rule-based recommendation engine. It is pure, which makes
 * it the cheapest and most valuable thing in the codebase to pin down.
 *
 * Profiles are derived from the existing fixtures by spread so the test stays
 * type-safe without re-declaring the UserProfile shape.
 */
const base = MOCK_USERS[0];
type Profile = typeof base;

const profile = (overrides: Partial<Profile>): Profile => ({ ...base, ...overrides });

describe('matchScore', () => {
  it('scores a profile against itself very highly', () => {
    expect(matchScore(base, base)).toBeGreaterThan(50);
  });

  it('never exceeds 100', () => {
    for (const other of MOCK_USERS) {
      expect(matchScore(base, other)).toBeLessThanOrEqual(100);
    }
  });

  it('never returns a negative score', () => {
    const empty = profile({ interests: [], promptAnswers: {} });
    expect(matchScore(empty, empty)).toBeGreaterThanOrEqual(0);
  });

  it('scores mutual intention higher than a one-way intention', () => {
    const dating = profile({ intention: 'dating' as Profile['intention'] });
    const friendship = profile({ intention: 'friendship' as Profile['intention'] });

    // dating -> dating is mutual; dating -> friendship is not matched by either.
    expect(matchScore(dating, dating)).toBeGreaterThan(matchScore(dating, friendship));
  });

  it('rewards shared interests', () => {
    const shared = profile({ interests: ['trail-walking', 'coffee'] as Profile['interests'] });
    const disjoint = profile({ interests: ['gaming'] as Profile['interests'] });

    expect(matchScore(shared, shared)).toBeGreaterThan(matchScore(shared, disjoint));
  });

  it('copes with a profile that has no interests or prompts', () => {
    const empty = profile({ interests: [], promptAnswers: {} });
    expect(() => matchScore(empty, base)).not.toThrow();
  });
});

describe('getMatchesForUser', () => {
  it('never returns the user themselves', () => {
    const results = getMatchesForUser(base, MOCK_USERS, 10);
    expect(results.some((entry) => entry.profile.id === base.id)).toBe(false);
  });

  it('honours the limit', () => {
    expect(getMatchesForUser(base, MOCK_USERS, 1).length).toBeLessThanOrEqual(1);
  });

  it('only returns candidates above the minimum threshold', () => {
    const results = getMatchesForUser(base, MOCK_USERS, 50);
    for (const entry of results) {
      expect(entry.score).toBeGreaterThan(30);
    }
  });

  it('sorts results by descending score', () => {
    const scores = getMatchesForUser(base, MOCK_USERS, 50).map((entry) => entry.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });

  it('returns an empty list for an empty pool', () => {
    expect(getMatchesForUser(base, [], 10)).toEqual([]);
  });
});

/**
 * M9 — the recommendation engine's feed-shaping guarantees.
 *
 * These are the properties a member actually feels: the feed does not reshuffle
 * between identical refreshes, incompatible intents are not shown to each
 * other, and a blocked member never appears even if the caller asks nicely.
 */
describe('M9 — deterministic ranking', () => {
  const candidate = (id: string, score: number): Profile =>
    profile({
      id,
      interests: ['coffee'],
      promptAnswers: { 'simple-pleasures': `answer ${score}` },
    });

  it('is stable: the same inputs produce the same order every time', () => {
    const pool = [candidate('c', 1), candidate('a', 1), candidate('b', 1)];
    const first = rankCandidates(base, pool, { limit: 10 }).map((entry) => entry.profile.id);
    for (let i = 0; i < 20; i++) {
      const again = rankCandidates(base, pool, { limit: 10 }).map((entry) => entry.profile.id);
      expect(again).toEqual(first);
    }
  });

  it('breaks score ties by id so the feed cannot reshuffle', () => {
    const ties = [candidate('z', 1), candidate('m', 1), candidate('a', 1)];
    const ids = rankCandidates(base, ties, { limit: 10 }).map((entry) => entry.profile.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('classifies intention compatibility in both directions', () => {
    expect(intentionAffinity('dating', 'dating')).toBe('mutual');
    expect(intentionAffinity('dating', 'both')).toBe('mutual');
    expect(intentionAffinity('dating', 'friendship')).toBe('none');
    expect(intentionAffinity('both', 'friendship')).toBe('mutual');
    expect(intentionAffinity('friendship', 'both')).toBe('mutual');
    expect(intentionAffinity(null, 'dating')).toBe('none');
  });

  it('drops incompatible intentions when the feed requires an intentional fit', () => {
    const datingOnly = profile({ id: 'dating-1', intention: 'dating' as Profile['intention'] });
    const friendOnly = profile({ id: 'friend-1', intention: 'friendship' as Profile['intention'] });
    const me = profile({ intention: 'dating' as Profile['intention'] });

    const withoutFilter = rankCandidates(me, [friendOnly], { limit: 10 });
    expect(withoutFilter.length).toBe(1);

    const withFilter = rankCandidates(me, [friendOnly], { limit: 10, requireIntentionalFit: true });
    expect(withFilter).toEqual([]);

    const keepsDating = rankCandidates(me, [datingOnly], { limit: 10, requireIntentionalFit: true });
    expect(keepsDating.length).toBe(1);
  });

  it('never returns an excluded (blocked) candidate', () => {
    const blocked = candidate('blocked-id', 1);
    const visible = candidate('visible-id', 1);

    const ranked = rankCandidates(base, [blocked, visible], {
      limit: 10,
      excludeIds: ['blocked-id'],
    });

    expect(ranked.map((entry) => entry.profile.id)).toEqual(['visible-id']);
  });

  it('explains the score as three components that sum to the total', () => {
    const breakdown = explainMatch(base, MOCK_USERS[0]);
    expect(breakdown.intention + breakdown.interests + breakdown.prompts).toBeCloseTo(
      breakdown.total,
      5
    );
    expect(breakdown.intention).toBeLessThanOrEqual(40);
    expect(breakdown.interests).toBeLessThanOrEqual(30);
    expect(breakdown.prompts).toBeLessThanOrEqual(30);
  });

  it('does not let answering more prompts lower a score', () => {
    const few = profile({ id: 'few', promptAnswers: { 'simple-pleasures': 'coffee at sunrise' } });
    const many = profile({
      id: 'many',
      promptAnswers: {
        'simple-pleasures': 'coffee at sunrise',
        'perfect-weekend': 'coffee at sunrise',
      },
    });
    expect(matchScore(base, many)).toBeGreaterThanOrEqual(matchScore(base, few));
  });
});
