import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_GENDERS,
  gendersForLookingFor,
  preferenceAffinity,
} from '@/lib/dating-preferences';
import { rankCandidates } from '@/lib/matching';

describe('dating preferences', () => {
  it('maps saved labels onto discovery genders', () => {
    expect(gendersForLookingFor(['Women'])).toEqual(['Woman']);
    expect(gendersForLookingFor(['Men'])).toEqual(['Man']);
    expect(gendersForLookingFor(['Men', 'Women'])).toEqual(['Man', 'Woman']);
    expect(gendersForLookingFor(['Everyone'])).toEqual([...DISCOVERY_GENDERS]);
  });

  it('treats missing or unrecognised values as no constraint', () => {
    expect(gendersForLookingFor([])).toEqual([...DISCOVERY_GENDERS]);
    expect(gendersForLookingFor(null)).toEqual([...DISCOVERY_GENDERS]);
    expect(gendersForLookingFor(['legacy-value'])).toEqual([...DISCOVERY_GENDERS]);
  });

  it('distinguishes mutual, one-way, excluded and unknown affinity', () => {
    const woman = { gender: 'Woman', lookingFor: ['Men'] };
    const man = { gender: 'Man', lookingFor: ['Women'] };
    const unset = { gender: 'Man', lookingFor: [] };

    expect(preferenceAffinity(woman, man)).toBe('mutual');
    expect(preferenceAffinity(woman, unset)).toBe('one-way');
    expect(preferenceAffinity(woman, { ...unset, lookingFor: ['Men'] })).toBe('none');
    expect(preferenceAffinity({ gender: 'Woman' }, { gender: 'Man' })).toBe('unknown');
  });

  it('does not erase nonbinary candidates when the member chose Everyone', () => {
    expect(
      preferenceAffinity(
        { gender: 'Nonbinary', lookingFor: ['Everyone'] },
        { gender: 'Woman', lookingFor: ['Everyone'] }
      )
    ).toBe('mutual');
  });
});

describe('preference-aware ranking', () => {
  const me = {
    id: 'me',
    gender: 'Woman',
    lookingFor: ['Men'],
    intention: 'dating',
    interests: ['coffee'],
    promptAnswers: {},
    online: false,
  };

  const candidate = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    intention: 'dating',
    interests: ['coffee'],
    promptAnswers: {},
    gender: 'Man',
    lookingFor: ['Women'],
    online: false,
    ...overrides,
  });

  it('puts a mutual preference fit ahead of a stronger raw score', () => {
    const compatible = candidate('compatible', { interests: [] });
    const incompatible = candidate('incompatible', {
      gender: 'Man',
      lookingFor: ['Men'],
      interests: ['coffee', 'travel', 'art'],
    });

    const ranked = rankCandidates(me, [incompatible, compatible], { limit: 10 });
    expect(ranked[0]?.profile.id).toBe('compatible');
    expect(ranked[0]?.preferenceFit).toBe('mutual');
  });

  it('puts online candidates first when online-first is enabled', () => {
    const offline = candidate('offline', { interests: ['coffee', 'travel'] });
    const online = candidate('online', { online: true, interests: [] });

    const ranked = rankCandidates(me, [offline, online], {
      limit: 10,
      onlineFirst: true,
    });
    expect(ranked[0]?.profile.id).toBe('online');
  });

  it('keeps the id tie-break so equivalent candidates do not reshuffle', () => {
    const pool = [candidate('z'), candidate('a'), candidate('m')];
    const ids = rankCandidates(me, pool, { limit: 10 }).map((entry) => entry.profile.id);
    expect(ids).toEqual(['a', 'm', 'z']);
  });
});
