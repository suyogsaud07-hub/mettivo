import {
  PROFILE_SECTIONS,
  profileSectionHref,
  type ProfileSectionId,
  type ProfileSectionStage,
} from '@/lib/onboarding-steps';
import { personalityOption } from '@/lib/personality';

/**
 * ONE authoritative profile-completion calculation.
 *
 * The dashboard, the section list and the "Complete My Profile" destination all
 * read this module. Nothing submits a percentage to the database, and a refresh
 * recomputes from the persisted profile row, so a stale number cannot survive a
 * reload.
 *
 * MODEL
 *   Section-based and transparent: each of the seventeen real profile sections
 *   contributes one equal unit. Essential sections complete at launch; the new
 *   member therefore starts honestly at 8/17, not at a fabricated 50%.
 *
 *   Empty strings, whitespace-only values and empty arrays are never progress.
 *   Optional answers count when present but are never required to launch.
 *   "Prefer not to say" is a real persisted answer and completes Religion.
 */

export interface CompletionProfile {
  firstName: string | null;
  lastName: string | null;
  hasLastName: boolean;
  username: string | null;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  bio: string | null;
  intention: string | null;
  lookingFor: string[] | null;
  hobbies: string[] | null;
  interests: string[] | null;
  physicalAttributes: string[] | null;
  height: string | null;
  mbti: string | null;
  religion: string | null;
  drinking: string | null;
  smoking: string | null;
  exercise: string | null;
  education: string | null;
  profession: string | null;
  languagesSpoken: string[] | null;
  pets: string[] | null;
  prompts: Record<string, string> | null;
}

export interface ProfileCompletionItem {
  sectionId: ProfileSectionId;
  title: string;
  description: string;
  stage: ProfileSectionStage;
  complete: boolean;
  /** Direct destination for the section editor. */
  href: string;
  /** Short, actionable copy for the next-step list. */
  recommendation: string;
}

export interface ProfileCompletion {
  percentage: number;
  completedCount: number;
  totalCount: number;
  remainingCount: number;
  isComplete: boolean;
  items: ProfileCompletionItem[];
  /** Up to three genuine incomplete sections, in recommendation order. */
  nextRecommended: ProfileCompletionItem[];
}

/** The copy the completion panel uses for each unfinished section. */
const RECOMMENDATIONS: Record<ProfileSectionId, string> = {
  name: 'Add the name people will see.',
  identity: 'Choose how you identify.',
  birthday: 'Confirm your age so recommendations are accurate.',
  location: 'Add your country and city.',
  intention: 'Say what you are looking for.',
  preferences: 'Choose who you would like to meet.',
  bio: 'Write a short intro to give people something to reply to.',
  photos: 'Add a clear profile photo.',
  physical: 'Add height or build details.',
  personality: 'Tell people more about your personality.',
  prompts: 'Answer a prompt so conversations start themselves.',
  interests: 'Add your interests to help people find common ground.',
  pets: 'Share how you feel about pets.',
  lifestyle: 'Complete your lifestyle preferences.',
  career: 'Add your education and profession.',
  languages: 'Add the languages you speak.',
  religion: 'Add a belief or choose prefer not to say.',
};

/**
 * Recommendation priority, most useful first.
 *
 * Essentials lead only when an older account is genuinely missing one. For a
 * fresh launch, the list starts with shared interests and personality rather
 * than administrative fields.
 */
const RECOMMENDATION_ORDER: ProfileSectionId[] = [
  'name',
  'identity',
  'birthday',
  'location',
  'intention',
  'preferences',
  'bio',
  'photos',
  'interests',
  'personality',
  'prompts',
  'pets',
  'physical',
  'lifestyle',
  'career',
  'languages',
  'religion',
];

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function filled(values: readonly string[] | null | undefined): boolean {
  return (values ?? []).some((value) => typeof value === 'string' && value.trim().length > 0);
}

function hasCompletePrompt(prompts: Record<string, string> | null): boolean {
  if (!prompts) return false;
  return Object.entries(prompts).some(
    ([promptId, answer]) => promptId.trim().length > 0 && answer.trim().length > 0
  );
}

const PREDICATES: Record<ProfileSectionId, (profile: CompletionProfile) => boolean> = {
  name: (profile) =>
    text(profile.firstName).length > 0 &&
    text(profile.username).length > 0 &&
    (!profile.hasLastName || text(profile.lastName).length > 0),
  identity: (profile) => text(profile.gender).length > 0,
  birthday: (profile) => typeof profile.age === 'number' && profile.age >= 18,
  location: (profile) => text(profile.country).length > 0 && text(profile.city).length > 0,
  intention: (profile) => text(profile.intention).length > 0,
  preferences: (profile) => filled(profile.lookingFor),
  bio: (profile) => text(profile.bio).length > 0,
  photos: (profile) => text(profile.avatarUrl).length > 0,
  physical: (profile) =>
    text(profile.height).length > 0 || filled(profile.physicalAttributes),
  personality: (profile) => personalityOption(profile.mbti) !== undefined,
  prompts: (profile) => hasCompletePrompt(profile.prompts),
  interests: (profile) => filled(profile.interests) || filled(profile.hobbies),
  pets: (profile) => filled(profile.pets),
  lifestyle: (profile) =>
    text(profile.smoking).length > 0 &&
    text(profile.drinking).length > 0 &&
    text(profile.exercise).length > 0,
  career: (profile) =>
    text(profile.education).length > 0 && text(profile.profession).length > 0,
  languages: (profile) => filled(profile.languagesSpoken),
  religion: (profile) => text(profile.religion).length > 0,
};

export function buildProfileCompletion(profile: CompletionProfile): ProfileCompletion {
  const items: ProfileCompletionItem[] = PROFILE_SECTIONS.map((section) => ({
    sectionId: section.id,
    title: section.title,
    description: section.description,
    stage: section.stage,
    complete: PREDICATES[section.id](profile),
    href: profileSectionHref(section.id),
    recommendation: RECOMMENDATIONS[section.id],
  }));

  const completedCount = items.filter((item) => item.complete).length;
  const totalCount = items.length;
  const percentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const byId = new Map(items.map((item) => [item.sectionId, item]));

  const nextRecommended = RECOMMENDATION_ORDER.map((id) => byId.get(id))
    .filter((item): item is ProfileCompletionItem => item !== undefined && !item.complete)
    .slice(0, 3);

  return {
    percentage,
    completedCount,
    totalCount,
    remainingCount: totalCount - completedCount,
    isComplete: completedCount === totalCount,
    items,
    nextRecommended,
  };
}
