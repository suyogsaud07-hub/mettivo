/**
 * M30 — the moderation policy, as structured, versioned data.
 *
 * This is the machine-readable mirror of the Community Guidelines and the
 * conduct clauses in the Terms of Use (`src/lib/legal-content.ts`). Keeping it
 * as data — not prose inside a prompt — means:
 *
 *   • a decision can cite a stable section id and version, so an audit entry
 *     stays meaningful after the guidelines are edited;
 *   • the language model is told which sections exist and is asked to choose
 *     among them, instead of inventing policy;
 *   • both the deterministic engine (`triage.ts`) and the AI advisory
 *     (`report-ai.ts`) read from one source, so they cannot drift apart.
 *
 * IT IS A SIGNAL, NOT AN AUTHORITY
 *   Nothing here punishes anyone. It maps a report category to the sections it
 *   could implicate and a default severity. Enforcement stays in the existing,
 *   moderator-gated database functions.
 */

/** Bump when the sections below change, so old assessments stay interpretable. */
export const POLICY_VERSION = '2026.10';

export interface PolicySection {
  /** Stable id used in audit records. Never rename; add a new one instead. */
  id: string;
  title: string;
  /** One-line statement of the rule, drawn from the published guidelines. */
  summary: string;
  /** Concrete examples the model may match against, from the published text. */
  examples: string[];
}

export const POLICY_SECTIONS: readonly PolicySection[] = [
  {
    id: 'authenticity',
    title: 'Be real',
    summary: 'Use your own photos, describe yourself honestly, one person one account.',
    examples: ['impersonation', 'fake age', 'duplicate or fake account', 'stolen photos'],
  },
  {
    id: 'harassment',
    title: 'Be kind — harassment and hate',
    summary: 'Treat every member with respect; cruelty, threats and hate speech are not allowed.',
    examples: ['harassment', 'hate speech', 'threats', 'slurs', 'repeated unwanted contact'],
  },
  {
    id: 'child_safety',
    title: 'Child safety',
    summary: 'Any sexual content involving minors, or a member who appears to be under 18, is removed immediately.',
    examples: ['underage user', 'sexual content involving a minor', 'grooming'],
  },
  {
    id: 'explicit_media',
    title: 'Explicit sexual content',
    summary: 'Explicit sexual content sent or posted without consent is prohibited.',
    examples: ['unsolicited nudes', 'explicit photos', 'sexual imagery'],
  },
  {
    id: 'indecent_live',
    title: 'Indecent conduct on Live or Voice',
    summary: 'Do not show private parts or make rude gestures on a call or voice card.',
    examples: ['exposure on a live call', 'indecent gesture', 'sexual conduct on Live'],
  },
  {
    id: 'fraud',
    title: 'Be safe — scams and fraud',
    summary: 'Never send money; scams, financial fraud and solicitation are prohibited.',
    examples: ['romance scam', 'crypto or investment fraud', 'solicitation', 'money requests'],
  },
  {
    id: 'privacy',
    title: 'Protect private information',
    summary: 'Do not share another person’s private information without their consent.',
    examples: ['doxxing', 'sharing an address or phone number', 'sharing private photos'],
  },
  {
    id: 'spam',
    title: 'Spam and advertising',
    summary: 'Mettivo is for genuine connection, not for advertising or bulk messaging.',
    examples: ['spam', 'third-party advertising', 'link farming'],
  },
];

const SECTION_BY_ID = new Map(POLICY_SECTIONS.map((section) => [section.id, section]));

/** The primary section a report category implicates, plus any secondary ones. */
const CATEGORY_SECTIONS: Record<string, string[]> = {
  abuse_text: ['harassment'],
  explicit_media: ['explicit_media'],
  indecent_live: ['indecent_live'],
  underage: ['child_safety'],
  other: ['authenticity', 'fraud', 'privacy', 'spam'],
  // Legacy M21 values still present on older rows.
  nudity: ['explicit_media'],
  harassment: ['harassment'],
  spam: ['spam'],
};

/** Default severity by report category. Urgent categories escalate, not punish. */
const CATEGORY_SEVERITY: Record<string, PolicySeverity> = {
  underage: 'critical',
  explicit_media: 'high',
  indecent_live: 'high',
  abuse_text: 'medium',
  other: 'low',
  nudity: 'high',
  harassment: 'medium',
  spam: 'low',
};

export type PolicySeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Categories that must always reach a human, regardless of confidence. */
const URGENT_CATEGORIES = new Set(['underage']);

/** Returns the sections a report category implicates (never empty). */
export function sectionsForCategory(category: string): PolicySection[] {
  const ids = CATEGORY_SECTIONS[category] ?? ['authenticity', 'other'].filter((id) => SECTION_BY_ID.has(id));
  const resolved = ids
    .map((id) => SECTION_BY_ID.get(id))
    .filter((section): section is PolicySection => section !== undefined);
  return resolved.length > 0 ? resolved : [SECTION_BY_ID.get('harassment')!];
}

/** The section ids a report category implicates, for citation. */
export function policyRefsForCategory(category: string): string[] {
  return sectionsForCategory(category).map((section) => section.id);
}

/** The default severity a category carries. Unknown categories are low. */
export function severityForCategory(category: string): PolicySeverity {
  return CATEGORY_SEVERITY[category] ?? 'low';
}

/** True when the category is a safety escalation that a human must always see. */
export function isUrgentCategory(category: string): boolean {
  return URGENT_CATEGORIES.has(category);
}

/** Looks up a section by id, or `null` when an assessment cites an unknown id. */
export function policySectionById(id: string): PolicySection | null {
  return SECTION_BY_ID.get(id) ?? null;
}
