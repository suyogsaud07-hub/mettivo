'use client';

/**
 * The banner shown while the owner previews their profile as a visitor.
 *
 * "View As" hides owner-only controls and shows only public posts; this makes
 * clear that what is on screen is a preview, and offers the way back.
 */
export interface ProfileViewAsBannerProps {
  onExit: () => void;
}

export default function ProfileViewAsBanner({ onExit }: ProfileViewAsBannerProps) {
  return (
    <div className="pf-view-as" role="status" data-testid="view-as-banner">
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
        style={{ flexShrink: 0, color: 'var(--pf-gold)' }}
      >
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
      <div className="pf-view-as-copy">
        <div className="pf-view-as-title">Viewing as a visitor</div>
        <div className="pf-view-as-text">Only your public posts and details are shown.</div>
      </div>
      <button
        type="button"
        className="pf-btn pf-btn-small pf-btn-quiet"
        onClick={onExit}
        data-testid="view-as-exit"
      >
        Exit
      </button>
    </div>
  );
}
