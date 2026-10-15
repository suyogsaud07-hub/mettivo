'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * A bottom sheet — the one modal treatment the settings screen uses.
 *
 * WHY ONE COMPONENT
 *   Settings needs eight different panels (edit profile, account, notifications,
 *   privacy, block list, delete, legal, avatar picker). They must open, close,
 *   scroll and trap the eye identically; hand-rolling that eight times is how one
 *   of them ends up without an Escape handler. The only things that vary are the
 *   title and the body, so those are the props.
 *
 * Midnight Romance: `#131017` scrim, `#211a28` sheet, `#34283f` hairline,
 * `#d8b38a` gold title. The sheet slides up from the bottom on a phone and is
 * capped at a comfortable reading width on a desktop.
 */

const mr = {
  scrim: 'rgba(8, 6, 10, 0.72)',
  card: 'var(--mr-card, #211a28)',
  border: 'var(--mr-card-border, #34283f)',
  gold: 'var(--mr-gold, #d8b38a)',
  heading: 'var(--mr-heading, #eae2f0)',
  muted: 'var(--mr-placeholder, #9b8ba6)',
} as const;

export interface BottomSheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  /** Rendered below the scroll area, outside it, so a primary action stays put. */
  footer?: ReactNode;
  testId?: string;
  /** When true, tapping the scrim does nothing (used mid-save). */
  busy?: boolean;
}

export default function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testId,
  busy = false,
}: BottomSheetProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: mr.scrim,
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '440px',
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: mr.card,
          borderTopLeftRadius: '26px',
          borderTopRightRadius: '26px',
          border: `1px solid ${mr.border}`,
          borderBottom: 'none',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '20px 20px 12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: mr.gold }}>{title}</h2>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: mr.muted, lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            data-testid={testId ? `${testId}-close` : undefined}
            disabled={busy}
            style={{
              background: 'none',
              border: 'none',
              color: mr.muted,
              fontSize: '26px',
              lineHeight: 1,
              cursor: busy ? 'default' : 'pointer',
              padding: '0 4px',
              opacity: busy ? 0.5 : 1,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: '0 20px 20px',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            color: mr.heading,
          }}
        >
          {children}
        </div>

        {footer && (
          <div style={{ padding: '12px 20px 24px', borderTop: `1px solid ${mr.border}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
