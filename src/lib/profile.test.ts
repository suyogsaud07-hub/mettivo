import { describe, expect, it } from 'vitest';
import {
  MAX_BIO_LENGTH,
  MAX_RELIGION_LENGTH,
  MIN_AGE,
  calculateAge,
  isAdult,
  validateProfileDraft,
  type ProfileDraft,
} from '@/lib/profile';
import {
  FIELD_TO_STEP,
  INITIAL_ONBOARDING_STEPS,
  MAX_PHOTOS,
  ONBOARDING_GENDERS,
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  PROFILE_SECTIONS,
  PROGRESSIVE_PROFILE_SECTIONS,
  RECOMMENDED_GALLERY_PHOTOS,
  profileSectionById,
  validateOnboardingStep,
  validateProfileSection,
  type OnboardingState,
} from '@/lib/onboarding-steps';

/**
 * M7 — profile validation, and the 18+ gate in particular.
 *
 * The gate previously failed silently: `calculateAge` clamped with
 * `Math.max(18, …)`, so a 15-year-old's real date of birth was stored and shown
 * as 18. On a dating product for adults that is the highest-severity defect in
 * the codebase (`RISK_REGISTER.md` R-05), so it gets direct tests.
 */

const NOW = new Date('2026-10-15T12:00:00Z');

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  id: 'user-1',
  firstName: 'Sujata',
  lastName: 'Saud',
  hasLastName: true,
  username: 'sujata',
  birthDate: '1998-05-04',
  intention: 'dating',
  ...overrides,
});

describe('M7 — age derivation', () => {
  it('reports the true age, not a clamped one', () => {
    expect(calculateAge('2011-01-01', NOW)).toBe(15);
    expect(calculateAge('1998-05-04', NOW)).toBe(28);
  });

  it('does not round up before the birthday', () => {
    // Born 1998-11-01, "today" is 2026-10-15: still 27.
    expect(calculateAge('1998-11-01', NOW)).toBe(27);
  });

  it('treats a future date as no birth date at all', () => {
    expect(calculateAge('2030-01-01', NOW)).toBeNull();
  });

  it('returns null for missing or unparseable input', () => {
    expect(calculateAge('', NOW)).toBeNull();
    expect(calculateAge(undefined, NOW)).toBeNull();
    expect(calculateAge('not-a-date', NOW)).toBeNull();
  });

  it('knows who is an adult', () => {
    expect(isAdult('1998-05-04', NOW)).toBe(true);
    expect(isAdult('2011-01-01', NOW)).toBe(false);
    expect(isAdult('', NOW)).toBe(false);
  });
});

