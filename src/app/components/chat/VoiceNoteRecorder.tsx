'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, X } from 'lucide-react';

interface VoiceNoteRecorderProps {
  onSend: (audioBlob: Blob, durationSeconds: number) => void;
}

type RecorderState = 'idle' | 'recording' | 'paused' | 'previewing' | 'sending';

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const TICK_MS = 250;

function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of SUPPORTED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export default function VoiceNoteRecorder({ onSend }: VoiceNoteRecorderProps) {
  const [state, setState] = useState<RecorderState>('idle');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playbackCurrent, setPlaybackCurrent] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mimeTypeRef = useRef<string | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackTimeupdateRef = useRef<((() => void)) | null>(null);
  const playbackEndedRef = useRef<((() => void)) | null>(null);
  const accumulatedMsRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const startLockRef = useRef(false);
  const cancellingRef = useRef(false);
  const isMountedRef = useRef(true);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current) {
      clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const stopMicrophone = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopMediaRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore: the stream may already be ended.
      }
    }
    mediaRecorderRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    clearPlaybackTimer();
    const audio = audioRef.current;
    if (audio) {
      const timeupdate = playbackTimeupdateRef.current;
      if (timeupdate) audio.removeEventListener('timeupdate', timeupdate);
      const ended = playbackEndedRef.current;
      if (ended) audio.removeEventListener('ended', ended);
      playbackTimeupdateRef.current = null;
      playbackEndedRef.current = null;
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    }
    setIsPlaying(false);
  }, [clearPlaybackTimer]);

  const releaseRecording = useCallback(() => {
    clearRecordingTimer();
    stopMediaRecorder();
    stopMicrophone();
    chunksRef.current = [];
    blobRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    accumulatedMsRef.current = 0;
    segmentStartRef.current = null;
  }, [clearRecordingTimer, stopMediaRecorder, stopMicrophone]);

  const releasePreview = useCallback(() => {
    stopPlayback();
    blobRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaybackCurrent(0);
    setPlaybackDuration(0);
    setIsPlaying(false);
  }, [stopPlayback]);

  const tickRecording = useCallback(() => {
    const now = Date.now();
    const base = segmentStartRef.current ?? now;
    const elapsed = Math.max(0, accumulatedMsRef.current + (now - base));
    setDurationSeconds(Math.ceil(elapsed / 1000));
  }, []);

  const setRecordingError = useCallback((message: string) => {
    setError(message);
    releaseRecording();
    setState('idle');
    startLockRef.current = false;
  }, [releaseRecording]);

  const startRecording = useCallback(async () => {
    if (startLockRef.current || sendingRef.current) return;
    startLockRef.current = true;

    setError(null);
    releaseRecording();
    stopPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        startLockRef.current = false;
        return;
      }
      streamRef.current = stream;

      const mime = getSupportedMimeType();
      if (!mime) {
        setError('Your browser cannot record audio.');
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        startLockRef.current = false;
        return;
      }
      mimeTypeRef.current = mime;

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      accumulatedMsRef.current = 0;
      segmentStartRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        if (!isMountedRef.current) return;
        clearRecordingTimer();
        if (cancellingRef.current) {
          cancellingRef.current = false;
          releaseRecording();
          setState('idle');
          setDurationSeconds(0);
          startLockRef.current = false;
          return;
        }

        const mime = mimeTypeRef.current ?? 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size === 0) {
          setError('The recording was empty. Please try again.');
          releaseRecording();
          setState('idle');
          startLockRef.current = false;
          return;
        }

        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;

        const now = Date.now();
        const recordedElapsed = accumulatedMsRef.current + (segmentStartRef.current !== null ? now - segmentStartRef.current : 0);
        const fallbackSeconds = Math.max(0, Math.ceil(recordedElapsed / 1000));
        setDurationSeconds(fallbackSeconds);
        setPlaybackDuration(Math.max(0, recordedElapsed) / 1000);

        // Validate against the actual audio metadata when the browser can read it.
        const probe = new Audio(url);
        const handleLoaded = () => {
          if (!isMountedRef.current) return;
          const duration = probe.duration;
          if (Number.isFinite(duration) && duration > 0) {
            setPlaybackDuration(duration);
            setDurationSeconds(Math.ceil(duration));
          }
        };
        probe.addEventListener('loadedmetadata', handleLoaded, { once: true });
        probe.src = url;
        probe.load();

        setState('previewing');
        startLockRef.current = false;
      };

      recorder.onerror = () => {
        if (!isMountedRef.current) return;
        setRecordingError('Recording failed.');
      };

      recorder.start(1000);
      setState('recording');
      setDurationSeconds(0);
      setPlaybackCurrent(0);
      setPlaybackDuration(0);
      setIsPlaying(false);

      recordingTimerRef.current = setInterval(tickRecording, TICK_MS);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : 'Microphone access denied.');
    }
  }, [
    clearRecordingTimer,
    releaseRecording,
    setRecordingError,
    stopPlayback,
    tickRecording,
  ]);

  const togglePause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'paused') {
      recorder.resume();
      segmentStartRef.current = Date.now();
      recordingTimerRef.current = setInterval(tickRecording, TICK_MS);
      setState('recording');
    } else {
      recorder.pause();
      accumulatedMsRef.current += Date.now() - (segmentStartRef.current ?? Date.now());
      segmentStartRef.current = null;
      clearRecordingTimer();
      setState('paused');
    }
  }, [clearRecordingTimer, tickRecording]);

  const cancelRecording = useCallback(() => {
    cancellingRef.current = true;
    sendingRef.current = false;
    releaseRecording();
    releasePreview();
    setState('idle');
    setDurationSeconds(0);
    setPlaybackCurrent(0);
    setPlaybackDuration(0);
    setIsPlaying(false);
    setError(null);
    startLockRef.current = false;
  }, [releaseRecording, releasePreview]);

  const stopAndPreview = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    clearRecordingTimer();
    recorder.stop(); // onstop finalises the blob and moves to previewing
  }, [clearRecordingTimer]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      const audio = audioRef.current;
      if (audio) audio.pause();
      setIsPlaying(false);
      clearPlaybackTimer();
      return;
    }

    const url = urlRef.current;
    if (!url || !blobRef.current) return;

    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(url);
      audioRef.current = audio;

      const handleTimeUpdate = () => {
        setPlaybackCurrent(audio?.currentTime ?? 0);
      };
      const handleEnded = () => {
        audio?.pause();
        setPlaybackCurrent(0);
        setIsPlaying(false);
        clearPlaybackTimer();
      };
      playbackTimeupdateRef.current = handleTimeUpdate;
      playbackEndedRef.current = handleEnded;
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);
    }

    audio.currentTime = playbackCurrent || 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      setIsPlaying(true);
    }
    playbackTimerRef.current = setInterval(() => {
      const audio = audioRef.current;
      if (audio) setPlaybackCurrent(audio.currentTime);
    }, TICK_MS);
  }, [isPlaying, playbackCurrent, clearPlaybackTimer]);

  const sendRecording = useCallback(async () => {
    if (sendingRef.current) return;
    const blob = blobRef.current;
    if (!blob || blob.size === 0) {
      setError('The voice note is empty and cannot be sent.');
      return;
    }

    sendingRef.current = true;
    setState('sending');
    try {
      const duration = playbackDuration > 0 ? playbackDuration : durationSeconds;
      await onSend(blob, duration);
      releasePreview();
      setState('idle');
      setDurationSeconds(0);
      setPlaybackCurrent(0);
      setPlaybackDuration(0);
      setIsPlaying(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice note could not be sent.');
      setState('previewing');
    } finally {
      sendingRef.current = false;
    }
  }, [onSend, playbackDuration, durationSeconds, releasePreview]);

  const deletePreview = useCallback(() => {
    releasePreview();
    setState('idle');
    setDurationSeconds(0);
    setPlaybackCurrent(0);
    setPlaybackDuration(0);
    setIsPlaying(false);
    setError(null);
    startLockRef.current = false;
  }, [releasePreview]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      sendingRef.current = true;
      clearRecordingTimer();
      clearPlaybackTimer();
      stopMediaRecorder();
      stopMicrophone();
      stopPlayback();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      blobRef.current = null;
      chunksRef.current = [];
    };
  }, [
    clearRecordingTimer,
    clearPlaybackTimer,
    stopMediaRecorder,
    stopMicrophone,
    stopPlayback,
  ]);

  return (
    <div className="flex flex-col gap-2" data-state={state}>
      {state === 'idle' && (
        <>
          {error && (
            <p className="text-xs text-[#EF4444]" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            data-testid="record-button"
            onClick={startRecording}
            disabled={error !== null}
            aria-label="Record voice note"
            className="p-2 rounded-full bg-[#C24A6E] text-white hover:bg-[#B33E5E] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Mic size={18} strokeWidth={2} />
          </button>
        </>
      )}

      {state === 'recording' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#C24A6E]/20 border border-[#C24A6E]/40">
          <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" aria-hidden="true" />
          <span className="text-xs font-medium text-[#F2E9E4]">Recording</span>
          <span
            data-testid="timer"
            className="ml-auto text-xs font-mono text-[#F2E9E4]"
          >
            {formatTime(durationSeconds)}
          </span>
          <button
            type="button"
            data-testid="pause-button"
            onClick={togglePause}
            className="p-1 text-[#F2E9E4] hover:text-white"
          >
            <Pause size={14} />
          </button>
          <button
            type="button"
            data-testid="cancel-button"
            onClick={cancelRecording}
            className="p-1 text-[#F2E9E4] hover:text-[#EF4444]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {state === 'paused' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#C24A6E]/20 border border-[#C24A6E]/40">
          <span className="text-xs font-medium text-[#F2E9E4]">Paused</span>
          <span
            data-testid="timer"
            className="ml-auto text-xs font-mono text-[#F2E9E4]"
          >
            {formatTime(durationSeconds)}
          </span>
          <button
            type="button"
            data-testid="resume-button"
            onClick={togglePause}
            className="p-1 text-[#F2E9E4] hover:text-white"
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            data-testid="stop-preview-button"
            onClick={stopAndPreview}
            className="p-1 text-[#F2E9E4] hover:text-[#10B981]"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            data-testid="cancel-button"
            onClick={cancelRecording}
            className="p-1 text-[#F2E9E4] hover:text-[#EF4444]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {state === 'previewing' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1C1822] border border-[#34283F]">
          <button
            type="button"
            data-testid="play-button"
            onClick={togglePlayback}
            className={`p-1.5 rounded-full text-[#F2E9E4] hover:bg-[#34283F] ${isPlaying ? 'bg-[#34283F]' : 'bg-[#29202D]'}`}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex justify-between text-xs text-[#B58A83]">
              <span data-testid="playback-current">{formatTime(playbackCurrent)}</span>
              <span data-testid="playback-total">{formatTime(playbackDuration || durationSeconds)}</span>
            </div>
            <div className="w-full h-1 bg-[#34283F] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#10B981]"
                style={{
                  width:
                    playbackDuration > 0
                      ? Math.min(100, (playbackCurrent / playbackDuration) * 100)
                      : 0,
                }}
              />
            </div>
          </div>
          <button
            type="button"
            data-testid="send-button"
            onClick={sendRecording}
            className="ml-2 px-3 py-1.5 rounded-md bg-[#10B981] text-[#17121C] text-xs font-bold hover:bg-[#34D399] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
          <button
            type="button"
            data-testid="delete-button"
            onClick={deletePreview}
            className="ml-2 px-3 py-1.5 rounded-md bg-[#C24A6E] text-white text-xs font-bold hover:bg-[#B33E5E]"
          >
            Delete
          </button>
        </div>
      )}

      {state === 'sending' && (
        <div className="px-3 py-2 text-xs text-[#B58A83]">Sending voice note…</div>
      )}
    </div>
  );
}
