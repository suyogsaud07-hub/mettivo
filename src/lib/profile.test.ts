import { describe, expect, it } from 'vitest';
import {
  MAX_BIO_LENGTH,
  MIN_AGE,
  calculateAge,
  isAdult,
  validateProfileDraft,
  type ProfileDraft,
} from '@/lib/profile';

/**
 * M7 — profile validation, and the 18+ gate in particular.
 *
 * The gate previously failed silently: `calculateAge` clamped with
 * `Math.max(18, …)`, so a 15-year-old's real date of birth was stored and shown
 * as 18. On a dating product for adults that is the highest-severity defect in
 * the codebase (`RISK_REGISTER.md` R-05), so it gets direct tests.
 */

const NOW = new Date('2026-10-15T12:00:00Z');

const draft = (overrides: Partial<ProfileDraft> = {}): ProfileDraft => ({
  id: 'user-1',
  displayName: 'Sujata',
  birthDate: '1998-05-04',
  intention: 'dating',
  ...overrides,
});

describe('M7 — age derivation', () => {
  it('reports the true age, not a clamped one', () => {
    expect(calculateAge('2011-01-01', NOW)).toBe(15);
    expect(calculateAge('1998-05-04', NOW)).toBe(28);
  });

  it('does not round up before the birthday', () => {
    // Born 1998-11-01, "today" is 2026-10-15: still 27.
    expect(calculateAge('1998-11-01', NOW)).toBe(27);
  });

  it('treats a future date as no birth date at all', () => {
    expect(calculateAge('2030-01-01', NOW)).toBeNull();
  });

  it('returns null for missing or unparseable input', () => {
    expect(calculateAge('', NOW)).toBeNull();
    expect(calculateAge(undefined, NOW)).toBeNull();
    expect(calculateAge('not-a-date', NOW)).toBeNull();
  });

  it('knows who is an adult', () => {
    expect(isAdult('1998-05-04', NOW)).toBe(true);
    expect(isAdult('2011-01-01', NOW)).toBe(false);
    expect(isAdult('', NOW)).toBe(false);
  });
});

describe('M7 — draft validation', () => {
  it('accepts a complete adult draft and builds the payload', () => {
    const result = validateProfileDraft(draft(), NOW);
    expect(result.ok).toBe(true);
    expect(result.payload.age).toBe(28);
    expect(result.payload.display_name).toBe('Sujata');
    expect(result.payload.onboarding_completed).toBe(true);
  });

  it('refuses an underage date of birth instead of clamping it', () => {
    const result = validateProfileDraft(draft({ birthDate: '2011-01-01' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('birthDate');
    expect(result.problems[0].message).toMatch(new RegExp(`${MIN_AGE}`));
    // Nothing is persisted from a rejected draft.
    expect(result.payload).toEqual({});
  });

  it('refuses a missing date of birth', () => {
    const result = validateProfileDraft(draft({ birthDate: '' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('birthDate');
  });

  it('requires a display name and bounds its length', () => {
    expect(validateProfileDraft(draft({ displayName: '   ' }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ displayName: 'x'.repeat(61) }), NOW).ok).toBe(false);
    expect(validateProfileDraft(draft({ displayName: 'x'.repeat(60) }), NOW).ok).toBe(true);
  });

  it('rejects an intention outside the closed set', () => {
    const result = validateProfileDraft(draft({ intention: 'polyamory' }), NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.field)).toContain('intention');
  });

  it('bounds the bio and caps photos', () => {
    expect(validateProfileDraft(draft({ bio: 'x'.repeat(MAX_BIO_LENGTH + 1) }), NOW).ok).toBe(false);
    expect(
      validateProfileDraft(draft({ photos: Array.from({ length: 7 }, (_, i) => `p${i}`) }), NOW).ok
    ).toBe(false);
  });

  it('de-duplicates and caps multi-select fields', () => {
    const result = validateProfileDraft(
      draft({ interests: ['coffee', 'coffee', 'hiking'], hobbies: ['Music', 'music'] }),
      NOW
    );
    expect(result.payload.interests).toEqual(['coffee', 'hiking']);
    expect(result.payload.hobbies).toEqual(['Music']);
  });

  it('never validates a draft into a payload without an adult age', () => {
    // Property: if `ok` is true, the persisted age is an adult age.
    const ages = ['1990-01-01', '2008-10-15', '2008-10-16', '2015-06-01'];
    for (const birthDate of ages) {
      const result = validateProfileDraft(draft({ birthDate }), NOW);
      if (result.ok) {
        expect(Number(result.payload.age)).toBeGreaterThanOrEqual(MIN_AGE);
      } else {
        expect(result.payload).toEqual({});
      }
    }
  });
});
