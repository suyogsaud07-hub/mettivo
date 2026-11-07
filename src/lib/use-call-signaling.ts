'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/** Signaling message types exchanged over Supabase Realtime broadcast. */
export type CallSignal =
  | { type: 'call-invite'; from: string; to: string; callType: 'voice' | 'video'; callId: string; timestamp: number }
  | { type: 'call-accept'; from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit; timestamp: number }
  | { type: 'call-offer'; from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit; timestamp: number }
  | { type: 'call-answer'; from: string; to: string; callId: string; sdp: RTCSessionDescriptionInit; timestamp: number }
  | { type: 'call-ice'; from: string; to: string; callId: string; candidate: RTCIceCandidateInit; timestamp: number }
  | { type: 'call-reject'; from: string; to: string; callId: string; timestamp: number }
  | { type: 'call-end'; from: string; to: string; callId: string; timestamp: number }
  | { type: 'call-cancel'; from: string; to: string; callId: string; timestamp: number };

export interface CallState {
  state: 'idle' | 'initiating' | 'ringing' | 'accepting' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'failed' | 'rejected' | 'missed' | 'cancelled';
  callType: 'voice' | 'video' | null;
  remoteUserId: string | null;
  remoteUserName: string | null;
  callId: string | null;
  duration: number;
  error: string | null;
  isInitiator: boolean;
}

