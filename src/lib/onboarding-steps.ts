import {
  MAX_PHOTOS,
  MAX_RELIGION_LENGTH,
  MIN_AGE,
  calculateAge,
  validateProfileDraft,
  type ProfileDraft,
  type ValidationProblem,
} from '@/lib/profile';
import {
  MAX_DISPLAY_NAME_LENGTH,
  composeDisplayName,
  normalizeName,
  validateIdentity,
} from '@/lib/identity';
import { personalityOption } from '@/lib/personality';

/**
 * The complete profile section registry.
 *
 * WHY THIS MODULE EXISTS
 *   The original wizard demanded all seventeen sections before a member could
 *   launch. That treated optional depth as a prerequisite for a usable dating
 *   profile. The registry now has one honest shape:
 *
 *     * eight ESSENTIAL sections run during initial onboarding;
 *     * nine PROGRESSIVE sections stay editable forever and are recommended by
 *       the dashboard completion panel.
 *
 *   Nothing has been deleted. Every original field, option and section remains.
 *
 * TWO KINDS OF VALIDATION
 *   Essential sections block the initial wizard. Progressive sections validate
 *   formats only: a member may open Personality or Interests and save without
 *   filling every optional field. This is what makes progressive completion
 *   possible without turning optional data into a new wall.
 *
 * It is deliberately pure — no React, no Supabase, no I/O — so every rule is
 * unit-testable and the page stays a renderer.
 */

/** Re-exported so wizard callers read the photo cap from one place. */
export { MAX_PHOTOS };

/** Four gallery photos remain the recommendation, never a launch requirement. */
export const RECOMMENDED_GALLERY_PHOTOS = 4;

/** The closed set of gender identities the wizard offers. */
export const ONBOARDING_GENDERS = ['Woman', 'Man', 'Nonbinary'] as const;

export type ProfileSectionStage = 'essential' | 'progressive';

export type ProfileSectionId =
  | 'name'
  | 'identity'
  | 'birthday'
  | 'location'
  | 'intention'
  | 'preferences'
  | 'bio'
  | 'photos'
  | 'physical'
  | 'personality'
  | 'prompts'
  | 'interests'
  | 'pets'
  | 'lifestyle'
  | 'career'
  | 'languages'
  | 'religion';

/**
 * The slice of the page's `FormState` these guards read.
 *
 * Structural on purpose: `FormState` satisfies it with no cast and no mapping
 * layer. Arrays are `readonly` because the guards never mutate what they are
 * given.
 */
