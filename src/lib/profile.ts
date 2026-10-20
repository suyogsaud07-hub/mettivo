import { supabase } from '@/lib/supabase';

/**
 * M7 — full profile management.
 *
 * Create, edit and delete, plus the validation guards. The guards live here AND
 * in the database (`supabase/migrations/20261015250000_m7_profile_validation.sql`):
 * this copy exists to give the member a *useful message at the right step*,
 * while the database copy is the one that actually cannot be bypassed.
 *
 * THE 18+ GATE
 *   The previous implementation computed age with `Math.max(18, calculated)`,
 *   which silently turned a 15-year-old's date of birth into "18" and let them
 *   complete onboarding. That is not a gate; it is a disguise. `calculateAge`
 *   now reports the true age and `validateProfileDraft` refuses to proceed.
 *   (RISK_REGISTER R-05.)
 */

/** Members must be adults. Mirrored by the `profiles_age_adult` constraint. */
export const MIN_AGE = 18;
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 1000;
export const MAX_PHOTOS = 6;
export const MAX_RELIGION_LENGTH = 80;

/** The closed set of declared intentions. Mirrored by `profiles_intention_set`. */
export const INTENTIONS = ['friendship', 'dating', 'both'] as const;
export type Intention = (typeof INTENTIONS)[number];

export interface ValidationProblem {
  /** The wizard's `FormState` key this problem belongs to. */
  field: string;
  message: string;
}

/** Raised for an expected failure while loading, saving or deleting a profile. */
export class ProfileError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

/**
 * The shape the wizard commits. Kept structural so the page can pass its own
 * `FormState` without a second mapping layer.
 */
export interface ProfileDraft {
  id: string;
  displayName: string;
  avatarUrl?: string;
  photos?: string[];
  gender?: string;
  pronouns?: string;
  /** ISO `YYYY-MM-DD`. */
  birthDate?: string;
  age?: number;
  country?: string;
  city?: string;
  height?: string;
  physicalAttributes?: string[];
  intention?: string;
  lookingFor?: string[];
  sexualOrientation?: string;
  mbti?: string;
  /** Optional and nullable; never used for matching. */
  religion?: string;
  personality?: string[];
  hobbies?: string[];
  pets?: string[];
  interests?: string[];
  prompts?: Record<string, string>;
  smoking?: string;
  drinking?: string;
  exercise?: string;
  education?: string;
  profession?: string;
  languagesSpoken?: string[];
  bio?: string;
}

/**
 * The member's true age in whole years, or `null` when the date is missing or
 * unparseable. Deliberately NOT clamped to 18 — see the module docblock.
 */
