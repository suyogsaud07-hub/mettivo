'use client';

import VideoCanvas from './VideoCanvas';
import { countryFlagEmoji } from '@/lib/live/signaling';
import type { LivePhase } from '@/lib/live/useLiveSession';

/**
 * The video stage: the partner on the main window and the member's own camera in
 * a small window in the corner. No name, age or profile is ever rendered — the
 * only thing identifying the partner is their country flag, which is the
 * anonymity promise of the whole feature.
 */

export interface LiveStageProps {
  phase: LivePhase;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  partnerCountry: string | null;
}

const STATUS_COPY: Record<LivePhase, string> = {
  idle: 'Tap Start to meet someone new',
  requesting: 'Waiting for camera access…',
  ready: 'Tap Start to meet someone new',
  searching: 'Finding someone for you…',
  connecting: 'Connecting…',
  live: '',
  error: 'Camera access is needed to go live',
};

export default function LiveStage({
  phase,
  remoteStream,
  localStream,
  partnerCountry,
}: LiveStageProps) {
  const waiting = !remoteStream;

  return (
    <div
      data-testid="live-stage"
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        borderRadius: '20px',
        overflow: 'hidden',
        backgroundColor: '#0d0a10',
        border: '1px solid #34283f',
      }}
    >
      {/* Main window: the partner. While searching, the member sees themselves
          so the screen is never a dead black rectangle. */}
      {remoteStream ? (
        <VideoCanvas stream={remoteStream} testId="live-remote-video" label="Your partner's video" />
      ) : localStream ? (
        <VideoCanvas stream={localStream} muted mirror testId="live-self-video" label="Your camera" />
      ) : (
        <div style={{ width: '100%', height: '100%', backgroundColor: '#131017' }} />
      )}

      {waiting && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '14px',
            backgroundColor: 'rgba(8, 6, 10, 0.45)',
            pointerEvents: 'none',
          }}
        >
          {(phase === 'searching' || phase === 'connecting') && (
            <span
              aria-hidden
              style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: '#d8b38a',
                animation: 'mr-live-pulse 1.2s ease-in-out infinite',
              }}
            />
          )}
          <p
            data-testid="live-status"
            style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#eae2f0', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}
          >
            {STATUS_COPY[phase]}
          </p>
        </div>
      )}

      {/* The member's own camera, once the partner is on screen. */}
      {remoteStream && localStream && (
        <div
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            width: '30%',
            maxWidth: '150px',
            aspectRatio: '3 / 4',
            borderRadius: '14px',
            overflow: 'hidden',
            border: '2px solid #d8b38a',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          <VideoCanvas stream={localStream} muted mirror testId="live-local-video" label="Your camera" />
        </div>
      )}

      {/* Anonymity: the ONLY identifier shown for a partner. */}
      {remoteStream && (
        <div
          data-testid="live-partner-country"
          style={{
            position: 'absolute',
            top: '14px',
            left: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 14px',
            borderRadius: '999px',
            backgroundColor: 'rgba(33, 26, 40, 0.82)',
            border: '1px solid #34283f',
            fontSize: '15px',
          }}
        >
          <span aria-hidden style={{ fontSize: '20px', lineHeight: 1 }}>
            {countryFlagEmoji(partnerCountry)}
          </span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#eae2f0' }}>
            {partnerCountry?.trim() ? partnerCountry : 'Unknown'}
          </span>
        </div>
      )}
    </div>
  );
}
