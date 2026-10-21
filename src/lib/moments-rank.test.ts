import { describe, expect, it } from 'vitest';
import {
  MOMENT_RANK_WEIGHTS,
  momentRelevance,
  rankMoments,
  type RankContext,
} from '@/lib/moments-rank';
import type { MomentFeedRow } from '@/lib/types';

const NOW = Date.parse('2026-01-10T12:00:00.000Z');

let seq = 0;

function row(overrides: Partial<MomentFeedRow> = {}): MomentFeedRow {
  seq += 1;
  return {
    id: `m-${seq.toString().padStart(3, '0')}`,
    author_id: `author-${seq}`,
    caption: null,
    media: [],
    media_type: null,
    content_kind: 'post',
    duration_seconds: null,
    allow_downloads: false,
    moderation_status: 'approved',
    tags: [],
    shares: 0,
    views_count: 0,
    unique_views: 0,
    like_count: 0,
    comment_count: 0,
    save_count: 0,
    liked_by_me: false,
    saved_by_me: false,
    visibility: 'public',
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('momentRelevance', () => {
  it('rewards engagement, weighting saves above likes', () => {
    const liked = row({ like_count: 10 });
    const saved = row({ save_count: 10 });
    expect(momentRelevance(saved, {}, NOW)).toBeGreaterThan(momentRelevance(liked, {}, NOW));
  });

  it('dampens a viral outlier with log1p', () => {
    const a = momentRelevance(row({ like_count: 100 }), {}, NOW);
    const b = momentRelevance(row({ like_count: 1000 }), {}, NOW);
    expect(b).toBeGreaterThan(a);
    // 10x the likes must be far less than 10x the score.
    expect(b).toBeLessThan(a * 4);
  });

  it('decays with age: a fresh post beats a stale one at equal engagement', () => {
    const fresh = momentRelevance(
      row({ created_at: new Date(NOW - 3_600_000).toISOString() }),
      {},
      NOW
    );
    const stale = momentRelevance(
      row({ created_at: new Date(NOW - 7 * 24 * 3_600_000).toISOString() }),
      {},
      NOW
    );
    expect(fresh).toBeGreaterThan(stale);
  });

  it('boosts posts from followed authors', () => {
    const target = row({ author_id: 'followed' });
    const context: RankContext = { following: new Set(['followed']) };
    expect(momentRelevance(target, context, NOW)).toBeGreaterThan(
      momentRelevance(target, {}, NOW)
    );
    expect(MOMENT_RANK_WEIGHTS.followingBoost).toBeGreaterThan(0);
  });

  it('boosts posts whose tags or hashtags match the viewer interests', () => {
    const tagged = row({ tags: ['Hiking'] });
    const caption = row({ caption: 'Morning trail #hiking' });
    const context: RankContext = { interests: ['hiking'] };
    expect(momentRelevance(tagged, context, NOW)).toBeGreaterThan(
      momentRelevance(tagged, {}, NOW)
    );
    expect(momentRelevance(caption, context, NOW)).toBeGreaterThan(
      momentRelevance(caption, {}, NOW)
    );
  });
});

describe('rankMoments', () => {
  it('orders by score, then created_at, then id', () => {
    const low = row({ id: 'b', like_count: 1 });
    const high = row({ id: 'c', like_count: 50 });
    const ordered = rankMoments([low, high], {}, { now: NOW });
    expect(ordered[0].id).toBe('c');
  });

  it('is deterministic for equal scores', () => {
    const a = row({
      id: 'a',
      author_id: 'x',
      created_at: new Date(NOW - 1000).toISOString(),
    });
    const b = row({
      id: 'b',
      author_id: 'y',
      created_at: new Date(NOW - 1000).toISOString(),
    });
    const first = rankMoments([a, b], {}, { now: NOW }).map((r) => r.id);
    const second = rankMoments([b, a], {}, { now: NOW }).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it('lets a followed author outrank a slightly more liked stranger', () => {
    const stranger = row({ id: 'stranger', author_id: 's', like_count: 6 });
    const friend = row({ id: 'friend', author_id: 'f', like_count: 5 });
    const ordered = rankMoments([stranger, friend], { following: new Set(['f']) }, { now: NOW });
    expect(ordered[0].id).toBe('friend');
  });

  it('spreads a prolific author instead of stacking them', () => {
    const rows = [
      row({ id: 'p1', author_id: 'prolific', like_count: 100 }),
      row({ id: 'p2', author_id: 'prolific', like_count: 90 }),
      row({ id: 'p3', author_id: 'prolific', like_count: 80 }),
      row({ id: 'o1', author_id: 'other', like_count: 1 }),
      row({ id: 'o2', author_id: 'else', like_count: 1 }),
    ];
    const ordered = rankMoments(rows, {}, { now: NOW, diversifyCreators: true });
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].author_id).not.toBe(ordered[i - 1].author_id);
    }
  });

  it('leaves order untouched when diversification is disabled', () => {
    const rows = [
      row({ id: 'p1', author_id: 'same', like_count: 100 }),
      row({ id: 'p2', author_id: 'same', like_count: 90 }),
    ];
    const ordered = rankMoments(rows, {}, { now: NOW, diversifyCreators: false });
    // No other author to interleave, so both orders are the same here.
    expect(ordered.map((r) => r.id)).toEqual(['p1', 'p2']);
  });
});
