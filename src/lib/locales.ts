/**
 * The languages Mettivo offers, and how they are named.
 *
 * WHY THIS FILE EXISTS
 *   The app previously carried three independent, hand-written language lists —
 *   the landing dropdown, the settings row, and the onboarding "languages spoken"
 *   pills — with four, five and thirteen entries respectively. They disagreed,
 *   and none of them could be extended without editing three places.
 *
 * HOW NAMES ARE PRODUCED
 *   Only the language CODES are authored here. The English name ("Japanese") and
 *   the native name ("日本語") both come from `Intl.DisplayNames`, which ships
 *   with every modern browser and with Node. Hand-writing ~45 native names would
 *   put a typo or a wrong script in front of a member and no test could catch it;
 *   `Intl` is the correct source for this and costs nothing.
 *
 * WHY A CURATED LIST AND NOT "EVERY LANGUAGE IN EXISTENCE"
 *   A language is only in this union once `translations.ts` carries its strings.
 *   The `Language` type IS the key set of that object, so a code here without
 *   translations would either be a type error or silently render English — the
 *   "static visual dropdown" failure this list exists to prevent. Adding a
 *   language therefore means adding its strings, which is the honest unit of
 *   work.
 */

/** Every language the UI has been translated into, in display order. */
export const LOCALE_CODES = [
  'en', 'ne', 'hi', 'bn', 'ur', 'ta', 'te', 'mr', 'gu', 'pa',
  'es', 'fr', 'pt', 'it', 'ro', 'de', 'nl', 'sv', 'no', 'da', 'fi',
  'pl', 'cs', 'hu', 'el', 'ru', 'uk', 'bg',
  'tr', 'az', 'kk', 'uz',
  'ar', 'he', 'fa',
  'sw', 'am', 'ha', 'yo', 'zu',
  'id', 'ms', 'tl', 'vi', 'th', 'my', 'km', 'si',
  'zh', 'ja', 'ko',
] as const;

/** The union of every supported language code. */
export type LocaleCode = (typeof LOCALE_CODES)[number];

export interface LocaleOption {
  /** BCP-47-ish language subtag, e.g. `ja`. */
  code: LocaleCode;
  /** English name, used for searching, e.g. "Japanese". */
  englishName: string;
  /** Endonym — the language's own name, e.g. "日本語". */
  nativeName: string;
}

/**
 * Extra search terms that `Intl.DisplayNames` does not produce.
 *
 * The brief names "Mandarin", which the CLDR calls "Chinese". A member typing
 * what they call the language should find it, so the common alternative is
 * indexed explicitly rather than left to fail the search.
 */
const SEARCH_ALIASES: Partial<Record<LocaleCode, readonly string[]>> = {
  zh: ['mandarin', 'cantonese', 'chinese simplified', 'chinese traditional', 'putonghua'],
  tl: ['tagalog'],
  no: ['norwegian bokmal'],
  fa: ['farsi'],
  my: ['burmese'],
  he: ['ivrit'],
  el: ['hellenic'],
  sw: ['kiswahili'],
  yo: ['yoruba'],
};

/** Best-effort name lookup; falls back to the raw code rather than throwing. */
function displayName(locales: string[], code: string): string {
  try {
    return new Intl.DisplayNames(locales, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The picker's data, in `LOCALE_CODES` order.
 *
 * Names are resolved once at module load rather than per render: building an
 * `Intl.DisplayNames` instance is not free, and the result never changes.
 */
export const LOCALE_OPTIONS: readonly LocaleOption[] = LOCALE_CODES.map((code) => ({
  code,
  englishName: displayName(['en'], code),
  nativeName: displayName([code], code),
}));

const BY_CODE = new Map<string, LocaleOption>(LOCALE_OPTIONS.map((o) => [o.code, o]));

/** The option for a code, or `undefined` when it is not a supported language. */
export function findLocale(code: string | null | undefined): LocaleOption | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/** English name for a code, falling back to the code itself. */
export function localeName(code: string): string {
  return findLocale(code)?.englishName ?? code;
}

/** Native name for a code, falling back to the English name and then the code. */
export function localeNativeName(code: string): string {
  const option = findLocale(code);
  if (!option) return code;
  return option.nativeName || option.englishName;
}

/**
 * True when `code` is one of the languages in this list.
 *
 * A plain `LOCALE_CODES.includes` cannot narrow, so this is the type guard the
 * context and the picker both use.
 */
export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && BY_CODE.has(value);
}

/**
 * Case-insensitive search over the English name, the native name and the
 * aliases. An empty query returns everything, which is what the picker shows
 * before the member types.
 *
 * Matching is `includes` rather than `startsWith` because a member searching
 * "hindi" should also find nothing hidden behind a prefix rule, and the list is
 * small enough that substring matches stay useful.
 */
export function searchLocales(query: string): readonly LocaleOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return LOCALE_OPTIONS;

  return LOCALE_OPTIONS.filter((option) => {
    if (option.englishName.toLowerCase().includes(needle)) return true;
    if (option.nativeName.toLowerCase().includes(needle)) return true;
    const aliases = SEARCH_ALIASES[option.code];
    return aliases ? aliases.some((alias) => alias.includes(needle)) : false;
  });
}
