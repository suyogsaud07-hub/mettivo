'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, Video, X, Mic, MicOff } from 'lucide-react';
import { formatCallDuration } from '@/lib/chat-tokens';

interface IncomingCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: (callType: 'voice' | 'video') => void;
  onReject: () => void;
  callerName: string;
  callerAvatar: string | null;
  callType: 'voice' | 'video';
  isIncoming: boolean;
  timeoutSeconds?: number;
}

export default function IncomingCallModal({
  isOpen,
  onClose,
  onAccept,
  onReject,
  callerName,
  callerAvatar,
  callType,
  isIncoming,
  timeoutSeconds = 30,
}: IncomingCallModalProps) {
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    let remaining = timeLeft;
    timerRef.current = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
      }
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, timeLeft]);

  if (!isOpen) return null;

  const handleAccept = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onAccept(callType);
  };

  const handleReject = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onReject();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#131017]/95 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative z-10 w-full max-w-md p-6 flex flex-col items-center justify-center text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {callerAvatar ? (
          <div className="relative mb-6">
            <img
              src={callerAvatar}
              alt=""
              className="w-32 h-32 rounded-full border-4 border-[#D4B18A] object-cover shadow-2xl"
            />
          </div>
        ) : (
          <div className="w-32 h-32 rounded-full bg-[#1C1822] border border-[#34283F] flex items-center justify-center text-4xl mb-6">
            👤
          </div>
        )}

        <h2 className="text-xl font-bold text-[#F2E9E4] mb-1">
          {isIncoming ? 'Incoming call' : 'Calling'}
        </h2>
        <p className="text-lg text-[#D4B18A] font-semibold mb-2">{callerName}</p>
        <p className="text-xs text-[#B58A83] mb-6">
          {callType === 'video' ? 'Video call' : 'Voice call'}
        </p>

        <div className="text-3xl font-mono text-[#F2E9E4] mb-8 font-bold">
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
        </div>

        <div className="flex gap-3 w-full">
          {isIncoming && (
            <button
              type="button"
              onClick={handleReject}
              className="flex-1 px-6 py-3 rounded-2xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] transition"
            >
              <Phone size={20} strokeWidth={2} />
              <span className="ml-2">Decline</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleAccept}
            className="flex-1 px-6 py-3 rounded-2xl bg-[#C24A6E] text-[#17121C] font-bold hover:bg-[#B33E5E] transition shadow-lg shadow-[#C24A6E]/40"
          >
            {callType === 'video' ? (
              <>
                <Video size={20} strokeWidth={2} />
                <span className="ml-2">Accept Video</span>
              </>
            ) : (
              <>
                <Phone size={20} strokeWidth={2} />
                <span className="ml-2">Accept</span>
              </>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 text-xs text-[#B58A83] hover:text-[#F2E9E4] underline"
        >
          <X size={14} strokeWidth={2} />
          <span className="ml-1">Close</span>
        </button>
      </div>
    </div>
  );
}
