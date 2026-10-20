import { describe, expect, it } from 'vitest';
import {
  PERSONALITY_OPTIONS,
  personalityLabel,
  personalityName,
  personalityOption,
} from '@/lib/personality';

const EXPECTED = {
  INTJ: 'Architect',
  INTP: 'Logician',
  ENTJ: 'Commander',
  ENTP: 'Debater',
  INFJ: 'Advocate',
  INFP: 'Mediator',
  ENFJ: 'Protagonist',
  ENFP: 'Campaigner',
  ISTJ: 'Logistician',
  ISFJ: 'Defender',
  ESTJ: 'Executive',
  ESFJ: 'Consul',
  ISTP: 'Virtuoso',
  ISFP: 'Adventurer',
  ESTP: 'Entrepreneur',
  ESFP: 'Entertainer',
} as const;

describe('MBTI catalogue', () => {
  it('has exactly the sixteen canonical codes, each with one name', () => {
    expect(PERSONALITY_OPTIONS).toHaveLength(16);
    expect(new Set(PERSONALITY_OPTIONS.map((option) => option.code)).size).toBe(16);
    expect(Object.fromEntries(PERSONALITY_OPTIONS.map((o) => [o.code, o.name]))).toEqual(
      EXPECTED
    );
  });

  it('gives every option a non-empty description', () => {
    for (const option of PERSONALITY_OPTIONS) {
      expect(option.description.trim().length, option.code).toBeGreaterThan(0);
    }
  });

  it('looks up names without changing the stored code', () => {
    expect(personalityName('INFJ')).toBe('Advocate');
    expect(personalityName(' infj ')).toBe('Advocate');
    expect(personalityOption('ESFP')?.code).toBe('ESFP');
  });

  it('falls back safely for unknown or empty values', () => {
    expect(personalityName('XXXX')).toBeNull();
    expect(personalityLabel('')).toBe('Not set');
    expect(personalityLabel('XXXX')).toBe('XXXX');
  });

  it('formats the display label as name plus canonical code', () => {
    expect(personalityLabel('INTJ')).toBe('Architect (INTJ)');
    expect(personalityLabel('esfp')).toBe('Entertainer (ESFP)');
  });
});
