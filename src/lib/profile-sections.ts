import {
  MAX_BIO_LENGTH,
  MAX_PHOTOS,
  calculateAge,
} from '@/lib/profile';
import {
  composeDisplayName,
  normalizeName,
  normalizeUsername,
} from '@/lib/identity';
import {
  validateProfileSection,
  type OnboardingState,
  type ProfileSectionId,
} from '@/lib/onboarding-steps';

/**
 * Builds the column patch for ONE profile section.
 *
 * This is the write-side counterpart to the section registry. It is deliberately
 * narrow: saving Personality updates `mbti` and nothing else, so a stale form in
 * one tab can never overwrite interests edited in another.
 *
 * Validation is the section's own contract. Essentials keep their launch rules;
 * progressive sections accept empty values (clearing is a valid edit) and only
 * reject malformed data.
 */

export interface SectionPatchResult {
  ok: boolean;
  message?: string;
  patch: Record<string, unknown>;
}

function trimmed(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function bounded(values: readonly string[] | null | undefined, max: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim().slice(0, 60);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

function completePrompts(prompts: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [promptId, answer] of Object.entries(prompts)) {
    const id = promptId.trim();
    const value = answer.trim();
    if (id && value) result[id] = value;
  }
  return result;
}

function fail(message: string): SectionPatchResult {
  return { ok: false, message, patch: {} };
}

export function buildProfileSectionPatch(
  sectionId: ProfileSectionId,
  state: OnboardingState
): SectionPatchResult {
  const validation = validateProfileSection(sectionId, state);
  if (!validation.ok) {
    return fail(validation.problems[0]?.message ?? 'Please check this section and try again.');
  }

  if (sectionId === 'bio' && state.bio.trim().length > MAX_BIO_LENGTH) {
    return fail(`Your bio must be ${MAX_BIO_LENGTH} characters or fewer.`);
  }

  switch (sectionId) {
    case 'name': {
      const firstName = normalizeName(state.firstName);
      const lastName = normalizeName(state.lastName);
      return {
        ok: true,
        patch: {
          first_name: firstName,
          last_name: state.hasLastName ? lastName : null,
          has_last_name: state.hasLastName,
          username: normalizeUsername(state.username),
          display_name: composeDisplayName({
            firstName,
            lastName,
            hasLastName: state.hasLastName,
          }),
        },
      };
    }

    case 'identity':
      return {
        ok: true,
        patch: {
          gender: trimmed(state.gender),
          pronouns: trimmed(state.pronouns),
        },
      };

    case 'birthday': {
      const age = calculateAge(state.birthDate);
      if (age === null) return fail('That date of birth is not valid.');
      return {
        ok: true,
        patch: { birth_date: state.birthDate, age },
      };
    }

    case 'location':
      return {
        ok: true,
        patch: {
          country: trimmed(state.country),
          city: trimmed(state.city),
        },
      };

    case 'intention':
      return { ok: true, patch: { intention: trimmed(state.intention) } };

    case 'preferences':
      return {
        ok: true,
        patch: {
          looking_for: bounded(state.lookingFor, 3),
          sexual_orientation: trimmed(state.sexualOrientation),
        },
      };

    case 'bio':
      return { ok: true, patch: { bio: trimmed(state.bio) } };

    case 'photos':
      return {
        ok: true,
        patch: {
          avatar_url: trimmed(state.avatarUrl),
          photos: bounded(state.photos, MAX_PHOTOS),
        },
      };

    case 'physical':
      return {
        ok: true,
        patch: {
          height: trimmed(state.height),
          physical_attributes: bounded(state.physicalAttributes, 7),
        },
      };

    case 'personality':
      return { ok: true, patch: { mbti: trimmed(state.mbti).toUpperCase() } };

    case 'prompts':
      return { ok: true, patch: { prompts: completePrompts(state.prompts) } };

    case 'interests':
      return {
        ok: true,
        patch: {
          interests: bounded(state.interests, 12),
          hobbies: bounded(state.hobbies, 18),
        },
      };

    case 'pets':
      return { ok: true, patch: { pets: bounded(state.pets, 6) } };

    case 'lifestyle':
      return {
        ok: true,
        patch: {
          smoking: trimmed(state.smoking),
          drinking: trimmed(state.drinking),
          exercise: trimmed(state.exercise),
        },
      };

    case 'career':
      return {
        ok: true,
        patch: {
          education: trimmed(state.education),
          profession: trimmed(state.profession),
        },
      };

    case 'languages':
      return { ok: true, patch: { languages_spoken: bounded(state.languagesSpoken, 8) } };

    case 'religion':
      return { ok: true, patch: { religion: trimmed(state.religion) } };

    default:
      return fail('This profile section is not available.');
  }
}
