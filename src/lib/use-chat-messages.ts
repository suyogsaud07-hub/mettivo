'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  fetchMessages,
  sendMessage,
  type MessageRecord,
} from '@/lib/messages';
import { isSameDay } from '@/lib/chat-tokens';
import type { ChatListItem, ChatMessage } from '@/lib/chat-types';

/** Page size for message pagination. */
export const MESSAGE_PAGE_SIZE = 50;

function toChatMessage(
  row: MessageRecord,
  currentUserId: string | null,
  otherIdentity: { display_name: string | null; avatar_url: string | null } | null,
  prevSenderId: string | null
): ChatMessage {
  const isMe = row.senderId === currentUserId;
  const senderName = isMe
    ? 'You'
    : otherIdentity?.display_name ?? 'Member';
  const senderAvatar = isMe ? null : otherIdentity?.avatar_url ?? null;
  const isGrouped = prevSenderId === row.senderId;
  const messageType = (row as { message_type?: string }).message_type;
  return {
    id: row.id,
    matchId: row.matchId,
    senderId: row.senderId,
    content: row.content,
    messageType: (messageType === 'text' || messageType === 'video_call' || messageType === 'audio_call' || messageType === 'call')
      ? messageType
      : 'text',
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    seenAt: row.seenAt,
    senderAvatar,
    senderName,
    isGroupStart: !isGrouped,
    isGrouped,
    status: row.seenAt
      ? 'seen'
      : row.deliveredAt
        ? 'delivered'
        : isMe
          ? 'sent'
          : 'sent',
  };
}

export interface UseChatMessagesResult {
  items: ChatListItem[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  currentUserId: string | null;
  otherUserId: string | null;
  otherIdentity: { display_name: string | null; avatar_url: string | null } | null;
  refresh: () => Promise<void>;
  unsubscribe: () => void;
}

/**
 * Hook that owns message fetching, pagination, realtime subscription, and
 * message grouping for one conversation.
 *
 * The realtime channel is created exactly once per matchId using a single
 * `.channel() → .on() → .subscribe()` chain. `otherIdentity` and `hasMore`
 * are tracked through refs so that a caller-supplied inline object or a
 * pagination state change cannot retrigger the subscription.
 */
export function useChatMessages(
  matchId: string,
  otherIdentity: { display_name: string | null; avatar_url: string | null } | null
): UseChatMessagesResult {
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastCreatedAtRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // Refs keep the latest values without making them effect dependencies.
  // This prevents a fresh object literal or a pagination state change from
  // causing the channel to be torn down and re-subscribed.
  const otherIdentityRef = useRef<{
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const hasMoreRef = useRef(hasMore);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    otherIdentityRef.current = otherIdentity;
  }, [otherIdentity]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const loadMessages = useCallback(
    async (older: boolean = false): Promise<void> => {
      if (!matchId) return;
      if (older && !hasMoreRef.current) return;

      try {
        setLoading(true);
        const rows = await fetchMessages(matchId, MESSAGE_PAGE_SIZE);
        if (!isMountedRef.current) return;

        const parsed: ChatMessage[] = rows.map((row, index) =>
          toChatMessage(
            row,
            currentUserIdRef.current,
            otherIdentityRef.current,
            index > 0 ? rows[index - 1].senderId : null
          )
        );

        // Build item list with date separators.
        const built: ChatListItem[] = [];
        let lastDate: string | null = null;
        for (const msg of parsed) {
          const msgDate = msg.createdAt.slice(0, 10);
          if (lastDate !== msgDate) {
            built.push({
              type: 'date',
              label:
                msgDate === new Date().toISOString().slice(0, 10)
                  ? 'Today'
                  : new Date(msgDate).toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    }),
            });
            lastDate = msgDate;
          }
          built.push(msg);
        }

        if (older) {
          setItems((prev) => [...built, ...prev]);
        } else {
          setItems(built);
          lastCreatedAtRef.current = rows.length > 0 ? rows[0].createdAt : null;
        }

        setHasMore(rows.length === MESSAGE_PAGE_SIZE);
        setError(null);
      } catch (err) {
        if (!isMountedRef.current) return;
        setError(
          err instanceof Error ? err.message : 'Failed to load messages.'
        );
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    },
    [matchId]
  );

