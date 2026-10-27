import { describe, expect, it } from 'vitest';
import { MAX_BIO_LENGTH } from '@/lib/profile';
import type { OnboardingState } from '@/lib/onboarding-steps';
import { buildProfileSectionPatch } from '@/lib/profile-sections';

const state = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  firstName: 'Sujata',
  lastName: 'Saud',
  hasLastName: true,
  username: 'sujata',
  avatarUrl: 'avatar',
  photos: ['a', 'b', 'c', 'd'],
  gender: 'Woman',
  pronouns: 'she/her',
  birthDate: '1998-05-04',
  country: 'Nepal',
  city: 'Kathmandu',
  height: '170 cm',
  physicalAttributes: ['Slim'],
  intention: 'dating',
  lookingFor: ['Men'],
  sexualOrientation: 'Straight',
  mbti: 'INFJ',
  religion: 'Hindu',
  prompts: { 'simple-pleasures': 'Coffee at sunrise' },
  interests: ['hiking'],
  hobbies: ['Music'],
  pets: ['Dog lover'],
  smoking: 'Non-smoker',
  drinking: 'Social drinker',
  exercise: 'A few times a week',
  education: "Bachelor's Degree",
  profession: 'Engineer',
  languagesSpoken: ['English'],
  bio: 'Coffee, mountains and long conversations.',
  ...overrides,
});

describe('profile section patches — narrow writes', () => {
  it('writes only the identity columns for the name section', () => {
    const result = buildProfileSectionPatch('name', state());
    expect(result.ok).toBe(true);
    expect(Object.keys(result.patch).sort()).toEqual([
      'display_name',
      'first_name',
      'has_last_name',
      'last_name',
      'username',
    ]);
  });

  it('writes only mbti for personality, so a stale tab cannot overwrite other fields', () => {
    const result = buildProfileSectionPatch('personality', state({ mbti: 'enfp' }));
    expect(result).toEqual({ ok: true, patch: { mbti: 'ENFP' } });
  });

  it('never includes the row id, ownership or launch state', () => {
    for (const section of [
      'name',
      'identity',
      'birthday',
      'location',
      'intention',
      'preferences',
      'bio',
      'photos',
      'physical',
      'personality',
      'prompts',
      'interests',
      'pets',
      'lifestyle',
      'career',
      'languages',
      'religion',
    ] as const) {
      const result = buildProfileSectionPatch(section, state());
      expect(result.ok, section).toBe(true);
      expect(result.patch, section).not.toHaveProperty('id');
      expect(result.patch, section).not.toHaveProperty('onboarding_completed');
    }
  });
});

describe('profile section patches — progressive edits accept clear', () => {
  it('saves an empty progressive section', () => {
    const result = buildProfileSectionPatch(
      'personality',
      state({ mbti: '  ', physicalAttributes: [] })
    );
    expect(result.ok).toBe(true);
    expect(result.patch).toEqual({ mbti: '' });
  });

  it('deduplicates and caps arrays', () => {
    const interests = Array.from({ length: 15 }, (_, index) => `Interest ${index}`);
    const result = buildProfileSectionPatch(
      'interests',
      state({ interests: ['hiking', 'Hiking', ...interests], hobbies: ['Music'] })
    );
    expect(result.ok).toBe(true);
    expect(result.patch.interests).toHaveLength(12);
    expect(result.patch.hobbies).toEqual(['Music']);
    expect(new Set(result.patch.interests as string[]).size).toBe(12);
  });

  it('refuses half-answered prompts instead of persisting holes', () => {
    const result = buildProfileSectionPatch(
      'prompts',
      state({
        prompts: {
          'simple-pleasures': ' Coffee ',
          '': 'orphan',
          'ideal-weekend': '   ',
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/both a question and an answer/);
  });

  it('bounds bio length', () => {
    const result = buildProfileSectionPatch(
      'bio',
      state({ bio: 'x'.repeat(MAX_BIO_LENGTH + 1) })
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(new RegExp(`${MAX_BIO_LENGTH}`));
  });
});

describe('profile section patches — photo launch rule', () => {
  it('requires a profile picture but accepts an empty gallery', () => {
    const result = buildProfileSectionPatch('photos', state({ photos: [] }));
    expect(result.ok).toBe(true);
    expect(result.patch).toEqual({ avatar_url: 'avatar', photos: [] });

    const missing = buildProfileSectionPatch('photos', state({ avatarUrl: '   ' }));
    expect(missing.ok).toBe(false);
    expect(missing.message).toMatch(/profile picture/i);
  });
});
