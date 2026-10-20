import { describe, expect, it } from 'vitest';
import {
  MAX_FIRST_NAME_LENGTH,
  MAX_LAST_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  composeDisplayName,
  displayUsername,
  normalizeUsername,
  validateIdentity,
  validateUsername,
} from '@/lib/identity';

describe('identity — username normalization', () => {
  it('trims, strips one optional @ and lowercases', () => {
    expect(normalizeUsername('  @Suyog_Saud  ')).toBe('suyog_saud');
    expect(normalizeUsername('SUYOG')).toBe('suyog');
    expect(normalizeUsername('@@suyog')).toBe('@suyog');
  });

  it('renders the stored handle with exactly one @', () => {
    expect(displayUsername(' @Suyog ')).toBe('@suyog');
    expect(displayUsername('')).toBe('');
  });
});

describe('identity — username validation', () => {
  it('accepts the allowed alphabet at both length bounds', () => {
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a'.repeat(MAX_USERNAME_LENGTH))).toBeNull();
    expect(validateUsername('@Suyog_99')).toBeNull();
  });

  it('rejects missing, short and long usernames', () => {
    expect(validateUsername('')).toMatch(/choose/i);
    expect(validateUsername('ab')).toMatch(/at least/i);
    expect(validateUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toMatch(/fewer/i);
  });

  it('rejects spaces, dots, hyphens, emoji and other punctuation', () => {
    for (const value of ['suyog saud', 'suyog.saud', 'suyog-saud', 'suyog😀', 'suyog!']) {
      expect(validateUsername(value), value).not.toBeNull();
    }
  });
});

describe('identity — names and the no-last-name option', () => {
  it('requires a first name but allows a missing last name only when opted out', () => {
    const noLast = validateIdentity({
      firstName: 'Suyog',
      lastName: '',
      hasLastName: false,
      username: 'suyog',
    });
    expect(noLast).toEqual([]);

    const requiredLast = validateIdentity({
      firstName: 'Suyog',
      lastName: '   ',
      hasLastName: true,
      username: 'suyog',
    });
    expect(requiredLast.map((problem) => problem.field)).toContain('lastName');
  });

  it('requires a first name', () => {
    const problems = validateIdentity({
      firstName: ' ',
      lastName: 'Saud',
      hasLastName: true,
      username: 'suyog',
    });
    expect(problems.map((problem) => problem.field)).toContain('firstName');
  });

  it('preserves Unicode and internal spacing in names', () => {
    const problems = validateIdentity({
      firstName: '  आशा ',
      lastName: '  श्रेष्ठ ',
      hasLastName: true,
      username: 'asha',
    });
    expect(problems).toEqual([]);
    expect(composeDisplayName({ firstName: '  आशा ', lastName: ' श्रेष्ठ ', hasLastName: true }))
      .toBe('आशा श्रेष्ठ');
  });

  it('bounds both name fields without truncating them', () => {
    expect(
      validateIdentity({
        firstName: 'x'.repeat(MAX_FIRST_NAME_LENGTH + 1),
        lastName: 'x'.repeat(MAX_LAST_NAME_LENGTH + 1),
        hasLastName: true,
        username: 'valid_name',
      }).map((problem) => problem.field)
    ).toEqual(['firstName', 'lastName']);
  });

  it('never treats the checkbox label as a surname', () => {
    expect(
      composeDisplayName({ firstName: 'Suyog', lastName: "I don't have a last name", hasLastName: false })
    ).toBe('Suyog');
  });
});
