'use client';

import { intentionLabel } from '@/lib/profile-options';

/**
 * The intention pill.
 *
 * Rendered identically wherever a member is introduced — their own dashboard,
 * another member's public profile, and the Discover / People cards — so the
 * "what are they here for" signal reads the same everywhere.
 */
export interface IntentionBadgeProps {
  intention: string | null | undefined;
  /** Shown when no intention has been chosen yet. */
  fallback?: string;
}

export default function IntentionBadge({
  intention,
  fallback = 'Looking for connections',
}: IntentionBadgeProps) {
  const label = intention ? intentionLabel(intention) : '';

  return <span style={styles.badge}>{label || fallback}</span>;
}

const styles = {
  badge: {
    display: 'inline-block',
    backgroundColor: '#241C2C',
    color: '#D8B38A',
    border: '1px solid #4A1828',
    padding: '6px 16px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.2px',
  },
};