describe('M7 — draft validation', () => {
  it('accepts a complete adult draft and builds the payload', () => {
    const result = validateProfileDraft(draft(), NOW);
    expect(result.ok).toBe(true);
    expect(result.payload.age).toBe(28);
    expect(result.payload.display_name).toBe('Sujata Saud');
    expect(result.payload.onboarding_completed).toBe(true);
  });

  it('refuses an underage date of birth instead of clamping it', () => {
    const result = validateProfileDraft(draft({ birthDate: '2011-01-01' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('birthDate');
    expect(result.problems[0].message).toMatch(new RegExp(`${MIN_AGE}`));
    // Nothing is persisted from a rejected draft.
    expect(result.payload).toEqual({});
  });

  it('refuses a missing date of birth', () => {
    const result = validateProfileDraft(draft({ birthDate: '' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('birthDate');
  });

  it('requires a first name and bounds its length', () => {
    expect(validateProfileDraft(draft({ firstName: '   ' }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ firstName: 'x'.repeat(41) }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ firstName: 'x'.repeat(40) }), NOW).ok).toBe(true);
  });

  it('allows a missing last name only when the member opts out', () => {
    expect(validateProfileDraft(draft({ lastName: '', hasLastName: false }), NOW).ok).toBe(true);
    expect(
      validateProfileDraft(draft({ lastName: '   ', hasLastName: true }), NOW).ok
    ).toBe(false);
  });

  it('normalizes and requires a valid username', () => {
    expect(validateProfileDraft(draft({ username: '@Sujata_1' }), NOW).payload.username).toBe(
      'sujata_1'
    );
    expect(validateProfileDraft(draft({ username: 'bad name' }), NOW).ok).toBe(false);
  });

  it('rejects an intention outside the closed set', () => {
    const result = validateProfileDraft(draft({ intention: 'polyamory' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('intention');
  });

  it('bounds the bio and caps photos', () => {
    expect(validateProfileDraft(draft({ bio: 'x'.repeat(MAX_BIO_LENGTH + 1) }), NOW).ok).toBe(false);
    expect(
      validateProfileDraft(draft({ photos: Array.from({ length: 7 }, (_, i) => `p${i}`) }), NOW).ok
    ).toBe(false);
  });

  it('de-duplicates and caps multi-select fields', () => {
    const result = validateProfileDraft(
      draft({ interests: ['coffee', 'coffee', 'hiking'], hobbies: ['Music', 'music'] }),
      NOW
    );
    expect(result.payload.interests).toEqual(['coffee', 'hiking']);
    expect(result.payload.hobbies).toEqual(['Music']);
  });

  it('keeps religion optional, trims it, and bounds its length', () => {
    expect(validateProfileDraft(draft(), NOW).payload.religion).toBe('');
    expect(validateProfileDraft(draft({ religion: '  Hindu  ' }), NOW).payload.religion).toBe(
      'Hindu'
    );
    expect(
      validateProfileDraft(draft({ religion: 'x'.repeat(MAX_RELIGION_LENGTH + 1) }), NOW).ok
    ).toBe(false);
  });

  it('never validates a draft into a payload without an adult age', () => {
    // Property: if `ok` is true, the persisted age is an adult age.
    const ages = ['1990-01-01', '2008-10-15', '2008-10-16', '2015-06-01'];
    for (const birthDate of ages) {
      const result = validateProfileDraft(draft({ birthDate }), NOW);
      if (result.ok) {
        expect(Number(result.payload.age)).toBeGreaterThanOrEqual(MIN_AGE);
      } else {
        expect(result.payload).toEqual({});
      }
    }
  });
});

/**
 * The onboarding registry and section controller.
 *
 * The launch path is now eight ESSENTIAL sections. The other nine remain
 * first-class profile sections with progressive validation: empty is valid,
 * malformed is not. These tests pin both halves so a future refactor cannot
 * quietly turn optional depth back into an onboarding wall.
 */

const blankState = (): OnboardingState => ({
  firstName: '',
  lastName: '',
  hasLastName: true,
  username: '',
  avatarUrl: '',
  photos: [],
  gender: '',
  pronouns: '',
  birthDate: '',
  country: '',
  city: '',
  height: '',
  physicalAttributes: [],
  intention: '',
  lookingFor: [],
  sexualOrientation: '',
  mbti: '',
  religion: '',
  prompts: {},
  interests: [],
  hobbies: [],
  pets: [],
  smoking: '',
  drinking: '',
  exercise: '',
  education: '',
  profession: '',
  languagesSpoken: [],
  bio: '',
});

const completeState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
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
  lookingFor: ['Women'],
  sexualOrientation: 'Straight',
  mbti: 'INFJ',
  religion: 'Hindu',
  prompts: { 'simple-pleasures': 'Coffee at sunrise' },
  interests: ['hiking'],
  hobbies: [],
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

describe('onboarding — the registry', () => {
  it('registers all seventeen original sections exactly once', () => {
    expect(PROFILE_SECTIONS).toHaveLength(17);
    expect(PROFILE_SECTIONS.map((spec) => spec.step)).toEqual(
      Array.from({ length: 17 }, (_, index) => index + 1)
    );
    expect(new Set(PROFILE_SECTIONS.map((spec) => spec.id)).size).toBe(17);
  });

  it('launches with eight essential sections and keeps nine progressive', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(8);
    expect(INITIAL_ONBOARDING_STEPS).toHaveLength(8);
    expect(PROGRESSIVE_PROFILE_SECTIONS).toHaveLength(9);
    expect(ONBOARDING_STEPS).toBe(INITIAL_ONBOARDING_STEPS);
    expect(INITIAL_ONBOARDING_STEPS.map((spec) => spec.id)).toEqual([
      'name',
      'identity',
      'birthday',
      'location',
      'intention',
      'preferences',
      'bio',
      'photos',
    ]);
    expect(INITIAL_ONBOARDING_STEPS.every((spec) => spec.stage === 'essential')).toBe(true);
    expect(PROGRESSIVE_PROFILE_SECTIONS.every((spec) => spec.stage === 'progressive')).toBe(
      true
    );
  });

  it('keeps every original field and maps it to its owning section', () => {
    for (const spec of PROFILE_SECTIONS) {
      for (const field of [...spec.required, ...spec.recommended]) {
        expect(FIELD_TO_STEP[field.key], `${field.key} -> step ${spec.step}`).toBe(
          spec.step
        );
      }
    }
    expect(FIELD_TO_STEP.firstName).toBe(1);
    expect(FIELD_TO_STEP.avatarUrl).toBe(17);
    expect(FIELD_TO_STEP.photos).toBe(17);
    expect(FIELD_TO_STEP.height).toBe(5);
    expect(FIELD_TO_STEP.religion).toBe(16);
  });

  it('is addressable by stable id and by step', () => {
    expect(profileSectionById('interests')?.step).toBe(10);
    expect(profileSectionById('not-a-section')).toBeNull();
    expect(validateProfileSection('personality', blankState()).ok).toBe(true);
    expect(validateProfileSection('personality', completeState({ mbti: 'INFJ' })).ok).toBe(
      true
    );
  });

  it('recommends four gallery photos without requiring them', () => {
    expect(RECOMMENDED_GALLERY_PHOTOS).toBe(4);
    expect(MAX_PHOTOS).toBe(6);
    expect(RECOMMENDED_GALLERY_PHOTOS).toBeLessThan(MAX_PHOTOS);
  });
});

describe('onboarding — essential launch steps block and then pass', () => {
  it('blocks every essential section for a blank state', () => {
    for (const spec of INITIAL_ONBOARDING_STEPS) {
      const result = validateOnboardingStep(spec.step, blankState());
      expect(result.ok, `step ${spec.step} (${spec.id}) must block`).toBe(false);
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.problems[0].message.length).toBeGreaterThan(0);
    }
  });

  it('passes every essential section for a complete state', () => {
    for (const spec of INITIAL_ONBOARDING_STEPS) {
      const result = validateOnboardingStep(spec.step, completeState());
      expect(
        result.ok,
        `step ${spec.step} (${spec.id}): ${result.problems[0]?.message ?? ''}`
      ).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it('never makes an essential step depend on a progressive field', () => {
    const noProgressiveDepth = completeState({
      height: '',
      physicalAttributes: [],
      mbti: '',
      prompts: {},
      interests: [],
      hobbies: [],
      pets: [],
      smoking: '',
      drinking: '',
      exercise: '',
      education: '',
      profession: '',
      languagesSpoken: [],
      religion: '',
    });
    for (const spec of INITIAL_ONBOARDING_STEPS) {
      expect(
        validateOnboardingStep(spec.step, noProgressiveDepth).ok,
        `step ${spec.step} must still pass`
      ).toBe(true);
    }
  });

  it('reports only problems owned by the section being validated', () => {
    for (const spec of INITIAL_ONBOARDING_STEPS) {
      // The final launch screen deliberately delegates to the full-draft guard,
      // so it may report a problem owned by an earlier essential section.
      if (spec.id === 'photos') continue;
      for (const problem of validateOnboardingStep(spec.step, blankState()).problems) {
        expect(
          FIELD_TO_STEP[problem.field],
          `step ${spec.step} reported ${problem.field}`
        ).toBe(spec.step);
      }
    }
  });

  it('tolerates the extra fields the page state carries', () => {
    const pageLikeState = { ...completeState(), age: 28, personalityTraits: ['calm'] };
    expect(validateOnboardingStep(1, pageLikeState).ok).toBe(true);
  });

  it('imposes no local requirement outside the registry', () => {
    expect(validateOnboardingStep(0, blankState()).ok).toBe(true);
    expect(validateOnboardingStep(18, blankState()).ok).toBe(true);
  });
});

describe('onboarding — progressive sections accept empty, reject malformed', () => {
  it('passes every progressive section when it is empty', () => {
    for (const spec of PROGRESSIVE_PROFILE_SECTIONS) {
      const result = validateOnboardingStep(spec.step, blankState());
      expect(result.ok, `${spec.id} must be skippable`).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it('rejects a malformed MBTI but accepts a blank one', () => {
    expect(validateProfileSection('personality', completeState({ mbti: '' })).ok).toBe(true);
    expect(validateProfileSection('personality', completeState({ mbti: 'NOPE' })).ok).toBe(
      false
    );
    expect(validateProfileSection('personality', completeState({ mbti: 'infj' })).ok).toBe(
      true
    );
  });

  it('rejects a half-answered prompt but accepts none', () => {
    expect(validateProfileSection('prompts', completeState({ prompts: {} })).ok).toBe(true);
    const half = validateProfileSection(
      'prompts',
      completeState({ prompts: { 'simple-pleasures': '   ' } })
    );
    expect(half.ok).toBe(false);
    expect(half.problems.map((problem) => problem.field)).toContain('prompts');
  });

  it('bounds religion but never requires it', () => {
    expect(validateProfileSection('religion', completeState({ religion: '' })).ok).toBe(true);
    expect(
      validateProfileSection(
        'religion',
        completeState({ religion: 'x'.repeat(MAX_RELIGION_LENGTH + 1) })
      ).ok
    ).toBe(false);
  });
});

describe('onboarding — essential section specifics', () => {
  it('step 1 owns the identity fields and never blocks on photos', () => {
    const problems = validateOnboardingStep(1, blankState()).problems;
    expect(problems.map((problem) => problem.field)).toEqual([
      'firstName',
      'lastName',
      'username',
    ]);
    expect(validateOnboardingStep(1, completeState({ photos: [], avatarUrl: '' })).ok).toBe(
      true
    );
  });

  it('step 2 accepts only the declared gender identities', () => {
    for (const gender of ONBOARDING_GENDERS) {
      expect(validateOnboardingStep(2, completeState({ gender })).ok).toBe(true);
    }
    expect(validateOnboardingStep(2, completeState({ gender: 'Alien' })).ok).toBe(false);
    expect(validateOnboardingStep(2, completeState({ gender: '   ' })).ok).toBe(false);
  });

  it('step 3 refuses a minor with the existing 18+ message, never clamping', () => {
    const minor = validateOnboardingStep(3, completeState({ birthDate: '2015-01-01' }));
    expect(minor.ok).toBe(false);
    expect(minor.problems[0].message).toBe(
      `Mettivo is for adults only. You must be ${MIN_AGE} or older to continue.`
    );

    expect(
      validateOnboardingStep(3, completeState({ birthDate: '' })).problems[0].field
    ).toBe('birthDate');
    expect(validateOnboardingStep(3, completeState()).ok).toBe(true);
  });

  it('step 4 needs both country and city', () => {
    const result = validateOnboardingStep(4, completeState({ country: '' }));
    expect(result.ok).toBe(false);
    expect(result.problems[0].message).toBe('Please select your country to continue.');
    expect(
      validateOnboardingStep(4, completeState({ city: '  ' })).problems.map(
        (problem) => problem.field
      )
    ).toContain('city');
  });

  it('steps 6, 7 and 15 require intention, discovery preference and bio', () => {
    expect(validateOnboardingStep(6, completeState({ intention: '' })).ok).toBe(false);
    expect(validateOnboardingStep(7, completeState({ lookingFor: [] })).ok).toBe(false);
    expect(validateOnboardingStep(15, completeState({ bio: '   ' })).ok).toBe(false);
    expect(validateOnboardingStep(15, completeState()).ok).toBe(true);
  });
});

describe('onboarding — photos launch with one picture, never four', () => {
  it('requires a profile picture', () => {
    const result = validateOnboardingStep(17, completeState({ avatarUrl: '' }));
    expect(result.ok).toBe(false);
    expect(result.problems.find((problem) => problem.field === 'avatarUrl')?.message).toBe(
      'Please add a profile picture to launch your profile.'
    );
  });

  it('accepts zero, one or four gallery photos when the avatar exists', () => {
    for (const photos of [[], ['a'], ['a', 'b', 'c', 'd']]) {
      expect(validateOnboardingStep(17, completeState({ photos })).ok).toBe(true);
    }
  });

  it('still enforces the gallery maximum', () => {
    const result = validateOnboardingStep(
      17,
      completeState({ photos: Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => `p${i}`) })
    );
    expect(result.ok).toBe(false);
    expect(result.problems.map((problem) => problem.field)).toContain('photos');
  });

  it('does not count blank gallery entries as photos', () => {
    expect(validateOnboardingStep(17, completeState({ photos: ['   '] })).ok).toBe(true);
  });

  it('keeps the photo rule out of the full-draft guard', () => {
    expect(validateProfileDraft(draft({ photos: [] }), NOW).ok).toBe(true);
  });
});

describe('onboarding — recommended fields never block', () => {
  it('hints optional physical and orientation fields without failing', () => {
    const physical = validateOnboardingStep(5, completeState({ physicalAttributes: [] }));
    expect(physical.ok).toBe(true);
    expect(physical.missingRecommended).toEqual(['Physical attributes']);

    const orientation = validateOnboardingStep(7, completeState({ sexualOrientation: '' }));
    expect(orientation.ok).toBe(true);
    expect(orientation.missingRecommended).toEqual(['Sexual orientation']);
  });

  it('hints religion on the optional section', () => {
    const skipped = validateOnboardingStep(16, blankState());
    expect(skipped.ok).toBe(true);
    expect(skipped.missingRecommended).toEqual(['Religion']);
    expect(validateOnboardingStep(16, completeState()).missingRecommended).toEqual([]);
  });

  it('hints gallery photos without blocking launch', () => {
    const noGallery = validateOnboardingStep(17, completeState({ photos: [] }));
    expect(noGallery.ok).toBe(true);
    expect(noGallery.missingRecommended).toEqual(['Gallery photos']);
  });
});
