/**
 * Dating-preference translation.
 *
 * The onboarding wizard stores `looking_for` as the member's chosen labels
 * (`Men`, `Women`, `Everyone`), while profiles store gender as `Woman`, `Man`
 * or `Nonbinary`. This module is the one place that translates between those
 * vocabularies so Discover's filters, the People feed and the ranking engine
 * cannot disagree about what a preference means.
 *
 * It is pure and deliberately forgiving: legacy/unknown values fall back to the
 * full gender set rather than hiding every candidate.
 */

/** The gender values the product's discovery filters understand. */
export const DISCOVERY_GENDERS = ['Woman', 'Man', 'Nonbinary'] as const;

export type DiscoveryGender = (typeof DISCOVERY_GENDERS)[number];

/** The preference labels stored in `profiles.looking_for`. */
export const DATING_PREFERENCE_LABELS = ['Men', 'Women', 'Everyone'] as const;

export type DatingPreferenceLabel = (typeof DATING_PREFERENCE_LABELS)[number];

const PREFERENCE_FOR_GENDER: Record<string, DatingPreferenceLabel> = {
  woman: 'Women',
  female: 'Women',
  man: 'Men',
  male: 'Men',
};

/**
 * The discovery filter implied by saved preferences.
 *
 * `Everyone`, an empty array and unrecognised legacy values all mean "show me
 * everyone". A member who selected both `Men` and `Women` gets both.
 */
export function gendersForLookingFor(
  lookingFor: readonly string[] | null | undefined
): DiscoveryGender[] {
  if (!lookingFor || lookingFor.length === 0) return [...DISCOVERY_GENDERS];
  if (lookingFor.includes('Everyone')) return [...DISCOVERY_GENDERS];

  const genders = lookingFor
    .map((label) => {
      if (label === 'Men') return 'Man' as const;
      if (label === 'Women') return 'Woman' as const;
      return null;
    })
    .filter((gender): gender is 'Woman' | 'Man' => gender !== null);

  return genders.length > 0 ? [...new Set(genders)] : [...DISCOVERY_GENDERS];
}

export type PreferenceAffinity = 'mutual' | 'one-way' | 'none' | 'unknown';

export interface PreferenceProfile {
  gender?: string | null;
  lookingFor?: readonly string[] | null;
}

function acceptsGender(
  lookingFor: readonly string[] | null | undefined,
  gender: string | null | undefined
): boolean | null {
  if (!lookingFor || lookingFor.length === 0) return null;
  if (lookingFor.includes('Everyone')) return true;

  const wanted = gender ? PREFERENCE_FOR_GENDER[gender.toLowerCase()] : undefined;
  if (!wanted) return null;

  return lookingFor.includes(wanted);
}

/**
 * How a pair's saved gender preferences line up.
 *
 * * `mutual`  — each member is in the other's chosen set.
 * * `one-way` — one side matches, the other has expressed no preference.
 * * `none`    — at least one side has explicitly excluded the other.
 * * `unknown` — neither side has usable preference information.
 *
 * `none` is the only value Discovery sinks to the bottom; it is not a hard
 * filter because a member can change preferences without the whole feed
 * disappearing and because legacy rows may have no gender.
 */
export function preferenceAffinity(
  a: PreferenceProfile,
  b: PreferenceProfile
): PreferenceAffinity {
  const aAcceptsB = acceptsGender(a.lookingFor, b.gender);
  const bAcceptsA = acceptsGender(b.lookingFor, a.gender);

  if (aAcceptsB === false || bAcceptsA === false) return 'none';
  if (aAcceptsB === true && bAcceptsA === true) return 'mutual';
  if (aAcceptsB === true || bAcceptsA === true) return 'one-way';
  return 'unknown';
}
