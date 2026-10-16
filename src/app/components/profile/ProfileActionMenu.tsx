'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The "…" button in the profile top bar.
 *
 * Pure navigation: each row invokes a handler the profile page owns, so this
 * component never touches data itself. Kept separate from `PostOptionsMenu`,
 * which mutates one post.
 */
export interface ProfileActionMenuProps {
  onViewAs: () => void;
  onSearch: () => void;
  onProfileStatus: () => void;
  onArchive: () => void;
}

export default function ProfileActionMenu({
  onViewAs,
  onSearch,
  onProfileStatus,
  onArchive,
}: ProfileActionMenuProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const choose = (handler: () => void) => {
    setOpen(false);
    handler();
  };

  return (
    <>
      <button
        type="button"
        style={styles.trigger}
        onClick={() => setOpen(true)}
        aria-label="Profile options"
        data-testid="profile-options"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {open && (
        <div style={styles.overlay} onClick={close}>
          <div
            style={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Profile options"
            onClick={(event) => event.stopPropagation()}
          >
            <div style={styles.title}>Profile options</div>
            <button
              type="button"
              style={styles.row}
              onClick={() => choose(onViewAs)}
              data-testid="profile-view-as"
            >
              <span style={styles.rowIcon}>👁️</span>
              <span style={styles.rowLabel}>
                View As
                <span style={styles.rowHint}>See your profile the way a visitor does</span>
              </span>
            </button>
            <button
              type="button"
              style={styles.row}
              onClick={() => choose(onSearch)}
              data-testid="profile-search"
            >
              <span style={styles.rowIcon}>🔍</span>
              <span style={styles.rowLabel}>
                Search
                <span style={styles.rowHint}>Find a post by its caption</span>
              </span>
            </button>
            <button
              type="button"
              style={styles.row}
              onClick={() => choose(onProfileStatus)}
              data-testid="profile-status"
            >
              <span style={styles.rowIcon}>💬</span>
              <span style={styles.rowLabel}>
                Profile status
                <span style={styles.rowHint}>Set a short headline</span>
              </span>
            </button>
            <button
              type="button"
              style={styles.row}
              onClick={() => choose(onArchive)}
              data-testid="profile-archive"
            >
              <span style={styles.rowIcon}>📦</span>
              <span style={styles.rowLabel}>
                Archive
                <span style={styles.rowHint}>Hidden posts — restore or delete them</span>
              </span>
            </button>

            <button type="button" style={styles.cancel} onClick={close}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  trigger: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#211A28',
    border: '1px solid #34283F',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
    color: '#EAE2F0',
  },
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(8, 6, 10, 0.72)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 120,
    padding: '16px',
  },
  sheet: {
    width: '100%',
    maxWidth: '440px',
    backgroundColor: '#211A28',
    borderRadius: '24px',
    padding: '20px',
    border: '1px solid #34283F',
    marginBottom: '16px',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
  },
  title: { fontSize: '17px', fontWeight: 700, color: '#EAE2F0', marginBottom: '12px' },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '14px 12px',
    borderRadius: '14px',
    border: 'none',
    background: 'none',
    color: '#EAE2F0',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  rowIcon: { fontSize: '18px', width: '24px', textAlign: 'center' as const },
  rowLabel: { display: 'flex', flexDirection: 'column' as const, gap: '2px', flex: 1 },
  rowHint: { fontSize: '12px', color: '#B58A83', fontWeight: 500 },
  cancel: {
    width: '100%',
    marginTop: '12px',
    padding: '14px',
    borderRadius: '16px',
    border: '1px solid #34283F',
    backgroundColor: 'transparent',
    color: '#B58A83',
    fontWeight: 700,
    fontSize: '14px',
    cursor: 'pointer',
  },
};
