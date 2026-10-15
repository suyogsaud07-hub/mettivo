import { describe, expect, it } from 'vitest';
import type { NotificationRow } from '@/lib/types';
import {
  actionForNotification,
  describeNotification,
  formatRelativeTime,
  typesForTab,
} from '@/lib/notifications';
import { countryFlag, genderIcon } from '@/lib/moments';
import { FEATURED_GAME, GAMES, getGame, summariseResults } from '@/lib/games';
import type { GameResultRow, NotificationType } from '@/lib/types';

const NOTIFICATION_TYPES: NotificationType[] = [
  'follow',
  'like',
  'match',
  'message',
  'visitor',
  'report',
];

const notification = (overrides: Partial<NotificationRow>): NotificationRow => ({
  id: 'n1',
  user_id: 'u1',
  actor_id: 'u2',
  type: 'like',
  entity_id: null,
  read_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('notification copy', () => {
  it('has a sentence for every notification type', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(describeNotification(type).length).toBeGreaterThan(0);
    }
  });
});

describe('notification actions', () => {
  it('deep-links match and message notifications into the chat', () => {
    const match = actionForNotification(
      notification({ type: 'match', entity_id: 'match-123' })
    );
    expect(match).toEqual({ label: 'Message', href: '/chat/match-123' });

    const message = actionForNotification(
      notification({ type: 'message', entity_id: 'match-9' })
    );
    expect(message?.href).toBe('/chat/match-9');
  });

  it('returns no action when a deep link is impossible', () => {
    expect(actionForNotification(notification({ type: 'match', entity_id: null }))).toBeNull();
    expect(actionForNotification(notification({ type: 'visitor' }))).toBeNull();
    expect(actionForNotification(notification({ type: 'report' }))).toBeNull();
  });

  it('routes profile-driven notifications to a browsing surface', () => {
    expect(actionForNotification(notification({ type: 'like' }))?.href).toBe('/discover');
    expect(actionForNotification(notification({ type: 'follow' }))?.href).toBe('/people');
  });
});

describe('notification tabs', () => {
  it('shows everything under All', () => {
    expect(typesForTab('All')).toBeNull();
  });

  it('scopes each dedicated tab', () => {
    expect(typesForTab('Follows')).toEqual(['follow']);
    expect(typesForTab('Likes')).toEqual(['like']);
    expect(typesForTab('Visitors')).toEqual(['visitor']);
    expect(typesForTab('Activity')).toContain('match');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it('buckets time into human units', () => {
    expect(formatRelativeTime(ago(30), now)).toBe('just now');
    expect(formatRelativeTime(ago(60), now)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(120), now)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(3600), now)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(86400), now)).toBe('1 day ago');
    expect(formatRelativeTime(ago(86400 * 60), now)).toBe('2 months ago');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});

describe('moments helpers', () => {
  it('maps known countries to flags', () => {
    expect(countryFlag('Nepal')).toBe('🇳🇵');
    expect(countryFlag('United Kingdom')).toBe('🇬🇧');
  });

  it('falls back to a globe for unknown or missing countries', () => {
    expect(countryFlag('Atlantis')).toBe('🌐');
    expect(countryFlag(null)).toBe('🌐');
    expect(countryFlag(undefined)).toBe('🌐');
  });

  it('maps genders to icons', () => {
    expect(genderIcon('Woman')).toBe('♀️');
    expect(genderIcon('Man')).toBe('♂️');
    expect(genderIcon('Nonbinary')).toBe('⚧');
  });
});

describe('game helpers', () => {
  const result = (outcome: GameResultRow['outcome']): GameResultRow => ({
    id: `r${Math.random()}`,
    user_id: 'u1',
    game_id: 'tic-tac-toe',
    outcome,
    score: 0,
    duration_seconds: null,
    created_at: new Date().toISOString(),
  });

  it('reports a null win rate before any game is played', () => {
    const stats = summariseResults([]);
    expect(stats).toEqual({ gamesPlayed: 0, wins: 0, losses: 0, draws: 0, winRate: null });
  });

  it('counts outcomes and computes the win rate', () => {
    const stats = summariseResults([result('win'), result('win'), result('loss'), result('draw')]);
    expect(stats.gamesPlayed).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.draws).toBe(1);
    expect(stats.winRate).toBe(50);
  });

  it('rounds the win rate to a whole percentage', () => {
    expect(summariseResults([result('win'), result('loss'), result('loss')]).winRate).toBe(33);
  });

  it('looks games up by id', () => {
    expect(getGame('tic-tac-toe')?.title).toBe('Tic Tac Toe');
    expect(getGame('nope')).toBeUndefined();
  });

  it('keeps the featured game aligned with the catalogue', () => {
    expect(GAMES).toContain(FEATURED_GAME);
    expect(FEATURED_GAME.playable).toBe(true);
  });

  it('gives every unplayable game a stated reason', () => {
    for (const game of GAMES.filter((entry) => !entry.playable)) {
      expect(game.pendingReason?.length ?? 0).toBeGreaterThan(20);
    }
  });
});
