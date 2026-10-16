/**
 * M24 — the spoken liveness challenge.
 *
 * The member reads a fresh phrase aloud; the voice route confirms via
 * speech-to-text that every word of it was spoken. A fresh random phrase each
 * attempt makes a replayed recording useless on the next try.
 */

/** Easy-to-say, easy-to-transcribe words — no homophone traps for STT. */
const WORDS = [
  'amber', 'orchid', 'velvet', 'copper', 'meadow', 'harbor', 'lilac', 'cedar',
  'pebble', 'saffron', 'willow', 'marble', 'thistle', 'quartz', 'ember', 'clover',
] as const;

/** Builds a phrase of two words and a two-digit number. `random` is injectable. */
export function buildChallengePhrase(random: () => number = Math.random): string {
  const pick = () => WORDS[Math.floor(random() * WORDS.length)] ?? WORDS[0];
  const number = 10 + Math.floor(random() * 90);
  return `${pick()} ${pick()} ${number}`;
}