export interface OnboardingState {
  firstName: string;
  lastName: string;
  hasLastName: boolean;
  username: string;
  avatarUrl: string;
  photos: readonly string[];
  gender: string;
  pronouns: string;
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

/** One profile section: its stage, title, completion fields and destination. */
export interface ProfileSectionSpec {
  step: number;
  id: ProfileSectionId;
  title: string;
  description: string;
  stage: ProfileSectionStage;
  required: StepFieldSpec[];
  recommended: StepFieldSpec[];
}

export interface OnboardingStepResult {
  /** False when an essential step blocks; `Next →` is disabled. */
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
 * The authoritative registry. Essential sections come first, so a new member's
 * wizard is a contiguous eight-step path; progressive sections keep their
 * original capabilities and are addressable by stable id from the dashboard.
 *
 * Every field named here must also be mapped in `FIELD_TO_STEP`; a test pins
 * that so adding a field without wiring its destination fails the suite.
 */
export const PROFILE_SECTIONS: ProfileSectionSpec[] = [
  {
    step: 1,
    id: 'name',
    title: 'Name & username',
    description: 'The name and handle people will see across Mettivo.',
    stage: 'essential',
    required: [
      required('firstName', 'First name'),
      required('lastName', 'Last name'),
      required('username', 'Username'),
    ],
    recommended: [],
  },
  {
    step: 2,
    id: 'identity',
    title: 'Identity',
    description: 'How you identify and, if you like, your pronouns.',
    stage: 'essential',
    required: [required('gender', 'Gender')],
    recommended: [optional('pronouns', 'Pronouns')],
  },
  {
    step: 3,
    id: 'birthday',
    title: 'Birthday',
    description: 'Your age is shown; your exact date of birth never is.',
    stage: 'essential',
    required: [required('birthDate', 'Date of birth')],
    recommended: [],
  },
  {
    step: 4,
    id: 'location',
    title: 'Location',
    description: 'Your country and city help nearby people find you.',
    stage: 'essential',
    required: [required('country', 'Country'), required('city', 'City or district')],
    recommended: [],
  },
  {
    step: 5,
    id: 'physical',
    title: 'Height & build',
    description: 'Optional physical details that add context to your profile.',
    stage: 'progressive',
    required: [required('height', 'Height')],
    recommended: [optional('physicalAttributes', 'Physical attributes')],
  },
  {
    step: 6,
    id: 'intention',
    title: 'Dating goals',
    description: 'What you are looking for, used by meaningful recommendations.',
    stage: 'essential',
    required: [required('intention', 'Intention')],
    recommended: [],
  },
  {
    step: 7,
    id: 'preferences',
    title: 'Who you want to meet',
    description: 'Your discovery preference and optional orientation.',
    stage: 'essential',
    required: [required('lookingFor', 'Looking to date')],
    recommended: [optional('sexualOrientation', 'Sexual orientation')],
  },
  {
    step: 8,
    id: 'personality',
    title: 'Personality',
    description: 'Your MBTI type, shown as a personality snapshot.',
    stage: 'progressive',
    required: [required('mbti', 'MBTI type')],
    recommended: [],
  },
  {
    step: 9,
    id: 'prompts',
    title: 'Prompts',
    description: 'Up to three answers that help conversations start themselves.',
    stage: 'progressive',
    required: [required('prompts', 'Prompt answers')],
    recommended: [],
  },
  {
    step: 10,
    id: 'interests',
    title: 'Interests & hobbies',
    description: 'The things you enjoy, so people can find common ground.',
    stage: 'progressive',
    required: [required('interests', 'Interests'), required('hobbies', 'Hobbies')],
    recommended: [],
  },
  {
    step: 11,
    id: 'pets',
    title: 'Pets & animals',
    description: 'How you feel about animals and pets.',
    stage: 'progressive',
    required: [required('pets', 'Pets')],
    recommended: [],
  },
  {
    step: 12,
    id: 'lifestyle',
    title: 'Lifestyle habits',
    description: 'Smoking, drinking and exercise preferences.',
    stage: 'progressive',
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
    title: 'Education & career',
    description: 'What you study and do for work.',
    stage: 'progressive',
    required: [required('education', 'Education'), required('profession', 'Profession')],
    recommended: [],
  },
  {
    step: 14,
    id: 'languages',
    title: 'Languages spoken',
    description: 'The languages you can comfortably communicate in.',
    stage: 'progressive',
    required: [required('languagesSpoken', 'Languages')],
    recommended: [],
  },
  {
    step: 15,
    id: 'bio',
    title: 'About you',
    description: 'A short introduction that gives people something to reply to.',
    stage: 'essential',
    required: [required('bio', 'Bio')],
    recommended: [],
  },
  {
    step: 16,
    id: 'religion',
    title: 'Religion & beliefs',
    description: 'Optional and always skippable; it never affects matching.',
    stage: 'progressive',
    required: [],
    recommended: [optional('religion', 'Religion')],
  },
  {
    step: 17,
    id: 'photos',
    title: 'Profile photo',
    description: 'One clear profile photo is enough to launch. Gallery photos can come later.',
    stage: 'essential',
    required: [required('avatarUrl', 'Profile picture')],
    recommended: [optional('photos', 'Gallery photos')],
  },
];

/** The eight sections a new member completes before launching. */
export const INITIAL_ONBOARDING_STEPS = PROFILE_SECTIONS.filter(
  (section) => section.stage === 'essential'
);

/** The nine sections available for progressive completion after launch. */
export const PROGRESSIVE_PROFILE_SECTIONS = PROFILE_SECTIONS.filter(
  (section) => section.stage === 'progressive'
);

/**
 * Backwards-compatible name for the initial wizard path.
 *
 * It intentionally contains only essential steps; the complete catalogue is
 * `PROFILE_SECTIONS`.
 */
export const ONBOARDING_STEPS = INITIAL_ONBOARDING_STEPS;

/** The number of initial onboarding steps, derived from the registry. */
export const ONBOARDING_TOTAL_STEPS = INITIAL_ONBOARDING_STEPS.length;

export function profileSectionById(id: string | null | undefined): ProfileSectionSpec | null {
  if (!id) return null;
  return PROFILE_SECTIONS.find((section) => section.id === id) ?? null;
}

export function profileSectionByStep(step: number): ProfileSectionSpec | null {
  return PROFILE_SECTIONS.find((section) => section.step === step) ?? null;
}

/** A stable dashboard destination for one section editor. */
export function profileSectionHref(sectionId: ProfileSectionId): string {
  return `/profile/edit?section=${sectionId}`;
}

/**
 * Field key -> owning step.
 *
 * Used by the review screen's submit guard to jump back to the offending step
 * instead of failing on the final step with a red banner.
 */
export const FIELD_TO_STEP: Record<string, number> = Object.fromEntries(
  PROFILE_SECTIONS.flatMap((section) =>
    [...section.required, ...section.recommended].map((field) => [field.key, section.step])
  )
);

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
  avatarUrl: (state) => !isBlank(state.avatarUrl),
  photos: (state) => countFilled(state.photos) > 0,
  gender: (state) => !isBlank(state.gender),
  pronouns: (state) => !isBlank(state.pronouns),
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
    avatarUrl: state.avatarUrl,
    photos: [...state.photos],
    gender: state.gender,
    pronouns: state.pronouns,
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

/** Format problems for a progressive section. Empty values never block. */
function progressiveProblems(id: ProfileSectionId, state: OnboardingState): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (id === 'personality' && !isBlank(state.mbti) && !personalityOption(state.mbti)) {
    problems.push({ field: 'mbti', message: 'Please pick a valid MBTI type.' });
  }

