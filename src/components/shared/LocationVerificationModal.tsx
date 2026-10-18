'use client';

import { useEffect } from 'react';
import { useLocationVerification } from '@/hooks/useLocationVerification';

/**
 * The "where are you?" prompt, shown globally (see
 * `LocationVerificationGate`, mounted from the root layout).
 *
 * Copy has two flavours:
 *   * a NEW city was detected → name it, and offer to update;
 *   * the regular 5-day check → a neutral "keep your profile accurate" nudge.
 *
 * Colours are the app's Midnight Romance tokens (see `globals.css`): card
 * `#1C1822`, hairline `#34283F`, gold action `#D4B18A`.
 */

interface LocationVerificationModalProps {
  /** The signed-in member's id, from the session — never from a URL. */
  userId: string;
}

export default function LocationVerificationModal({
  userId,
}: LocationVerificationModalProps) {
  const {
    needsVerification,
    detectedCity,
    detectedCountry,
    loading,
    updating,
    error,
    confirmLocation,
    dismiss,
  } = useLocationVerification(userId);

  // Escape keeps the dialog reachable by keyboard; it is a soft dismissal, the
  // same as "Keep Current".
  useEffect(() => {
    if (!needsVerification) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [needsVerification, dismiss]);

  if (!needsVerification) return null;

  const place = [detectedCity, detectedCountry].filter(Boolean).join(', ');
  const hasDetectedCity = Boolean(place);

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        backgroundColor: 'rgba(9, 7, 12, 0.72)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-verification-title"
        style={{
          width: '100%',
          maxWidth: '360px',
          borderRadius: '24px',
          backgroundColor: '#1C1822',
          border: '1px solid #34283F',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: '52px',
            height: '52px',
            margin: '0 auto 16px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(212, 177, 138, 0.14)',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#D4B18A"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        </div>

        <h2
          id="location-verification-title"
          style={{
            margin: '0 0 10px',
            fontSize: '18px',
            fontWeight: 700,
            color: '#EAE2F0',
          }}
        >
          Update your location?
        </h2>

        <p
          style={{
            margin: '0 0 20px',
            fontSize: '14px',
            lineHeight: 1.5,
            color: '#B4A3C0',
          }}
        >
          {hasDetectedCity
            ? `We noticed you might be in ${place}. Update your location?`
            : 'Please verify your location to keep your profile accurate.'}
        </p>

        {loading && (
          <p
            aria-live="polite"
            style={{
              margin: '0 0 16px',
              fontSize: '12px',
              color: '#8E7F9A',
            }}
          >
            Checking your current location…
          </p>
        )}

        {error && (
          <p
            role="alert"
            style={{
              margin: '0 0 16px',
              fontSize: '12px',
              color: '#FCA5B5',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={updating}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '30px',
              border: 'none',
              backgroundColor: '#29202D',
              color: '#B58A83',
              fontWeight: 700,
              cursor: updating ? 'not-allowed' : 'pointer',
              opacity: updating ? 0.6 : 1,
            }}
          >
            Keep Current
          </button>

          <button
            type="button"
            onClick={() => void confirmLocation()}
            disabled={updating}
            style={{
              flex: 1,
              padding: '14px',
              borderRadius: '30px',
              border: 'none',
              backgroundColor: '#D4B18A',
              color: '#17121C',
              fontWeight: 800,
              cursor: updating ? 'not-allowed' : 'pointer',
              opacity: updating ? 0.7 : 1,
            }}
          >
            {updating ? 'Saving…' : 'Update Location'}
          </button>
        </div>
      </div>
    </div>
  );
}
