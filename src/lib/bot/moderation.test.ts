import { describe, expect, it } from 'vitest';
import {
  banDeniedMessage,
  formatBanDate,
  parseBanStatus,
  suspensionBanner,
} from './moderation';
import { SUBBU_SYSTEM_PROMPT } from './constants';

describe('parseBanStatus', () => {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it('treats a future timestamp as restricted', () => {
    expect(parseBanStatus({ banned_until: future, ban_reason: 'verbal_harassment' })).toEqual({
      banned: true,
      until: future,
      reason: 'verbal_harassment',
    });
  });

  it('treats an expired or missing restriction as unrestricted', () => {
    expect(parseBanStatus({ banned_until: past, ban_reason: 'x' }).banned).toBe(false);
    expect(parseBanStatus(null)).toEqual({ banned: false, until: null, reason: null });
    expect(parseBanStatus({ banned_until: 'not-a-date' }).banned).toBe(false);
  });
});

describe('restriction copy', () => {
  it('formats the API message with the expiry and a readable reason', () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const message = banDeniedMessage(until, 'verbal_harassment');
    expect(message).toContain('read-only until');
    expect(message).toContain('verbal harassment');
  });

  it('formats the required banner', () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    expect(suspensionBanner(until)).toMatch(
      /^Your account is read-only after a confirmed community guidelines violation\. Expires: .+\.$/,
    );
  });

  it('falls back to the raw value for an unparseable date', () => {
    expect(formatBanDate('nope')).toBe('nope');
  });
});

describe('SUBBU_SYSTEM_PROMPT', () => {
  it('removes ban authority from the model', () => {
    expect(SUBBU_SYSTEM_PROMPT).not.toContain('"action":"ban"');
    expect(SUBBU_SYSTEM_PROMPT).toMatch(/no power to ban/i);
    expect(SUBBU_SYSTEM_PROMPT).toMatch(/human moderator/i);
  });
});
