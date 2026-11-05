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
 * `otherIdentity` is tracked through a ref so that a caller passing a fresh
 * object literal on every render (e.g. an inline object) cannot retrigger the
 * subscription or a reload. `currentUserId` remains a real dependency so the
 * conversation is (re)loaded once the signed-in member is resolved.
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

  // Holds the latest `otherIdentity` without making it a dependency. This
  // prevents a caller-supplied inline object from retriggering the
  // subscription on every render. Kept in sync via an effect after commit.
  const otherIdentityRef = useRef<{
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  useEffect(() => {
    otherIdentityRef.current = otherIdentity;
  }, [otherIdentity]);

  const loadMessages = useCallback(
    async (older: boolean = false): Promise<void> => {
      if (!matchId) return;
      if (older && !hasMore) return;

      try {
        setLoading(true);
        const rows = await fetchMessages(matchId, MESSAGE_PAGE_SIZE);
        if (!isMountedRef.current) return;

        const parsed: ChatMessage[] = rows.map((row, index) =>
          toChatMessage(
            row,
            currentUserId,
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
    [matchId, currentUserId, hasMore]
  );

  const send = useCallback(
    async (content: string): Promise<void> => {
      if (!matchId || !currentUserId) return;

      const optimisticId = `opt-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: optimisticId,
        matchId,
        senderId: currentUserId,
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
        const sameSender = last && 'senderId' in last && last.senderId === currentUserId;
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
    [matchId, currentUserId]
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

      // Initial load is intentional: it populates state from an async source.
      void loadMessages();
    })();

    const channel = supabase
      .channel(`chat:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as MessageRecord;
          if (!isMountedRef.current) return;

          // Ignore our own optimistic insert; it will be replaced by the real row.
          if ('optimisticId' in row) return;

          const lastItem = items[items.length - 1];
          const lastSender = lastItem && 'senderId' in lastItem
            ? (lastItem as ChatMessage).senderId
            : null;

          const msg = toChatMessage(
            row,
            currentUserId,
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
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as MessageRecord;
          if (!isMountedRef.current) return;
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
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      isMountedRef.current = false;
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [matchId, currentUserId, loadMessages]);

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