export interface UseCallSignalingResult {
  call: CallState;
  // WebRTC callbacks
  onSignal: (payload: { type: string; target: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => void;
  handleOffer: (sdp: RTCSessionDescriptionInit, fromUserId: string) => void;
  handleAnswer: (sdp: RTCSessionDescriptionInit) => void;
  handleIceCandidate: (candidate: RTCIceCandidateInit) => void;
  // Call actions
  initiateCall: (targetUserId: string, targetUserName: string, callType: 'voice' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  subscribe: (matchId: string, myUserId: string, myUserName: string) => void;
  unsubscribe: () => void;
}

const CALL_TTL_MS = 30_000; // Incoming call expires after 30 seconds if unanswered

type BroadcastEventHandler = (event: { payload?: unknown }) => void;

/**
 * Hook that manages call signaling over Supabase Realtime broadcast.
 *
 * It does NOT manage the WebRTC peer connection itself — that is handled by
 * useWebRTC. This hook owns the invitation state machine and routes signaling
 * messages to the WebRTC hook.
 */
export function useCallSignaling(
  webrtc: ReturnType<typeof import('./use-webrtc').useWebRTC>
): UseCallSignalingResult {
  const [call, setCall] = useState<CallState>({
    state: 'idle',
    callType: null,
    remoteUserId: null,
    remoteUserName: null,
    callId: null,
    duration: 0,
    error: null,
    isInitiator: false,
  });

  // Ref that always holds the latest call state so subscribe() does not need
  // to be recreated when state changes (which would cause duplicate channels).
  const callRef = useRef(call);

  // Keep callRef in sync with call outside of render to avoid
  // "Cannot access refs during render" errors.
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const myUserNameRef = useRef<string | null>(null);
  const matchIdRef = useRef<string | null>(null);
  const inviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearInviteTimer = useCallback(() => {
    if (inviteTimerRef.current) {
      clearTimeout(inviteTimerRef.current);
      inviteTimerRef.current = null;
    }
  }, []);

  const clearDuration = useCallback(() => {
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    setCall((c) => ({ ...c, duration: 0 }));
  }, []);

  const startDuration = useCallback(() => {
    clearDuration();
    durationRef.current = setInterval(() => {
      setCall((c) => ({ ...c, duration: c.duration + 1 }));
    }, 1000);
  }, [clearDuration]);

  const resetCall = useCallback((partial: Partial<CallState>) => {
    clearInviteTimer();
    clearDuration();
    setCall((prev) => ({ ...prev, ...partial }));
  }, [clearInviteTimer, clearDuration]);

  // Subscribe to signaling channel.
  const subscribe = useCallback(
    (matchId: string, userId: string, userName: string) => {
      myUserIdRef.current = userId;
      myUserNameRef.current = userName;
      matchIdRef.current = matchId;

      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }

      // Cast to any to work with Supabase Realtime broadcast API which may not
      // be fully typed in the installed version of @supabase/supabase-js.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channel: any = supabase.channel(`call:${matchId}`);

      channel
        .on(
          'broadcast',
          { event: 'call-invite' },
          ((event: { payload?: CallSignal & { type: 'call-invite' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            if (callRef.current.state !== 'idle') return; // Already in a call

            setCall({
              state: 'ringing',
              callType: payload.callType,
              remoteUserId: payload.from,
              remoteUserName: payload.from, // name resolved elsewhere
              callId: payload.callId,
              duration: 0,
              error: null,
              isInitiator: false,
            });

            clearInviteTimer();
            inviteTimerRef.current = setTimeout(() => {
              if (callRef.current.state === 'ringing') {
                setCall((prev) => ({ ...prev, state: 'missed' }));
              }
            }, CALL_TTL_MS);
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-offer' },
          ((event: { payload?: CallSignal & { type: 'call-offer' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            webrtc.handleOffer(payload.sdp, payload.from);
            setCall((prev) => ({ ...prev, state: 'connecting' }));
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-answer' },
          ((event: { payload?: CallSignal & { type: 'call-answer' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            webrtc.handleAnswer(payload.sdp);
            setCall((prev) => ({ ...prev, state: 'connected' }));
            startDuration();
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-ice' },
          ((event: { payload?: CallSignal & { type: 'call-ice' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            webrtc.handleIceCandidate(payload.candidate);
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-reject' },
          ((event: { payload?: CallSignal & { type: 'call-reject' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            if (callRef.current.state === 'initiating') {
              resetCall({ state: 'rejected', error: 'Call was rejected.' });
            }
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-accept' },
          ((event: { payload?: CallSignal & { type: 'call-accept' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            if (callRef.current.state === 'initiating') {
              resetCall({ state: 'connecting' });
            }
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-cancel' },
          ((event: { payload?: CallSignal & { type: 'call-cancel' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            if (callRef.current.state === 'ringing') {
              resetCall({ state: 'cancelled', error: 'Call was cancelled.' });
            }
          }) as BroadcastEventHandler
        )
        .on(
          'broadcast',
          { event: 'call-end' },
          ((event: { payload?: CallSignal & { type: 'call-end' } }) => {
            const payload = event.payload;
            if (!payload || payload.to !== myUserIdRef.current) return;
            resetCall({ state: 'ended', error: null });
          }) as BroadcastEventHandler
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            channelRef.current = channel;
          }
        });
    },
    [webrtc, resetCall, startDuration]
  );

  const unsubscribe = useCallback(() => {
    clearInviteTimer();
    clearDuration();
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setCall({
      state: 'idle',
      callType: null,
      remoteUserId: null,
      remoteUserName: null,
      callId: null,
      duration: 0,
      error: null,
      isInitiator: false,
    });
    myUserIdRef.current = null;
    myUserNameRef.current = null;
    matchIdRef.current = null;
  }, [clearInviteTimer, clearDuration]);

  // Broadcast a signaling message to the channel.
  const broadcast = useCallback(
    (signal: Omit<CallSignal, 'timestamp'>) => {
      if (!channelRef.current || !myUserIdRef.current) return;
      void (channelRef.current as any /* eslint-disable-line @typescript-eslint/no-explicit-any */).send({
        type: 'broadcast',
        event: signal.type,
        payload: { ...signal, timestamp: Date.now() },
      });
    },
    []
  );

  const initiateCall = useCallback(
    async (targetUserId: string, targetUserName: string, callType: 'voice' | 'video') => {
      const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      resetCall({
        state: 'initiating',
        callType,
        remoteUserId: targetUserId,
        remoteUserName: targetUserName,
        callId,
        duration: 0,
        error: null,
        isInitiator: true,
      });

      // Send invite broadcast.
      broadcast({
        type: 'call-invite',
        from: myUserIdRef.current ?? '',
        to: targetUserId,
        callType,
        callId,
      } as any /* eslint-disable-line @typescript-eslint/no-explicit-any */);

      // Create the WebRTC offer immediately so the recipient can answer.
      // The offer is broadcast as call-offer by webrtc.initiate().
      await webrtc.initiate(
        { audio: true, video: callType === 'video' },
        targetUserId,
      );
    },
    [broadcast, resetCall, webrtc]
  );

  const acceptCall = useCallback(async () => {
    if (!call.callId || !call.remoteUserId) return;

    resetCall({ state: 'accepting' });

    // Notify the caller we accepted.
    broadcast({
      type: 'call-accept',
      from: myUserIdRef.current ?? '',
      to: call.remoteUserId,
      callId: call.callId,
    } as unknown as Omit<CallSignal, 'timestamp'>);

    // Create the WebRTC answer: acquire media, add tracks, set local description.
    await webrtc.accept({
      audio: true,
      video: call.callType === 'video',
    });
  }, [call.callId, call.remoteUserId, call.callType, broadcast, resetCall, webrtc]);

  const rejectCall = useCallback(() => {
    if (!call.callId || !call.remoteUserId) return;

    broadcast({
      type: 'call-reject',
      from: myUserIdRef.current ?? '',
      to: call.remoteUserId,
      callId: call.callId,
    } as unknown as Omit<CallSignal, 'timestamp'>);

    resetCall({ state: 'idle' });
  }, [call.callId, call.remoteUserId, broadcast, resetCall]);

  const endCall = useCallback(() => {
    if (call.callId && call.remoteUserId) {
      broadcast({
        type: 'call-end',
        from: myUserIdRef.current ?? '',
        to: call.remoteUserId,
        callId: call.callId,
      } as unknown as Omit<CallSignal, 'timestamp'>);
    }
    webrtc.end();
    resetCall({ state: 'idle' });
  }, [call.callId, call.remoteUserId, webrtc, resetCall]);

  // WebRTC onSignal callback — routes signaling messages.
  const onSignal = useCallback(
    (payload: { type: string; target: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      broadcast({
        type: payload.type as CallSignal['type'],
        from: myUserIdRef.current ?? '',
        to: payload.target,
        callId: call.callId ?? '',
        ...(payload.sdp ? { sdp: payload.sdp } : {}),
        ...(payload.candidate ? { candidate: payload.candidate } : {}),
      } as unknown as Omit<CallSignal, 'timestamp'>);
    },
    [broadcast, call.callId]
  );

  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  return {
    call,
    onSignal,
    handleOffer: webrtc.handleOffer,
    handleAnswer: webrtc.handleAnswer,
    handleIceCandidate: webrtc.handleIceCandidate,
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    subscribe,
    unsubscribe,
  };
}
