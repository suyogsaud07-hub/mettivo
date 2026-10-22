'use client';

import { useRouter } from 'next/navigation';

/**
 * Quiet, icon-only entry point to the owner's Profile Views analytics.
 *
 * Deliberately text-free: the count and label live on the analytics screen, so
 * the profile header stays minimal. The `title` supplies a native tooltip and
 * `aria-label` keeps the control understandable to screen readers.
 */
export default function ProfileViewsIconButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="pf-views-icon-btn"
      data-testid="profile-views-button"
      onClick={() => router.push('/profile/stats/views')}
      aria-label="View profile visitors"
      title="Profile views"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}
