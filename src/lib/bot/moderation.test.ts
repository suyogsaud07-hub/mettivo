import { describe, expect, it } from 'vitest';
import {
  SUBBU_IMAGE_BAN_DAYS,
  SUBBU_TEXT_BAN_DAYS,
  banDeniedMessage,
  formatBanDate,
  parseBanFlag,
  parseBanStatus,
  suspensionBanner,
} from './moderation';
import { SUBBU_SYSTEM_PROMPT } from './constants';

const FLAG = '{"action":"ban","duration":"2_days","reason":"verbal_harassment"}';

describe('parseBanFlag', () => {
  it('accepts the exact flag the prompt demands', () => {
    expect(parseBanFlag(FLAG)).toEqual({
      days: SUBBU_TEXT_BAN_DAYS,
      reason: 'verbal_harassment',
    });
  });

  it('accepts the flag inside a code fence or a sentence', () => {
    expect(parseBanFlag('```json\n' + FLAG + '\n```')?.reason).toBe('verbal_harassment');
    expect(parseBanFlag(`Banning now: ${FLAG}`)?.days).toBe(2);
  });

  it('ignores prose, malformed JSON and unrelated objects', () => {
    expect(parseBanFlag('You are banned.')).toBeNull();
    expect(parseBanFlag('{not json}')).toBeNull();
    expect(parseBanFlag('{"action":"warn","duration":"2_days","reason":"x"}')).toBeNull();
    expect(parseBanFlag('{"action":"ban","duration":"7_days","reason":"x"}')).toBeNull();
    expect(parseBanFlag('{"action":"ban","duration":"2_days","reason":"  "}')).toBeNull();
    expect(parseBanFlag('')).toBeNull();
  });

  it('never trusts an arbitrary duration', () => {
    // A prompt-injected reply cannot ask for a year.
    expect(parseBanFlag('{"action":"ban","duration":"365_days","reason":"x"}')).toBeNull();
  });
});

describe('parseBanStatus', () => {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it('treats a future timestamp as banned', () => {
    expect(parseBanStatus({ banned_until: future, ban_reason: 'verbal_harassment' })).toEqual({
      banned: true,
      until: future,
      reason: 'verbal_harassment',
    });
  });

  it('treats an expired or missing ban as not banned', () => {
    expect(parseBanStatus({ banned_until: past, ban_reason: 'x' }).banned).toBe(false);
    expect(parseBanStatus(null)).toEqual({ banned: false, until: null, reason: null });
    expect(parseBanStatus({ banned_until: 'not-a-date' }).banned).toBe(false);
  });
});

describe('ban copy', () => {
  it('formats the API message with the expiry and a readable reason', () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const message = banDeniedMessage(until, 'verbal_harassment');
    expect(message).toContain('banned until');
    expect(message).toContain('verbal harassment');
  });

  it('formats the required suspension banner', () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    expect(suspensionBanner(until)).toMatch(
      /^Your account has been suspended for violating community guidelines\. Ban expires: .+\.$/,
    );
  });

  it('falls back to the raw value for an unparseable date', () => {
    expect(formatBanDate('nope')).toBe('nope');
  });

  it('keeps the two-tier policy', () => {
    expect(SUBBU_TEXT_BAN_DAYS).toBe(2);
    expect(SUBBU_IMAGE_BAN_DAYS).toBe(30);
  });
});

describe('SUBBU_SYSTEM_PROMPT', () => {
  it('contains the exact ban flag and forbids prose', () => {
    expect(SUBBU_SYSTEM_PROMPT).toContain(FLAG);
    expect(SUBBU_SYSTEM_PROMPT).toMatch(/Do not apologise, explain, or say "you are banned"/);
  });
});
