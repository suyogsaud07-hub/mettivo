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

/**
 * Lucide-style glyphs, drawn inline.
 *
 * The project carries no icon dependency, so the transport icons are local SVG
 * paths (the same approach every other surface uses). They inherit
 * `currentColor`, so the enabled/disabled colour treatment lives on the button.
 */
function MicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
      <path d="M5 10v2a7 7 0 0 0 12 5" />
      <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    </svg>
  );
}

function VideoOffIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function RoundButton({
  ariaLabel,
  enabled,
  onClick,
  disabled,
  testId,
  children,
}: {
  ariaLabel: string;
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={enabled}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '48px',
        height: '48px',
        borderRadius: '50%',
        border: `1px solid ${enabled ? '#34283f' : '#7f1d2e'}`,
        backgroundColor: enabled ? '#211a28' : '#4a1c2e',
        color: enabled ? '#eae2f0' : '#fca5b5',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
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
        ariaLabel={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        enabled={micEnabled}
        onClick={onToggleMic}
      >
        {micEnabled ? <MicIcon /> : <MicOffIcon />}
      </RoundButton>
      <RoundButton
        testId="live-toggle-cam"
        ariaLabel={camEnabled ? 'Turn camera off' : 'Turn camera on'}
        enabled={camEnabled}
        onClick={onToggleCam}
      >
        {camEnabled ? <VideoIcon /> : <VideoOffIcon />}
      </RoundButton>

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
