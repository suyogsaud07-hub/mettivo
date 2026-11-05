'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** WebRTC ICE server configuration. STUN is public; TURN must come from env. */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }

  return servers;
}

/** Constraints for audio/video capture. */
export interface MediaConstraints {
  audio: boolean;
  video: boolean;
}

/** Result of the WebRTC hook. */
export interface UseWebRTCResult {
  /** Local media stream (camera/mic). */
  localStream: MediaStream | null;
  /** Remote media stream. */
  remoteStream: MediaStream | null;
  /** Current call state. */
  state: 'idle' | 'initiating' | 'ringing' | 'accepting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed';
  /** Whether the local mic is muted. */
  isMuted: boolean;
  /** Whether the local camera is off. */
  isCameraOff: boolean;
  /** Call duration in seconds (updates while connected). */
  duration: number;
  /** Error message if any. */
  error: string | null;
  /** Initiate an outgoing call. */
  initiate: (constraints: MediaConstraints) => Promise<void>;
  /** Accept an incoming call. */
  accept: (constraints: MediaConstraints) => Promise<void>;
  /** Reject an incoming call. */
  reject: () => void;
  /** End the active call. */
  end: () => void;
  /** Toggle mic mute. */
  toggleMute: () => void;
  /** Toggle camera on/off. */
  toggleCamera: () => void;
  /** Handle an incoming WebRTC offer (called by signaling layer). */
  handleOffer: (sdp: RTCSessionDescriptionInit, fromUserId: string) => void;
  /** Handle an incoming WebRTC answer (called by signaling layer). */
  handleAnswer: (sdp: RTCSessionDescriptionInit) => void;
  /** Handle an incoming ICE candidate (called by signaling layer). */
  handleIceCandidate: (candidate: RTCIceCandidateInit) => void;
}

/**
 * Hook that owns the WebRTC peer connection and media streams for one call.
 *
 * Signaling (offer/answer/ICE) is NOT handled here — it is handled by
 * useCallSignaling, which calls the callbacks exposed by this hook.
 */
export function useWebRTC(onSignal: (payload: { type: string; target: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => void): UseWebRTCResult {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<'idle' | 'initiating' | 'ringing' | 'accepting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);
  const isInitiatorRef = useRef(false);

  const iceServers = buildIceServers();

  const clearDuration = useCallback(() => {
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    setDuration(0);
  }, []);

  const startDuration = useCallback(() => {
    clearDuration();
    durationRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  }, [clearDuration]);

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && remoteUserIdRef.current) {
        onSignal({
          type: 'ice-candidate',
          target: remoteUserIdRef.current,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          setState('connected');
          startDuration();
          break;
        case 'disconnected':
        case 'failed':
          setState('failed');
          break;
        case 'closed':
          setState('ended');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        setState('failed');
        setError('Could not establish a media connection. Try again.');
      }
    };

    return pc;
  }, [onSignal, startDuration]);

  const cleanup = useCallback(() => {
    clearDuration();
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    setState('ended');
    remoteUserIdRef.current = null;
    isInitiatorRef.current = false;
  }, [clearDuration, localStream]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const acquireMedia = useCallback(
    async (constraints: MediaConstraints): Promise<MediaStream> => {
      const audio = constraints.audio ? { echoCancellation: true, noiseSuppression: true } : false;
      const video = constraints.video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
        return stream;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to access media devices.';
        setError(message);
        throw err;
      }
    },
    []
  );

  const initiate = useCallback(
    async (constraints: MediaConstraints) => {
      setError(null);
      setState('initiating');
      isInitiatorRef.current = true;

      try {
        const stream = await acquireMedia(constraints);
        setLocalStream(stream);

        const pc = createPeerConnection();
        peerRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        if (remoteUserIdRef.current) {
          onSignal({
            type: 'offer',
            target: remoteUserIdRef.current,
            sdp: offer,
          });
        }

        setState('connecting');
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : 'Failed to start call.');
      }
    },
    [acquireMedia, createPeerConnection, onSignal]
  );

  const accept = useCallback(
    async (constraints: MediaConstraints) => {
      setError(null);
      setState('accepting');

      try {
        const stream = await acquireMedia(constraints);
        setLocalStream(stream);

        const pc = createPeerConnection();
        peerRef.current = pc;

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // The offer should already be set as remote description by the signaling layer.
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (remoteUserIdRef.current) {
          onSignal({
            type: 'answer',
            target: remoteUserIdRef.current,
            sdp: answer,
          });
        }

        setState('connecting');
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : 'Failed to accept call.');
      }
    },
    [acquireMedia, createPeerConnection, onSignal]
  );

  const reject = useCallback(() => {
    cleanup();
    setState('idle');
  }, [cleanup]);

  const end = useCallback(() => {
    cleanup();
    setState('idle');
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  }, [localStream]);

  /**
   * Called by the signaling layer when an offer is received.
   * Sets the remote description and prepares for answer.
   */
  const handleOffer = useCallback(
    async (sdp: RTCSessionDescriptionInit, fromUserId: string) => {
      remoteUserIdRef.current = fromUserId;
      isInitiatorRef.current = false;
      setState('ringing');

      const pc = createPeerConnection();
      peerRef.current = pc;

      try {
        await pc.setRemoteDescription(sdp);
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : 'Failed to set remote offer.');
      }
    },
    [createPeerConnection]
  );

  /**
   * Called by the signaling layer when an answer is received.
   */
  const handleAnswer = useCallback(
    async (sdp: RTCSessionDescriptionInit) => {
      const pc = peerRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(sdp);
        setState('connecting');
      } catch (err) {
        setState('failed');
        setError(err instanceof Error ? err.message : 'Failed to set remote answer.');
      }
    },
    []
  );

  /**
   * Called by the signaling layer when an ICE candidate is received.
   */
  const handleIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit) => {
      const pc = peerRef.current;
      if (!pc) return;
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.error('[webrtc] addIceCandidate failed:', err);
      }
    },
    []
  );

  return {
    localStream,
    remoteStream,
    state,
    isMuted,
    isCameraOff,
    duration,
    error,
    initiate,
    accept,
    reject,
    end,
    toggleMute,
    toggleCamera,
    // Exposed for the signaling layer to call.
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  };
}
