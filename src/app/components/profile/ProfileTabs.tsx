'use client';

/**
 * The dual-tab switch shared by every profile surface.
 *
 *   * "User Feed"    — the member's posts / timeline,
 *   * "User Details" — the structured profile fields.
 *
 * The sliding gold indicator is the Midnight Romance treatment; keeping the
 * component in one place means the own-profile and public-profile tabs cannot
 * drift apart visually.
 */

export type ProfileTab = 'feed' | 'details';

export interface ProfileTabsProps {
  active: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}

export default function ProfileTabs({ active, onChange }: ProfileTabsProps) {
  return (
    <div style={styles.segment} role="tablist" aria-label="Profile sections">
      <div
        style={{
          ...styles.indicator,
          transform: active === 'details' ? 'translateX(100%)' : 'translateX(0)',
        }}
      />
      <button
        type="button"
        role="tab"
        aria-selected={active === 'feed'}
        style={{ ...styles.button, color: active === 'feed' ? '#131017' : '#EAE2F0' }}
        onClick={() => onChange('feed')}
      >
        User Feed
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'details'}
        style={{ ...styles.button, color: active === 'details' ? '#131017' : '#EAE2F0' }}
        onClick={() => onChange('details')}
      >
        User Details
      </button>
    </div>
  );
}

const styles = {
  segment: {
    position: 'relative' as const,
    display: 'flex',
    margin: '0 20px 24px 20px',
    backgroundColor: '#211A28',
    borderRadius: '999px',
    padding: '4px',
    border: '1px solid #34283F',
  },
  indicator: {
    position: 'absolute' as const,
    top: '4px',
    bottom: '4px',
    left: '4px',
    width: 'calc(50% - 4px)',
    backgroundColor: '#D8B38A',
    borderRadius: '999px',
    transition: 'transform 0.25s ease',
  },
  button: {
    position: 'relative' as const,
    flex: 1,
    zIndex: 1,
    padding: '12px',
    borderRadius: '999px',
    border: 'none',
    background: 'none',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'color 0.25s ease',
  },
};
