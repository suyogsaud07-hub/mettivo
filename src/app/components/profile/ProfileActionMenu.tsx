'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The "…" button in the profile top bar.
 *
 * Pure navigation: each row invokes a handler the profile page owns, so this
 * component never touches data itself.
 */
export interface ProfileActionMenuProps {
  onViewAs: () => void;
  onSearch: () => void;
  onProfileStatus: () => void;
  onArchive: () => void;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function ProfileActionMenu({
  onViewAs,
  onSearch,
  onProfileStatus,
  onArchive,
}: ProfileActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const choose = (handler: () => void) => {
    setOpen(false);
    handler();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="pf-icon-btn"
        onClick={() => setOpen(true)}
        aria-label="Profile options"
        aria-haspopup="dialog"
        data-testid="profile-options"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>

      {open && (
        <div className="pf-sheet-overlay" onClick={close}>
          <div
            ref={sheetRef}
            className="pf-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-options-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="pf-sheet-title" id="profile-options-title">
              Profile options
            </h2>
            <p className="pf-sheet-subtitle">Manage how your profile appears and behaves.</p>

            <button
              type="button"
              className="pf-menu-row"
              onClick={() => choose(onViewAs)}
              data-testid="profile-view-as"
            >
              <span className="pf-menu-icon">
                <Icon>
                  <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="2.6" />
                </Icon>
              </span>
              <span className="pf-menu-copy">
                <span>View as visitor</span>
                <span className="pf-menu-hint">See your profile the way a visitor does</span>
              </span>
            </button>

            <button
              type="button"
              className="pf-menu-row"
              onClick={() => choose(onSearch)}
              data-testid="profile-search"
            >
              <span className="pf-menu-icon">
                <Icon>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </Icon>
              </span>
              <span className="pf-menu-copy">
                <span>Search posts</span>
                <span className="pf-menu-hint">Find a post by its caption</span>
              </span>
            </button>

            <button
              type="button"
              className="pf-menu-row"
              onClick={() => choose(onProfileStatus)}
              data-testid="profile-status"
            >
              <span className="pf-menu-icon">
                <Icon>
                  <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
                  <path d="M8 11h8M8 15h5" />
                </Icon>
              </span>
              <span className="pf-menu-copy">
                <span>Profile status</span>
                <span className="pf-menu-hint">Set a short headline</span>
              </span>
            </button>

            <button
              type="button"
              className="pf-menu-row"
              onClick={() => choose(onArchive)}
              data-testid="profile-archive"
            >
              <span className="pf-menu-icon">
                <Icon>
                  <path d="M4 7h16v13H4z" />
                  <path d="M3 4h18v3H3zM9 11h6" />
                </Icon>
              </span>
              <span className="pf-menu-copy">
                <span>Archive</span>
                <span className="pf-menu-hint">Hidden posts — restore or delete them</span>
              </span>
            </button>

            <button type="button" className="pf-sheet-cancel pf-menu-close" onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
