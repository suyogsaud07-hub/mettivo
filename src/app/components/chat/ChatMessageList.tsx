'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import MessageBubble from '@/app/components/chat/MessageBubble';
import TypingIndicator from '@/app/components/chat/TypingIndicator';
import type { ChatListItem, ChatMessage } from '@/lib/chat-types';
import type { ChatMediaByMessage } from '@/lib/chatMedia';

interface ChatMessageListProps {
  items: ChatListItem[];
  currentUserId: string | null;
  otherUserId: string | null;
  otherUserName: string | null;
  otherUserAvatar: string | null;
  chatMedia?: ChatMediaByMessage;
  searchQuery?: string;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onPinToggle: (messageId: string) => void;
  onReply: (messageId: string) => void;
  onForward: (messageId: string) => void;
  onScrollBottom?: () => void;
  typingUsers: string[];
}

export default function ChatMessageList({
  items,
  currentUserId,
  otherUserId,
  otherUserName,
  otherUserAvatar,
  chatMedia = {},
  searchQuery,
  isLoading,
  error,
  onRetry,
  onPinToggle,
  onReply,
  onForward,
  onScrollBottom,
  typingUsers,
}: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const searchMatchesRef = useRef<{ messageId: string; content: string }[]>([]);

  // Scroll to bottom when new messages arrive (unless user is scrolling up).
  useEffect(() => {
    if (onScrollBottom) {
      const end = messagesEndRef.current;
      if (end) {
        const parent = end.parentElement;
        if (parent) {
          const isNearBottom =
            parent.scrollHeight - parent.scrollTop - parent.clientHeight < 200;
          if (isNearBottom) {
            onScrollBottom();
          }
        }
      }
    }
  }, [items, onScrollBottom]);

  // Recompute search matches when query or items change.
  useEffect(() => {
    if (!searchQuery?.trim()) {
      searchMatchesRef.current = [];
      setSearchMatchIndex(-1);
      return;
    }
    const q = searchQuery.trim().toLowerCase();
    const matches: { messageId: string; content: string }[] = [];
    for (const item of items) {
      if (!('type' in item)) {
        if (item.content.toLowerCase().includes(q)) {
          matches.push({ messageId: item.id, content: item.content });
        }
      }
    }
    searchMatchesRef.current = matches;
    setSearchMatchIndex(matches.length > 0 ? 0 : -1);
  }, [items, searchQuery]);

  const jumpToMatch = useCallback(
    (delta: number) => {
      const matches = searchMatchesRef.current;
      if (matches.length === 0) return;
      const next = (searchMatchIndex + delta + matches.length) % matches.length;
      setSearchMatchIndex(next);
      const el = document.getElementById(`msg-${matches[next].messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    },
    [searchMatchIndex]
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    onRetry();
  }, [onRetry]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertTriangle size={32} className="mb-2 text-[#EF4444]" />
        <p className="text-sm text-[#B58A83] mb-4">{error}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="flex items-center gap-1.5 rounded-xl bg-[#1C1822] border border-[#34283F] px-4 py-2 text-sm text-[#F2E9E4] hover:bg-[#29202D]"
        >
          <RefreshCw size={16} /> Try again
        </button>
      </div>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="w-8 h-8 rounded-full border-2 border-[#D4B18A]/30 border-t-[#D4B18A] rounded-full animate-spin mb-4" />
        <p className="text-sm text-[#B58A83]">Loading messages…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <span className="text-2xl mb-2">💬</span>
        <p className="text-sm text-[#B58A83]">No messages yet. Say hello.</p>
      </div>
    );
  }

  // Group consecutive messages by sender for avatar/timestamp display.
  const groupedItems: Array<ChatListItem & { groupKey?: string }> = [];
  let lastSenderId: string | null = null;

  for (const item of items) {
    if ('type' in item && item.type === 'date') {
      groupedItems.push(item);
      lastSenderId = null;
    } else {
      const msg = item as ChatMessage;
      const isGrouped = lastSenderId === msg.senderId;
      groupedItems.push({
        ...msg,
        isGrouped,
        isGroupStart: !isGrouped,
        groupKey: `${msg.senderId}-${msg.id}`,
      });
      lastSenderId = msg.senderId;
    }
  }

  return (
    <div className="flex flex-col h-full">
      {typingUsers.length > 0 && (
        <div className="px-4 pb-1">
          <TypingIndicator userNames={typingUsers} />
        </div>
      )}
      {searchQuery?.trim() && (
        <div className="px-4 pb-1 text-xs flex items-center justify-between text-[#B58A83]">
          <span>
            {searchMatchesRef.current.length} match{searchMatchesRef.current.length !== 1 ? 'es' : ''}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => jumpToMatch(-1)}
              disabled={searchMatchIndex < 0}
              className="p-1 hover:bg-[#29202D] rounded disabled:opacity-50"
            >
              ▲
            </button>
            <button
              onClick={() => jumpToMatch(1)}
              disabled={searchMatchIndex < 0}
              className="p-1 hover:bg-[#29202D] rounded disabled:opacity-50"
            >
              ▼
            </button>
          </div>
        </div>
      )}
      <div
        ref={messagesEndRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2 scrollbar-hide"
      >
        {groupedItems.map((item, index) => {
          if ('type' in item && item.type === 'date') {
            return (
              <div
                key={`date-${index}`}
                className="flex items-center justify-center my-2"
              >
                <span className="px-2 py-0.5 rounded-full bg-[#1C1822] border border-[#34283F] text-[10px] text-[#6B5B79]">
                  {item.label}
                </span>
              </div>
            );
          }

          const msg = item as ChatMessage;
          const isMe = msg.senderId === currentUserId;
          const mediaForMsg = chatMedia[msg.id] ?? null;

          return (
            <div key={msg.id} id={`msg-${msg.id}`} className="relative w-full">
              <MessageBubble
                message={{
                  id: msg.id,
                  match_id: msg.matchId,
                  sender_id: msg.senderId,
                  content: msg.content,
                  created_at: msg.createdAt,
                  message_type: msg.messageType,
                  delivered_at: msg.deliveredAt,
                  seen_at: msg.seenAt,
                }}
                media={mediaForMsg}
                isMe={isMe}
                currentUserId={currentUserId ?? null}
                isPinned={false}
                searchQuery={searchQuery}
                onPinToggle={() => onPinToggle(msg.id)}
                onReply={() => onReply(msg.id)}
                onForward={() => onForward(msg.id)}
                showAvatar={!msg.isGrouped}
                isGroupStart={msg.isGroupStart}
                isGrouped={msg.isGrouped}
                senderAvatar={!isMe ? otherUserAvatar : null}
                senderName={!isMe && msg.isGroupStart ? otherUserName : null}
              />
              {msg.status === 'failed' && (
                <div className="absolute top-0 right-0 z-10">
                  <button
                    type="button"
                    onClick={() => {
                      // Retry logic handled by parent via optimistic ID
                    }}
                    className="p-1 text-[#EF4444] hover:text-[#F2E9E4]"
                    aria-label="Retry sending"
                  >
                    <AlertTriangle size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
