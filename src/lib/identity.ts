/**
 * Display identity — first name, last name and username.
 *
 * These rules are duplicated in SQL (`normalize_username`, the username unique
 * index and the `profiles_identity_*` constraints) because the browser is not
 * the authorisation boundary. This module gives members immediate, specific
 * feedback; the database is what decides whether a write is valid.
 */

export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;
export const MAX_FIRST_NAME_LENGTH = 40;
export const MAX_LAST_NAME_LENGTH = 40;
/** First + space + last. Mirrors `profiles_display_name_shape` after the upgrade. */
export const MAX_DISPLAY_NAME_LENGTH = 81;

/**
 * Lowercase letters, digits and underscores only. The leading `@` is accepted
 * as input, stripped before validation, and never stored.
 */
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

export interface IdentityInput {
  firstName: string;
  lastName: string;
  hasLastName: boolean;
  username: string;
}

export interface IdentityProblem {
  field: 'firstName' | 'lastName' | 'username';
  message: string;
}

/** Trims a name and collapses internal runs of whitespace. Unicode is preserved. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Trim, drop one optional leading `@`, and lowercase. Interior whitespace is
 * left in place so validation can reject it instead of silently changing a
 * username the member typed.
 */
export function normalizeUsername(value: string): string {
  const trimmed = value.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}

/** What the member should see after typing, e.g. `@suyog_saud`. */
export function displayUsername(value: string): string {
  const normalized = normalizeUsername(value);
  return normalized ? `@${normalized}` : '';
}

/** One sentence describing the username rules, reused by every surface. */
export const USERNAME_HINT = `${MIN_USERNAME_LENGTH}–${MAX_USERNAME_LENGTH} characters: lowercase letters, numbers and underscores.`;

/** Validates a username without touching the network. */
export function validateUsername(value: string): string | null {
  const normalized = normalizeUsername(value);

  if (!normalized) return 'Please choose a username.';
  if (normalized.length < MIN_USERNAME_LENGTH) {
    return `Your username must be at least ${MIN_USERNAME_LENGTH} characters.`;
  }
  if (normalized.length > MAX_USERNAME_LENGTH) {
    return `Your username must be ${MAX_USERNAME_LENGTH} characters or fewer.`;
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Use only letters, numbers and underscores. Spaces, dots and hyphens are not allowed.';
  }
  return null;
}

/** Validates the full identity block in the order the fields appear. */
export function validateIdentity(input: IdentityInput): IdentityProblem[] {
  const problems: IdentityProblem[] = [];
  const firstName = normalizeName(input.firstName);
  const lastName = normalizeName(input.lastName);

  if (!firstName) {
    problems.push({ field: 'firstName', message: 'Please add your first name.' });
  } else if (firstName.length > MAX_FIRST_NAME_LENGTH) {
    problems.push({
      field: 'firstName',
      message: `First name must be ${MAX_FIRST_NAME_LENGTH} characters or fewer.`,
    });
  }

  if (input.hasLastName) {
    if (!lastName) {
      problems.push({ field: 'lastName', message: 'Please add your last name.' });
    } else if (lastName.length > MAX_LAST_NAME_LENGTH) {
      problems.push({
        field: 'lastName',
        message: `Last name must be ${MAX_LAST_NAME_LENGTH} characters or fewer.`,
      });
    }
  }

  const usernameProblem = validateUsername(input.username);
  if (usernameProblem) {
    problems.push({ field: 'username', message: usernameProblem });
  }

  return problems;
}

/**
 * Builds the single public-facing name. The checkbox is a control, never data:
 * when it is off the surname is dropped rather than written as a literal label.
 */
export function composeDisplayName(input: {
  firstName: string;
  lastName: string;
  hasLastName: boolean;
}): string {
  const firstName = normalizeName(input.firstName);
  const lastName = input.hasLastName ? normalizeName(input.lastName) : '';
  return lastName ? `${firstName} ${lastName}` : firstName;
}
