import { describe, expect, it } from 'vitest';
import { buildChallengePhrase } from './phrase';

describe('buildChallengePhrase', () => {
  it('produces two words and a two-digit number', () => {
    const phrase = buildChallengePhrase(() => 0.42);
    expect(phrase).toMatch(/^[a-z]+ [a-z]+ \d{2}$/);
  });

  it('is deterministic for an injected source', () => {
    expect(buildChallengePhrase(() => 0)).toBe('amber amber 10');
    expect(buildChallengePhrase(() => 0.5)).toBe('pebble pebble 55');
  });

  it('never produces a one-digit or three-digit number', () => {
    for (let i = 0; i < 50; i += 1) {
      const parts = buildChallengePhrase(() => i / 50).split(' ');
      const number = Number(parts[2]);
      expect(number).toBeGreaterThanOrEqual(10);
      expect(number).toBeLessThanOrEqual(99);
    }
  });
});
