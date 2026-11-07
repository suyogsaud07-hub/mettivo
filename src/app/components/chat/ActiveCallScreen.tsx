'use client';

import { Phone, Video, X, Mic, MicOff } from 'lucide-react';

interface ActiveCallScreenProps {
  isOpen: boolean;
  onEnd: () => void;
  onMute: () => void;
  onCamera: () => void;
  onSpeaker: () => void;
  callType: 'voice' | 'video';
  isMuted: boolean;
  isCameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  duration: number;
  state: string;
  error: string | null;
}

export default function ActiveCallScreen({
  isOpen,
  onEnd,
  onMute,
  onCamera,
  onSpeaker,
  callType,
  isMuted,
  isCameraOff,
  localStream,
  remoteStream,
  duration,
  state,
  error,
}: ActiveCallScreenProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={() => {}}
    >
      <div
        className="relative z-10 w-full h-full flex flex-col items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative w-full max-w-2xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl mb-6">
          {remoteStream ? (
            <video
              autoPlay
              playsInline
              {...({ srcObject: remoteStream } as React.VideoHTMLAttributes<HTMLVideoElement>)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#6B5B79]">
              Waiting for video…
            </div>
          )}
          {callType === 'video' && localStream && (
            <video
              autoPlay
              playsInline
              muted
              {...({ srcObject: localStream } as React.VideoHTMLAttributes<HTMLVideoElement>)}
              className="absolute bottom-4 right-4 w-48 h-36 bg-[#1C1822] rounded-xl border border-[#34283F] object-cover"
            />
          )}
          {callType !== 'video' && localStream === null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[#6B5B79]">
              <Mic size={48} className="mb-2" />
              <p>Voice call active</p>
            </div>
          )}
          {state === 'connecting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <span className="text-[#D4B18A] font-medium">Connecting…</span>
            </div>
          )}
        </div>

        <div className="text-lg font-mono text-[#D4B18A] mb-6 font-bold">
          {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={onMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-[#C24A6E]/20 text-[#EF4444]'
                : 'bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D]'
            }`}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <MicOff size={20} strokeWidth={2} />
            ) : (
              <Mic size={20} strokeWidth={2} />
            )}
          </button>

          {callType === 'video' && (
            <button
              type="button"
              onClick={onCamera}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                isCameraOff
                  ? 'bg-[#C24A6E]/20 text-[#EF4444]'
                  : 'bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D]'
              }`}
              aria-label={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isCameraOff ? (
                <Video size={20} strokeWidth={2} className="opacity-50" />
              ) : (
                <Video size={20} strokeWidth={2} />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onSpeaker}
            className="w-14 h-14 rounded-full flex items-center justify-center bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D]"
            aria-label="Speaker"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M11 5L6 9v2h6L11 19z" />
              <path d="M5.5 15A3.5 3.5 0 0119 5a3.5 3.5 0 013.5 3.5v10a3.5 3.5 0 01-3.5 3.5A3.5 3.5 0 015.5 15z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onEnd}
            className="w-14 h-14 rounded-full bg-[#EF4444] text-white flex items-center justify-center shadow-lg shadow-[#EF4444]/40 hover:bg-[#DC2626] transition"
            aria-label="End call"
          >
            <Phone size={20} strokeWidth={2} />
          </button>
        </div>

        {error && (
          <div className="mt-4 px-4 py-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-sm text-[#EF4444]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
