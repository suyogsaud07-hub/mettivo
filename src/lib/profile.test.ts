import { describe, expect, it } from 'vitest';
import {
  MAX_BIO_LENGTH,
  MIN_AGE,
  calculateAge,
  isAdult,
  validateProfileDraft,
  type ProfileDraft,
} from '@/lib/profile';
import {
  FIELD_TO_STEP,
  MAX_PHOTOS,
  MIN_PHOTOS,
  ONBOARDING_GENDERS,
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_STEPS,
  validateOnboardingStep,
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
  displayName: 'Sujata',
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
    expect(result.payload.display_name).toBe('Sujata');
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

  it('requires a display name and bounds its length', () => {
    expect(validateProfileDraft(draft({ displayName: '   ' }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ displayName: 'x'.repeat(61) }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ displayName: 'x'.repeat(60) }), NOW).ok).toBe(true);
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
 * The onboarding step controller.
 *
 * The wizard used to accept `Next` on any step and only reject the member at
 * submit time, so steps 4–14 could be walked empty. `validateOnboardingStep` is
 * now the single source of truth for "does this step block?"; these tests pin
 * every rule, including the character-exact photo message the browser suite
 * matches on.
 */

const blankState = (): OnboardingState => ({
  displayName: '',
  photos: [],
  gender: '',
  birthDate: '',
  country: '',
  city: '',
  height: '',
  physicalAttributes: [],
  intention: '',
  lookingFor: [],
  sexualOrientation: '',
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
  bio: '',
});

const completeState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  displayName: 'Sujata',
  photos: ['a', 'b', 'c', 'd'],
  gender: 'Woman',
  birthDate: '1998-05-04',
  country: 'Nepal',
  city: 'Kathmandu',
  height: '170 cm',
  physicalAttributes: ['Slim'],
  intention: 'dating',
  lookingFor: ['Women'],
  sexualOrientation: 'Straight',
  mbti: 'INFJ',
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

/** Steps that block locally: 1..14. Step 15 is photo upload + submit. */
const BLOCKING_STEPS = ONBOARDING_STEPS.filter(
  (spec) => spec.step < ONBOARDING_TOTAL_STEPS
);

describe('onboarding — the step registry', () => {
  it('registers all fifteen steps, once each, in order', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(15);
    expect(ONBOARDING_STEPS).toHaveLength(ONBOARDING_TOTAL_STEPS);
    expect(ONBOARDING_STEPS.map((spec) => spec.step)).toEqual(
      Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, index) => index + 1)
    );
    expect(new Set(ONBOARDING_STEPS.map((spec) => spec.id)).size).toBe(
      ONBOARDING_TOTAL_STEPS
    );
  });

  it('maps every registered field to the step that owns it', () => {
    for (const spec of ONBOARDING_STEPS) {
      for (const field of [...spec.required, ...spec.recommended]) {
        expect(FIELD_TO_STEP[field.key], `${field.key} -> step ${spec.step}`).toBe(
          spec.step
        );
      }
    }
  });

  it('maps the fields the review screen jumps back to', () => {
    // `handleSubmit` uses this map to send the member back to the offending
    // step rather than failing on the review screen.
    const fields = [
      'displayName',
      'photos',
      'gender',
      'birthDate',
      'age',
      'country',
      'city',
      'intention',
      'lookingFor',
      'mbti',
      'interests',
      'hobbies',
      'bio',
    ];
    for (const field of fields) {
      const step = FIELD_TO_STEP[field];
      expect(step, `${field} must map to a real step`).toBeGreaterThanOrEqual(1);
      expect(step).toBeLessThanOrEqual(ONBOARDING_TOTAL_STEPS);
    }
  });

  it('re-exports the photo bounds rather than redefining them', () => {
    expect(MIN_PHOTOS).toBe(4);
    expect(MAX_PHOTOS).toBe(6);
    expect(MIN_PHOTOS).toBeLessThanOrEqual(MAX_PHOTOS);
  });
});

