'use client';

import type { ReactNode } from 'react';
import IntentionBadge from './IntentionBadge';
import ProfileStatCards, { type ProfileStatKey } from './ProfileStatCards';

/**
 * The profile hero: avatar, identity, intention and the four primary counters.
 *
 * Shared by the member's own dashboard and another member's public profile, so
 * the two surfaces stay structurally identical. `actions` is how the owner gets
 * Edit Profile and a visitor gets Follow / Send Text without forking the markup.
 */
export interface ProfileHeaderProps {
  displayName: string;
  username?: string | null;
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
  /**
   * Public unique-viewer count. Omitted on the owner dashboard, which shows the
   * dedicated Profile Views button instead.
   */
  views?: number;
  onStatNavigate?: (key: ProfileStatKey) => void;
  /** Counters that open a list. On another member's profile, Followers only. */
  navigableStats?: ProfileStatKey[];
  /** Extra controls rendered under the intention pill (Edit Profile / Follow). */
  actions?: ReactNode;
}

function initials(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function ProfileHeader({
  displayName,
  username,
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
  views,
  onStatNavigate,
  navigableStats,
  actions,
}: ProfileHeaderProps) {
  const safeName = String(displayName ?? '').trim() || 'Member';
  const displayLocation =
    city && country ? `${city}, ${country}` : city || country || 'Location not set';
  const meta = [gender, displayLocation].filter(Boolean).join(' · ');

  return (
    <>
      <section className="pf-hero" aria-label="Profile overview">
        <div className="pf-identity">
          <div className="pf-avatar-wrap">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`${safeName}'s profile photo`}
                className="pf-avatar"
              />
            ) : (
              <div className="pf-avatar-fallback" aria-hidden="true">
                {initials(safeName)}
              </div>
            )}
            {isOnline && <span className="pf-online" aria-label="Online" />}
          </div>

          <div className="pf-name-row">
            <h1 className="pf-name">{safeName}</h1>
            {age !== null && <span className="pf-age">{age}</span>}
          </div>

          {username ? <p className="pf-username">@{username.replace(/^@/, '')}</p> : null}

          <p className="pf-meta">{meta}</p>

          <IntentionBadge intention={intention} className="pf-intention" />

          {views !== undefined ? (
            <p className="pf-views-meta" aria-label={`${views} profile views`}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>
                <strong>{views}</strong> profile view{views === 1 ? '' : 's'}
              </span>
            </p>
          ) : null}

          {actions && <div className="pf-actions">{actions}</div>}
        </div>

        <ProfileStatCards
          matches={matches}
          following={following}
          followers={followers}
          likes={likes}
          onNavigate={onStatNavigate}
          navigableStats={navigableStats}
        />
      </section>
    </>
  );
}
