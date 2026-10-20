import {
  MAX_PHOTOS,
  MIN_AGE,
  calculateAge,
  validateProfileDraft,
  type ProfileDraft,
  type ValidationProblem,
} from '@/lib/profile';
import { validateIdentity } from '@/lib/identity';
import { personalityOption } from '@/lib/personality';

/**
 * The onboarding wizard's per-step contract — steps 1–17.
 *
 * WHY THIS MODULE EXISTS
 *   The wizard used to validate on `handleNext` only, so a member could reach
 *   the final step with earlier steps empty and only find out at submit time.
 *   This module makes each step's requirement data: the UI derives `disabled`
 *   from it, the inline error is its `problems[0]`, and `handleNext` re-checks
 *   it so a programmatic click cannot skip a blocking step either.
 *
 * It is deliberately pure — no React, no Supabase, no I/O — so every rule is
 * unit-testable and the page stays a renderer.
 *
 * RELIGION IS OPTIONAL
 *   Step 15 offers a religion or belief, but it is a recommended field only: it
 *   never blocks `Next` and skipping it persists nothing. The database column is
 *   nullable and no matching rule reads it.
 *
 * THE PHOTO REQUIREMENT IS STEP-LOCAL
 *   Exactly four gallery photos (plus one separate avatar) is an onboarding-flow
 *   rule, not a database invariant: the count lives here (the final step) ONLY.
 *   `validateProfileDraft`/`saveProfile` are unchanged and the database caps the
 *   array without demanding a minimum. The final step delegates to the
 *   full-draft guard AND adds the gallery-count rule.
 */

/** Re-exported so wizard callers read the photo cap from one place. */
export { MAX_PHOTOS };

/**
 * The onboarding gallery requirement — EXACTLY this many distinct photos.
 *
 * This is an onboarding-flow rule, not a database invariant: it lives here and
 * is applied when the member first completes the wizard.
 */
export const MIN_PHOTOS = 4;

/** The closed set of gender identities the wizard offers on step 2. */
export const ONBOARDING_GENDERS = ['Woman', 'Man', 'Nonbinary'] as const;

/**
 * The slice of the wizard's `FormState` these guards read.
 *
 * Structural on purpose: `FormState` satisfies it with no cast and no mapping
 * layer, while this module still cannot depend on the page. Arrays are
 * `readonly` because the guards never mutate what they are given.
 */
export interface OnboardingState {
  firstName: string;
  lastName: string;
  hasLastName: boolean;
  username: string;
  photos: readonly string[];
  gender: string;
  birthDate: string;
  country: string;
  city: string;
  height: string;
  physicalAttributes: readonly string[];
  intention: string;
  lookingFor: readonly string[];
  sexualOrientation: string;
  mbti: string;
  religion: string;
  prompts: Readonly<Record<string, string>>;
  interests: readonly string[];
  hobbies: readonly string[];
  pets: readonly string[];
  smoking: string;
  drinking: string;
  exercise: string;
  education: string;
  profession: string;
  languagesSpoken: readonly string[];
  bio: string;
}

/** One wizard field, with the label a member sees. */
export interface StepFieldSpec {
  key: keyof OnboardingState;
  label: string;
  required: boolean;
}

/** One wizard step: what blocks it and what is merely suggested. */
export interface OnboardingStepSpec {
  step: number;
  id: string;
  required: StepFieldSpec[];
  recommended: StepFieldSpec[];
}

export interface OnboardingStepResult {
  /** False when the step blocks: `Next →` is disabled and the first problem is shown. */
  ok: boolean;
  problems: ValidationProblem[];
  /** Human-readable labels of optional fields the member has not filled in. */
  missingRecommended: string[];
}

const required = (key: keyof OnboardingState, label: string): StepFieldSpec => ({
  key,
  label,
  required: true,
});

const optional = (key: keyof OnboardingState, label: string): StepFieldSpec => ({
  key,
  label,
  required: false,
});

/**
 * The registry. The final step lists no field: it is owned by
 * `validateProfileDraft`.
 *
 * Every field named here must also be mapped in `FIELD_TO_STEP`; a test pins
 * that, so adding a field to a step without wiring the jump-to-step map fails
 * the suite rather than silently stranding the member on the review screen.
 */
