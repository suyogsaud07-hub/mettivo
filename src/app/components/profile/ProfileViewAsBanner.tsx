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
    <div style={styles.banner} role="status" data-testid="view-as-banner">
      <span style={styles.icon} aria-hidden>👁️</span>
      <div style={styles.text}>
        <div style={styles.title}>Viewing as a visitor</div>
        <div style={styles.subtitle}>Only your public posts and details are shown.</div>
      </div>
      <button
        type="button"
        style={styles.exit}
        onClick={onExit}
        data-testid="view-as-exit"
      >
        Exit
      </button>
    </div>
  );
}

const styles = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '0 20px 16px 20px',
    padding: '14px 16px',
    borderRadius: '16px',
    backgroundColor: '#241C2C',
    border: '1px solid #4A1828',
  },
  icon: { fontSize: '20px' },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: '14px', fontWeight: 700, color: '#D8B38A' },
  subtitle: { fontSize: '12px', color: '#B58A83' },
  exit: {
    padding: '8px 16px',
    borderRadius: '999px',
    border: 'none',
    background: 'linear-gradient(135deg, #D8B38A, #C78C8D)',
    color: '#131017',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
  },
};
