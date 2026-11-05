'use client';

import { useEffect, useState, use, useRef, useSyncExternalStore, useMemo } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  markConversationRead,
  markMessagesDelivered,
  fetchChatSettings,
  setDisappearingMessages,
  purgeExpiredChatContent,
  fetchConversationSendState,
  fetchConversationMute,
  setConversationMute,
  type ConversationSendState,
} from '@/lib/messages';
import { blockMember, BlockingError } from '@/lib/blocking';
import { pinMessage, unpinMessage, fetchPinnedMessages } from '@/lib/pins';
import {
  ConversationError,
  respondToConversationRequest,
} from '@/lib/conversations';
import { type MessageRow } from '@/lib/types';
import {
  fetchChatMedia,
  sendChatMedia,
  subscribeToChatMedia,
  isGone,
  ChatMediaError,
  type ChatMediaByMessage,
} from '@/lib/chatMedia';
import {
  NO_RESTRICTIONS,
  describeRestriction,
  fetchMyRestrictions,
  type MyRestrictions,
} from '@/lib/reports';
import { ReportModal } from '@/app/components/moderation/ReportModal';
import MessageBubble from '@/app/components/chat/MessageBubble';
import { fetchPublicIdentities, type PublicIdentity } from '@/lib/public-profiles';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';
import ProfileStoryModal from '@/components/chat/ProfileStoryModal';

/** The 24-hour window offered by the disappearing-chat toggle. */
const DISAPPEARING_SECONDS = 86_400;

function subscribeToBrowserLanguage(): () => void {
  return () => {};
}

function getBrowserLanguageSnapshot(): string | null {
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : null;
}