export const ONBOARDING_STEPS: OnboardingStepSpec[] = [
  {
    step: 1,
    id: 'name',
    required: [
      required('firstName', 'First name'),
      required('lastName', 'Last name'),
      required('username', 'Username'),
    ],
    recommended: [],
  },
  { step: 2, id: 'identity', required: [required('gender', 'Gender')], recommended: [] },
  { step: 3, id: 'birthday', required: [required('birthDate', 'Date of birth')], recommended: [] },
  {
    step: 4,
    id: 'location',
    required: [required('country', 'Country'), required('city', 'City or district')],
    recommended: [],
  },
  {
    step: 5,
    id: 'physical',
    required: [required('height', 'Height')],
    recommended: [optional('physicalAttributes', 'Physical attributes')],
  },
  { step: 6, id: 'intention', required: [required('intention', 'Intention')], recommended: [] },
  {
    step: 7,
    id: 'preferences',
    required: [required('lookingFor', 'Looking to date')],
    recommended: [optional('sexualOrientation', 'Sexual orientation')],
  },
  {
    step: 8,
    id: 'personality',
    required: [required('mbti', 'MBTI type')],
    recommended: [],
  },
  {
    step: 9,
    id: 'prompts',
    required: [required('prompts', 'Prompt answers')],
    recommended: [],
  },
  {
    step: 10,
    id: 'interests',
    required: [required('interests', 'Interests'), required('hobbies', 'Hobbies')],
    recommended: [],
  },
  { step: 11, id: 'pets', required: [required('pets', 'Pets')], recommended: [] },
  {
    step: 12,
    id: 'lifestyle',
    required: [
      required('smoking', 'Smoking'),
      required('drinking', 'Drinking'),
      required('exercise', 'Exercise'),
    ],
    recommended: [],
  },
  {
    step: 13,
    id: 'career',
    required: [required('education', 'Education'), required('profession', 'Profession')],
    recommended: [],
  },
  {
    step: 14,
    id: 'languages',
    required: [required('languagesSpoken', 'Languages')],
    recommended: [],
  },
  { step: 15, id: 'bio', required: [required('bio', 'Bio')], recommended: [] },
  {
    step: 16,
    id: 'religion',
    required: [],
    recommended: [optional('religion', 'Religion')],
  },
  { step: 17, id: 'photos', required: [], recommended: [] },
];

/**
 * The number of wizard steps, derived from the registry so the counter, the
 * final-step guard and the E2E journey can never drift from the list itself.
 */
export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;

/**
 * Field key -> owning step.
 *
 * Used by the review screen's submit guard to jump back to the offending step
 * instead of failing on the final step with a red banner. It is a superset of the
 * registry: it also carries fields the full-draft guard can report but no step
 * blocks on directly.
 */
export const FIELD_TO_STEP: Record<string, number> = {
  firstName: 1,
  lastName: 1,
  hasLastName: 1,
  username: 1,
  photos: 17,
  avatarUrl: 17,
  gender: 2,
  pronouns: 2,
  birthDate: 3,
  age: 3,
  country: 4,
  city: 4,
  height: 5,
  physicalAttributes: 5,
  intention: 6,
  lookingFor: 7,
  sexualOrientation: 7,
  mbti: 8,
  prompts: 9,
  religion: 16,
  interests: 10,
  hobbies: 10,
  pets: 11,
  smoking: 12,
  drinking: 12,
  exercise: 12,
  education: 13,
  profession: 13,
  languagesSpoken: 14,
  bio: 15,
};

function isBlank(value: string | undefined | null): boolean {
  return (value ?? '').trim().length === 0;
}

/** Counts entries that are non-blank strings, ignoring holes and whitespace. */
function countFilled(values: readonly string[] | undefined): number {
  let count = 0;
  for (const value of values ?? []) {
    if (typeof value === 'string' && value.trim().length > 0) count += 1;
  }
  return count;
}

