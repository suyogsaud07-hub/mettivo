import { describe, expect, it } from 'vitest';
import { formatCompactCount } from '@/lib/number-format';

describe('formatCompactCount', () => {
  it('shows exact integers below one thousand', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(1)).toBe('1');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('uses K notation with one meaningful decimal', () => {
    expect(formatCompactCount(1_000)).toBe('1K');
    expect(formatCompactCount(1_250)).toBe('1.3K');
    expect(formatCompactCount(12_500)).toBe('12.5K');
    expect(formatCompactCount(20_000)).toBe('20K');
    expect(formatCompactCount(100_000)).toBe('100K');
  });

  it('keeps values below one million in K notation', () => {
    expect(formatCompactCount(999_000)).toBe('999K');
    expect(formatCompactCount(999_999)).toBe('999.9K');
  });

  it('uses M notation from one million onward', () => {
    expect(formatCompactCount(1_000_000)).toBe('1M');
    expect(formatCompactCount(1_200_000)).toBe('1.2M');
    expect(formatCompactCount(20_000_000)).toBe('20M');
  });

  it('normalises invalid and negative input', () => {
    expect(formatCompactCount(-4)).toBe('0');
    expect(formatCompactCount(Number.NaN)).toBe('0');
  });
});
