'use client';

import { useRouter } from 'next/navigation';
import { formatCompactCount } from '@/lib/number-format';

interface ProfileViewsIconButtonProps {
  /** Public unique-viewer count. `null` while loading or unavailable. */
  count: number | null;
}

/**
 * The single Profile Views control: an eye icon plus a compact unique-viewer
 * count in one pill. It opens the existing visitor analytics screen and does
 * not expose any viewer identity.
 */
export default function ProfileViewsIconButton({ count }: ProfileViewsIconButtonProps) {
  const router = useRouter();
  const hasCount = count !== null && Number.isFinite(count);
  const exactCount = hasCount ? Math.max(0, Math.floor(count)) : null;
  const label = exactCount === null ? '—' : formatCompactCount(exactCount);
  const accessibleLabel =
    exactCount === null
      ? 'View profile visitors'
      : `${exactCount} profile viewer${exactCount === 1 ? '' : 's'}. View visitors.`;

  return (
    <button
      type="button"
      className="pf-views-pill"
      data-testid="profile-views-button"
      onClick={() => router.push('/profile/stats/views')}
      aria-label={accessibleLabel}
      title="Profile views"
    >
      <svg
        width="15"
        height="15"
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
      <span className="pf-views-pill-count" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}
