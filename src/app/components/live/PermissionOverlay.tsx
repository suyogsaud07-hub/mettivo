'use client';

import VideoCanvas from './VideoCanvas';
import type { LivePhase } from '@/lib/live/useLiveSession';

/**
 * The pre-flight permission step.
 *
 * Camera and microphone access is the single most invasive permission the app
 * asks for, so it is requested deliberately (a button, never on page load) and
 * the member sees exactly what the partner will see — their own preview — before
 * they enter the pool. There is no "maybe later"; declining is one tap out.
 */

export interface PermissionOverlayProps {
  phase: LivePhase;
  error: string | null;
  localStream: MediaStream | null;
  onAllow: () => void;
  onStart: () => void;
  onCancel: () => void;
}

export default function PermissionOverlay({
  phase,
  error,
  localStream,
  onAllow,
  onStart,
  onCancel,
}: PermissionOverlayProps) {
  const requesting = phase === 'requesting';

  return (
    <div
      data-testid="live-permission-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        backgroundColor: 'rgba(8, 6, 10, 0.86)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Go live on Mettivo Live"
        style={{
          width: '100%',
          maxWidth: '400px',
          backgroundColor: '#211a28',
          border: '1px solid #34283f',
          borderRadius: '24px',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            backgroundColor: '#e05a6d',
            animation: 'mr-live-pulse 1.4s ease-in-out infinite',
          }} />
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#eae2f0' }}>
            Mettivo Live
          </h1>
        </div>
        <p style={{ margin: '0 0 18px', fontSize: '13px', lineHeight: 1.6, color: '#b58a83' }}>
          Meet a random member face to face. Your name, age and profile stay hidden —
          only your country is shown.
        </p>

        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '210px',
            borderRadius: '18px',
            overflow: 'hidden',
            border: '1px solid #34283f',
            backgroundColor: '#131017',
            marginBottom: '18px',
          }}
        >
          {localStream ? (
            <VideoCanvas stream={localStream} muted mirror testId="live-preview" label="Your camera preview" />
          ) : (
            <div style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9b8ba6',
              fontSize: '13px',
              textAlign: 'center',
              padding: '0 20px',
            }}>
              Your camera preview appears here once you allow access.
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            data-testid="live-permission-error"
            style={{ margin: '0 0 14px', fontSize: '13px', lineHeight: 1.5, color: '#fca5b5' }}
          >
            {error}
          </p>
        )}

        {localStream ? (
          <button
            type="button"
            data-testid="live-go-live"
            onClick={onStart}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '16px',
              border: 'none',
              background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
              color: '#1a130c',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Go Live
          </button>
        ) : (
          <button
            type="button"
            data-testid="live-allow"
            onClick={onAllow}
            disabled={requesting}
            style={{
              width: '100%',
              padding: '16px',
              borderRadius: '16px',
              border: 'none',
              background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
              color: '#1a130c',
              fontSize: '16px',
              fontWeight: 800,
              cursor: requesting ? 'default' : 'pointer',
              opacity: requesting ? 0.7 : 1,
            }}
          >
            {requesting ? 'Requesting access…' : 'Allow camera & microphone'}
          </button>
        )}

        <button
          type="button"
          data-testid="live-permission-cancel"
          onClick={onCancel}
          style={{
            width: '100%',
            marginTop: '10px',
            padding: '14px',
            borderRadius: '16px',
            border: '1px solid #34283f',
            backgroundColor: 'transparent',
            color: '#b58a83',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
