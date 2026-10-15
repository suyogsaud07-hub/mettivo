/**
 * M17 — the translation vocabulary, shared by the browser and the server.
 *
 * This module is PURE: no network, no React, no Supabase, no environment. It
 * exists so the language allow-list is defined exactly once. The settings UI,
 * the data-access layer and the `/api/translate` route all normalise through
 * here, which is what stops a code that the UI offers from being rejected by the
 * database (`user_preferences_language_format`) or by an upstream provider.
 *
 * The database copy is the boundary that cannot be bypassed; this copy exists to
 * produce a useful message at the right moment and to keep the two lists honest.
 */

export type TranslationProviderId = 'deepl' | 'mymemory';

/** The closed set of failure codes a translation can report. */
export type TranslationErrorCode =
  | 'invalid_request'
  | 'unsupported_language'
  | 'upstream_error'
  | 'upstream_quota'
  | 'empty_result';

/** The language a member's incoming messages are translated into by default. */
export const DEFAULT_TRANSLATION_LANGUAGE = 'en';

/**
 * `code, English label`, ordered so the settings list reads predictably.
 *
 * Every code is two lowercase letters, optionally followed by a region
 * (`pt-br`), which is exactly what `user_preferences_language_format` accepts:
 * `^[a-z]{2}(-[a-z]{2})?$`. A code outside that shape could be offered by the UI
 * and then refused by PostgreSQL, so the shape is part of the contract, not a
 * coincidence.
 */
const LANGUAGE_TABLE: readonly (readonly [string, string])[] = [
  ['en', 'English'],
  ['ne', 'Nepali'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ar', 'Arabic'],
  ['bn', 'Bengali'],
  ['tr', 'Turkish'],
  ['id', 'Indonesian'],
  ['vi', 'Vietnamese'],
  ['th', 'Thai'],
  ['pl', 'Polish'],
  ['nl', 'Dutch'],
  ['uk', 'Ukrainian'],
  ['ro', 'Romanian'],
  ['sv', 'Swedish'],
  ['cs', 'Czech'],
  ['el', 'Greek'],
  ['he', 'Hebrew'],
];

/** One entry of the language picker. */
export interface TranslationLanguageOption {
  code: string;
  label: string;
}

/** Every code the product accepts, at every boundary. */
export const SUPPORTED_LANGUAGE_CODES: readonly string[] = LANGUAGE_TABLE.map(([code]) => code);

/** The language picker's options, in display order. */
export const TRANSLATION_LANGUAGE_OPTIONS: readonly TranslationLanguageOption[] =
  LANGUAGE_TABLE.map(([code, label]) => ({ code, label }));

/** Mirrors `user_preferences_language_format`. */
const LANGUAGE_CODE_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/;

export interface TranslationResult {
  translatedText: string;
  provider: TranslationProviderId;
  detectedSourceLanguage?: string;
}

/** Raised for every expected failure while translating. */
export class TranslationError extends Error {
  readonly code: string;

  constructor(message: string, code: TranslationErrorCode) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}

/**
 * Normalises anything a caller might hold — `' EN '`, `'pt_BR'`, `null` — into a
 * supported code, or `null` when it is not one.
 *
 * Returning `null` rather than throwing is deliberate: the callers are a
 * settings form, a route body and a stored column, and each needs to decide for
 * itself whether an unusable code is a validation error or a reason to fall back
 * to the default.
 */
export function normaliseLanguageCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const code = value.trim().toLowerCase().replace(/_/g, '-');
  if (!LANGUAGE_CODE_PATTERN.test(code)) return null;

  return SUPPORTED_LANGUAGE_CODES.includes(code) ? code : null;
}

/**
 * True only for a code this product supports.
 *
 * Case and surrounding whitespace are tolerated, because the values arrive from
 * a browser form and from a `varchar` column; the meaning of the guard is "this
 * can be used as a language", not "this is already byte-identical to the list".
 */
export function isSupportedLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && normaliseLanguageCode(value) !== null;
}
