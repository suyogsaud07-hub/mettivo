'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  LIVE_CHANNEL_NAME,
  LIVE_ICE_SERVERS,
  isAddressedTo,
  makePeerId,
  readAnswer,
  readAvailable,
  readBye,
  readChat,
  readIce,
  readOffer,
  readSeek,
  shouldAnswerSeek,
  type AnswerMessage,
  type AvailableMessage,
  type ByeMessage,
  type ChatSignalMessage,
  type IceMessage,
  type LiveChatMessage,
  type LiveEvent,
  type OfferMessage,
  type SeekMessage,
} from './signaling';

/**
 * `useLiveSession` — the one place that owns a live call.
 *
 * It wrings together four things that must be torn down together and in the
 * right order: the camera/microphone tracks, the `RTCPeerConnection`, the
 * Supabase Realtime channel, and the pairing timers. Concentrating that here
 * means the page is pure presentation and there is exactly one cleanup path, so
 * a "Stop" cannot leave a camera light on or a peer connection open.
 *
 * PAIRING (see `signaling.ts` for the pure rules)
 *   1. on Start the client subscribes to `mettivo-live`, tracks presence, and
 *      broadcasts `seek`.
 *   2. a seek is answered only by the peer with the LOWER id
 *      (`shouldAnswerSeek`), which prevents a two-sided glare.
 *   3. the seeker, on the first `available`, creates the offer; the answerer
 *      replies with an answer. ICE is exchanged over the same channel.
 *
 * VIDEO QUALITY IS THE DEVICE'S
 *   `getUserMedia` asks for 1920x1080 and the stream is handed to the peer
 *   unmodified — no canvas, no re-encode, no bitrate cap. Whatever the camera
 *   and the network can carry is what the partner sees.
 */

/** Where a member is in the live flow. Drives which UI is shown. */
export type LivePhase =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'searching'
  | 'connecting'
  | 'live'
  | 'error';

export interface UseLiveSession {
  phase: LivePhase;
  error: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  myCountry: string;
  /** My own account id, for reporting a partner. */
  myUserId: string | null;
  partnerCountry: string | null;
  /**
   * The partner's real account id, as announced over signaling. Used only to
   * open a report against a person; never treated as proof of identity.
   */
  partnerUserId: string | null;
  peersOnline: number;
  messages: LiveChatMessage[];
  micEnabled: boolean;
  camEnabled: boolean;
  requestMedia: () => Promise<void>;
  start: () => Promise<void>;
  next: () => void;
  stop: () => void;
  sendChat: (text: string) => void;
  toggleMic: () => void;
  toggleCam: () => void;
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera and microphone access was blocked. Allow it in your browser settings and try again.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'No camera or microphone was found on this device.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'Your camera or microphone is already in use by another app.';
    }
  }
  return 'We could not start your camera. Please try again.';
}

