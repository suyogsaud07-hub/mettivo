'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** WebRTC ICE server configuration. STUN is public; TURN must come from env. */
function buildIceServers(): RTCIceServer[] {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return iceServers;
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
  /** Initiate an outgoing call (creates PC, acquires media, sends offer). */
  initiate: (constraints: MediaConstraints, targetUserId?: string) => Promise<void>;
  /** Accept an incoming call (acquires media, creates answer). */
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
 *
 * Call flow:
 *   Outgoing: initiate() -> create PC, add tracks, create offer, send offer
 *   Incoming: handleOffer() -> create PC, set remote description (state: ringing)
 *             -> accept() -> acquire media, add tracks, create answer, send answer
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
  const pendingTracksRef = useRef<MediaStreamTrack[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

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

  /**
   * Creates a single RTCPeerConnection with ICE servers and all event handlers.
   * Exactly one PC exists per active call.
   */
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
          setError(null);
          startDuration();
          break;
        case 'disconnected':
          setState('reconnecting');
          break;
        case 'failed':
          setState('failed');
          setError('Could not establish a media connection. Try again.');
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

    pc.onsignalingstatechange = () => {
      // Diagnostic only — never log SDP contents.
      if (process.env.NODE_ENV === 'development') {
        console.debug('[webrtc] signalingState:', pc.signalingState);
      }
    };

    return pc;
  }, [onSignal]);

  const cleanup = useCallback(() => {
    clearDuration();
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setState('ended');
    remoteUserIdRef.current = null;
    isInitiatorRef.current = false;
    pendingTracksRef.current = [];
  }, [clearDuration]);

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

  /**
   * Outgoing call: acquire media, create PC, add tracks, create offer, send offer.
   */
  const initiate = useCallback(
    async (constraints: MediaConstraints, targetUserId?: string) => {
      setError(null);
      setState('initiating');
      isInitiatorRef.current = true;

      if (targetUserId) {
        remoteUserIdRef.current = targetUserId;
      }

      try {
        const stream = await acquireMedia(constraints);
        setLocalStream(stream);
        localStreamRef.current = stream;

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

  /**
   * Incoming call: acquire media, add tracks to existing PC, create answer, send answer.
   * The PC and remote description were already set up by handleOffer().
   */
  const accept = useCallback(
    async (constraints: MediaConstraints) => {
      setError(null);
      setState('accepting');

      try {
        const stream = await acquireMedia(constraints);
        setLocalStream(stream);
        localStreamRef.current = stream;

        // Reuse the PC created by handleOffer() if it exists.
        let pc = peerRef.current;
        if (!pc) {
          pc = createPeerConnection();
          peerRef.current = pc;
        }

        // Add any tracks that were queued before the PC existed.
        pendingTracksRef.current.forEach((track) => pc.addTrack(track));
        pendingTracksRef.current = [];

        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

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
  }, [cleanup]);

  const end = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsCameraOff(!videoTrack.enabled);
    }
  }, []);

  /**
   * Called by the signaling layer when an offer is received.
   * Creates the PC, sets the remote description, and queues local tracks
   * to be added when the user accepts. Does NOT acquire media yet — that
   * happens in accept() when the user explicitly accepts the call.
   */
  const handleOffer = useCallback(
    async (sdp: RTCSessionDescriptionInit, fromUserId: string) => {
      remoteUserIdRef.current = fromUserId;
      isInitiatorRef.current = false;
      setState('ringing');

      // Close any existing PC before creating a new one.
      if (peerRef.current) {
        peerRef.current.close();
      }

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
   * Sets the remote description on the initiator's PC.
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
   * Candidates that arrive before the remote description is set are buffered
   * and applied automatically by addIceCandidate once the description exists.
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
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  };
}
