'use client';

/**
 * The four primary profile counters: Matches, Following, Followers and Profile
 * Likes. Shared by the member's own dashboard and the public profile so the
 * header reads identically on both.
 *
 * `onNavigate` is optional: on your own profile the cards are shortcuts into
 * the matching `/profile/stats/*` lists, while on another member's profile they
 * are informational (their lists are not yours to browse).
 */

export type ProfileStatKey = 'matches' | 'following' | 'followers' | 'likes';

export interface ProfileStatCardsProps {
  matches: number;
  following: number;
  followers: number;
  likes: number;
  onNavigate?: (key: ProfileStatKey) => void;
  /**
   * Which counters open a list. Omitted means "all of them" (your own profile).
   * On another member's profile only Followers is viewable, so the caller passes
   * `['followers']` and the rest stay informational.
   */
  navigableStats?: ProfileStatKey[];
}

interface StatDefinition {
  key: ProfileStatKey;
  icon: string;
  label: string;
  value: number;
}

export default function ProfileStatCards({
  matches,
  following,
  followers,
  likes,
  onNavigate,
  navigableStats,
}: ProfileStatCardsProps) {
  const stats: StatDefinition[] = [
    { key: 'matches', icon: '🤝', label: 'Matches', value: matches },
    { key: 'following', icon: '➕', label: 'Following', value: following },
    { key: 'followers', icon: '👥', label: 'Followers', value: followers },
    { key: 'likes', icon: '💛', label: 'Profile Likes', value: likes },
  ];

  const canNavigate = (key: ProfileStatKey) =>
    Boolean(onNavigate) && (!navigableStats || navigableStats.includes(key));

  return (
    <div style={styles.grid}>
      {stats.map((stat) => {
        const content = (
          <>
            <span style={styles.icon}>{stat.icon}</span>
            <span style={styles.value}>{stat.value || 0}</span>
            <span style={styles.label}>{stat.label}</span>
          </>
        );

        return canNavigate(stat.key) ? (
          <button
            key={stat.key}
            type="button"
            onClick={() => onNavigate?.(stat.key)}
            style={styles.card}
            aria-label={`${stat.label}: ${stat.value || 0}`}
          >
            {content}
          </button>
        ) : (
          <div key={stat.key} style={{ ...styles.card, cursor: 'default' }} aria-label={`${stat.label}: ${stat.value || 0}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '10px',
    padding: '0 20px',
    marginBottom: '24px',
  },
  card: {
    backgroundColor: '#211A28',
    borderRadius: '16px',
    padding: '16px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    border: '1px solid #34283F',
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'center' as const,
  },
  icon: { fontSize: '20px' },
  value: { fontSize: '18px', fontWeight: 800, color: '#EAE2F0' },
  label: {
    fontSize: '9px',
    color: '#B58A83',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.4px',
    lineHeight: 1.2,
  },
};
