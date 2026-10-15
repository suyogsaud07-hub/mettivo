/**
 * Option catalogues shared by the profile surfaces.
 *
 * WHY THIS MODULE EXISTS
 *   The onboarding wizard and the profile dashboard both let a member choose
 *   from the same closed sets (intention, who they want to date, drinking,
 *   smoking, pets). Those lists used to live inside `edit/page.tsx` as local
 *   arrays; a second copy on the dashboard would have drifted the moment either
 *   screen changed. They are catalogued once here so the two renderers cannot
 *   disagree about what the valid values are.
 *
 * GENDER IS NOT HERE
 *   The gender set is already owned by `onboarding-steps.ts`
 *   (`ONBOARDING_GENDERS`) and is validated there; the dashboard imports that
 *   constant rather than duplicating it here.
 *
 * The stored VALUES are the strings already written to `profiles` by past
 * builds, so changing a label is safe but changing a value would orphan rows.
 */

/** A stored value paired with the label a member sees. */
export interface ProfileOption {
  value: string;
  label: string;
}

/** Declared intentions. Values are mirrored by `profiles_intention_set`. */
export const PROFILE_INTENTION_OPTIONS: readonly ProfileOption[] = [
  { value: 'friendship', label: 'Friendship & Networking' },
  { value: 'dating', label: 'Long-term Relationship / Dating' },
  { value: 'both', label: 'Casual & Open to Options' },
];

/** Who the member wants to see. Stored in `profiles.looking_for`. */
export const PROFILE_LOOKING_FOR_OPTIONS = ['Men', 'Women', 'Everyone'] as const;

/** Drinking habits. Stored in `profiles.drinking`. */
export const PROFILE_DRINKING_OPTIONS = [
  'Non-drinker',
  'Social drinker',
  'Regular drinker',
] as const;

/** Smoking habits. Stored in `profiles.smoking`. */
export const PROFILE_SMOKING_OPTIONS = [
  'Non-smoker',
  'Social smoker',
  'Regular smoker',
] as const;

/** Feelings about animals. Stored in `profiles.pets`. */
export const PROFILE_PETS_OPTIONS = [
  'Dog lover',
  'Cat lover',
  'Have pets',
  'Allergic to pets',
  'No pets',
  'Want pets',
] as const;

/** Free-text hobby labels. Stored in `profiles.hobbies`. */
export const PROFILE_HOBBIES_OPTIONS = [
  'Music',
  'Travel',
  'Photography',
  'Gaming',
  'Fitness',
  'Cooking',
  'Reading',
  'Movies',
  'Art & Design',
  'Outdoors & Hiking',
  'Dancing',
  'Tech & Coding',
  'Yoga',
  'Coffee & Tea',
  'Fashion',
  'Sports',
  'Pets & Animals',
  'Wine & Dining',
] as const;

/** The label for a stored intention value, falling back to the raw value. */
export function intentionLabel(value: string): string {
  return PROFILE_INTENTION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
