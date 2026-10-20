'use client';

/**
 * The four primary profile counters: Matches, Following, Followers and Profile
 * Likes. A compact numeric row on small screens, a two-by-two panel from tablet
 * width up. Shared by the dashboard and public profiles.
 *
 * `onNavigate` is optional: on your own profile all four open their lists, while
 * another member's profile only exposes Followers.
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
    { key: 'matches', label: 'Matches', value: matches },
    { key: 'following', label: 'Following', value: following },
    { key: 'followers', label: 'Followers', value: followers },
    { key: 'likes', label: 'Profile Likes', value: likes },
  ];

  const canNavigate = (key: ProfileStatKey) =>
    Boolean(onNavigate) && (!navigableStats || navigableStats.includes(key));

  return (
    <div className="pf-stats" aria-label="Profile stats">
      {stats.map((stat) => {
        const content = (
          <>
            <span className="pf-stat-value">{stat.value || 0}</span>
            <span className="pf-stat-label">{stat.label}</span>
          </>
        );

        return canNavigate(stat.key) ? (
          <button
            key={stat.key}
            type="button"
            onClick={() => onNavigate?.(stat.key)}
            className="pf-stat"
            aria-label={`${stat.label}: ${stat.value || 0}. View list`}
          >
            {content}
          </button>
        ) : (
          <div
            key={stat.key}
            className="pf-stat"
            aria-label={`${stat.label}: ${stat.value || 0}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
