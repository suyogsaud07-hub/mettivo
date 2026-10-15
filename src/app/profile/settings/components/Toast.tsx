'use client';

/**
 * The transient confirmation used across settings ("Avatar updated", "App cache
 * cleared successfully.", …).
 *
 * It replaces the `alert()` calls the screen used to make: an alert blocks the
 * page and cannot carry the Midnight Romance palette. The timer lives with the
 * caller (so a sheet closing cannot cancel it), this component is pure.
 */

const mr = {
  gold: 'var(--mr-gold, #d8b38a)',
  goldText: 'var(--mr-gold-text, #1a130c)',
  errorBg: 'var(--mr-burgundy, #4a1c2e)',
  errorText: '#f2cfcf',
} as const;

export interface ToastMessage {
  message: string;
  tone: 'success' | 'error';
}

export default function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;

  const isError = toast.tone === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="settings-toast"
      data-tone={toast.tone}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '40px',
        transform: 'translateX(-50%)',
        zIndex: 3000,
        maxWidth: '90%',
        padding: '12px 20px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 600,
        textAlign: 'center',
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        backgroundColor: isError ? mr.errorBg : mr.gold,
        color: isError ? mr.errorText : mr.goldText,
      }}
    >
      {toast.message}
    </div>
  );
}