  const send = useCallback(
    async (content: string): Promise<void> => {
      if (!matchId || !currentUserIdRef.current) return;

      const optimisticId = `opt-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: optimisticId,
        matchId,
        senderId: currentUserIdRef.current,
        content,
        messageType: 'text',
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        seenAt: null,
        senderAvatar: null,
        senderName: 'You',
        isGroupStart: false,
        isGrouped: false,
        optimisticId,
        status: 'sending',
      };

      setItems((prev) => {
        const last = prev[prev.length - 1];
        const sameSender = last && 'senderId' in last && last.senderId === currentUserIdRef.current;
        optimistic.isGrouped = sameSender;
        optimistic.isGroupStart = !sameSender;
        return [...prev, optimistic];
      });

      try {
        const sent = await sendMessage(matchId, content);
        if (!isMountedRef.current) return;

        setItems((prev) =>
          prev.map((item) =>
            'optimisticId' in item && item.optimisticId === optimisticId
              ? {
                  ...item,
                  id: sent.id,
                  createdAt: sent.createdAt,
                  status: 'sent',
                  optimisticId: undefined,
                }
              : item
          )
        );
      } catch (err) {
        if (!isMountedRef.current) return;
        setItems((prev) =>
          prev.map((item) =>
            'optimisticId' in item && item.optimisticId === optimisticId
              ? { ...item, status: 'failed' }
              : item
          )
        );
        setError(
          err instanceof Error ? err.message : 'Message failed to send.'
        );
      }
    },
    [matchId]
  );

  useEffect(() => {
    if (!matchId) return;
    isMountedRef.current = true;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (isMountedRef.current) {
        setCurrentUserId(user?.id ?? null);
        if (user) setOtherUserId(null); // resolved elsewhere
      }

      // Initial load happens after the signed-in member is resolved.
      void loadMessages();
    })();

    // Strict chain: channel() → on() → subscribe(). A single postgres_changes
    // listener with event: '*' handles both INSERT and UPDATE so we never
    // add callbacks after the channel has subscribed.
    const channel = supabase
      .channel(`chat:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as MessageRecord | null;
          const eventType = payload.eventType;
          if (!row || !isMountedRef.current) return;

          // Ignore our own optimistic insert; the real row replaces it.
          if ('optimisticId' in row) return;

          const lastItem = items[items.length - 1];
          const lastSender = lastItem && 'senderId' in lastItem
            ? (lastItem as ChatMessage).senderId
            : null;

          if (eventType === 'INSERT') {
            const msg = toChatMessage(
              row,
              currentUserIdRef.current,
              otherIdentityRef.current,
              lastSender
            );

            setItems((prev) => {
              const last = prev[prev.length - 1];
              const lastCreatedAt = 'createdAt' in last ? last.createdAt : null;
              const needsDateSep =
                !last || ('type' in last && last.type === 'date') || (lastCreatedAt && !isSameDay(msg.createdAt, lastCreatedAt));
              const sep: ChatListItem | null = needsDateSep
                ? {
                    type: 'date',
                    label: new Date(msg.createdAt).toLocaleDateString(undefined, {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    }),
                  }
                : null;
              return [...(sep ? [sep] : []), msg];
            });
          } else if (eventType === 'UPDATE') {
            setItems((prev) =>
              prev.map((item) =>
                'senderId' in item && item.id === row.id
                  ? {
                      ...item,
                      deliveredAt: row.deliveredAt,
                      seenAt: row.seenAt,
                      status: row.seenAt
                        ? 'seen'
                        : row.deliveredAt
                          ? 'delivered'
                          : item.status,
                    }
                  : item
              )
            );
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      isMountedRef.current = false;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId, loadMessages]);

  return {
    items,
    loading,
    error,
    sendMessage: send,
    loadMore: async () => {
      await loadMessages(true);
    },
    hasMore,
    currentUserId,
    otherUserId,
    otherIdentity,
    refresh: async () => {
      await loadMessages();
    },
    unsubscribe: () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    },
  };
}
