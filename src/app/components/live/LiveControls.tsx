'use client';

import type { LivePhase } from '@/lib/live/useLiveSession';

/**
 * Instant transport controls: Start, Next and Stop, plus microphone and camera
 * toggles. "Next" is the OmeTV muscle-memory — one tap drops the current partner
 * and finds another without leaving the pool.
 */

export interface LiveControlsProps {
  phase: LivePhase;
  micEnabled: boolean;
  camEnabled: boolean;
  /** A video ban or suspension: Start is shown but disabled. */
  restricted?: boolean;
  onStart: () => void;
  onNext: () => void;
  onStop: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
}

function RoundButton({
  label,
  active,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        border: `1px solid ${active ? '#34283f' : '#7f1d2e'}`,
        backgroundColor: active ? '#211a28' : '#4a1c2e',
        color: active ? '#eae2f0' : '#fca5b5',
        fontSize: '18px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}

export default function LiveControls({
  phase,
  micEnabled,
  camEnabled,
  restricted = false,
  onStart,
  onNext,
  onStop,
  onToggleMic,
  onToggleCam,
}: LiveControlsProps) {
  const inPool = phase === 'searching' || phase === 'connecting' || phase === 'live';
  const canStart = !inPool && phase !== 'requesting' && !restricted;

  const pill: React.CSSProperties = {
    flex: 1,
    padding: '15px',
    borderRadius: '16px',
    border: 'none',
    fontSize: '15px',
    fontWeight: 800,
    cursor: 'pointer',
  };

  return (
    <div
      data-testid="live-controls"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '14px 0 4px',
      }}
    >
      <RoundButton
        testId="live-toggle-mic"
        label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        active={micEnabled}
        onClick={onToggleMic}
      />
      <RoundButton
        testId="live-toggle-cam"
        label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
        active={camEnabled}
        onClick={onToggleCam}
      />

      {canStart || (!inPool && restricted) ? (
        <button
          type="button"
          data-testid="live-start"
          onClick={onStart}
          disabled={restricted || phase === 'requesting'}
          style={{
            ...pill,
            background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
            color: '#1a130c',
            opacity: restricted ? 0.5 : 1,
            cursor: restricted ? 'default' : 'pointer',
          }}
        >
          {restricted ? 'Unavailable' : 'Start'}
        </button>
      ) : (
        <>
          <button
            type="button"
            data-testid="live-next"
            onClick={onNext}
            disabled={!inPool}
            style={{
              ...pill,
              background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
              color: '#1a130c',
              opacity: inPool ? 1 : 0.5,
              cursor: inPool ? 'pointer' : 'default',
            }}
          >
            Next
          </button>
          <button
            type="button"
            data-testid="live-stop"
            onClick={onStop}
            disabled={!inPool}
            style={{
              ...pill,
              flex: '0 0 auto',
              padding: '15px 22px',
              backgroundColor: 'transparent',
              border: '1px solid #7f1d2e',
              color: '#fca5b5',
              opacity: inPool ? 1 : 0.5,
              cursor: inPool ? 'pointer' : 'default',
            }}
          >
            Stop
          </button>
        </>
      )}
    </div>
  );
}
