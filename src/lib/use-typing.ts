'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/** A typing indicator broadcast on a Supabase Realtime channel. */
export interface TypingEvent {
  userId: string;
  userName: string;
  matchId: string;
  timestamp: number;
}

export interface UseTypingResult {
  typingUsers: string[]; // userIds currently typing
  isTyping: boolean;
  startTyping: () => void;
  stopTyping: () => void;
  subscribe: (matchId: string, myUserId: string, myUserName: string) => void;
  unsubscribe: () => void;
}

/**
 * Hook that manages typing indicators via Supabase Realtime broadcast.
 *
 * Typing events are ephemeral broadcasts — they are never written to the
 * messages table. Each broadcast expires after 3 seconds of silence.
 */

const TYPING_TTL_MS = 3000;
const BROADCAST_EVENT = 'typing';

export function useTyping(): UseTypingResult {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const timerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((userId: string) => {
    const t = timerRef.current.get(userId);
    if (t) clearTimeout(t);
    timerRef.current.delete(userId);
  }, []);

  const addOrRefresh = useCallback((userId: string, userName: string) => {
    if (userId === myUserIdRef.current) return;
    clearTimer(userId);
    setTypingUsers((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    timerRef.current.set(
      userId,
      setTimeout(() => {
        clearTimer(userId);
        setTypingUsers((prev) => prev.filter((id) => id !== userId));
      }, TYPING_TTL_MS)
    );
  }, [clearTimer]);

  const remove = useCallback((userId: string) => {
    clearTimer(userId);
    setTypingUsers((prev) => prev.filter((id) => id !== userId));
  }, [clearTimer]);

  const startTyping = useCallback(() => {
    if (!myUserIdRef.current || !channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: BROADCAST_EVENT,
      payload: {
        userId: myUserIdRef.current,
        matchId: channelRef.current.topic.split(':')[1],
        timestamp: Date.now(),
      },
    });
  }, []);

  const stopTyping = useCallback(() => {
    if (!myUserIdRef.current || !channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing_stop',
      payload: { userId: myUserIdRef.current },
    });
  }, []);

  const subscribe = useCallback(
    (matchId: string, userId: string, userName: string) => {
      myUserIdRef.current = userId;

      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }

      // Cast to any to work with Supabase Realtime broadcast API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channel: any = supabase.channel(`typing:${matchId}`);

      channel
        .on(
          'broadcast',
          { event: BROADCAST_EVENT },
          ((event: { payload?: TypingEvent }) => {
            const payload = event.payload;
            if (!payload || payload.userId === userId) return;
            addOrRefresh(payload.userId, payload.userName);
          }) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */
        )
        .on(
          'broadcast',
          { event: 'typing_stop' },
          ((event: { payload?: { userId: string } }) => {
            const payload = event.payload;
            if (!payload || payload.userId === userId) return;
            remove(payload.userId);
          }) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            // Announce presence when joining.
            void channel.send({
              type: 'broadcast',
              event: BROADCAST_EVENT,
              payload: {
                userId,
                userName,
                matchId,
                timestamp: Date.now(),
              },
            });
          }
        });

      channelRef.current = channel;
    },
    [addOrRefresh, remove]
  );

  const unsubscribe = useCallback(() => {
    if (myUserIdRef.current && channelRef.current) {
      void channelRef.current.send({
        type: 'broadcast',
        event: 'typing_stop',
        payload: { userId: myUserIdRef.current },
      });
    }
    timerRef.current.forEach((t) => clearTimeout(t));
    timerRef.current.clear();
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setTypingUsers([]);
    myUserIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  return {
    typingUsers,
    isTyping: typingUsers.length > 0,
    startTyping,
    stopTyping,
    subscribe,
    unsubscribe,
  };
}
