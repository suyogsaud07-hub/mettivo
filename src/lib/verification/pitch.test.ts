import { describe, expect, it } from 'vitest';
import { PITCH_BANDS, estimatePitch, median, pitchMatchesGender } from './pitch';

/** A mono sine wave at `hz`, sampled at `sampleRate`. */
function sine(hz: number, sampleRate: number, length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return samples;
}

describe('median', () => {
  it('returns the middle value of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignores non-finite and non-positive entries, and returns 0 when empty', () => {
    expect(median([Number.NaN, -5, 0, 10, 20])).toBe(15);
    expect(median([])).toBe(0);
  });
});

describe('pitchMatchesGender', () => {
  it('accepts a plausible pitch for the selected gender', () => {
    expect(pitchMatchesGender('Woman', 220)).toBe(true);
    expect(pitchMatchesGender('Man', 120)).toBe(true);
    expect(pitchMatchesGender('Nonbinary', 260)).toBe(true);
  });

  it('rejects the clear opposite band', () => {
    expect(pitchMatchesGender('Woman', 90)).toBe(false);
    expect(pitchMatchesGender('Man', 300)).toBe(false);
  });

  it('rejects a non-positive or non-finite measurement', () => {
    expect(pitchMatchesGender('Woman', 0)).toBe(false);
    expect(pitchMatchesGender('Woman', Number.NaN)).toBe(false);
  });

  it('keeps the overlapping grace band for both Woman and Man', () => {
    expect(pitchMatchesGender('Woman', PITCH_BANDS.Woman.min)).toBe(true);
    expect(pitchMatchesGender('Man', PITCH_BANDS.Man.max)).toBe(true);
    expect(PITCH_BANDS.Woman.min).toBeLessThanOrEqual(PITCH_BANDS.Man.max);
  });
});

describe('estimatePitch', () => {
  it('returns a plausible in-band frequency for a clean tone', () => {
    const sampleRate = 8000;
    const hz = estimatePitch(sine(200, sampleRate, 800), sampleRate);
    expect(hz).toBeGreaterThan(0);
    expect(hz).toBeGreaterThanOrEqual(50);
    expect(hz).toBeLessThanOrEqual(500);
  });

  it('returns 0 for silence', () => {
    expect(estimatePitch(new Float32Array(800), 8000)).toBe(0);
  });

  it('returns 0 for empty input or a non-positive sample rate', () => {
    expect(estimatePitch(new Float32Array(0), 8000)).toBe(0);
    expect(estimatePitch(sine(200, 8000, 800), 0)).toBe(0);
  });
});