export function useLiveSession(): UseLiveSession {
  const [phase, setPhase] = useState<LivePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [myCountry, setMyCountry] = useState('');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [partnerCountry, setPartnerCountry] = useState<string | null>(null);
  const [partnerUserId, setPartnerUserId] = useState<string | null>(null);
  const [peersOnline, setPeersOnline] = useState(0);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  // Mutable, authoritative state. React state is for rendering only; the
  // Realtime callbacks must read the *current* value, not the one captured when
  // the handler was registered.
  // A stable peer id for this mount. It is intentionally React state (not a
  // ref) so it is created exactly once, holds no secret, and never changes.
  const [peerId] = useState<string>(() => makePeerId());

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const partnerRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const phaseRef = useRef<LivePhase>('idle');
  const myCountryRef = useRef('');
  const myUserIdRef = useRef<string | null>(null);
  const inPoolRef = useRef(false);
  const answerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myPeerId = useCallback(() => peerId, [peerId]);

  const setPhaseState = useCallback((next: LivePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    answerTimerRef.current = null;
    connectTimerRef.current = null;
  }, []);

  const send = useCallback((event: LiveEvent, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    void channel
      .send({ type: 'broadcast', event, payload })
      .catch((err: unknown) => console.warn('[live] broadcast failed:', event, err));
  }, []);

  const teardownPeer = useCallback(() => {
    clearTimers();
    pendingCandidatesRef.current = [];
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
  }, [clearTimers]);

  const stopLocalMedia = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const candidate of pendingCandidatesRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[live] dropped a buffered ICE candidate:', err);
      }
    }
    pendingCandidatesRef.current = [];
  }, []);

  /** Broadcast a `seek` and wait for an `available` from the pool. */
  const beginSearch = useCallback(() => {
    if (!localStreamRef.current || !inPoolRef.current) {
      setPhaseState('ready');
      return;
    }
    teardownPeer();
    partnerRef.current = null;
    setPartnerCountry(null);
    setPartnerUserId(null);
    setMessages([]);
    setPhaseState('searching');
    send('seek', {
      from: myPeerId(),
      country: myCountryRef.current,
      userId: myUserIdRef.current,
    });
  }, [teardownPeer, setPhaseState, send, myPeerId]);

  /** Arms a timeout that gives up on a partner who never completes handshaking. */
  const armConnectTimeout = useCallback(() => {
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      if (phaseRef.current === 'connecting') {
        teardownPeer();
        partnerRef.current = null;
        setPartnerCountry(null);
        setPartnerUserId(null);
        if (inPoolRef.current) beginSearch();
        else setPhaseState('ready');
      }
    }, 12000);
  }, [teardownPeer, setPhaseState, beginSearch]);

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: [...LIVE_ICE_SERVERS] });

    pc.onicecandidate = (event) => {
      const partner = partnerRef.current;
      if (!event.candidate || !partner) return;
      send('ice', { from: myPeerId(), to: partner, candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected' && phaseRef.current === 'connecting') {
        clearTimers();
        setPhaseState('live');
      } else if (state === 'failed') {
        teardownPeer();
        partnerRef.current = null;
        setPartnerCountry(null);
        setPartnerUserId(null);
        if (inPoolRef.current) beginSearch();
        else setPhaseState('ready');
      }
    };

    pcRef.current = pc;
    return pc;
  }, [send, myPeerId, teardownPeer, setPhaseState, clearTimers, beginSearch]);

  const attachLocalTracks = useCallback((pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    if (pc.getSenders().length > 0) return;
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
  }, []);

  const createOffer = useCallback(
    async (partnerId: string) => {
      try {
        const pc = pcRef.current ?? createPeerConnection();
        attachLocalTracks(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send('offer', {
          from: myPeerId(),
          to: partnerId,
          country: myCountryRef.current,
          sdp: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp },
        });
        armConnectTimeout();
      } catch (err) {
        console.error('[live] failed to create an offer:', err);
        teardownPeer();
        partnerRef.current = null;
        setPartnerCountry(null);
        setPartnerUserId(null);
        if (inPoolRef.current) beginSearch();
      }
    },
    [createPeerConnection, attachLocalTracks, send, myPeerId, armConnectTimeout, teardownPeer, beginSearch]
  );

  // --- Realtime handlers ----------------------------------------------------

  const handleSeek = useCallback(
    (message: SeekMessage) => {
      const me = myPeerId();
      if (message.from === me) return;
      if (partnerRef.current) return;
      if (phaseRef.current !== 'searching') return;
      if (!shouldAnswerSeek(me, message.from)) return;

      partnerRef.current = message.from;
      setPartnerCountry(message.country || null);
      setPartnerUserId(message.userId);
      setPhaseState('connecting');
      send('available', {
        from: me,
        to: message.from,
        country: myCountryRef.current,
        userId: myUserIdRef.current,
      });

      // If the caller vanishes before offering, resume the search.
      if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
      answerTimerRef.current = setTimeout(() => {
        if (phaseRef.current === 'connecting' && !pcRef.current) {
          partnerRef.current = null;
          setPartnerCountry(null);
          setPartnerUserId(null);
          if (inPoolRef.current) beginSearch();
        }
      }, 8000);
    },
    [myPeerId, send, setPhaseState, beginSearch]
  );

  const handleAvailable = useCallback(
    (message: AvailableMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me)) return;
      if (phaseRef.current !== 'searching') return;
      if (partnerRef.current) return;

      clearTimers();
      partnerRef.current = message.from;
      setPartnerCountry(message.country || null);
      setPartnerUserId(message.userId);
      setPhaseState('connecting');
      void createOffer(message.from);
    },
    [myPeerId, clearTimers, setPhaseState, createOffer]
  );

  const handleOffer = useCallback(
    async (message: OfferMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me) || message.from === me) return;
      if (partnerRef.current && partnerRef.current !== message.from) return;

      clearTimers();
      partnerRef.current = message.from;
      setPartnerCountry(message.country || null);
      setPhaseState('connecting');

      try {
        const pc = pcRef.current ?? createPeerConnection();
        attachLocalTracks(pc);
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('answer', {
          from: me,
          to: message.from,
          sdp: { type: pc.localDescription?.type, sdp: pc.localDescription?.sdp },
        });
        armConnectTimeout();
      } catch (err) {
        console.error('[live] failed to answer an offer:', err);
        teardownPeer();
        partnerRef.current = null;
        setPartnerCountry(null);
        setPartnerUserId(null);
        if (inPoolRef.current) beginSearch();
      }
    },
    [
      myPeerId,
      clearTimers,
      setPhaseState,
      createPeerConnection,
      attachLocalTracks,
      flushCandidates,
      send,
      armConnectTimeout,
      teardownPeer,
      beginSearch,
    ]
  );

  const handleAnswer = useCallback(
    async (message: AnswerMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me)) return;
      // Only the peer we are currently negotiating with may answer us.
      if (message.from !== partnerRef.current) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        await flushCandidates();
        clearTimers();
        setPhaseState('live');
      } catch (err) {
        console.error('[live] failed to apply an answer:', err);
      }
    },
    [myPeerId, flushCandidates, clearTimers, setPhaseState]
  );

  const handleIce = useCallback(
    async (message: IceMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me)) return;
      // ICE is only meaningful from the peer we currently hold a connection to;
      // any other sender is ignored so a third party cannot poison the stream.
      if (message.from !== partnerRef.current) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(message.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        console.warn('[live] dropped an ICE candidate:', err);
      }
    },
    [myPeerId]
  );

  const handleBye = useCallback(
    (message: ByeMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me)) return;
      if (message.from !== partnerRef.current) return;

      teardownPeer();
      partnerRef.current = null;
      setPartnerCountry(null);
      setPartnerUserId(null);
      if (inPoolRef.current) beginSearch();
      else setPhaseState('ready');
    },
    [myPeerId, teardownPeer, setPhaseState, beginSearch]
  );

  const handleChat = useCallback(
    (message: ChatSignalMessage) => {
      const me = myPeerId();
      if (!isAddressedTo(message, me)) return;
      // Chat is scoped to the live session: accept text only from the peer we
      // are actually connected to, never from an unrelated room participant.
      if (message.from !== partnerRef.current) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `them-${message.at}-${message.from.slice(0, 6)}`,
          text: message.text,
          mine: false,
          at: message.at,
        },
      ]);
    },
    [myPeerId]
  );

  // --- Channel lifecycle ----------------------------------------------------

  const ensureChannel = useCallback(async (): Promise<RealtimeChannel | null> => {
    if (channelRef.current && subscribedRef.current) return channelRef.current;

    // Reaching here means there is no channel, or the previous one never
    // subscribed (subscribe errored/timed out). Remove any stale channel before
    // replacing it: overwriting `channelRef` alone leaks the dead socket.
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      subscribedRef.current = false;
    }

    const me = myPeerId();
    const channel = supabase.channel(LIVE_CHANNEL_NAME, {
      config: {
        broadcast: { self: false },
        presence: { key: me },
      },
    });

    channel
      .on('broadcast', { event: 'seek' }, ({ payload }: { payload: unknown }) => {
        const message = readSeek(payload);
        if (message) handleSeek(message);
      })
      .on('broadcast', { event: 'available' }, ({ payload }: { payload: unknown }) => {
        const message = readAvailable(payload);
        if (message) handleAvailable(message);
      })
      .on('broadcast', { event: 'offer' }, ({ payload }: { payload: unknown }) => {
        const message = readOffer(payload);
        if (message) void handleOffer(message);
      })
      .on('broadcast', { event: 'answer' }, ({ payload }: { payload: unknown }) => {
        const message = readAnswer(payload);
        if (message) void handleAnswer(message);
      })
      .on('broadcast', { event: 'ice' }, ({ payload }: { payload: unknown }) => {
        const message = readIce(payload);
        if (message) void handleIce(message);
      })
      .on('broadcast', { event: 'bye' }, ({ payload }: { payload: unknown }) => {
        const message = readBye(payload);
        if (message) handleBye(message);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }: { payload: unknown }) => {
        const message = readChat(payload);
        if (message) handleChat(message);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const others = Object.keys(state).filter((key) => key !== me).length;
        setPeersOnline(others);
      });

    channelRef.current = channel;

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true;
          settle();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[live] realtime channel status:', status);
          // Leave no dead channel behind, or a later retry silently leaks it.
          if (channelRef.current === channel) {
            channelRef.current = null;
            subscribedRef.current = false;
          }
          void supabase.removeChannel(channel);
          settle();
        }
      });
      // Never let a silent subscribe hang the Start button forever.
      setTimeout(settle, 6000);
    });

    return channel;
  }, [myPeerId, handleSeek, handleAvailable, handleOffer, handleAnswer, handleIce, handleBye, handleChat]);

  // --- Public actions -------------------------------------------------------

  const requestMedia = useCallback(async () => {
    if (localStreamRef.current) return;
    setPhaseState('requesting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      localStreamRef.current = stream;
      // Match the toggles to whatever the device actually provided.
      setMicEnabled(stream.getAudioTracks().length > 0);
      setCamEnabled(stream.getVideoTracks().length > 0);
      setLocalStream(stream);
      setPhaseState('ready');
    } catch (err) {
      console.error('[live] getUserMedia failed:', err);
      setError(mediaErrorMessage(err));
      setPhaseState('error');
    }
  }, [setPhaseState]);

  const start = useCallback(async () => {
    setError(null);
    if (!localStreamRef.current) {
      await requestMedia();
      if (!localStreamRef.current) return;
    }

    inPoolRef.current = true;
    const channel = await ensureChannel();
    if (!channel || !inPoolRef.current) return;

    void channel
      .track({ peerId: myPeerId(), country: myCountryRef.current, userId: myUserIdRef.current })
      .catch((err: unknown) => console.warn('[live] presence track failed:', err));

    beginSearch();
  }, [requestMedia, ensureChannel, myPeerId, beginSearch]);

  const next = useCallback(() => {
    if (!localStreamRef.current) return;
    const partner = partnerRef.current;
    if (partner) send('bye', { from: myPeerId(), to: partner });
    if (!inPoolRef.current) {
      inPoolRef.current = true;
      void ensureChannel().then((channel) => {
        if (channel)
          void channel.track({
            peerId: myPeerId(),
            country: myCountryRef.current,
            userId: myUserIdRef.current,
          });
        beginSearch();
      });
      return;
    }
    beginSearch();
  }, [send, myPeerId, ensureChannel, beginSearch]);

  const stop = useCallback(() => {
    inPoolRef.current = false;
    const partner = partnerRef.current;
    if (partner) send('bye', { from: myPeerId(), to: partner });

    teardownPeer();
    partnerRef.current = null;
    setPartnerCountry(null);
    setPartnerUserId(null);
    setMessages([]);

    const channel = channelRef.current;
    if (channel) {
      void channel.untrack().catch(() => undefined);
      void supabase.removeChannel(channel);
    }
    channelRef.current = null;
    subscribedRef.current = false;
    setPeersOnline(0);

    stopLocalMedia();
    setPhaseState('idle');
  }, [send, myPeerId, teardownPeer, stopLocalMedia, setPhaseState]);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const at = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: `me-${at}-${Math.random().toString(36).slice(2, 7)}`, text: trimmed, mine: true, at },
      ]);
      const partner = partnerRef.current;
      if (partner) send('chat', { from: myPeerId(), to: partner, text: trimmed, at });
    },
    [send, myPeerId]
  );

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const nextEnabled = !tracks[0].enabled;
    for (const track of tracks) track.enabled = nextEnabled;
    setMicEnabled(nextEnabled);
  }, []);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    if (tracks.length === 0) return;
    const nextEnabled = !tracks[0].enabled;
    for (const track of tracks) track.enabled = nextEnabled;
    setCamEnabled(nextEnabled);
  }, []);

  // --- Lifecycle ------------------------------------------------------------

  // The member's own country, for the presence metadata and their own flag.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        myUserIdRef.current = user.id;
        if (mounted) setMyUserId(user.id);
        const { data } = await supabase
          .from('profiles')
          .select('country')
          .eq('id', user.id)
          .maybeSingle();
        if (mounted && typeof data?.country === 'string') {
          myCountryRef.current = data.country;
          setMyCountry(data.country);
        }
      } catch (err) {
        // Non-fatal: the flag simply falls back to a globe.
        console.warn('[live] could not read your country:', err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // One teardown for everything, so navigating away cannot leave the camera on.
  useEffect(() => {
    return () => {
      inPoolRef.current = false;
      const pc = pcRef.current;
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pcRef.current = null;
      }
      const channel = channelRef.current;
      if (channel) {
        void channel.untrack().catch(() => undefined);
        void supabase.removeChannel(channel);
      }
      channelRef.current = null;
      const stream = localStreamRef.current;
      if (stream) for (const track of stream.getTracks()) track.stop();
      localStreamRef.current = null;
      if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
      if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    };
  }, []);

  return {
    phase,
    error,
    localStream,
    remoteStream,
    myCountry,
    myUserId,
    partnerCountry,
    partnerUserId,
    peersOnline,
    messages,
    micEnabled,
    camEnabled,
    requestMedia,
    start,
    next,
    stop,
    sendChat,
    toggleMic,
    toggleCam,
  };
}
