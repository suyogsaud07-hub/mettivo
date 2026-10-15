import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
  TRANSLATION_LANGUAGE_OPTIONS,
  TranslationError,
  isSupportedLanguageCode,
  normaliseLanguageCode,
} from '@/lib/translation';

/**
 * CONTRACT A — the pure language layer.
 *
 * These are the invariants that keep the picker, the database check constraint
 * (`user_preferences_language_format`) and the upstream providers agreeing.
 */

/** Every code the contract requires to exist. */
const REQUIRED_CODES = [
  'en', 'ne', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh',
  'ar', 'bn', 'tr', 'id', 'vi', 'th', 'pl', 'nl', 'uk', 'ro', 'sv', 'cs',
  'el', 'he',
];

describe('language normalisation', () => {
  it('lowercases, trims and accepts a supported code', () => {
    expect(normaliseLanguageCode('EN')).toBe('en');
    expect(normaliseLanguageCode('  ne  ')).toBe('ne');
    expect(normaliseLanguageCode('Hi')).toBe('hi');
  });

  it('turns an underscore region into the hyphen form', () => {
    // `pt_br` is what a locale API or a spreadsheet export tends to produce.
    // `pt-br` is not in the allow-list today, so the normalised (unsupported)
    // value must come back as null rather than as a code nobody can serve.
    expect(normaliseLanguageCode('pt_br')).toBeNull();
    expect(normaliseLanguageCode('PT_BR')).toBeNull();
  });

  it('returns null for anything unusable rather than throwing', () => {
    expect(normaliseLanguageCode('')).toBeNull();
    expect(normaliseLanguageCode('   ')).toBeNull();
    expect(normaliseLanguageCode(null)).toBeNull();
    expect(normaliseLanguageCode(undefined)).toBeNull();
    expect(normaliseLanguageCode('xx')).toBeNull();
    expect(normaliseLanguageCode('english')).toBeNull();
    expect(normaliseLanguageCode('auto')).toBeNull();
    expect(normaliseLanguageCode('en-US')).toBeNull();
    expect(normaliseLanguageCode('<script>')).toBeNull();
  });

  it('never returns a code that is not in the allow-list', () => {
    for (const candidate of ['en', 'EN', 'ne', 'zz', 'english', 'e', 'en-']) {
      const normalised = normaliseLanguageCode(candidate);
      if (normalised !== null) {
        expect(SUPPORTED_LANGUAGE_CODES).toContain(normalised);
      }
    }
  });
});

describe('isSupportedLanguageCode', () => {
  it('is true for every supported code', () => {
    for (const code of REQUIRED_CODES) {
      expect(isSupportedLanguageCode(code)).toBe(true);
    }
  });

  it('is case and whitespace tolerant', () => {
    expect(isSupportedLanguageCode('EN')).toBe(true);
    expect(isSupportedLanguageCode(' hi ')).toBe(true);
  });

  it('narrows only strings', () => {
    expect(isSupportedLanguageCode(42)).toBe(false);
    expect(isSupportedLanguageCode(null)).toBe(false);
    expect(isSupportedLanguageCode(undefined)).toBe(false);
    expect(isSupportedLanguageCode({ code: 'en' })).toBe(false);
    expect(isSupportedLanguageCode(['en'])).toBe(false);
    expect(isSupportedLanguageCode('not a language')).toBe(false);
  });
});

describe('the language presets', () => {
  it('includes every code the contract requires', () => {
    for (const code of REQUIRED_CODES) {
      expect(SUPPORTED_LANGUAGE_CODES).toContain(code);
    }
  });

  it('contains no duplicates', () => {
    expect(new Set(SUPPORTED_LANGUAGE_CODES).size).toBe(SUPPORTED_LANGUAGE_CODES.length);
    expect(new Set(TRANSLATION_LANGUAGE_OPTIONS.map((option) => option.code)).size).toBe(
      TRANSLATION_LANGUAGE_OPTIONS.length
    );
  });

  it('has one option per supported code, each with a label', () => {
    expect(TRANSLATION_LANGUAGE_OPTIONS.map((option) => option.code)).toEqual([
      ...SUPPORTED_LANGUAGE_CODES,
    ]);

    for (const option of TRANSLATION_LANGUAGE_OPTIONS) {
      expect(isSupportedLanguageCode(option.code)).toBe(true);
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('matches the database check constraint exactly', () => {
    // `user_preferences_language_format` is ^[a-z]{2}(-[a-z]{2})?$. A code that
    // does not match would be offered by the UI and refused by PostgreSQL.
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(code).toMatch(/^[a-z]{2}(-[a-z]{2})?$/);
    }
  });

  it('has a default that is itself supported', () => {
    expect(isSupportedLanguageCode(DEFAULT_TRANSLATION_LANGUAGE)).toBe(true);
    expect(DEFAULT_TRANSLATION_LANGUAGE).toBe('en');
  });
});

describe('TranslationError', () => {
  it('carries the machine code and a real Error identity', () => {
    const error = new TranslationError('Nope.', 'unsupported_language');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TranslationError);
    expect(error.name).toBe('TranslationError');
    expect(error.message).toBe('Nope.');
    expect(error.code).toBe('unsupported_language');
  });
});