/** Whether a field currently holds something a member typed or picked. */
const PRESENCE: { readonly [K in keyof OnboardingState]: (state: OnboardingState) => boolean } = {
  firstName: (state) => !isBlank(state.firstName),
  lastName: (state) => state.hasLastName ? !isBlank(state.lastName) : true,
  hasLastName: () => true,
  username: (state) => !isBlank(state.username),
  photos: (state) => countFilled(state.photos) > 0,
  gender: (state) => !isBlank(state.gender),
  birthDate: (state) => !isBlank(state.birthDate),
  country: (state) => !isBlank(state.country),
  city: (state) => !isBlank(state.city),
  height: (state) => !isBlank(state.height),
  physicalAttributes: (state) => countFilled(state.physicalAttributes) > 0,
  intention: (state) => !isBlank(state.intention),
  lookingFor: (state) => countFilled(state.lookingFor) > 0,
  sexualOrientation: (state) => !isBlank(state.sexualOrientation),
  mbti: (state) => !isBlank(state.mbti),
  religion: (state) => !isBlank(state.religion),
  prompts: (state) => Object.keys(state.prompts ?? {}).length > 0,
  interests: (state) => countFilled(state.interests) > 0,
  hobbies: (state) => countFilled(state.hobbies) > 0,
  pets: (state) => countFilled(state.pets) > 0,
  smoking: (state) => !isBlank(state.smoking),
  drinking: (state) => !isBlank(state.drinking),
  exercise: (state) => !isBlank(state.exercise),
  education: (state) => !isBlank(state.education),
  profession: (state) => !isBlank(state.profession),
  languagesSpoken: (state) => countFilled(state.languagesSpoken) > 0,
  bio: (state) => !isBlank(state.bio),
};

/**
 * Adapts the wizard's state to the full-draft guard.
 *
 * `id` is not validated by `validateProfileDraft` — it only reaches the payload
 * on success — so an empty placeholder is honest here rather than a cast.
 */
function toProfileDraft(state: OnboardingState): ProfileDraft {
  return {
    id: '',
    firstName: state.firstName,
    lastName: state.lastName,
    hasLastName: state.hasLastName,
    username: state.username,
    photos: [...state.photos],
    gender: state.gender,
    birthDate: state.birthDate,
    country: state.country,
    city: state.city,
    height: state.height,
    physicalAttributes: [...state.physicalAttributes],
    intention: state.intention,
    lookingFor: [...state.lookingFor],
    sexualOrientation: state.sexualOrientation,
    mbti: state.mbti,
    religion: state.religion,
    interests: [...state.interests],
    hobbies: [...state.hobbies],
    pets: [...state.pets],
    prompts: { ...state.prompts },
    smoking: state.smoking,
    drinking: state.drinking,
    exercise: state.exercise,
    education: state.education,
    profession: state.profession,
    languagesSpoken: [...state.languagesSpoken],
    bio: state.bio,
  };
}

