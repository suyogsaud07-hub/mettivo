'use client';

/**
 * A labelled on/off switch for the Notifications and Privacy sheets.
 *
 * The whole row is the hit target (a phone tap on a 44px toggle is easy to miss),
 * the control is a real `role="switch"` button so keyboard and screen readers
 * work, and the state is also carried by `aria-checked` and the track colour so
 * it is never colour-only.
 */

const mr = {
  card: 'var(--mr-card, #211a28)',
  gold: 'var(--mr-gold, #d8b38a)',
  goldText: 'var(--mr-gold-text, #1a130c)',
  heading: 'var(--mr-heading, #eae2f0)',
  muted: 'var(--mr-placeholder, #9b8ba6)',
  track: 'var(--mr-inactive, #2d2336)',
  border: 'var(--mr-card-border, #34283f)',
} as const;

export interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testId?: string;
}

export default function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  testId,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      data-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        width: '100%',
        padding: '14px 0',
        background: 'none',
        border: 'none',
        borderBottom: `1px solid ${mr.border}`,
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: mr.heading }}>
          {label}
        </span>
        {description && (
          <span style={{ display: 'block', fontSize: '12px', color: mr.muted, marginTop: '3px', lineHeight: 1.45 }}>
            {description}
          </span>
        )}
      </span>

      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: '46px',
          height: '28px',
          borderRadius: '999px',
          backgroundColor: checked ? mr.gold : mr.track,
          border: `1px solid ${checked ? mr.gold : mr.border}`,
          position: 'relative',
          transition: 'background-color 0.2s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '20px' : '2px',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            backgroundColor: checked ? mr.goldText : mr.heading,
            transition: 'left 0.2s ease',
          }}
        />
      </span>
    </button>
  );
}
