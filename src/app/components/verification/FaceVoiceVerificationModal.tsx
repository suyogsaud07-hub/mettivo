'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchChallenge,
  submitFace,
  submitVoice,
  VerificationError,
  type VerificationGender,
} from '@/lib/verification/client';
import { estimatePitch, median, pitchMatchesGender } from '@/lib/verification/pitch';

/**
 * Mandatory live face + voice verification.
 *
 * The member proves there is a real, present human behind the account before
 * they can leave the gender step:
 *
 *   * a live camera frame is classified by the server (human face + gender),
 *   * a fresh phrase is read aloud and the server confirms via speech-to-text
 *     that every word was spoken,
 *   * a client pitch estimate must also be plausible for the selected gender.
 *
 * Both server checks are authoritative and fail closed; the pitch check is an
 * advisory gate that stops an obvious mismatch before a round trip. Nothing is
 * recorded as verified unless the real verdicts came back positive.
 */

interface FaceVoiceVerificationModalProps {
  gender: VerificationGender;
  /** The name the wizard holds. Sent with the phrase request so it is used
   *  before the profile row exists. */
  displayName: string | null;
  onCancel: () => void;
  onVerified: (selfieUrl: string) => void;
}

type Phase = 'face' | 'voice' | 'verified';

export default function FaceVoiceVerificationModal({
  gender,
  displayName,
  onCancel,
  onVerified,
}: FaceVoiceVerificationModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pitchSamplesRef = useRef<number[]>([]);
  const pitchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('face');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState('');
  const [phrase, setPhrase] = useState('');
  const [livePitch, setLivePitch] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setReady(true);
      } catch {
        if (!cancelled) {
          setError('We need camera and microphone access to verify you.');
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (pitchTimerRef.current) clearInterval(pitchTimerRef.current);
      pitchTimerRef.current = null;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, []);

  const handleCaptureFace = async () => {
    setError(null);
    const frame = captureFrame();
    if (!frame) {
      setError('We could not read the camera. Please try again.');
      return;
    }
    setSelfieUrl(frame);
    setBusy(true);
    try {
      const result = await submitFace(frame, gender);
      if (!mountedRef.current) return;
      if (!result.passed) {
        setError(messageForFace(result.reason));
        return;
      }
      const nextPhrase = await fetchChallenge({ displayName, gender });
      if (!mountedRef.current) return;
      setPhrase(nextPhrase);
      setPhase('voice');
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof VerificationError ? err.message : 'Verification failed.');
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) {
      setError('The microphone is not available.');
      return;
    }
    setError(null);
    pitchSamplesRef.current = [];
    setLivePitch(0);

    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      pitchTimerRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        const f0 = estimatePitch(buffer, audioContext.sampleRate);
        if (f0 > 0) {
          pitchSamplesRef.current.push(f0);
          setLivePitch(Math.round(f0));
        }
      }, 100);
    } catch {
      // Pitch is advisory; recording still proceeds without it.
      audioContextRef.current = null;
    }

    // Record only the audio tracks: recording the combined camera+audio stream
    // yields a `video/webm` blob, whose data URL fails the server's `data:audio/`
    // prefix check (and uploads a needless video frame per attempt). Pin the
    // container to `audio/webm` where the browser supports it, so the data URL
    // sent to the voice route is `data:audio/webm;base64,…` (Safari, which lacks
    // webm, falls back to its native container — still `data:audio/…`).
    const audioStream = new MediaStream(stream.getAudioTracks());
    const canRecordWebm =
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported('audio/webm');
    const recorder = canRecordWebm
      ? new MediaRecorder(audioStream, { mimeType: 'audio/webm' })
      : new MediaRecorder(audioStream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      void finishRecording(recorder.mimeType || 'audio/webm');
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  const stopRecording = () => {
    if (pitchTimerRef.current) clearInterval(pitchTimerRef.current);
    pitchTimerRef.current = null;
    recorderRef.current?.stop();
    setRecording(false);
  };

  const finishRecording = async (mimeType: string) => {
    try {
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;

      // `recorder.mimeType` is typically `audio/webm;codecs=opus`. The server's
      // data-URL parser only understands a bare `audio/webm`, so drop the codec
      // parameter — otherwise the URL `data:audio/webm;codecs=opus;base64,…`
      // is rejected and the route answers 503 `ai_unavailable`.
      const containerType = (mimeType || 'audio/webm').split(';')[0]?.trim() || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: containerType });
      if (blob.size === 0) {
        setError('We did not hear anything. Please try again.');
        return;
      }

      const audioUrl = await blobToDataUrl(blob);
      const pitchHz = Math.round(median(pitchSamplesRef.current));

      // Pitch is advisory (see `pitch.ts`): `median([])` is 0 when the analyser
      // never produced a sample, so only consult it when a voice was measured.
      // Rejecting on a missing measurement would dead-end a valid recording; the
      // server's speech-to-text check stays the authoritative gate.
      if (pitchHz > 0 && !pitchMatchesGender(gender, pitchHz)) {
        setError('That voice did not match your selected gender. Please try again.');
        return;
      }

      setBusy(true);
      const result = await submitVoice(audioUrl, phrase, pitchHz);
      if (!mountedRef.current) return;
      if (!result.passed) {
        setError('We could not confirm those words. Please read the phrase again.');
        return;
      }

      setPhase('verified');
      onVerified(selfieUrl);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof VerificationError ? err.message : 'Voice verification failed.');
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Face and voice verification"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        backgroundColor: 'rgba(13,10,16,0.94)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        padding: '20px',
        color: '#F2E9E4',
      }}
    >
      <div style={{ fontSize: '19px', fontWeight: 800 }}>
        {phase === 'face' ? 'Verify your face' : phase === 'voice' ? 'Say the phrase' : 'Verified'}
      </div>

      <div
        style={{
          width: '260px',
          height: '260px',
          borderRadius: '24px',
          overflow: 'hidden',
          border: '2px solid #D4B18A',
          backgroundColor: '#0D0A10',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {!ready && !error && (
          <div style={{ position: 'absolute', fontSize: '13px', color: '#B58A83' }}>
            Starting camera…
          </div>
        )}
      </div>

      {phase === 'face' && (
        <div style={{ fontSize: '13px', color: '#B58A83', textAlign: 'center', maxWidth: '320px' }}>
          Look straight at the camera and hold still. We will check that this is a real human
          face consistent with <strong style={{ color: '#D4B18A' }}>{gender}</strong>.
        </div>
      )}

      {phase === 'voice' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#B58A83', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Read this aloud
          </div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#D4B18A', marginTop: '4px' }}>
            {phrase}
          </div>
          {recording && (
            <div style={{ fontSize: '12px', color: '#B58A83', marginTop: '6px' }}>
              Listening… {livePitch > 0 ? `${livePitch} Hz` : ''}
            </div>
          )}
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: '#FCA5B5', fontSize: '13px', textAlign: 'center', maxWidth: '340px' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', width: '300px' }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy || recording}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '30px',
            backgroundColor: '#29202D',
            color: '#B58A83',
            border: 'none',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>

        {phase === 'face' && (
          <button
            type="button"
            onClick={() => void handleCaptureFace()}
            disabled={!ready || busy}
            style={{
              flex: 2,
              padding: '14px',
              borderRadius: '30px',
              backgroundColor: '#D4B18A',
              color: '#17121C',
              border: 'none',
              fontWeight: 800,
              cursor: ready && !busy ? 'pointer' : 'not-allowed',
              opacity: ready && !busy ? 1 : 0.6,
            }}
          >
            {busy ? 'Checking…' : 'Capture & verify face'}
          </button>
        )}

        {phase === 'voice' && !recording && (
          <button
            type="button"
            onClick={startRecording}
            disabled={busy}
            style={{
              flex: 2,
              padding: '14px',
              borderRadius: '30px',
              backgroundColor: '#D4B18A',
              color: '#17121C',
              border: 'none',
              fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Checking…' : 'Record phrase'}
          </button>
        )}

        {phase === 'voice' && recording && (
          <button
            type="button"
            onClick={stopRecording}
            style={{
              flex: 2,
              padding: '14px',
              borderRadius: '30px',
              backgroundColor: '#D4B18A',
              color: '#17121C',
              border: 'none',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Stop & submit
          </button>
        )}
      </div>
    </div>
  );
}

function messageForFace(reason: string | null): string {
  switch (reason) {
    case 'no_face':
      return 'We could not see a clear human face. Improve the lighting and try again.';
    case 'gender_mismatch':
      return 'That face did not match your selected gender. Please try again.';
    case 'low_confidence':
      return 'We were not confident enough. Move closer to the camera and try again.';
    default:
      return 'Face verification did not pass. Please try again.';
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the recording.'));
    };
    reader.onerror = () => reject(new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}