/** The blocking rules, in the order the member should be told about them. */
function blockingProblems(step: number, state: OnboardingState): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  switch (step) {
    case 1: {
      problems.push(
        ...validateIdentity({
          firstName: state.firstName,
          lastName: state.lastName,
          hasLastName: state.hasLastName,
          username: state.username,
        })
      );
      break;
    }

    case 2: {
      if (!(ONBOARDING_GENDERS as readonly string[]).includes(state.gender.trim())) {
        problems.push({ field: 'gender', message: 'Please select how you identify to continue.' });
      }
      break;
    }

    case 3: {
      if (isBlank(state.birthDate)) {
        problems.push({
          field: 'birthDate',
          message: 'Please enter your date of birth to continue.',
        });
      } else {
        const age = calculateAge(state.birthDate);
        if (age === null) {
          problems.push({ field: 'birthDate', message: 'That date of birth is not valid.' });
        } else if (age < MIN_AGE) {
          // The 18+ gate: refuse, never clamp (RISK_REGISTER R-05).
          problems.push({
            field: 'birthDate',
            message: `Mettivo is for adults only. You must be ${MIN_AGE} or older to continue.`,
          });
        }
      }
      break;
    }

    case 4: {
      if (isBlank(state.country)) {
        problems.push({ field: 'country', message: 'Please select your country to continue.' });
      }
      if (isBlank(state.city)) {
        problems.push({ field: 'city', message: 'Please add your city or district to continue.' });
      }
      break;
    }

    case 5: {
      if (isBlank(state.height)) {
        problems.push({ field: 'height', message: 'Please add your height to continue.' });
      }
      break;
    }

    case 6: {
      if (isBlank(state.intention)) {
        problems.push({ field: 'intention', message: 'Please choose your intention to continue.' });
      }
      break;
    }

    case 7: {
      if (countFilled(state.lookingFor) < 1) {
        problems.push({
          field: 'lookingFor',
          message: 'Please choose who you would like to date to continue.',
        });
      }
      break;
    }

    case 8: {
      if (isBlank(state.mbti)) {
        problems.push({ field: 'mbti', message: 'Please pick your MBTI type to continue.' });
      } else if (!personalityOption(state.mbti)) {
        problems.push({ field: 'mbti', message: 'Please pick a valid MBTI type to continue.' });
      }
      break;
    }

    case 9: {
      if (countFilled(Object.keys(state.prompts ?? {})) < 1) {
        problems.push({
          field: 'prompts',
          message: 'Please answer at least one prompt to continue.',
        });
        break;
      }
      // A half-answered prompt (a question with no answer, or an answer filed
      // under no question) is not a prompt: both halves are required.
      for (const [id, answer] of Object.entries(state.prompts ?? {})) {
        if (isBlank(id) || isBlank(answer)) {
          problems.push({
            field: 'prompts',
            message: 'Every prompt you add needs both a question and an answer.',
          });
          break;
        }
      }
      break;
    }

    case 10: {
      if (countFilled(state.interests) + countFilled(state.hobbies) < 1) {
        problems.push({
          field: 'interests',
          message: 'Please pick at least one interest or hobby to continue.',
        });
      }
      break;
    }

    case 11: {
      if (countFilled(state.pets) < 1) {
        problems.push({
          field: 'pets',
          message: 'Please choose how you feel about pets to continue.',
        });
      }
      break;
    }

    case 12: {
      if (isBlank(state.smoking)) {
        problems.push({ field: 'smoking', message: 'Please select your smoking preference to continue.' });
      }
      if (isBlank(state.drinking)) {
        problems.push({ field: 'drinking', message: 'Please select your drinking preference to continue.' });
      }
      if (isBlank(state.exercise)) {
        problems.push({ field: 'exercise', message: 'Please select your exercise routine to continue.' });
      }
      break;
    }

    case 13: {
      if (isBlank(state.education)) {
        problems.push({ field: 'education', message: 'Please add your education level to continue.' });
      }
      if (isBlank(state.profession)) {
        problems.push({ field: 'profession', message: 'Please add your profession to continue.' });
      }
      break;
    }

    case 14: {
      if (countFilled(state.languagesSpoken) < 1) {
        problems.push({
          field: 'languagesSpoken',
          message: 'Please select at least one language to continue.',
        });
      }
      break;
    }

    case 15: {
      if (isBlank(state.bio)) {
        problems.push({ field: 'bio', message: 'Please add a short bio to continue.' });
      }
      break;
    }

    case ONBOARDING_TOTAL_STEPS: {
      // The final step is the photo screen. The full-draft guard is still the
      // single authority for the profile fields, and the gallery requirement is
      // added on top because the draft guard has no photo count (the database
      // caps the array but does not demand a minimum).
      problems.push(...validateProfileDraft(toProfileDraft(state)).problems);

      const galleryCount = countFilled(state.photos);
      if (galleryCount !== MIN_PHOTOS) {
        problems.push({
          field: 'photos',
          message: `Please upload exactly ${MIN_PHOTOS} gallery photos to continue (${galleryCount}/${MIN_PHOTOS} uploaded)`,
        });
      }
      break;
    }

    default:
      break;
  }

  return problems;
}

/**
 * The per-step decision.
 *
 * A step not present in the registry imposes no local requirement (the registry
 * covers every real step, so this only absorbs an out-of-range call defensively).
 */
export function validateOnboardingStep(
  step: number,
  state: OnboardingState
): OnboardingStepResult {
  const spec = ONBOARDING_STEPS.find((entry) => entry.step === step);
  const problems = spec ? blockingProblems(step, state) : [];
  const missingRecommended = spec
    ? spec.recommended.filter((field) => !PRESENCE[field.key](state)).map((field) => field.label)
    : [];

  return { ok: problems.length === 0, problems, missingRecommended };
}
