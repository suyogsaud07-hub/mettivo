/**
 * Casual Intent Categories
 *
 * Distinct from the main intention field (friendship, dating, both),
 * these represent more specific casual dating preferences.
 */

export type CasualIntent = 
  | 'free_tonight'
  | 'short_term_fun'
  | 'friends_with_benefits'
  | null;

/** Casual intent display information */
export interface CasualIntentConfig {
  id: CasualIntent;
  label: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
}

/** Available casual intents with their display properties */
export const CASUAL_INTENTS: CasualIntentConfig[] = [
  {
    id: 'free_tonight',
    label: 'Free Tonight',
    description: 'Looking for connections tonight',
    icon: '🌙',
    color: '#D4B18A',
    bgColor: 'rgba(212, 177, 138, 0.15)',
  },
  {
    id: 'short_term_fun',
    label: 'Short Term Fun',
    description: 'Seeking short-term fun and excitement',
    icon: '🎉',
    color: '#C78C8D',
    bgColor: 'rgba(199, 140, 141, 0.15)',
  },
  {
    id: 'friends_with_benefits',
    label: 'Friends with Benefits',
    description: 'Looking for casual relationships with benefits',
    icon: '🔥',
    color: '#B58A83',
    bgColor: 'rgba(181, 138, 131, 0.15)',
  },
];

/** Get casual intent config by ID */
export function getCasualIntentConfig(intent: CasualIntent): CasualIntentConfig | null {
  return CASUAL_INTENTS.find((config) => config.id === intent) ?? null;
}

/** Get label for casual intent */
export function getCasualIntentLabel(intent: CasualIntent): string {
  const config = getCasualIntentConfig(intent);
  return config?.label ?? '';
}

/** Check if a user has a casual intent */
export function hasCasualIntent(intent: CasualIntent): boolean {
  return intent !== null;
}

/** Casual intent category for filtering */
export type CasualIntentFilter = CasualIntent | 'all';

/** Filter options for casual intents */
export const CASUAL_INTENT_FILTERS: { value: CasualIntentFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...CASUAL_INTENTS.map((config) => ({
    value: config.id as CasualIntentFilter,
    label: config.label,
  })),
];
