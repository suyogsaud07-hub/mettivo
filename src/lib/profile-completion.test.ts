import { describe, expect, it } from 'vitest';
import {
  buildProfileCompletion,
  type CompletionProfile,
} from '@/lib/profile-completion';

const completeProfile = (overrides: Partial<CompletionProfile> = {}): CompletionProfile => ({
  firstName: 'Sujata',
  lastName: 'Saud',
  hasLastName: true,
  username: 'sujata',
  age: 28,
  gender: 'Woman',
  city: 'Kathmandu',
  country: 'Nepal',
  avatarUrl: 'avatar',
  bio: 'Coffee, mountains and long conversations.',
  intention: 'dating',
  lookingFor: ['Men'],
  hobbies: ['Music'],
  interests: ['hiking'],
  physicalAttributes: ['Slim'],
  height: '170 cm',
  mbti: 'INFJ',
  religion: 'Prefer not to say',
  drinking: 'Social drinker',
  smoking: 'Non-smoker',
  exercise: 'A few times a week',
  education: "Bachelor's Degree",
  profession: 'Engineer',
  languagesSpoken: ['English'],
  pets: ['Dog lover'],
  prompts: { 'simple-pleasures': 'Coffee at sunrise' },
  ...overrides,
});

const essentialOnly = (overrides: Partial<CompletionProfile> = {}): CompletionProfile =>
  completeProfile({
    height: null,
    physicalAttributes: null,
    mbti: null,
    prompts: null,
    interests: null,
    hobbies: null,
    pets: null,
    smoking: null,
    drinking: null,
    exercise: null,
    education: null,
    profession: null,
    languagesSpoken: null,
    religion: null,
    ...overrides,
  });

describe('profile completion — the honest launch percentage', () => {
  it('starts at 8 of 17 (47%), not a fabricated 50%', () => {
    const completion = buildProfileCompletion(essentialOnly());
    expect(completion.completedCount).toBe(8);
    expect(completion.totalCount).toBe(17);
    expect(completion.remainingCount).toBe(9);
    expect(completion.percentage).toBe(47);
    expect(completion.isComplete).toBe(false);
  });

  it('reaches 100% only when every section is genuinely complete', () => {
    const completion = buildProfileCompletion(completeProfile());
    expect(completion.completedCount).toBe(17);
    expect(completion.percentage).toBe(100);
    expect(completion.isComplete).toBe(true);
    expect(completion.nextRecommended).toEqual([]);
  });

  it('exposes all seventeen sections with stable direct links', () => {
    const completion = buildProfileCompletion(essentialOnly());
    expect(completion.items).toHaveLength(17);
    expect(completion.items.every((item) => item.href.startsWith('/profile/edit?section='))).toBe(
      true
    );
    expect(completion.items.find((item) => item.sectionId === 'photos')?.href).toBe(
      '/profile/edit?section=photos'
    );
  });
});

describe('profile completion — empty values are not progress', () => {
  it('does not count whitespace-only text', () => {
    const completion = buildProfileCompletion(completeProfile({ bio: '   ' }));
    expect(completion.completedCount).toBe(16);
    expect(completion.items.find((item) => item.sectionId === 'bio')?.complete).toBe(false);
  });

  it('does not count empty arrays', () => {
    const completion = buildProfileCompletion(
      completeProfile({ interests: [], hobbies: [], lookingFor: [] })
    );
    const byId = new Map(completion.items.map((item) => [item.sectionId, item]));
    expect(byId.get('interests')?.complete).toBe(false);
    expect(byId.get('preferences')?.complete).toBe(false);
  });

  it('requires a complete lifestyle trio', () => {
    const completion = buildProfileCompletion(completeProfile({ exercise: '   ' }));
    expect(completion.items.find((item) => item.sectionId === 'lifestyle')?.complete).toBe(
      false
    );
  });

  it('requires a complete prompt pair', () => {
    const half = buildProfileCompletion(
      completeProfile({ prompts: { 'simple-pleasures': '   ' } })
    );
    expect(half.items.find((item) => item.sectionId === 'prompts')?.complete).toBe(false);
  });
});

describe('profile completion — optional answers count when present', () => {
  it('accepts interests OR hobbies', () => {
    const interestsOnly = buildProfileCompletion(
      essentialOnly({ interests: ['hiking'], hobbies: null })
    );
    const hobbiesOnly = buildProfileCompletion(
      essentialOnly({ interests: null, hobbies: ['Music'] })
    );
    expect(
      interestsOnly.items.find((item) => item.sectionId === 'interests')?.complete
    ).toBe(true);
    expect(hobbiesOnly.items.find((item) => item.sectionId === 'interests')?.complete).toBe(
      true
    );
  });

  it('treats "Prefer not to say" as a real religion answer', () => {
    const completion = buildProfileCompletion(
      essentialOnly({ religion: 'Prefer not to say' })
    );
    expect(completion.items.find((item) => item.sectionId === 'religion')?.complete).toBe(
      true
    );
  });

  it('completes photos with one profile picture; gallery depth is separate', () => {
    const completion = buildProfileCompletion(essentialOnly({ avatarUrl: 'avatar' }));
    expect(completion.items.find((item) => item.sectionId === 'photos')?.complete).toBe(
      true
    );
  });
});

describe('profile completion — recommendations', () => {
  it('recommends progressive depth first after launch, not admin fields', () => {
    const completion = buildProfileCompletion(essentialOnly());
    expect(completion.nextRecommended.map((item) => item.sectionId)).toEqual([
      'interests',
      'personality',
      'prompts',
    ]);
  });

  it('skips completed recommendations without reordering the rest', () => {
    const completion = buildProfileCompletion(
      essentialOnly({
        interests: ['hiking'],
        hobbies: ['Music'],
        mbti: 'INFJ',
      })
    );
    expect(completion.nextRecommended.map((item) => item.sectionId)).toEqual([
      'prompts',
      'pets',
      'physical',
    ]);
  });

  it('never recommends a section that is already complete', () => {
    const completion = buildProfileCompletion(completeProfile({ pets: null }));
    expect(completion.nextRecommended.map((item) => item.sectionId)).toEqual(['pets']);
  });

  it('surfaces an incomplete essential section for an older account', () => {
    const completion = buildProfileCompletion(completeProfile({ bio: '' }));
    expect(completion.nextRecommended[0]?.sectionId).toBe('bio');
  });
});
