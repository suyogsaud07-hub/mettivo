/**
 * The Welcome Letter from the founder.
 *
 * WHY A CONFIG FILE
 *   The letter is authored copy, not application logic. Keeping it in one plain
 *   TypeScript constant means it can be edited by hand in VS Code (or by anyone
 *   comfortable in a text editor) without touching a page component, and the
 *   landing-page trigger and the `/letter` route can never disagree about what
 *   the letter says — they both read this object.
 *
 * EDITING THE LETTER
 *   Change the values below. `salutation`, `body` and `signature` are rendered in
 *   order: the greeting, one paragraph per array entry, the sign-off, then the
 *   signature. Add or remove paragraphs freely; the page maps over `body`.
 *
 *   Do NOT move the strings into `src/lib/locale-data.ts`: that file is generated
 *   for the UI's fixed 18 keys, and the letter is deliberately a single authored
 *   voice rather than 50 translations of it.
 */

export interface WelcomeLetter {
  /** Small label above the letter, also used as the document title. */
  heading: string;
  /** The greeting line, e.g. "Dear users,". */
  salutation: string;
  /** One entry per paragraph. */
  body: string[];
  /** The sign-off line, e.g. "-Founder". */
  closing: string;
  /** Who signed it. */
  signature: string;
}

export const WELCOME_LETTER: WelcomeLetter = {
  heading: 'A Welcome Letter from the Founder',
  salutation: 'Dear users,',
  body: ['Welcome to Mettivo. Explore and enjoy!'],
  closing: '-Founder',
  signature: 'Suyog Saund.',
};
