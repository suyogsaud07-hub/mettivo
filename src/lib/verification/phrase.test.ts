import { describe, expect, it } from 'vitest';
import { buildChallengePhrase } from './phrase';

describe('buildChallengePhrase', () => {
  it('includes the display name and gender', () => {
    const phrase = buildChallengePhrase({ displayName: 'Suman', gender: 'Man' }, () => 0);
    expect(phrase).toBe('Hi, my name is Suman. I am a man.');
  });

  it('handles missing display names gracefully', () => {
    const phrase = buildChallengePhrase({ displayName: null, gender: 'Woman' }, () => 0);
    expect(phrase).toBe('Hi, my name is friend. I am a woman.');
  });

  it('handles nonbinary gender', () => {
    const phrase = buildChallengePhrase({ displayName: 'Sam', gender: 'Nonbinary' }, () => 0);
    expect(phrase).toBe('Hi, my name is Sam. I am nonbinary.');
  });

  it('is deterministic for an injected source', () => {
    const random = () => 0.5;
    expect(buildChallengePhrase({ displayName: 'A', gender: 'Man' }, random))
      .toBe(buildChallengePhrase({ displayName: 'A', gender: 'Man' }, random));
  });

  it('sanitizes dangerous characters from names', () => {
    const phrase = buildChallengePhrase({ displayName: 'Suman <script>', gender: 'Man' }, () => 0);
    expect(phrase).toBe('Hi, my name is Suman. I am a man.');
  });
});