'use client';

import type { ReactNode } from 'react';
import IntentionBadge from './IntentionBadge';
import ProfileStatCards, { type ProfileStatKey } from './ProfileStatCards';

/**
 * The profile header: avatar, name + age badge, "gender • location", the
 * intention pill and the four primary counters.
 *
 * One component for both the member's own dashboard and another member's public
 * profile, so the two views are structurally identical. The public profile adds
 * a Follow button through `actions`; everything else is the same.
 */
export interface ProfileHeaderProps {
  displayName: string;
  age: number | null;
  gender: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  isOnline?: boolean;
  intention: string | null;
  matches: number;
  following: number;
  followers: number;
  likes: number;
  onStatNavigate?: (key: ProfileStatKey) => void;
  /** Counters that open a list. On another member's profile, Followers only. */
  navigableStats?: ProfileStatKey[];
  /** Extra controls rendered under the intention pill (e.g. Follow). */
  actions?: ReactNode;
}

export default function ProfileHeader({
  displayName,
  age,
  gender,
  city,
  country,
  avatarUrl,
  isOnline = false,
  intention,
  matches,
  following,
  followers,
  likes,
  onStatNavigate,
  navigableStats,
  actions,
}: ProfileHeaderProps) {
  const displayLocation =
    city && country ? `${city}, ${country}` : city || country || 'Location not set';

  return (
    <>
      <div style={styles.heroSection}>
        <div style={styles.avatarContainer}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={displayName} style={styles.avatar} />
          ) : (
            <div style={{ ...styles.avatar, ...styles.avatarFallback }}>👤</div>
          )}
          {isOnline && <div style={styles.onlineBadge} />}
        </div>

        <div style={styles.nameRow}>
          <span style={styles.name}>{displayName}</span>
          {age !== null && <span style={styles.ageBadge}>{age}</span>}
        </div>

        <div style={styles.location}>
          {gender ? `${gender} • ` : ''}
          {displayLocation}
        </div>

        <IntentionBadge intention={intention} />

        {actions && <div style={styles.actions}>{actions}</div>}
      </div>

      <ProfileStatCards
        matches={matches}
        following={following}
        followers={followers}
        likes={likes}
        onNavigate={onStatNavigate}
        navigableStats={navigableStats}
      />
    </>
  );
}

const styles = {
  heroSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '30px 20px 20px 20px',
  },
  avatarContainer: { position: 'relative' as const, marginBottom: '16px' },
  avatar: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    objectFit: 'cover' as const,
    border: '3px solid #D8B38A',
    backgroundColor: '#34283F',
  },
  avatarFallback: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '40px',
  },
  onlineBadge: {
    position: 'absolute' as const,
    bottom: '5px',
    right: '10px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#34D399',
    border: '3px solid #131017',
  },
  nameRow: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
  name: { fontSize: '26px', fontWeight: 800, color: '#EAE2F0' },
  ageBadge: {
    backgroundColor: '#4A1828',
    color: '#D8B38A',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: 700,
  },
  location: { fontSize: '14px', color: '#B58A83', marginBottom: '16px', textAlign: 'center' as const },
  actions: { display: 'flex', gap: '10px', marginTop: '16px' },
};
