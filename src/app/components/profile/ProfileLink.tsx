'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Canonical link to a member's public profile.
 *
 * Keeping the route here means avatars, names, list rows and swipe cards cannot
 * drift to `/user/...` or a query-string variant. The label is explicit because
 * an avatar by itself has no accessible name.
 */
export interface ProfileLinkProps {
  userId: string;
  children: ReactNode;
  label?: string;
  style?: CSSProperties;
  className?: string;
}

export default function ProfileLink({
  userId,
  children,
  label,
  style,
  className,
}: ProfileLinkProps) {
  return (
    <Link
      href={`/profile/${encodeURIComponent(userId)}`}
      aria-label={label}
      className={className}
      style={{ display: 'inline-flex', color: 'inherit', textDecoration: 'none', ...style }}
    >
      {children}
    </Link>
  );
}