  if (id === 'prompts') {
    for (const [promptId, answer] of Object.entries(state.prompts ?? {})) {
      if (isBlank(promptId) || isBlank(answer)) {
        problems.push({
          field: 'prompts',
          message: 'Every prompt you add needs both a question and an answer.',
        });
        break;
      }
    }
  }

  if (id === 'religion' && state.religion.trim().length > MAX_RELIGION_LENGTH) {
    problems.push({
      field: 'religion',
      message: `Religion must be ${MAX_RELIGION_LENGTH} characters or fewer.`,
    });
  }

  return problems;
}

/** The blocking rules for essential steps and format rules for progressive. */
function sectionProblems(section: ProfileSectionSpec, state: OnboardingState): ValidationProblem[] {
  if (section.stage === 'progressive') {
    return progressiveProblems(section.id, state);
  }

  const problems: ValidationProblem[] = [];

  switch (section.id) {
    case 'name': {
      problems.push(
        ...validateIdentity({
          firstName: state.firstName,
          lastName: state.lastName,
          hasLastName: state.hasLastName,
          username: state.username,
        })
      );
      const displayName = composeDisplayName({
        firstName: normalizeName(state.firstName),
        lastName: normalizeName(state.lastName),
        hasLastName: state.hasLastName,
      });
      if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        problems.push({
          field: 'firstName',
          message: `Your name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer in total.`,
        });
      }
      break;
    }

    case 'identity': {
      if (!(ONBOARDING_GENDERS as readonly string[]).includes(state.gender.trim())) {
        problems.push({ field: 'gender', message: 'Please select how you identify to continue.' });
      }
      break;
    }

    case 'birthday': {
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
          problems.push({
            field: 'birthDate',
            message: `Mettivo is for adults only. You must be ${MIN_AGE} or older to continue.`,
          });
        }
      }
      break;
    }

    case 'location': {
      if (isBlank(state.country)) {
        problems.push({ field: 'country', message: 'Please select your country to continue.' });
      }
      if (isBlank(state.city)) {
        problems.push({ field: 'city', message: 'Please add your city or district to continue.' });
      }
      break;
    }

    case 'intention': {
      if (isBlank(state.intention)) {
        problems.push({ field: 'intention', message: 'Please choose your intention to continue.' });
      }
      break;
    }

    case 'preferences': {
      if (countFilled(state.lookingFor) < 1) {
        problems.push({
          field: 'lookingFor',
          message: 'Please choose who you would like to date to continue.',
        });
      }
      break;
    }

    case 'bio': {
      if (isBlank(state.bio)) {
        problems.push({ field: 'bio', message: 'Please add a short bio to continue.' });
      }
      break;
    }

    case 'photos': {
      // The full-draft guard remains the authority for the essential fields.
      problems.push(...validateProfileDraft(toProfileDraft(state)).problems);

      if (isBlank(state.avatarUrl)) {
        problems.push({
          field: 'avatarUrl',
          message: 'Please add a profile picture to launch your profile.',
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
 * The per-section decision.
 *
 * Essential sections block. Progressive sections only reject malformed values,
 * so a member can save one optional section without completing the rest.
 */
export function validateOnboardingStep(
  step: number,
  state: OnboardingState
): OnboardingStepResult {
  const section = profileSectionByStep(step);
  const problems = section ? sectionProblems(section, state) : [];
  const missingRecommended = section
    ? section.recommended
        .filter((field) => !PRESENCE[field.key](state))
        .map((field) => field.label)
    : [];

  return { ok: problems.length === 0, problems, missingRecommended };
}

/** Looks up a section by stable id and validates it. */
export function validateProfileSection(
  sectionId: ProfileSectionId,
  state: OnboardingState
): OnboardingStepResult {
  const section = profileSectionById(sectionId);
  if (!section) return { ok: false, problems: [], missingRecommended: [] };
  return validateOnboardingStep(section.step, state);
}
