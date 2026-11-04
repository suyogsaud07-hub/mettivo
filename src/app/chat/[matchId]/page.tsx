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

/** The 24-hour window offered by the disappearing-chat toggle. */
const DISAPPEARING_SECONDS = 86_400;

/**
 * The browser's language, as an external store.
 *
 * Declared at module scope so the function identities are stable across
 * renders — `useSyncExternalStore` re-subscribes whenever `subscribe` changes
 * identity. No subscription is actually needed: `navigator.language` cannot
 * change without a page reload, so the only risk would be subscribing and never
 * unsubscribing, which this deliberately avoids.
 */
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
  // Next.js 16 passes `params` as a promise; `use()` unwraps it in a client
  // component without blocking the initial render.
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

  /**
   * The language this member wants incoming messages translated into.
   *
   * Only incoming bubbles get a translate control, so this is read here and
   * passed down rather than being fetched per message.
   */
  const { language: preferredTranslationLanguage } =
    usePreferredTranslationLanguage();

  /**
   * Best-effort hint for the language a message is written in.
   *
   * External, non-React state, so it is read with `useSyncExternalStore` rather
   * than `useEffect` + `setState` — the pattern CODING_STANDARDS §2 mandates,
   * and the only one that is hydration-safe here: the SERVER snapshot is `null`
   * ("let the provider detect it") while the client snapshot is the browser's
   * language. Reading `navigator` during render would produce different markup
   * on the server and the client.
   *
   * The value feeds an on-demand request only — it is never part of the first
   * paint — so no subscription is needed for it to stay correct; the language
   * cannot change without a reload.
   */
  const sourceLanguageHint = useSyncExternalStore(
    subscribeToBrowserLanguage,
    getBrowserLanguageSnapshot,
    () => null
  );

  /**
   * Stable references to the identities the realtime handler needs.
   *
   * The subscription effect may only depend on `matchId`: if it depended on
   * `currentUserId`/`otherUserId` — which the effect itself sets — every message
   * that resolved `otherUserId` would tear the channel down and rebuild it, and
   * the fresh `init()` would overwrite `messages` with the first fetch, erasing
   * realtime additions. Refs keep the handler current without re-subscribing.
   */
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

      // M21: a banned or suspended member can read but not compose. The
      // database enforces this too (a BEFORE INSERT trigger); the notice just
      // explains the disabled composer instead of letting a send silently fail.
      const myRestrictions = await fetchMyRestrictions();
      if (isMounted) setRestrictions(myRestrictions);

      // M38: request state and the three-message cap are enforced by a
      // BEFORE INSERT trigger. This projection only lets the composer and the
      // accept/decline banner explain it in advance.
      const requestState = await fetchConversationSendState(matchId);
      if (isMounted) setSendState(requestState);

      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at, delivered_at, seen_at')
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

      // The media ledger is fetched alongside the thread. A media message has an
      // empty `content`, so without this the bubble would render blank.
      const mediaMap = await fetchChatMedia(matchId);
      if (isMounted) setChatMedia(mediaMap);

      // M26: the retention setting drives the header toggle and banner.
      const window = await fetchChatSettings(matchId);
      if (isMounted) setDisappearing(window);

      const mute = await fetchConversationMute(matchId);
      if (isMounted) setMuted(mute);

      const pinned = await fetchPinnedMessages(matchId);
      if (isMounted) setPinnedMessageIds(new Set(pinned));

      // M11: opening a thread reads it. The badge is computed server-side from
      // `last_read_at`, so it must be stamped here or the count never clears.
      // M26: the same call stamps the "seen" receipts on incoming messages.
      markConversationRead(matchId).catch(() => undefined);

      // Best-effort: acknowledge delivery and sweep anything that has aged out
      // of a disappearing window. RLS already hides expired rows, so neither can
      // fail visibly.
      void markMessagesDelivered(matchId);
      void purgeExpiredChatContent();

      if (!user) return;

      // Resolve the other participant. Prefer the messages we already have, but
      // fall back to the match row so a brand-new, empty conversation still has
      // a report/block target (otherwise Report is disabled and Block is a no-op).
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
          // De-dupe: the sender appends locally on a successful insert, so the
          // same row can arrive twice (once from the send, once from realtime).
          setMessages((prev) =>
            prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
          );

          // A media message arrives as an empty-content row; pull its ledger
          // entry so the bubble can render and be opened.
          if (inserted.content === '') refreshMedia();

          if (!otherUserIdRef.current && inserted.sender_id !== currentUserIdRef.current) {
            applyOtherUserId(inserted.sender_id);
          }

          // An incoming message while the thread is open is delivered at once,
          // and — because the member is looking at it — seen as well.
          if (inserted.sender_id !== currentUserIdRef.current) {
            void markMessagesDelivered(matchId);
            markConversationRead(matchId).catch(() => undefined);
            // A recipient reply auto-accepts a pending request; refresh so the
            // composer unlocks without a reload.
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
          // Receipt timestamps land here; merge them into the existing bubble so
          // the ticks flip from delivered to seen live.
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    // An item the recipient exhausts must vanish on the sender's screen too.
    const unsubscribeMedia = subscribeToChatMedia(matchId, refreshMedia);

    return () => {
      isMounted = false;
      unsubscribeMedia();
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  // The header shows the other member's public identity (name and @handle),
  // never their private profile fields. Read through the allow-listed view.
  useEffect(() => {
    if (!otherUserId) return;

    let cancelled = false;

    fetchPublicIdentities([otherUserId])
      .then((identities) => {
        if (!cancelled) setOtherIdentity(identities.get(otherUserId) ?? null);
      })
      .catch((identityError: unknown) => {
        // The thread remains usable without a header name; do not block it.
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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    const content = newMessage.trim();
    const me = currentUserIdRef.current;
    if (!content || !me) return;

    // `.select().single()` returns the stored row so it can be shown at once,
    // independently of whether Realtime is enabled for `messages`. The realtime
    // INSERT de-dupes by id, so there is no double bubble either way.
    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        match_id: matchId,
        sender_id: me,
        content,
      })
      .select('id, match_id, sender_id, content, created_at, delivered_at, seen_at')
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
    // Snapshot BEFORE clearing: emptying `value` clears the live FileList.
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    const picked = files[0];
    const me = currentUserIdRef.current;
    if (!picked || !me) return;

    setSendingMedia(true);
    setError(null);
    try {
      // Every chat item is a strict 2-view; videos are capped at 10s by
      // `prepareMedia`, which rejects a longer clip before anything uploads.
      const sent = await sendChatMedia(matchId, me, picked);
      const now = new Date();
      const messageRow: MessageRow = {
        id: sent.messageId,
        match_id: matchId,
        sender_id: me,
        content: '',
        created_at: now.toISOString(),
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
      // `blockMember` records the block AND severs the match in one transaction.
      // Inserting straight into `blocked_users` skipped that severing, leaving a
      // dead conversation that still listed the member.
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
      // Enabling the mode retires anything already older than the window.
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

      // Fetch every message id in the conversation (not just the loaded page).
      const { data: allMessages, error: fetchError } = await supabase
        .from('messages')
        .select('id')
        .eq('match_id', matchId);

      if (fetchError) throw fetchError;

      // Insert a deletion record for each message, idempotently.
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

  // Client-side search over currently loaded messages, derived reactively.
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

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-4 bg-neutral-950 text-white">
      {/* Header with back button, the other member's public identity and menu */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          onClick={() => window.history.back()}
          className="px-3 py-1 rounded text-sm bg-neutral-800 hover:bg-neutral-700 shrink-0"
        >
          ← Back
        </button>
        <div className="min-w-0 flex-1 text-center">
          {otherUserId ? (
            <Link href={`/profile/${otherUserId}`} className="block">
              <p className="truncate text-sm font-semibold text-neutral-100 hover:underline">
                {conversationName}
              </p>
              {conversationUsername ? (
                <p className="truncate text-xs text-amber-200/80">{conversationUsername}</p>
              ) : null}
            </Link>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-neutral-100">
                {conversationName}
              </p>
              {conversationUsername ? (
                <p className="truncate text-xs text-amber-200/80">{conversationUsername}</p>
              ) : null}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 relative shrink-0">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded bg-neutral-800 hover:bg-neutral-700"
            aria-label="Conversation options"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          {/* Conversation options menu */}
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-neutral-800 rounded-lg shadow-lg border border-neutral-700 z-10">
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-neutral-100 mb-2">Conversation</p>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/chat/${matchId}/info`);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700"
                >
                  View contact
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/chat/${matchId}?search=1`);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1"
                >
                  Search
                </button>
                <button
                  onClick={handleToggleMute}
                  disabled={muted === null || togglingDisappearing}
                  className={`w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1 ${muted === null || togglingDisappearing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {muted ? 'Unmute notifications' : 'Mute notifications'}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportTargetType('user');
                    setReportOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1"
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
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1"
                  disabled={!otherUserId}
                >
                  Report Conversation
                </button>
                <button
                  onClick={blocked ? handleUnblock : handleBlock}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1"
                  disabled={blocking || !otherUserId}
                >
                  {blocked ? 'Unblock User' : (blocking ? 'Blocking…' : 'Block User')}
                </button>
                <button
                  onClick={handleClearChat}
                  disabled={togglingDisappearing}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1 text-rose-400"
                >
                  Clear chat
                </button>
                <button
                  onClick={toggleDisappearing}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-700 mt-1"
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
        <div
          className="mb-2 relative"
          style={{
            animation: 'slideDown 0.2s ease-out',
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              position: 'relative',
            }}
          >
            <svg
              className="w-4 h-4 text-neutral-400"
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
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                }}
                className="p-1 text-neutral-400 hover:text-neutral-200"
              >
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <div
              className="mt-1 px-2 text-xs text-neutral-400"
            >
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {disappearing && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-amber-700/40 bg-amber-950/30 p-2 text-center text-xs text-amber-200"
        >
          Disappearing messages on — everything here clears 24 hours after it is sent.
        </div>
      )}

      {blocked && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-rose-800/50 bg-rose-950/30 p-2 text-center text-xs text-rose-200"
        >
          You blocked this member. The conversation is closed and you will not see each other again.
        </div>
      )}

      {/* Scrollable message list. This container both makes the list scroll and
          balances the closing </div> below; without it the root element closed
          early and the JSX failed to parse. */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
        {messages.length === 0 && (
          <p className="text-center text-sm text-neutral-500 mt-8">
            No messages yet. Say hello.
          </p>
        )}

        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId;
          const media = chatMedia[msg.id];
          const isPinned = pinnedMessageIds.has(msg.id);

          // When searching, skip non-matching messages.
          if (searchQuery.trim() && !msg.content.toLowerCase().includes(searchQuery.toLowerCase())) {
            return null;
          }

          // An exhausted or expired item is gone for BOTH members, exactly as if
          // it had never been sent.
          if (media && isGone(media)) return null;

          return (
            <div key={msg.id} className="mb-2 relative">
              <MessageBubble
                message={msg}
                media={media ?? null}
                isMe={isMe}
                currentUserId={currentUserId ?? null}
                searchQuery={searchQuery}
                isPinned={isPinned}
                onPinToggle={() => {
                  const next = new Set(pinnedMessageIds);
                  if (isPinned) next.delete(msg.id);
                  else next.add(msg.id);
                  setPinnedMessageIds(next);
                }}
              />
            </div>
          );
        })}
      </div>

      {pinnedMessageIds.size > 0 && (
        <div
          role="status"
          className="mt-2 rounded-xl border border-amber-700/50 bg-amber-950/40 p-2 text-xs text-amber-200"
        >
          {pinnedMessageIds.size} pinned message{pinnedMessageIds.size > 1 ? 's' : ''} in this conversation.
        </div>
      )}

      {restrictionMessage && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-xs text-amber-200"
        >
          {restrictionMessage}
        </div>
      )}

      {!blocked && requestPending && sendState?.requestedByMe && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-center text-xs text-amber-200"
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
          className="mb-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200"
        >
          <p className="mb-3 text-center">
            {conversationName} sent you a message request.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleRespond(true)}
              disabled={responding}
              className="flex-1 rounded-lg bg-amber-400 px-3 py-2 font-semibold text-neutral-950 disabled:opacity-50"
            >
              {responding ? 'Saving…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => void handleRespond(false)}
              disabled={responding}
              className="flex-1 rounded-lg border border-amber-700/60 px-3 py-2 font-semibold text-amber-100 disabled:opacity-50"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {!blocked && conversationClosed && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-center text-xs text-neutral-300"
        >
          This conversation is closed. You can read the history, but no new
          messages can be sent.
        </div>
      )}

      {!blocked && requestBlocked && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-rose-800/50 bg-rose-950/30 p-3 text-center text-xs text-rose-200"
        >
          You have sent {sendState?.sentCount ?? 0} messages. Wait for{' '}
          {conversationName} to accept your request before sending more.
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-center text-xs text-rose-400">
          {error}
        </p>
      )}

      <form onSubmit={sendMessage} className="flex gap-2">
        {/* Disappearing media: a paperclip opens the picker. Photos and clips are
            always a strict 2-view and vanish after the recipient's second open;
            the database, not this UI, enforces it. */}
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
          aria-label="Attach a 2-view photo or video"
          title="Attach a 2-view photo or video (max 10s)"
          className="px-3 py-3 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 disabled:opacity-50"
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
          className="flex-1 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-white focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="px-5 py-3 bg-rose-500 font-semibold rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>

      {/* Report dialog — shared with every other surface. */}
      <ReportModal
        isOpen={reportOpen}
        onClose={() => setReportOpen(false)}
        targetUserId={otherUserId ?? ''}
        targetType={reportTargetType}
        title={reportTargetType === 'chat' ? 'Report this conversation' : 'Report member'}
        onSubmitted={handleReported}
      />
    </div>
  );
}
