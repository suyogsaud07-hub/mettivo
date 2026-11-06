'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  fetchMessages,
  parseMessageRow,
  sendMessage,
  type MessageRecord,
} from '@/lib/messages';
import { getValidMessageDate, isSameDay } from '@/lib/chat-tokens';
import type { ChatListItem, ChatMessage } from '@/lib/chat-types';

/** Page size for message pagination. */
export const MESSAGE_PAGE_SIZE = 50;

/** Maximum automatic reconnection attempts after a realtime failure. */
const MAX_SUBSCRIPTION_RETRIES = 3;
/** Base delay (ms) between reconnection attempts; scales with attempt number. */
const SUBSCRIPTION_RETRY_BASE_MS = 2_000;
/** Maximum number of applied message ids to remember for duplicate suppression. */
const DEDUP_CAPACITY = 1_000;

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
  const messageType = row.messageType;
  return {
    id: row.id,
    matchId: row.matchId,
    senderId: row.senderId,
    content: row.content,
    isEdited: row.isEdited,
    messageType: (messageType === 'text' || messageType === 'image' || messageType === 'video' || messageType === 'audio' || messageType === 'video_call' || messageType === 'audio_call' || messageType === 'call')
      ? messageType
      : 'text',
    createdAt: getValidMessageDate(row.createdAt).toISOString(),
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
  realtimeError: string | null;
  subscriptionStatus: string | null;
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
 * Lifecycle:
 *   The message channel is built with a single `channel() → on() → subscribe()`
 *   chain. Every `postgres_changes` callback is registered BEFORE `subscribe()`,
 *   and `subscribe()` is the final configuration operation. The channel is torn
 *   down with `supabase.removeChannel()` when the match changes, the component
 *   unmounts, or `unsubscribe()` is called.
 *
 *   `otherIdentity`, `currentUserId`, `items` and `hasMore` are mirrored into
 *   refs so that caller-supplied inline objects or unrelated state changes can
 *   never retrigger the subscription. The subscription effect depends only on
 *   `matchId` — the value that identifies the conversation.
 */
export function useChatMessages(
  matchId: string,
  otherIdentity: { display_name: string | null; avatar_url: string | null } | null
): UseChatMessagesResult {
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);
  const lastCreatedAtRef = useRef<string | null>(null);
  const retryCountRef = useRef(0);
  // Suppresses duplicate INSERT events delivered more than once for the same row.
  const receivedIdsRef = useRef<Set<string>>(new Set());

  // Refs keep the latest values without making them effect dependencies. This
  // prevents a fresh object literal or a pagination state change from causing
  // the channel to be torn down and re-subscribed.
  const otherIdentityRef = useRef<{
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const hasMoreRef = useRef(hasMore);
  const currentUserIdRef = useRef<string | null>(null);
  const itemsRef = useRef<ChatListItem[]>([]);

  useEffect(() => {
    otherIdentityRef.current = otherIdentity;
  }, [otherIdentity]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
        isEdited: false,
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

  /**
   * Builds (or rebuilds) the realtime channel for the current match.
   *
   * Strict ordering: `channel() → on() → subscribe()`. The channel instance is
   * stored in `channelRef.current` so cleanup and retry always address the
   * latest channel. A `ch !== channelRef.current` guard inside every callback
   * guarantees a superseded channel can never mutate state or schedule a retry.
   */
  useEffect(() => {
    if (!matchId) {
      // No channel can exist without a conversation. Leave the status/error
      // state as-is: the chat UI does not render without a valid matchId, and
      // the next valid matchId resets them via the SUBSCRIBED callback.
      return;
    }

    // A new conversation means a new dedup scope: ids from a previous thread
    // must not suppress messages in this one.
    receivedIdsRef.current.clear();
    retryCountRef.current = 0;

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

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
          if (!active) return;
          const eventType = payload.eventType;
          if (eventType === 'DELETE') {
            const oldRow = payload.old as { id?: unknown };
            if (typeof oldRow.id === 'string') {
              setItems((prev) => prev.filter((item) => !('id' in item && item.id === oldRow.id)));
            }
            return;
          }
          if (eventType !== 'INSERT' && eventType !== 'UPDATE') return;
          const row = parseMessageRow(payload.new);
          if (!row) return;

          const lastItem = itemsRef.current[itemsRef.current.length - 1];
          const lastSender = lastItem && 'senderId' in lastItem
            ? (lastItem as ChatMessage).senderId
            : null;

          if (eventType === 'INSERT') {
            if (receivedIdsRef.current.has(row.id)) return;
            receivedIdsRef.current.add(row.id);
            if (receivedIdsRef.current.size > DEDUP_CAPACITY) {
              const first = receivedIdsRef.current.values().next().value;
              if (first !== undefined) receivedIdsRef.current.delete(first);
            }
            const msg = toChatMessage(
              row,
              currentUserIdRef.current,
              otherIdentityRef.current,
              lastSender
            );

            setItems((prev) => {
              if (prev.some((m) => 'id' in m && m.id === msg.id)) return prev;
              const last = prev[prev.length - 1];
              const lastCreatedAt = last
                ? ('createdAt' in last ? last.createdAt : null)
                : null;
              const needsDateSep =
                !last ||
                ('type' in last && last.type === 'date') ||
                (lastCreatedAt && !isSameDay(msg.createdAt, lastCreatedAt));
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
              return [...prev, ...(sep ? [sep] : []), msg];
            });
          } else if (eventType === 'UPDATE') {
            setItems((prev) =>
              prev.map((item) =>
                'senderId' in item && item.id === row.id
                  ? {
                      ...item,
                      content: row.content,
                      isEdited: row.isEdited,
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
      .subscribe((status, error) => {
        if (!active) return;
        // Ignore status reports from a channel that has been superseded by a
        // retry or a match change.
        if (channel !== channelRef.current) return;

        if (status === 'SUBSCRIBED') {
          retryCountRef.current = 0;
          setRealtimeError(null);
          setSubscriptionStatus(status);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setSubscriptionStatus(status);
          setRealtimeError(error?.message ?? 'Realtime connection failed.');
          if (retryCountRef.current < MAX_SUBSCRIPTION_RETRIES) {
            retryCountRef.current++;
            retryTimer = setTimeout(() => {
              if (!active) return;
              if (channel !== channelRef.current) return;
              rebuild();
            }, SUBSCRIPTION_RETRY_BASE_MS * retryCountRef.current);
          }
        } else if (status === 'CLOSED') {
          setSubscriptionStatus(status);
        }
      });

    channelRef.current = channel;

    /**
     * Tears down the current channel and builds a fresh one. Used by the
     * bounded reconnection strategy; never called while `active` is false.
     */
    function rebuild(): void {
      if (!active) return;
      const previous = channelRef.current;
      if (previous) void supabase.removeChannel(previous);
      const next = supabase
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
            if (!active) return;
            const eventType = payload.eventType;
            if (eventType === 'DELETE') {
              const oldRow = payload.old as { id?: unknown };
              if (typeof oldRow.id === 'string') {
                setItems((prev) => prev.filter((item) => !('id' in item && item.id === oldRow.id)));
              }
              return;
            }
            if (eventType !== 'INSERT' && eventType !== 'UPDATE') return;
            const row = parseMessageRow(payload.new);
            if (!row) return;

            const lastItem = itemsRef.current[itemsRef.current.length - 1];
            const lastSender = lastItem && 'senderId' in lastItem
              ? (lastItem as ChatMessage).senderId
              : null;

            if (eventType === 'INSERT') {
              if (receivedIdsRef.current.has(row.id)) return;
              receivedIdsRef.current.add(row.id);
              if (receivedIdsRef.current.size > DEDUP_CAPACITY) {
                const first = receivedIdsRef.current.values().next().value;
                if (first !== undefined) receivedIdsRef.current.delete(first);
              }
              const msg = toChatMessage(
                row,
                currentUserIdRef.current,
                otherIdentityRef.current,
                lastSender
              );
              setItems((prev) => {
                if (prev.some((m) => 'id' in m && m.id === msg.id)) return prev;
                const last = prev[prev.length - 1];
                const lastCreatedAt = last
                  ? ('createdAt' in last ? last.createdAt : null)
                  : null;
                const needsDateSep =
                  !last ||
                  ('type' in last && last.type === 'date') ||
                  (lastCreatedAt && !isSameDay(msg.createdAt, lastCreatedAt));
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
                return [...prev, ...(sep ? [sep] : []), msg];
              });
            } else if (eventType === 'UPDATE') {
              setItems((prev) =>
                prev.map((item) =>
                  'senderId' in item && item.id === row.id
                    ? {
                        ...item,
                        content: row.content,
                        isEdited: row.isEdited,
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
        .subscribe((status, error) => {
          if (!active) return;
          if (next !== channelRef.current) return;
          if (status === 'SUBSCRIBED') {
            retryCountRef.current = 0;
            setRealtimeError(null);
            setSubscriptionStatus(status);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setSubscriptionStatus(status);
            setRealtimeError(error?.message ?? 'Realtime connection failed.');
            if (retryCountRef.current < MAX_SUBSCRIPTION_RETRIES) {
              retryCountRef.current++;
              retryTimer = setTimeout(() => {
                if (!active) return;
                if (next !== channelRef.current) return;
                rebuild();
              }, SUBSCRIPTION_RETRY_BASE_MS * retryCountRef.current);
            }
          } else if (status === 'CLOSED') {
            setSubscriptionStatus(status);
          }
        });
      channelRef.current = next;
    }

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      const current = channelRef.current;
      if (current) {
        void supabase.removeChannel(current);
        channelRef.current = null;
      }
    };
  }, [matchId]);

  /**
   * Resolves the signed-in member and performs the initial message fetch.
   * Separate from the subscription effect so a realtime failure never blocks
   * message display, and vice-versa.
   */
  useEffect(() => {
    if (!matchId) return;
    isMountedRef.current = true;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!isMountedRef.current) return;
      setCurrentUserId(user?.id ?? null);
      if (user) setOtherUserId(null); // resolved elsewhere

      void loadMessages();
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, [matchId, loadMessages]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setRealtimeError(null);
    setSubscriptionStatus(null);
    retryCountRef.current = 0;
  }, []);

  return {
    items,
    loading,
    error,
    realtimeError,
    subscriptionStatus,
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
    unsubscribe,
  };
}