export default function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ search?: string }>;
}) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.matchId;
  const resolvedSearchParams = use(searchParams);
  const searchFromUrl = resolvedSearchParams.search === '1';

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherIdentity, setOtherIdentity] = useState<PublicIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [searchActive, setSearchActive] = useState(searchFromUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  const router = useRouter();

  const [reportOpen, setReportOpen] = useState(false);
  const [reportTargetType, setReportTargetType] = useState<'user' | 'chat'>('user');
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);
  const [chatMedia, setChatMedia] = useState<ChatMediaByMessage>({});
  const [sendingMedia, setSendingMedia] = useState(false);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const [togglingDisappearing, setTogglingDisappearing] = useState(false);

  const [storyOpen, setStoryOpen] = useState(false);
  const deleteForMe = async (messageId: string) => {
    const { data } = await supabase.auth.getUser();
    const user = data?.user ?? null;
    if (!user) return;
    try {
      await supabase.from('message_deletions').insert({ message_id: messageId, user_id: user.id });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err) {
      console.error('Failed to delete for me:', err);
    }
  };

  const handleUnblock = async () => {
    const target = otherUserIdRef.current;
    if (!target) return;
    try {
      const { unblockMember } = await import('@/lib/blocking');
      await unblockMember(target);
      setBlocked(false);
      setMenuOpen(false);
    } catch (err) {
      console.error('Failed to unblock:', err);
    }
  };

  const [sendState, setSendState] = useState<ConversationSendState | null>(null);
  const [responding, setResponding] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  const { language: preferredTranslationLanguage } =
    usePreferredTranslationLanguage();

  const sourceLanguageHint = useSyncExternalStore(
    subscribeToBrowserLanguage,
    getBrowserLanguageSnapshot,
    () => null
  );

  const currentUserIdRef = useRef<string | null>(null);
  const otherUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const applyOtherUserId = (id: string) => {
      otherUserIdRef.current = id;
      if (isMounted) setOtherUserId(id);
    };

    const refreshMedia = () => {
      void fetchChatMedia(matchId).then((map) => {
        if (isMounted) setChatMedia(map);
      });
    };

    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;
      currentUserIdRef.current = user?.id ?? null;
      if (user) setCurrentUserId(user.id);

      const myRestrictions = await fetchMyRestrictions();
      if (isMounted) setRestrictions(myRestrictions);

      const requestState = await fetchConversationSendState(matchId);
      if (isMounted) setSendState(requestState);

      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at, message_type, delivered_at, seen_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });

      if (!isMounted) return;

      if (fetchError) {
        console.error('Failed to load messages:', fetchError.message);
        setError('Could not load this conversation.');
        return;
      }

      const messagesData = (data ?? []) as MessageRow[];
      setMessages(messagesData);

      const mediaMap = await fetchChatMedia(matchId);
      if (isMounted) setChatMedia(mediaMap);

      const window = await fetchChatSettings(matchId);
      if (isMounted) setDisappearing(window);

      const mute = await fetchConversationMute(matchId);
      if (isMounted) setMuted(mute);

      const pinned = await fetchPinnedMessages(matchId);
      if (isMounted) setPinnedMessageIds(new Set(pinned));

      markConversationRead(matchId).catch(() => undefined);

      void markMessagesDelivered(matchId);
      void purgeExpiredChatContent();

      if (!user) return;

      const otherSender = messagesData.find((m) => m.sender_id !== user.id);
      if (otherSender) {
        applyOtherUserId(otherSender.sender_id);
        return;
      }

      const { data: matchRow } = await supabase
        .from('matches')
        .select('user_a_id, user_b_id')
        .eq('id', matchId)
        .maybeSingle();

      if (!isMounted || !matchRow) return;
      const other =
        matchRow.user_a_id === user.id ? matchRow.user_b_id : matchRow.user_a_id;
      if (other) applyOtherUserId(other);
    };

    void init();

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
        (payload: RealtimePostgresChangesPayload<MessageRow>) => {
          const inserted = payload.new as MessageRow;
          setMessages((prev) =>
            prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
          );

          if (inserted.content === '') refreshMedia();

          if (!otherUserIdRef.current && inserted.sender_id !== currentUserIdRef.current) {
            applyOtherUserId(inserted.sender_id);
          }

          if (inserted.sender_id !== currentUserIdRef.current) {
            void markMessagesDelivered(matchId);
            markConversationRead(matchId).catch(() => undefined);
            void fetchConversationSendState(matchId).then((state) => {
              if (state) setSendState(state);
            });
          }
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
        (payload: RealtimePostgresChangesPayload<MessageRow>) => {
          const updated = payload.new as MessageRow;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    const unsubscribeMedia = subscribeToChatMedia(matchId, refreshMedia);

    return () => {
      isMounted = false;
      unsubscribeMedia();
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  useEffect(() => {
    if (!otherUserId) return;

    let cancelled = false;

    fetchPublicIdentities([otherUserId])
      .then((identities) => {
        if (!cancelled) setOtherIdentity(identities.get(otherUserId) ?? null);
      })
      .catch((identityError: unknown) => {
        console.error('Failed to load conversation identity:', identityError);
        if (!cancelled) setOtherIdentity(null);
      });

    return () => {
      cancelled = true;
    };
  }, [otherUserId]);

  const activeIdentity =
    otherIdentity && otherIdentity.id === otherUserId ? otherIdentity : null;
  const conversationName =
    activeIdentity?.display_name?.trim() || activeIdentity?.username || 'Conversation';
  const conversationUsername = activeIdentity?.username
    ? `@${activeIdentity.username.replace(/^@/, '')}`
    : null;

  const senderAvatar = activeIdentity?.avatar_url ?? null;

  const openStory = () => {
    if (otherUserId) setStoryOpen(true);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    const content = newMessage.trim();
    const me = currentUserIdRef.current;
    if (!content || !me) return;

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        match_id: matchId,
        sender_id: me,
        content,
        message_type: 'text',
      })
      .select('id, match_id, sender_id, content, created_at, message_type, delivered_at, seen_at')
      .single();

    if (insertError) {
      console.error('Failed to send message:', insertError.message);
      setError(
        insertError.code === '42501'
          ? insertError.message
          : 'Message could not be sent.'
      );
      return;
    }

    const inserted = data as MessageRow | null;
    if (inserted) {
      setMessages((prev) =>
        prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
      );
    }

    setError(null);
    setNewMessage('');

    const nextState = await fetchConversationSendState(matchId);
    if (nextState) setSendState(nextState);
  };

  const handleRespond = async (accept: boolean) => {
    if (responding) return;
    setResponding(true);
    setError(null);

    try {
      await respondToConversationRequest(matchId, accept);
      const nextState = await fetchConversationSendState(matchId);
      if (nextState) setSendState(nextState);
    } catch (err) {
      setError(
        err instanceof ConversationError
          ? err.message
          : 'The request could not be updated. Please try again.'
      );
    } finally {
      setResponding(false);
    }
  };

  const handleMediaPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    const picked = files[0];
    const me = currentUserIdRef.current;
    if (!picked || !me) return;

    setSendingMedia(true);
    setError(null);
    try {
      const sent = await sendChatMedia(matchId, me, picked);
      const now = new Date();
      const messageRow: MessageRow = {
        id: sent.messageId,
        match_id: matchId,
        sender_id: me,
        content: '',
        created_at: now.toISOString(),
        message_type: 'text',
        delivered_at: null,
        seen_at: null,
      };
      setMessages((prev) =>
        prev.some((m) => m.id === messageRow.id) ? prev : [...prev, messageRow]
      );
      const nextState = await fetchConversationSendState(matchId);
      if (nextState) setSendState(nextState);

      setChatMedia((prev) => ({
        ...prev,
        [sent.messageId]: {
          id: sent.mediaId,
          message_id: sent.messageId,
          match_id: matchId,
          sender_id: me,
          storage_path: '',
          media_type: sent.media.mediaType,
          view_once: false,
          view_limit: sent.viewLimit,
          view_count: 0,
          expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
          viewed_at: null,
          created_at: now.toISOString(),
        },
      }));
    } catch (err) {
      const message =
        err instanceof ChatMediaError ? err.message : 'The media could not be sent.';
      setError(message);
    } finally {
      setSendingMedia(false);
    }
  };

  const handleReported = () => {
    setReportOpen(false);
    setMenuOpen(false);
  };

  const handleBlock = async () => {
    const target = otherUserIdRef.current;
    if (!target) return;

    setBlocking(true);
    setError(null);

    try {
      await blockMember(target);
      setMenuOpen(false);
      setBlocked(true);
    } catch (err) {
      if (err instanceof BlockingError) {
        setError(err.message);
      } else {
        console.error('Unexpected error blocking user:', err);
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setBlocking(false);
    }
  };

  const toggleDisappearing = async () => {
    setTogglingDisappearing(true);
    setError(null);
    try {
      const next = await setDisappearingMessages(
        matchId,
        disappearing ? null : DISAPPEARING_SECONDS
      );
      setDisappearing(next);
      if (next) await purgeExpiredChatContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change disappearing messages.');
    } finally {
      setTogglingDisappearing(false);
    }
  };

  const handleToggleMute = async () => {
    if (muted === null) return;
    setTogglingDisappearing(true);
    setError(null);
    try {
      const next = await setConversationMute(matchId, !muted);
      setMuted(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not update that setting.');
    } finally {
      setTogglingDisappearing(false);
    }
  };

  const handleClearChat = async () => {
    if (!window.confirm('Clear this conversation for you? The other participant will keep their messages.')) return;
    setTogglingDisappearing(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');

      const { data: allMessages, error: fetchError } = await supabase
        .from('messages')
        .select('id')
        .eq('match_id', matchId);

      if (fetchError) throw fetchError;

      if (allMessages && allMessages.length > 0) {
        const { error: insertError } = await supabase
          .from('message_deletions')
          .upsert(
            allMessages.map((m) => ({ message_id: m.id, user_id: user.id })),
            { onConflict: 'message_id,user_id' }
          );
        if (insertError) throw insertError;
      }

      setMessages([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not clear this conversation.');
    } finally {
      setTogglingDisappearing(false);
    }
  };

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [searchQuery, messages]);

  const restrictionMessage = describeRestriction(restrictions);
  const requestPending = sendState?.relationshipState === 'MESSAGE_REQUEST_PENDING';
  const conversationClosed =
    sendState?.relationshipState === 'UNAVAILABLE' ||
    sendState?.relationshipState === 'BLOCKED';
  const requestBlocked =
    sendState !== null && !sendState.canSend && !conversationClosed;
  const canSend =
    restrictionMessage === null && !blocked && !conversationClosed && !requestBlocked;
  const remainingRequests =
    sendState && requestPending && sendState.requestedByMe
      ? Math.max(0, sendState.sendLimit - sendState.sentCount)
      : null;

  const ROSE = '#C24A6E';
  const SURFACE = '#131017';
  const PANEL = '#1C1822';
  const BORDER = '#34283F';
  const TEXT = '#F2E9E4';
  const MUTED = '#B58A83';
  const ACCENT = '#D4B18A';

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-0 bg-[#131017] text-[#F2E9E4]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#34283F] shrink-0 bg-[#131017]/80 backdrop-blur">
        <button
          onClick={() => window.history.back()}
          className="px-3 py-1.5 rounded-md text-sm bg-[#1C1822] border border-[#34283F] hover:bg-[#29202D] text-[#F2E9E4] shrink-0"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1 text-center cursor-pointer" onClick={openStory}>
          {otherUserId ? (
            <Link href={`/profile/${otherUserId}`} className="block" onClick={(e) => e.stopPropagation()}>
              <p className="truncate text-sm font-semibold text-[#F2E9E4] hover:underline">
                {conversationName}
              </p>
              {conversationUsername ? (
                <p className="truncate text-xs text-[#D4B18A]/90">{conversationUsername}</p>
              ) : null}
            </Link>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-[#F2E9E4]">
                {conversationName}
              </p>
              {conversationUsername ? (
                <p className="truncate text-xs text-[#D4B18A]/90">{conversationUsername}</p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 relative shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded-md bg-[#1C1822] border border-[#34283F] hover:bg-[#29202D] text-[#F2E9E4] aria-label='Conversation options'"
            aria-label="Conversation options"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 bg-[#1C1822] rounded-xl shadow-2xl border border-[#34283F] z-20">
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider mb-3">Conversation</p>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/chat/${matchId}/info`);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#F2E9E4] hover:bg-[#29202D]"
                >
                  View contact
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/chat/${matchId}?search=1`);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#F2E9E4] hover:bg-[#29202D] mt-1"
                >
                  Search
                </button>
                <button
                  onClick={handleToggleMute}
                  disabled={muted === null || togglingDisappearing}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[#29202D] mt-1 ${
                    muted === null || togglingDisappearing ? 'opacity-50 cursor-not-allowed text-[#6B5B79]' : 'text-[#F2E9E4]'
                  }`}
                >
                  {muted ? 'Unmute notifications' : 'Mute notifications'}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportTargetType('user');
                    setReportOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#F2E9E4] hover:bg-[#29202D] mt-1"
                  disabled={!otherUserId}
                >
                  Report User
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportTargetType('chat');
                    setReportOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-[#F2E9E4] hover:bg-[#29202D] mt-1"
                  disabled={!otherUserId}
                >
                  Report Conversation
                </button>
                <button
                  onClick={blocked ? handleUnblock : handleBlock}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[#29202D] mt-1 text-[#F2E9E4]"
                  disabled={blocking || !otherUserId}
                >
                  {blocked ? 'Unblock User' : (blocking ? 'Blocking…' : 'Block User')}
                </button>
                <button
                  onClick={handleClearChat}
                  disabled={togglingDisappearing}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[#29202D] mt-1 text-[#C24A6E]"
                >
                  Clear chat
                </button>
                <button
                  onClick={toggleDisappearing}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[#29202D] mt-1 text-[#F2E9E4]"
                  disabled={togglingDisappearing}
                >
                  {togglingDisappearing
                    ? 'Updating…'
                    : disappearing
                      ? 'Turn off 24-hour mode'
                      : 'Disappearing messages (24h)'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {searchActive && (
        <div className="mb-2 px-4 relative" style={{ animation: 'slideDown 0.2s ease-out' }}>
          <div className="flex items-center gap-2 relative">
            <svg
              className="w-4 h-4 text-[#B58A83]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search messages…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-[#1C1822] border border-[#34283F] rounded-xl px-3 py-2 text-sm text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A]"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1 text-[#B58A83] hover:text-[#F2E9E4]"
              >
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="mt-1 px-2 text-xs text-[#B58A83]">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {disappearing && (
        <div
          role="status"
          className="mb-3 px-4 rounded-xl border border-[#D4B18A]/40 bg-[#D4B18A]/10 p-2 text-center text-xs text-[#D4B18A]"
        >
          Disappearing messages on — everything here clears 24 hours after it is sent.
        </div>
      )}

      {blocked && (
        <div
          role="status"
          className="mb-3 px-4 rounded-xl border border-[#C24A6E]/40 bg-[#C24A6E]/10 p-2 text-center text-xs text-[#C24A6E]"
        >
          You blocked this member. The conversation is closed and you will not see each other again.
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3 pb-2 pr-2 px-4 scrollbar-hide">
        {messages.length === 0 && (
          <p className="text-center text-sm text-[#B58A83] mt-12">
            No messages yet. Say hello.
          </p>
        )}

        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId;
          const media = chatMedia[msg.id];
          const isPinned = pinnedMessageIds.has(msg.id);

          if (searchQuery.trim() && !msg.content.toLowerCase().includes(searchQuery.toLowerCase())) {
            return null;
          }

          if (media && isGone(media)) return null;

          return (
            <div key={msg.id} className="mb-2 relative w-full">
              <MessageBubble
                message={msg}
                media={media ?? null}
                isMe={isMe}
                currentUserId={currentUserId ?? null}
                isPinned={isPinned}
                searchQuery={searchQuery}
                onPinToggle={() => {
                  const next = new Set(pinnedMessageIds);
                  if (isPinned) next.delete(msg.id);
                  else next.add(msg.id);
                  setPinnedMessageIds(next);
                }}
                onReply={() => {}}
                onForward={() => {}}
                senderAvatar={!isMe ? senderAvatar : null}
              />
            </div>
          );
        })}
      </div>

      {pinnedMessageIds.size > 0 && (
        <div
          role="status"
          className="mt-2 px-4 rounded-xl border border-[#D4B18A]/50 bg-[#D4B18A]/20 p-2 text-xs text-[#D4B18A]"
        >
          {pinnedMessageIds.size} pinned message{pinnedMessageIds.size > 1 ? 's' : ''} in this conversation.
        </div>
      )}

      {restrictionMessage && (
        <div
          role="status"
          className="mb-3 px-4 rounded-xl border border-[#D4B18A]/50 bg-[#D4B18A]/20 p-3 text-xs text-[#D4B18A]"
        >
          {restrictionMessage}
        </div>
      )}

      {!blocked && requestPending && sendState?.requestedByMe && (
        <div
          role="status"
          className="mb-3 px-4 rounded-xl border border-[#D4B18A]/40 bg-[#D4B18A]/10 p-3 text-center text-xs text-[#D4B18A]"
        >
          Message request pending. You can send three messages until{' '}
          {conversationName} accepts.
          {remainingRequests !== null
            ? ` ${remainingRequests} ${
                remainingRequests === 1 ? 'message' : 'messages'
              } left.`
            : ''}
        </div>
      )}

      {!blocked && requestPending && sendState?.canRespond && (
        <div
          role="status"
          className="mb-3 px-4 rounded-xl border border-[#D4B18A]/40 bg-[#D4B18A]/10 p-3 text-xs text-[#D4B18A]"
        >
          <p className="mb-3 text-center">
            {conversationName} sent you a message request.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleRespond(true)}
              disabled={responding}
              className="flex-1 rounded-xl bg-[#D4B18A] px-3 py-2 font-semibold text-[#17121C] disabled:opacity-50"
            >
              {responding ? 'Saving…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => void handleRespond(false)}
              disabled={responding}
              className="flex-1 rounded-xl border border-[#D4B18A]/60 px-3 py-2 font-semibold text-[#F2E9E4] disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {!blocked && conversationClosed && (
        <div
          role="alert"
          className="mb-3 px-4 rounded-xl border border-[#34283F] bg-[#1C1822] p-3 text-center text-xs text-[#B58A83]"
        >
          This conversation is closed. You can read the history, but no new messages can be sent.
        </div>
      )}

      {!blocked && requestBlocked && (
        <div
          role="alert"
          className="mb-3 px-4 rounded-xl border border-[#C24A6E]/50 bg-[#C24A6E]/10 p-3 text-center text-xs text-[#C24A6E]"
        >
          You have sent {sendState?.sentCount ?? 0} messages. Wait for{' '}
          {conversationName} to accept your request before sending more.
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 px-4 text-center text-xs text-[#C24A6E]">
          {error}
        </p>
      )}

      <form onSubmit={sendMessage} className="flex gap-2 px-4 pb-4 shrink-0">
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          data-testid="chat-media-input"
          onChange={handleMediaPicked}
        />
        <button
          type="button"
          onClick={() => mediaInputRef.current?.click()}
          disabled={!canSend || sendingMedia}
          aria-label="Attach a photo or video"
          title="Attach a photo or video"
          className="p-2.5 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#29202D] shrink-0"
        >
          {sendingMedia ? '…' : '📎'}
        </button>
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={
            conversationClosed
              ? 'This conversation is closed'
              : requestBlocked
                ? 'Request limit reached — wait for acceptance'
                : canSend
                  ? 'Type a message...'
                  : 'Messaging is paused'
          }
          aria-label="Message"
          disabled={!canSend}
          className="flex-1 px-4 py-3 rounded-2xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] focus:outline-none focus:ring-1 focus:ring-[#D4B18A] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          className={`w-12 h-12 rounded-full bg-[#C24A6E] text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-lg hover:bg-[#B33E5E] transition`}
          aria-label="Send"
        >
          ➤
        </button>
      </form>

      <ReportModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        targetUserId={otherUserId ?? ''}
        targetType={reportTargetType}
        title={reportTargetType === 'chat' ? 'Report this conversation' : 'Report member'}
        onSubmitted={handleReported}
      />

      <ProfileStoryModal
        isOpen={storyOpen}
        onClose={() => setStoryOpen(false)}
        userId={otherUserId ?? ''}
        userName={conversationName}
        userUsername={conversationUsername ? conversationUsername.replace(/^@/, '') : null}
        avatarUrl={senderAvatar}
      />
    </div>
  );
}
