'use client';

import { useCallback, useRef, useState } from 'react';
import { Mic, MicOff, Pause, Play, X } from 'lucide-react';

interface VoiceNoteRecorderProps {
  onSend: (audioBlob: Blob, durationSeconds: number) => void;
}

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export default function VoiceNoteRecorder({ onSend }: VoiceNoteRecorderProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'previewing' | 'sending'>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mimeTypeRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.remove();
      audioRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    clearTimer();
  }, [clearTimer]);

  const startRecording = useCallback(async () => {
    setError(null);
    clearTimer();
    stopPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mime = getSupportedMimeType();
      if (!mime) {
        setError('Your browser cannot record audio.');
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }
      mimeTypeRef.current = mime;

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        setState('previewing');
      };

      recorder.onerror = () => {
        setError('Recording failed.');
        stopRecording();
      };

      recorder.start(1000);
      setState('recording');
      setIsPaused(false);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied.');
      setState('idle');
    }
  }, [clearTimer, stopPlayback, stopRecording]);

  const cancelRecording = useCallback(() => {
    stopRecording();
    chunksRef.current = [];
    setDuration(0);
    setState('idle');
    setError(null);
  }, [stopRecording]);

  const sendRecording = useCallback(() => {
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current ?? 'audio/webm' });
    if (blob.size === 0) return;
    setState('sending');
    onSend(blob, duration);
    stopPlayback();
    chunksRef.current = [];
    setDuration(0);
    setState('idle');
  }, [duration, onSend]);

  const playPreview = useCallback(() => {
    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current ?? 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {state === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          disabled={error !== null}
          aria-label="Record voice note"
          className="p-2 rounded-full bg-[#C24A6E] text-white hover:bg-[#B33E5E] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Mic size={18} strokeWidth={2} />
        </button>
      )}

      {state === 'recording' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#C24A6E]/20 border border-[#C24A6E]/40">
          <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" />
          <span className="text-xs font-medium text-[#F2E9E4]">Recording</span>
          <span className="ml-auto text-xs font-mono text-[#F2E9E4]">
            {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
          </span>
          <button
            type="button"
            onClick={() => {
              if (isPaused) {
                mediaRecorderRef.current?.resume();
                setState('recording');
                setIsPaused(false);
              } else {
                mediaRecorderRef.current?.pause();
                setState('paused');
                setIsPaused(true);
              }
            }}
            className="p-1 text-[#F2E9E4] hover:text-white"
          >
            {isPaused ? (
              <Play size={14} />
            ) : (
              <Pause size={14} />
            )}
          </button>
          <button type="button" onClick={cancelRecording} className="p-1 text-[#F2E9E4] hover:text-[#EF4444]">
            <X size={14} />
          </button>
        </div>
      )}

      {state === 'paused' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#C24A6E]/20 border border-[#C24A6E]/40">
          <span className="text-xs font-medium text-[#F2E9E4]">Paused</span>
          <span className="ml-auto text-xs font-mono text-[#F2E9E4]">
            {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
          </span>
          <button
            type="button"
            onClick={() => {
              mediaRecorderRef.current?.resume();
              setState('recording');
            }}
            className="p-1 text-[#F2E9E4] hover:text-white"
          >
            <Play size={14} />
          </button>
          <button type="button" onClick={cancelRecording} className="p-1 text-[#F2E9E4] hover:text-[#EF4444]">
            <X size={14} />
          </button>
        </div>
      )}

      {state === 'previewing' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1C1822] border border-[#34283F]">
          <button
            type="button"
            onClick={playPreview}
            className="p-1.5 rounded-full bg-[#29202D] text-[#F2E9E4] hover:bg-[#34283F]"
          >
            <Play size={16} />
          </button>
          <span className="text-xs text-[#B58A83]">
            {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
          </span>
          <button type="button" onClick={sendRecording} className="ml-2 px-3 py-1.5 rounded-md bg-[#10B981] text-[#17121C] text-xs font-bold hover:bg-[#34D399]">
            Send
          </button>
          <button type="button" onClick={cancelRecording} className="ml-2 px-3 py-1.5 rounded-md bg-[#C24A6E] text-white text-xs font-bold hover:bg-[#B33E5E]">
            Cancel
          </button>
        </div>
      )}

      {state === 'sending' && (
        <div className="px-3 py-2 text-xs text-[#B58A83]">Sending voice note…</div>
      )}

      {error && (
        <p className="text-xs text-[#EF4444]">{error}</p>
      )}
    </div>
  );
}
