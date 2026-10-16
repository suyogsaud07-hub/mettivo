/**
 * M24 — acoustic pitch helper for the voice check.
 *
 * This is NOT a security boundary. The authoritative voice signal is the
 * server's speech-to-text liveness check. Pitch is a client-side heuristic used
 * only to catch an obvious mismatch quickly and to give the member feedback
 * before a round trip; it is recorded by the server as advisory data. It is
 * deliberately forgiving, because vocal pitch varies widely across individuals
 * and microphone quality, and a false rejection is a worse failure than a lenient
 * one here.
 */

import type { VerificationGender } from '@/lib/verification/client';

/** Typical speaking fundamental-frequency bands, with a grace margin. */
export const PITCH_BANDS: Record<VerificationGender, { min: number; max: number }> = {
  // A lower-bound near 155 Hz and an upper bound near 175 Hz leave an overlap
  // band so a deep voice is never punished for a gender it does not contradict.
  Woman: { min: 155, max: 500 },
  Man: { min: 50, max: 175 },
  Nonbinary: { min: 50, max: 500 },
};

/** The median of a list of measurements, or 0 for an empty/garbage input. */
export function median(values: readonly number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

/**
 * Whether a measured pitch is consistent with the selected gender. Only the
 * clear opposite band fails; anything inside the (overlapping) accepted band
 * passes.
 */
export function pitchMatchesGender(gender: VerificationGender, hz: number): boolean {
  if (!Number.isFinite(hz) || hz <= 0) return false;
  const band = PITCH_BANDS[gender];
  return hz >= band.min && hz <= band.max;
}

/** Window bounds for the autocorrelation search, in Hz. */
const MIN_HZ = 50;
const MAX_HZ = 500;

/**
 * Estimates the fundamental frequency (F0) of a frame of time-domain audio,
 * using autocorrelation. Returns 0 when the frame is silent or has no clear
 * period, so callers can ignore unvoiced frames.
 *
 * Deliberately simple and dependency-free: this runs a few times a second in the
 * browser and is only a supporting signal, not a decision-maker.
 */
export function estimatePitch(samples: Float32Array, sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || samples.length === 0) return 0;

  // Silence gate: skip frames quieter than a low RMS threshold.
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms < 0.01) return 0;

  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), samples.length - 1);

  let bestLag = -1;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let i = 0; i + lag < samples.length; i += 1) {
      correlation += samples[i] * samples[i + lag];
    }
    correlation /= samples.length - lag;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag <= 0) return 0;
  const hz = sampleRate / bestLag;
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : 0;
}