describe('onboarding — every step blocks when blank, passes when filled', () => {
  it('blocks all of steps 1..14 for a blank state', () => {
    for (const spec of BLOCKING_STEPS) {
      const result = validateOnboardingStep(spec.step, blankState());
      expect(result.ok, `step ${spec.step} (${spec.id}) must block`).toBe(false);
      expect(
        result.problems.length,
        `step ${spec.step} (${spec.id}) must explain why`
      ).toBeGreaterThan(0);
      expect(result.problems[0].message.length).toBeGreaterThan(0);
    }
  });

  it('passes all of steps 1..14 for a complete state', () => {
    for (const spec of BLOCKING_STEPS) {
      const result = validateOnboardingStep(spec.step, completeState());
      expect(
        result.ok,
        `step ${spec.step} (${spec.id}): ${result.problems[0]?.message ?? ''}`
      ).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it('reports only problems owned by the step being validated', () => {
    for (const spec of BLOCKING_STEPS) {
      for (const problem of validateOnboardingStep(spec.step, blankState()).problems) {
        expect(
          FIELD_TO_STEP[problem.field],
          `step ${spec.step} reported ${problem.field}`
        ).toBe(spec.step);
      }
    }
  });

  it('tolerates the extra fields the page state carries', () => {
    // `FormState` additionally holds `age` and `personalityTraits`; the
    // structural contract ignores them with no cast and no mapping layer. `tsc`
    // proves the same assignment in src/app/profile/edit/page.tsx.
    const pageLikeState = { ...completeState(), age: 28, personalityTraits: ['calm'] };
    expect(validateOnboardingStep(1, pageLikeState).ok).toBe(true);
  });

  it('imposes no local requirement outside the registry', () => {
    expect(validateOnboardingStep(0, blankState()).ok).toBe(true);
    expect(validateOnboardingStep(ONBOARDING_TOTAL_STEPS + 1, blankState()).ok).toBe(true);
  });
});

describe('onboarding — step 15, the photo requirement', () => {
  it('blocks with the character-exact message unless exactly four gallery photos', () => {
    for (const photos of [[], ['a'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e']]) {
      const result = validateOnboardingStep(ONBOARDING_TOTAL_STEPS, completeState({ photos }));
      expect(result.ok).toBe(false);
      expect(result.problems.find((problem) => problem.field === 'photos')?.message).toBe(
        `Please upload exactly 4 gallery photos to continue (${photos.length}/4 uploaded)`
      );
    }
  });

  it('does not count blank or whitespace-only photo entries', () => {
    const result = validateOnboardingStep(
      ONBOARDING_TOTAL_STEPS,
      completeState({ photos: ['a', 'b', 'c', '   '] })
    );
    expect(result.ok).toBe(false);
    expect(result.problems.find((problem) => problem.field === 'photos')?.message).toBe(
      'Please upload exactly 4 gallery photos to continue (3/4 uploaded)'
    );
  });

  it('accepts exactly four and refuses three or five', () => {
    expect(validateOnboardingStep(ONBOARDING_TOTAL_STEPS, completeState()).ok).toBe(true);
    expect(
      validateOnboardingStep(ONBOARDING_TOTAL_STEPS, completeState({ photos: ['a', 'b', 'c'] })).ok
    ).toBe(false);
    expect(
      validateOnboardingStep(
        ONBOARDING_TOTAL_STEPS,
        completeState({ photos: ['a', 'b', 'c', 'd', 'e'] })
      ).ok
    ).toBe(false);
  });

  it('step 1 owns only the display name and never blocks on photos', () => {
    const problems = validateOnboardingStep(1, blankState()).problems;
    expect(problems.map((problem) => problem.field)).toEqual(['displayName']);
    expect(problems[0].message).toBe('Please provide a display name to continue.');
    expect(validateOnboardingStep(1, completeState({ photos: [] })).ok).toBe(true);
  });

  it('keeps the photo rule out of the full-draft guard', () => {
    // The gallery count is an onboarding-flow rule only. Profile edits are not
    // forced to re-upload a gallery.
    expect(validateProfileDraft(draft({ photos: [] }), NOW).ok).toBe(true);
    expect(
      validateOnboardingStep(ONBOARDING_TOTAL_STEPS, completeState({ photos: [] })).ok
    ).toBe(false);
  });
});

describe('onboarding — step-specific guards', () => {
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
    expect(validateOnboardingStep(3, completeState({ birthDate: 'not-a-date' })).ok).toBe(
      false
    );
    expect(validateOnboardingStep(3, completeState()).ok).toBe(true);
  });

  it('step 4 names the country requirement exactly and still needs a city', () => {
    const result = validateOnboardingStep(4, completeState({ country: '' }));
    expect(result.ok).toBe(false);
    expect(result.problems[0].message).toBe('Please select your country to continue.');

    expect(
      validateOnboardingStep(4, { ...completeState(), city: '  ' }).problems.map(
        (problem) => problem.field
      )
    ).toContain('city');
    expect(validateOnboardingStep(4, completeState()).ok).toBe(true);
  });

  it('step 8 requires both halves of every prompt', () => {
    const halfAnswered = validateOnboardingStep(
      8,
      completeState({ prompts: { 'simple-pleasures': '   ' } })
    );
    expect(halfAnswered.ok).toBe(false);
    expect(halfAnswered.problems.map((problem) => problem.field)).toContain('prompts');

    const noQuestion = validateOnboardingStep(
      8,
      completeState({ prompts: { '': 'An answer' } })
    );
    expect(noQuestion.ok).toBe(false);
    expect(noQuestion.problems.map((problem) => problem.field)).toContain('prompts');

    expect(validateOnboardingStep(8, completeState({ prompts: {} })).ok).toBe(true);
  });

  it('step 9 is satisfied by interests or hobbies, not necessarily both', () => {
    expect(
      validateOnboardingStep(9, completeState({ interests: ['hiking'], hobbies: [] })).ok
    ).toBe(true);
    expect(
      validateOnboardingStep(9, completeState({ interests: [], hobbies: ['Music'] })).ok
    ).toBe(true);
    expect(
      validateOnboardingStep(9, completeState({ interests: [], hobbies: [] })).ok
    ).toBe(false);
  });

  it('step 11 blocks on smoking, drinking and exercise independently', () => {
    const cases = [
      { field: 'smoking', state: completeState({ smoking: '' }) },
      { field: 'drinking', state: completeState({ drinking: '' }) },
      { field: 'exercise', state: completeState({ exercise: '' }) },
    ];
    for (const { field, state } of cases) {
      const result = validateOnboardingStep(11, state);
      expect(result.ok, `${field} must block`).toBe(false);
      expect(result.problems.map((problem) => problem.field)).toContain(field);
    }
    expect(validateOnboardingStep(11, completeState()).ok).toBe(true);
  });

  it('step 12 needs both education and profession', () => {
    expect(
      validateOnboardingStep(12, completeState({ education: '' })).problems.map(
        (problem) => problem.field
      )
    ).toContain('education');
    expect(
      validateOnboardingStep(12, completeState({ profession: '  ' })).problems.map(
        (problem) => problem.field
      )
    ).toContain('profession');
    expect(validateOnboardingStep(12, completeState()).ok).toBe(true);
  });
});

describe('onboarding — recommended fields never block', () => {
  it('hints the optional field on steps 5 and 7 without failing the step', () => {
    const physical = validateOnboardingStep(5, completeState({ physicalAttributes: [] }));
    expect(physical.ok).toBe(true);
    expect(physical.missingRecommended).toEqual(['Physical attributes']);

    const orientation = validateOnboardingStep(7, completeState({ sexualOrientation: '' }));
    expect(orientation.ok).toBe(true);
    expect(orientation.missingRecommended).toEqual(['Sexual orientation']);
  });

  it('hints nothing once the optional field is filled', () => {
    expect(validateOnboardingStep(5, completeState()).missingRecommended).toEqual([]);
    expect(validateOnboardingStep(7, completeState()).missingRecommended).toEqual([]);
  });

  it('hints nothing for steps with no recommended field', () => {
    for (const spec of BLOCKING_STEPS) {
      if (spec.recommended.length === 0) {
        expect(
          validateOnboardingStep(spec.step, completeState()).missingRecommended
        ).toEqual([]);
      }
    }
  });
});

describe('onboarding — step 15 delegates to the full-draft guard', () => {
  it('blocks an incomplete review state with the draft guard problems', () => {
    const result = validateOnboardingStep(ONBOARDING_TOTAL_STEPS, blankState());
    expect(result.ok).toBe(false);
    const fields = result.problems.map((problem) => problem.field);
    expect(fields).toContain('displayName');
    expect(fields).toContain('birthDate');
  });

  it('uses the draft guard 18+ message, proving the delegation', () => {
    const minor = validateOnboardingStep(
      ONBOARDING_TOTAL_STEPS,
      completeState({ birthDate: '2015-01-01' })
    );
    expect(minor.ok).toBe(false);
    expect(minor.problems).toContainEqual({
      field: 'birthDate',
      message: `Mettivo is for adults only. You must be ${MIN_AGE} or older.`,
    });
  });

  it('passes the review step for a complete adult profile', () => {
    const result = validateOnboardingStep(ONBOARDING_TOTAL_STEPS, completeState());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
});
