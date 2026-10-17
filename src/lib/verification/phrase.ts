/**
 * M24 — the spoken liveness challenge.
 *
 * The member reads a fresh phrase aloud; the voice route confirms with
 * speech-to-text that every word of it was spoken. A fresh random phrase is
 * what makes a replayed recording useless on the next try.
 */

export interface PhraseInput {
  /** The member's chosen display name, or null if they have not set one. */
  displayName: string | null;
  /** The gender the wizard is verifying against. */
  gender: 'Woman' | 'Man' | 'Nonbinary';
}

/** Trims to a single safe word, so the phrase cannot be used to inject prompt text. */
function safeName(displayName: string | null): string {
  if (!displayName) return 'friend';
  const cleaned = displayName
    .replace(/[^\p{L}\s'-]/gu, '')
    .trim()
    .split(/\s+/)[0];
  return cleaned.length > 0 ? cleaned.slice(0, 30) : 'friend';
}

/** The grammatical article+noun for the selected gender. */
function genderWord(gender: 'Woman' | 'Man' | 'Nonbinary'): string {
  if (gender === 'Woman') return 'a woman';
  if (gender === 'Man') return 'a man';
  return 'nonbinary';
}

/**
 * Builds the phrase the member reads aloud. `random` is injectable so the
 * tests are deterministic.
 */
export function buildChallengePhrase(
  input: PhraseInput,
  random: () => number = Math.random
): string {
  const name = safeName(input.displayName);
  const gender = genderWord(input.gender);
  const openers = ['Hi', 'Hello', 'Hey'];
  const opener = openers[Math.floor(random() * openers.length)] ?? openers[0];
  return `${opener}, my name is ${name}. I am ${gender}.`;
}