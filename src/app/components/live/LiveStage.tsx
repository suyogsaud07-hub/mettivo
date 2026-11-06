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
      className="relative flex-1 min-h-0 rounded-2xl overflow-hidden bg-[#0d0a10] border border-[#34283f]"
    >
      {/* Main window: the partner. While searching, the member sees themselves
          so the screen is never a dead black rectangle. */}
      {remoteStream ? (
        <VideoCanvas
          stream={remoteStream}
          testId="live-remote-video"
          label="Your partner's video"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const }}
        />
      ) : localStream ? (
        <VideoCanvas stream={localStream} muted mirror testId="live-self-video" label="Your camera" />
      ) : (
        <div className="w-full h-full bg-[#131017]" />
      )}

      {waiting && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-14 bg-[#08060a]/45 pointer-events-none"
        >
          {(phase === 'searching' || phase === 'connecting') && (
            <span
              aria-hidden
              className="w-3.5 h-3.5 rounded-full bg-[#d8b38a] animate-[mr-live-pulse_1.2s_ease-in-out_infinite]"
            />
          )}
          <p
            data-testid="live-status"
            className="m-0 text-14 font-semibold text-[#eae2f0] drop-shadow-md"
          >
            {STATUS_COPY[phase]}
          </p>
        </div>
      )}

      {/* The member's own camera, once the partner is on screen. */}
      {remoteStream && localStream && (
        <div
          className="absolute top-4 right-4 w-32 h-48 rounded-xl overflow-hidden border-2 border-[#d8b38a] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
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
