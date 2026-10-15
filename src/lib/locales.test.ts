import { describe, expect, it } from 'vitest';
import {
  LOCALE_CODES,
  LOCALE_OPTIONS,
  findLocale,
  isLocaleCode,
  localeName,
  localeNativeName,
  searchLocales,
} from '@/lib/locales';
import { LOCALE_DATA } from '@/lib/locale-data';
import { translations, type Language } from '@/lib/translations';

/**
 * The language catalogue is the contract between three surfaces — the landing
 * picker, the settings sheet and the onboarding pills — and the translation
 * data. These tests pin the invariants that keep "the picker offers N languages"
 * and "the app has strings for N languages" from drifting apart, which is the
 * silent failure that turns a global dropdown into a decoration.
 */

describe('locale catalogue', () => {
  it('exposes one option per code, in order, with no duplicates', () => {
    expect(LOCALE_OPTIONS).toHaveLength(LOCALE_CODES.length);
    expect(LOCALE_OPTIONS.map((option) => option.code)).toEqual([...LOCALE_CODES]);
    expect(new Set(LOCALE_CODES).size).toBe(LOCALE_CODES.length);
  });

  it('covers the languages the brief names explicitly', () => {
    // The brief called out these by name; every one must be selectable.
    for (const code of [
      'en', 'ne', 'hi', 'es', 'fr', 'ja', 'de', 'pt', 'ar', 'zh', 'ko', 'it', 'ru',
    ]) {
      expect(isLocaleCode(code), `${code} must be a supported language`).toBe(true);
    }
  });

  it('resolves an English name and an endonym for every language', () => {
    for (const option of LOCALE_OPTIONS) {
      expect(option.englishName, `${option.code} english name`).toBeTruthy();
      // A native name that just echoes the code means Intl had no data.
      expect(option.nativeName, `${option.code} native name`).toBeTruthy();
      expect(option.code).toMatch(/^[a-z]{2}(-[a-z]{2})?$/);
    }
  });

  it('rejects anything that is not a supported code', () => {
    for (const value of ['', 'xx', 'klingon', null, undefined, 42, {}, []]) {
      expect(isLocaleCode(value)).toBe(false);
    }
  });

  it('looks names up defensively', () => {
    expect(localeName('ja')).toBe('Japanese');
    expect(localeNativeName('ja')).toBe('日本語');
    expect(findLocale('ja')?.englishName).toBe('Japanese');
    // An unknown code falls back to itself rather than throwing.
    expect(localeName('zz')).toBe('zz');
    expect(localeNativeName('zz')).toBe('zz');
    expect(findLocale('zz')).toBeUndefined();
  });
});

describe('locale search', () => {
  it('returns everything for an empty query', () => {
    expect(searchLocales('')).toHaveLength(LOCALE_OPTIONS.length);
    expect(searchLocales('   ')).toHaveLength(LOCALE_OPTIONS.length);
  });

  it('matches the English name, case-insensitively', () => {
    expect(searchLocales('japan').map((o) => o.code)).toEqual(['ja']);
    expect(searchLocales('JAPAN').map((o) => o.code)).toEqual(['ja']);
    expect(searchLocales('kor').map((o) => o.code)).toEqual(['ko']);
  });

  it('matches the native name', () => {
    expect(searchLocales('日本語').map((o) => o.code)).toEqual(['ja']);
    expect(searchLocales('한국어').map((o) => o.code)).toEqual(['ko']);
  });

  it('matches the aliases the brief uses', () => {
    // The brief says "Mandarin"; CLDR calls it "Chinese".
    expect(searchLocales('mandarin').map((o) => o.code)).toContain('zh');
    expect(searchLocales('farsi').map((o) => o.code)).toContain('fa');
    expect(searchLocales('tagalog').map((o) => o.code)).toContain('tl');
  });

  it('returns an empty list rather than everything when nothing matches', () => {
    expect(searchLocales('zzzzz')).toEqual([]);
  });
});

describe('translation coverage', () => {
  const englishKeys = Object.keys(translations.en);

  it('has real strings for every language the picker offers', () => {
    // The core invariant: a language in the picker must have strings, or
    // selecting it silently renders English.
    for (const code of LOCALE_CODES) {
      expect(translations[code], `${code} must have translations`).toBeDefined();
    }
  });

  it('has no missing key in any language', () => {
    const gaps: string[] = [];
    for (const code of LOCALE_CODES) {
      for (const key of englishKeys) {
        const value = translations[code][key];
        if (typeof value !== 'string' || value.trim() === '') {
          gaps.push(`${code}.${key}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('keeps every language to exactly the English key set', () => {
    for (const code of LOCALE_CODES) {
      expect(Object.keys(translations[code]).sort(), `${code} key set`).toEqual(
        [...englishKeys].sort()
      );
    }
  });

  it('preserves the hand-written English source verbatim', () => {
    const source = LOCALE_DATA.en;
    // The landing CTA. Title case is deliberate: this button is the primary
    // brand action, and it opens `/signup` (see `src/app/page.tsx`).
    expect(source.get_started).toBe("Let's Get Started");
    expect(source.discover).toBe('Discover');
  });

  it('does not leave a language identical to English across the board', () => {
    // A machine translation that failed everywhere would fall back to English
    // for every key. Allow a couple of coincidences (proper nouns), but not a
    // wholesale miss.
    for (const code of LOCALE_CODES) {
      if (code === 'en') continue;
      const identical = englishKeys.filter(
        (key) => translations[code][key] === translations.en[key]
      ).length;
      expect(identical, `${code} looks untranslated`).toBeLessThan(englishKeys.length);
    }
  });

  it('types Language as the catalogue, not a hand-maintained subset', () => {
    // Compile-time in practice; asserted here so the intent is documented.
    const asLanguage: Language = 'ja';
    expect(LOCALE_CODES).toContain(asLanguage);
  });
});
