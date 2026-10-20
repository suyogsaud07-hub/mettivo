/**
 * The single MBTI catalogue.
 *
 * The stored value remains the canonical four-letter code (`profiles.mbti`), so
 * existing rows and matching are unchanged. This module only gives that code a
 * human-readable name and description for the UI.
 */

export interface PersonalityOption {
  code: string;
  name: string;
  description: string;
}

export const PERSONALITY_OPTIONS = [
  {
    code: 'INTJ',
    name: 'Architect',
    description: 'Strategic, independent and comfortable with long-term plans.',
  },
  {
    code: 'INTP',
    name: 'Logician',
    description: 'Curious, analytical and happiest exploring ideas.',
  },
  {
    code: 'ENTJ',
    name: 'Commander',
    description: 'Decisive, ambitious and energised by leading.',
  },
  {
    code: 'ENTP',
    name: 'Debater',
    description: 'Inventive, quick-witted and always up for a debate.',
  },
  {
    code: 'INFJ',
    name: 'Advocate',
    description: 'Insightful, principled and driven to help others.',
  },
  {
    code: 'INFP',
    name: 'Mediator',
    description: 'Idealistic, empathetic and guided by personal values.',
  },
  {
    code: 'ENFJ',
    name: 'Protagonist',
    description: 'Warm, persuasive and focused on bringing people together.',
  },
  {
    code: 'ENFP',
    name: 'Campaigner',
    description: 'Enthusiastic, imaginative and excited by new possibilities.',
  },
  {
    code: 'ISTJ',
    name: 'Logistician',
    description: 'Practical, dependable and attentive to detail.',
  },
  {
    code: 'ISFJ',
    name: 'Defender',
    description: 'Caring, loyal and quietly attentive to the people around them.',
  },
  {
    code: 'ESTJ',
    name: 'Executive',
    description: 'Organised, direct and good at getting things done.',
  },
  {
    code: 'ESFJ',
    name: 'Consul',
    description: 'Sociable, supportive and attentive to community.',
  },
  {
    code: 'ISTP',
    name: 'Virtuoso',
    description: 'Adaptable, hands-on and calm in a crisis.',
  },
  {
    code: 'ISFP',
    name: 'Adventurer',
    description: 'Gentle, creative and drawn to new experiences.',
  },
  {
    code: 'ESTP',
    name: 'Entrepreneur',
    description: 'Bold, energetic and quick to act.',
  },
  {
    code: 'ESFP',
    name: 'Entertainer',
    description: 'Playful, spontaneous and loves being around people.',
  },
] as const satisfies readonly PersonalityOption[];

export type PersonalityCode = (typeof PERSONALITY_OPTIONS)[number]['code'];

/** Looks up a stored code, tolerating surrounding whitespace and lowercase input. */
export function personalityOption(code: string | null | undefined): PersonalityOption | undefined {
  const normalized = (code ?? '').trim().toUpperCase();
  return PERSONALITY_OPTIONS.find((option) => option.code === normalized);
}

/** The display name for a stored code, or `null` when it is not a known type. */
export function personalityName(code: string | null | undefined): string | null {
  return personalityOption(code)?.name ?? null;
}

/** A name-plus-code label, falling back to the raw stored value or "Not set". */
export function personalityLabel(code: string | null | undefined): string {
  const option = personalityOption(code);
  if (option) return `${option.name} (${option.code})`;
  return (code ?? '').trim() || 'Not set';
}