export function calculateAge(dateOfBirth: string | undefined | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;

  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;

  // A date in the future is not a birth date.
  if (birth.getTime() > now.getTime()) return null;

  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/** True only when the date of birth is present and yields an adult age. */
export function isAdult(dateOfBirth: string | undefined | null, now = new Date()): boolean {
  const age = calculateAge(dateOfBirth, now);
  return age !== null && age >= MIN_AGE;
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

function bounded(values: readonly string[] | undefined, max: number, maxLength = 60): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim().slice(0, maxLength);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

export interface ValidationResult {
  ok: boolean;
  problems: ValidationProblem[];
  /** The payload safe to send. Only meaningful when `ok` is true. */
  payload: Record<string, unknown>;
}

/**
 * Validates a draft and builds the write payload in one pass, so the wizard
 * cannot accidentally save a field it did not validate.
 */
export function validateProfileDraft(draft: ProfileDraft, now = new Date()): ValidationResult {
  const problems: ValidationProblem[] = [];

  const displayName = trimmed(draft.displayName);
  if (!displayName) {
    problems.push({ field: 'displayName', message: 'Please add a display name.' });
  } else if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    problems.push({
      field: 'displayName',
      message: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
    });
  }

  // The gate. A missing date of birth is refused as firmly as an underage one:
  // an unverified adult is not a verified adult.
  const age = calculateAge(draft.birthDate, now);
  if (!draft.birthDate) {
    problems.push({ field: 'birthDate', message: 'Please add your date of birth.' });
  } else if (age === null) {
    problems.push({ field: 'birthDate', message: 'That date of birth is not valid.' });
  } else if (age < MIN_AGE) {
    problems.push({
      field: 'birthDate',
      message: `Mettivo is for adults only. You must be ${MIN_AGE} or older.`,
    });
  }

  const intention = trimmed(draft.intention);
  if (intention && !(INTENTIONS as readonly string[]).includes(intention)) {
    problems.push({ field: 'intention', message: 'Please choose what you are looking for.' });
  }

  const bio = trimmed(draft.bio);
  if (bio.length > MAX_BIO_LENGTH) {
    problems.push({
      field: 'bio',
      message: `Your bio must be ${MAX_BIO_LENGTH} characters or fewer.`,
    });
  }

  const religion = trimmed(draft.religion);
  if (religion.length > MAX_RELIGION_LENGTH) {
    problems.push({
      field: 'religion',
      message: `Religion must be ${MAX_RELIGION_LENGTH} characters or fewer.`,
    });
  }

  const photos = (draft.photos ?? []).filter((photo) => typeof photo === 'string' && photo);
  if (photos.length > MAX_PHOTOS) {
    problems.push({ field: 'photos', message: `You can upload up to ${MAX_PHOTOS} photos.` });
  }

  if (problems.length > 0) {
    // `age` is never persisted from an unvalidated draft.
    return { ok: false, problems, payload: {} };
  }

  const payload: Record<string, unknown> = {
    id: draft.id,
    display_name: displayName,
    avatar_url: trimmed(draft.avatarUrl),
    photos: photos.slice(0, MAX_PHOTOS),
    gender: trimmed(draft.gender),
    pronouns: trimmed(draft.pronouns),
    birth_date: draft.birthDate,
    age,
    country: trimmed(draft.country),
    city: trimmed(draft.city),
    height: trimmed(draft.height),
    physical_attributes: bounded(draft.physicalAttributes, 7),
    intention,
    looking_for: bounded(draft.lookingFor, 3),
    sexual_orientation: trimmed(draft.sexualOrientation),
    mbti: trimmed(draft.mbti),
    religion,
    personality: bounded(draft.personality, 10),
    hobbies: bounded(draft.hobbies, 18),
    pets: bounded(draft.pets, 6),
    interests: bounded(draft.interests, 12),
    prompts: draft.prompts ?? {},
    smoking: trimmed(draft.smoking),
    drinking: trimmed(draft.drinking),
    exercise: trimmed(draft.exercise),
    education: trimmed(draft.education),
    profession: trimmed(draft.profession),
    languages_spoken: bounded(draft.languagesSpoken, 8),
    bio,
    onboarding_completed: true,
  };

  return { ok: true, problems: [], payload };
}

const SAVE_FAILED_MESSAGE = 'We could not save your profile. Please try again.';

/** Maps a database failure to an actionable message without exposing SQL details. */
function saveFailureMessage(code: string | undefined): string {
  if (code === '42501') {
    return 'We could not save your profile because this account is not permitted to write it. Please sign in again, then try once more.';
  }
  return SAVE_FAILED_MESSAGE;
}

/**
 * Creates or updates the member's profile.
 *
 * WHY THIS IS NOT AN UPSERT
 *   `profiles.birth_date` deliberately carries a column-level SELECT revoke
 *   (M15). PostgreSQL requires SELECT on every column named in an
 *   `ON CONFLICT DO UPDATE SET` list, so an upsert whose payload includes
 *   `birth_date` fails with `permission denied for table profiles` even though
 *   the member may legitimately update their own row. Granting SELECT on
 *   `birth_date` would undo the privacy boundary.
 *
 *   Instead, update first and check the returned id. A plain UPDATE needs only
 *   UPDATE + SELECT on the returned `id`, not on `birth_date`. Zero returned
 *   rows means the profile does not exist yet, so we insert it. The insert also
 *   returns its id, so a silently filtered write can never be mistaken for
 *   success. A concurrent insert surfaces as `23505`; the retry update closes
 *   that race.
 */
export async function saveProfile(draft: ProfileDraft): Promise<void> {
  const { ok, problems, payload } = validateProfileDraft(draft);

  if (!ok) {
    throw new ProfileError(problems[0]?.message ?? 'Your profile is not ready to save yet.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;

  if (authError || !user) {
    console.error('[profile] save failed: no authenticated user', authError?.message);
    throw new ProfileError(
      'Your session has expired. Please sign in again to save your profile.',
      authError?.code
    );
  }

  // Never trust an id supplied by the caller: auth.uid() is the write boundary.
  const fields: Record<string, unknown> = { ...payload };
  delete fields.id;

  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', user.id)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[profile] save failed:', updateError.code, updateError.message);
    throw new ProfileError(saveFailureMessage(updateError.code), updateError.code);
  }
  if (updated) return;

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert({ ...fields, id: user.id })
    .select('id')
    .maybeSingle();

  if (!insertError && inserted) return;

  if (insertError?.code === '23505') {
    const { data: retried, error: retryError } = await supabase
      .from('profiles')
      .update(fields)
      .eq('id', user.id)
      .select('id')
      .maybeSingle();

    if (!retryError && retried) return;

    console.error('[profile] save retry failed:', retryError?.code, retryError?.message);
    throw new ProfileError(saveFailureMessage(retryError?.code), retryError?.code);
  }

  console.error('[profile] save failed:', insertError?.code, insertError?.message);
  throw new ProfileError(saveFailureMessage(insertError?.code), insertError?.code);
}

// `loadOwnProfile()` used to live here with a `select('*')`. It was imported by
// nothing, and a wildcard select is now denied outright because `birth_date`
// carries a column-level revoke. Removed rather than repaired: the two surfaces
// that genuinely need the member's own row (the wizard and the dashboard) each
// read an explicit allow-list sized to what they render.

// Data-subject rights (export and erasure) live in `src/lib/privacy.ts` and are
// already wired into `/profile/settings`. They are deliberately NOT duplicated
// here: that module signs the dead session out after erasure, and a second copy
// would be the one that eventually forgot to.
