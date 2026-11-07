'use client';

import { useCallback, useEffect, useMemo, useRef, useState, use } from 'react';
import { X } from 'lucide-react';
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
  unsendMessage,
  deleteMessageForMe,
} from '@/lib/messages';
import { blockMember, unblockMember, BlockingError } from '@/lib/blocking';
import { pinMessage, unpinMessage, fetchPinnedMessages } from '@/lib/pins';
import {
  ConversationError,
  respondToConversationRequest,
} from '@/lib/conversations';
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
import { fetchPublicIdentities, type PublicIdentity } from '@/lib/public-profiles';
import { presenceManager } from '@/lib/presence';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';
import ProfileStoryModal from '@/components/chat/ProfileStoryModal';
import ChatHeader from '@/app/components/chat/ChatHeader';
import ChatComposer from '@/app/components/chat/ChatComposer';
import ChatMessageList from '@/app/components/chat/ChatMessageList';
import IncomingCallModal from '@/app/components/chat/IncomingCallModal';
import ActiveCallScreen from '@/app/components/chat/ActiveCallScreen';
import ForwardModal from '@/app/components/chat/ForwardModal';
import { useChatMessages } from '@/lib/use-chat-messages';
import { useTyping } from '@/lib/use-typing';
import type { ChatListItem } from '@/lib/chat-types';
import { useWebRTC } from '@/lib/use-webrtc';
import { useCallSignaling } from '@/lib/use-call-signaling';
import type { MessageRow } from '@/lib/types';

/** The 24-hour window offered by the disappearing-chat toggle. */
const DISAPPEARING_SECONDS = 86_400;

/** Derives a storage file extension from an audio MIME type. */
function extensionForAudioMime(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4' || base === 'audio/aac' || base === 'audio/m4a') return 'm4a';
  return 'webm';
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

  // Validate matchId is a UUID before any database queries.
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const validMatchId = uuidRegex.test(matchId);

  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherIdentity, setOtherIdentity] = useState<PublicIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [searchActive, setSearchActive] = useState(searchFromUrl);
  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportTargetType, setReportTargetType] = useState<'user' | 'chat'>('user');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardMessageContent, setForwardMessageContent] = useState('');
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);
  const [chatMedia, setChatMedia] = useState<ChatMediaByMessage>({});
  const [sendingMedia, setSendingMedia] = useState(false);
  const [disappearing, setDisappearing] = useState<number | null>(null);
  const [togglingDisappearing, setTogglingDisappearing] = useState(false);

  const [storyOpen, setStoryOpen] = useState(false);
  const [sendState, setSendState] = useState<ConversationSendState | null>(null);
  const [responding, setResponding] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; content: string; senderId: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; content: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const { language: preferredTranslationLanguage } =
    usePreferredTranslationLanguage();

  const currentUserIdRef = useRef<string | null>(null);
  const otherUserIdRef = useRef<string | null>(null);
  const callSignalingRef = useRef<ReturnType<typeof useCallSignaling> | null>(null);

  // --- WebRTC + Call Signaling ---
  const webrtc = useWebRTC((payload) => {
    callSignalingRef.current?.onSignal(payload);
  });
  const callSignaling = useCallSignaling(webrtc);

  // Keep ref in sync so the WebRTC callback can reach the signaling instance.
  useEffect(() => {
    callSignalingRef.current = callSignaling;
  }, [callSignaling]);

  const [incomingCall, setIncomingCall] = useState<{
    callerId: string;
    callerName: string;
    callerAvatar: string | null;
    callType: 'voice' | 'video';
    callId: string;
  } | null>(null);
  const [activeCall, setActiveCall] = useState(false);
  const [outgoingCallPending, setOutgoingCallPending] = useState(false);

  // Initialize call signaling when we know our identity
  useEffect(() => {
    if (currentUserId && otherUserId) {
      callSignalingRef.current?.subscribe(
        matchId,
        currentUserId,
        otherIdentity?.display_name ?? 'Member'
      );
    }
    return () => {
      callSignalingRef.current?.unsubscribe();
    };
  }, [currentUserId, otherUserId, matchId, otherIdentity?.display_name]);

  // Handle incoming call from signaling
  useEffect(() => {
    const c = callSignaling.call;
    if (c.state === 'ringing' && c.remoteUserId && c.callType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIncomingCall({
        callerId: c.remoteUserId,
        callerName: c.remoteUserName ?? 'Member',
        callerAvatar: otherIdentity?.avatar_url ?? null,
        callType: c.callType,
        callId: c.callId ?? '',
      });
    }
  }, [callSignaling.call, otherIdentity?.avatar_url]);

  // Outgoing call UI: once we've initiated (state -> connecting), show the active call screen.
  // The WebRTC offer is created by callSignaling.initiateCall().
  useEffect(() => {
    const c = callSignaling.call;
    if (c.state === 'connecting' && c.isInitiator && c.callType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveCall(true);
    }
  }, [callSignaling.call]);

  // Incoming call UI: once the WebRTC offer arrives (state -> ringing), show the active call screen.
  // The WebRTC answer is created by callSignaling.acceptCall().
  useEffect(() => {
    if (
      webrtc.state === 'ringing' &&
      callSignaling.call.callType &&
      !callSignaling.call.isInitiator
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveCall(true);
    }
  }, [webrtc.state, callSignaling.call]);

  // Hide outgoing call UI when the call is rejected, cancelled, or ended.
  useEffect(() => {
    const c = callSignaling.call;
    if (
      outgoingCallPending &&
      (c.state === 'rejected' || c.state === 'cancelled' || c.state === 'ended')
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOutgoingCallPending(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveCall(false);
    }
  }, [outgoingCallPending, callSignaling.call]);

  // Accept incoming call
  const handleAcceptCall = async () => {
    setIncomingCall(null);
    await callSignaling.acceptCall();
    // WebRTC answer is created once the offer arrives (see effect above).
  };

  // Reject incoming call
  const handleRejectCall = () => {
    setIncomingCall(null);
    setOutgoingCallPending(false);
    callSignaling.rejectCall();
  };

  // End active call
  const handleEndCall = () => {
    setActiveCall(false);
    setOutgoingCallPending(false);
    setIncomingCall(null);
    callSignaling.endCall();
  };

  // Initiate outgoing call
  const handleInitiateCall = async (callType: 'voice' | 'video') => {
    if (!otherUserId || !otherIdentity) return;
    setOutgoingCallPending(true);
    await callSignaling.initiateCall(
      otherUserId,
      otherIdentity?.display_name ?? 'Member',
      callType
    );
    // WebRTC offer is created only after the recipient accepts the invite
    // (see the effect below that watches callSignaling.call.state).
  };

  // --- Message handling via useChatMessages hook ---
  const {
    items: messageItems,
    loading: messagesLoading,
    error: messagesError,
    realtimeError: messagesRealtimeError,
    subscriptionStatus: messagesSubscriptionStatus,
    sendMessage: sendChatMessage,
    loadMore: loadMoreMessages,
    hasMore,
    refresh: refreshMessages,
  } = useChatMessages(matchId, otherIdentity
    ? { display_name: otherIdentity.display_name, avatar_url: otherIdentity.avatar_url }
    : null);

  const handleSaveEdit = async () => {
    if (!editingMessage || !currentUserId) return;
    const content = editDraft.trim();
    if (!content || content.length > 2000) {
      setError(content ? 'Messages must be 2000 characters or fewer.' : 'Message content cannot be empty.');
      return;
    }

    setSavingEdit(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from('messages')
        .update({ content, is_edited: true })
        .eq('id', editingMessage.id)
        .eq('sender_id', currentUserId)
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!data) throw new Error('You can only edit your own message.');

      await refreshMessages();
      setEditingMessage(null);
      setEditDraft('');
    } catch (editError) {
      console.error('[messages] edit failed:', editError);
      setError(editError instanceof Error ? editError.message : 'We could not edit that message.');
    } finally {
      setSavingEdit(false);
    }
  };

  // --- Typing indicators ---
  const typing = useTyping();
  const { subscribe: subscribeTyping, unsubscribe: unsubscribeTyping } = typing;
  const typingUserNames = useMemo(() => {
    return typing.typingUsers.map((uid) =>
      uid === otherUserId ? (otherIdentity?.display_name ?? 'Member') : 'Member'
    );
  }, [typing.typingUsers, otherUserId, otherIdentity?.display_name]);

  const startTyping = useCallback(() => {
    typing.startTyping();
  }, [typing]);

  const stopTyping = useCallback(() => {
    typing.stopTyping();
  }, [typing]);

  // Subscribe to typing indicators for this conversation.
  // `subscribe`/`unsubscribe` are stable callbacks, so depending on them (rather
  // than the whole `typing` object) prevents resubscribing whenever
  // `typingUsers` changes.
  useEffect(() => {
    if (currentUserId && otherUserId && matchId) {
      subscribeTyping(
        matchId,
        currentUserId,
        otherIdentity?.display_name ?? 'Member'
      );
    }
    return () => {
      unsubscribeTyping();
    };
  }, [currentUserId, otherUserId, matchId, otherIdentity?.display_name, subscribeTyping, unsubscribeTyping]);

  // --- Online/offline presence ---
  // Presence comes from the authoritative presence_sessions table via the
  // user_is_online RPC / PresenceManager. A user is online only while an
  // active, non-expired presence session exists (see PresenceHeartbeat).
  useEffect(() => {
    if (!otherUserId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOnline(null);
      return;
    }

    const unsub = presenceManager.subscribeToUser(otherUserId, (online) => {
      setIsOnline(online);
    });

    return () => {
      unsub();
    };
  }, [otherUserId]);

  // --- Init: load session, identity, settings ---
  const refreshMedia = useCallback(async () => {
    const map = await fetchChatMedia(matchId);
    setChatMedia(map);
  }, [matchId]);

  useEffect(() => {
    let isMounted = true;

    const applyOtherUserId = (id: string) => {
      otherUserIdRef.current = id;
      if (isMounted) setOtherUserId(id);
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
        .select('id, match_id, sender_id, content, created_at, is_edited, message_type, delivered_at, seen_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });

      if (!isMounted) return;

      if (fetchError) {
        console.error('Failed to load messages:', fetchError.message);
        setError('Could not load this conversation.');
        return;
      }

      const messagesData = (data ?? []) as MessageRow[];
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

    const unsubscribeMedia = subscribeToChatMedia(matchId, refreshMedia);

    return () => {
      isMounted = false;
      unsubscribeMedia();
    };
  }, [matchId, refreshMedia]);

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

  // --- Send text message ---
  const handleSendText = useCallback(
    async (text: string) => {
      const me = currentUserIdRef.current;
      if (!text || !me) return;

      setError(null);
      try {
        await sendChatMessage(text);
        setReplyTo(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Message could not be sent.');
      }
    },
    [sendChatMessage]
  );

  // --- Send voice note ---
  const voiceNoteSendingRef = useRef(false);

  const handleSendVoiceNote = useCallback(
    async (blob: Blob) => {
      const me = currentUserIdRef.current;
      if (!me || voiceNoteSendingRef.current) return;

      // Reject empty recordings before touching storage or the database.
      if (!blob || blob.size === 0) {
        setError('The voice note is empty and cannot be sent.');
        return;
      }

      voiceNoteSendingRef.current = true;
      setSendingMedia(true);
      setError(null);

      let storagePath: string | null = null;

      try {
        // 1. Upload the audio blob to the private chat-media bucket first.
        //    We upload before inserting so a failed upload never leaves an
        //    orphaned message row behind. The extension and content type are
        //    derived from the actual recorded MIME type, not hard-coded.
        const mime = blob.type || 'audio/webm';
        storagePath = `${matchId}/${me}/${crypto.randomUUID()}.${extensionForAudioMime(mime)}`;
        const { error: uploadError } = await supabase.storage
          .from('chat-media')
          .upload(storagePath, blob, {
            contentType: mime,
            upsert: false,
            cacheControl: '3600',
          });

        if (uploadError) throw uploadError;

        // 2. Call send_chat_media() which inserts the messages row and the
        //    chat_media ledger row in a single transaction. The database
        //    enforces sender ownership and match participation via RLS.
        const { error: rpcError } = await supabase.rpc('send_chat_media', {
          p_match_id: matchId,
          p_storage_path: storagePath,
          p_media_type: 'audio',
          p_view_limit: 2,
          p_ttl_seconds: 86400,
        });

        if (rpcError) throw rpcError;

        // 3. Refresh the media ledger so the new voice note appears in the UI.
        void fetchChatMedia(matchId).then((map) => setChatMedia(map));
      } catch (err) {
        // 4. Clean up the orphaned storage object if the RPC failed.
        if (storagePath) {
          await supabase.storage.from('chat-media').remove([storagePath]).catch(() => undefined);
        }
        setError(err instanceof Error ? err.message : 'Voice note could not be sent.');
      } finally {
        voiceNoteSendingRef.current = false;
        setSendingMedia(false);
      }
    },
    [matchId, currentUserIdRef.current]
  );

  // --- Send media (triggered by ChatComposer attachment picker) ---
  const handleAttachFiles = async (files: FileList) => {
    const me = currentUserIdRef.current;
    if (!files.length || !me) return;

    setSendingMedia(true);
    setError(null);

    try {
      const errors: string[] = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        try {
          await sendChatMedia(matchId, me, file);
        } catch (err) {
          const message =
            err instanceof ChatMediaError ? err.message : 'The media could not be sent.';
          errors.push(`${file.name}: ${message}`);
        }
      }

      if (errors.length > 0) {
        setError(errors.join(' '));
      } else {
        void fetchChatMedia(matchId).then((map) => setChatMedia(map));
        const nextState = await fetchConversationSendState(matchId);
        if (nextState) setSendState(nextState);
      }
    } finally {
      setSendingMedia(false);
    }
  };

  // --- Other handlers ---
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

  const handleUnblock = async () => {
    const target = otherUserIdRef.current;
    if (!target) return;

    setBlocking(true);
    setError(null);

    try {
      await unblockMember(target);
      setBlocked(false);
    } catch (err) {
      if (err instanceof BlockingError) {
        setError(err.message);
      } else {
        console.error('Unexpected error unblocking user:', err);
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

  const [menuOpen, setMenuOpen] = useState(false);

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

      await refreshMessages();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not clear this conversation.');
    } finally {
      setTogglingDisappearing(false);
    }
  };

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

  // Invalid matchId: render an error state instead of querying the database.
  if (!validMatchId) {
    return (
      <div className="flex flex-col h-screen max-w-md mx-auto p-0 bg-[#131017] text-[#F2E9E4]">
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <h2 className="text-sm font-semibold text-[#F2E9E4] mb-2">
            Invalid conversation
          </h2>
          <p className="text-xs text-[#B58A83] mb-4">
            This conversation does not exist.
          </p>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-xl bg-[#1C1822] border border-[#34283F] px-4 py-2 text-sm text-[#F2E9E4] hover:bg-[#29202D]"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-0 bg-[#131017] text-[#F2E9E4]">
      {/* Header */}
      <ChatHeader
        otherUserId={otherUserId}
        otherUserName={conversationName}
        otherUserUsername={conversationUsername}
        otherUserAvatar={senderAvatar}
        isOnline={isOnline}
        onVoiceCall={() => handleInitiateCall('voice')}
        onVideoCall={() => handleInitiateCall('video')}
        onBack={() => window.history.back()}
        onMore={() => setMenuOpen(!menuOpen)}
      />

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 mt-2 w-60 bg-[#1C1822] rounded-xl shadow-2xl border border-[#34283F] z-40">
            <div className="px-4 py-3 flex items-center justify-between border-b border-[#34283F] mb-3">
              <p className="text-xs font-semibold text-[#B58A83] uppercase tracking-wider">Conversation</p>
              <button
                onClick={() => setMenuOpen(false)}
                className="p-1 text-[#B58A83] hover:text-[#F2E9E4]"
                aria-label="Close menu"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
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
        </>
      )}

      {searchActive && (
        <div className="mb-2 px-4 relative">
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
          You blocked this member. The conversation is closed.
        </div>
      )}

      {/* Message list */}
      <ChatMessageList
        items={messageItems}
        currentUserId={currentUserId}
        otherUserId={otherUserId}
        otherUserName={conversationName}
        otherUserAvatar={senderAvatar}
        searchQuery={searchQuery}
        isLoading={messagesLoading}
        error={messagesError}
        onRetry={refreshMessages}
        pinnedMessageIds={pinnedMessageIds}
        onPinToggle={async (messageId) => {
          const wasPinned = pinnedMessageIds.has(messageId);
          if (wasPinned) {
            await unpinMessage(matchId, messageId);
          } else {
            await pinMessage(matchId, messageId);
          }
          setPinnedMessageIds((previous) => {
            const next = new Set(previous);
            if (wasPinned) next.delete(messageId);
            else next.add(messageId);
            return next;
          });
        }}
        onReply={(messageId) => {
          const msg = messageItems.find(
            (m): m is Extract<ChatListItem, { id: string }> =>
              !('type' in m) && m.id === messageId
          );
          if (msg) {
            setReplyTo({
              id: msg.id,
              content: msg.content,
              senderId: msg.senderId,
            });
          }
        }}
        onForward={(messageId) => {
          const msg = messageItems.find(
            (m): m is Extract<ChatListItem, { id: string }> =>
              !('type' in m) && m.id === messageId
          );
          if (msg) {
            setForwardMessageContent(msg.content);
            setForwardOpen(true);
          }
        }}
        onEdit={(messageId) => {
          const msg = messageItems.find(
            (item): item is Extract<ChatListItem, { id: string }> =>
              !('type' in item) && item.id === messageId
          );
          if (msg) {
            setEditingMessage({ id: msg.id, content: msg.content });
            setEditDraft(msg.content);
            setError(null);
          }
        }}
        onUnsend={async (messageId) => {
          await unsendMessage(messageId);
          await refreshMessages();
        }}
        onDeleteForMe={async (messageId) => {
          await deleteMessageForMe(messageId);
          await refreshMessages();
        }}
        typingUsers={typingUserNames}
      />

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
          <p className="mb-3 text-center">{conversationName} sent you a message request.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void respondToConversationRequest(matchId, true)}
              disabled={responding}
              className="flex-1 rounded-xl bg-[#D4B18A] px-3 py-2 font-semibold text-[#17121C] disabled:opacity-50"
            >
              {responding ? 'Saving…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={() => void respondToConversationRequest(matchId, false)}
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

      {messagesRealtimeError && messagesSubscriptionStatus !== 'SUBSCRIBED' && (
        <p role="status" className="mb-3 px-4 text-center text-xs text-[#B58A83]">
          Connection issue: {messagesRealtimeError}. Messages already loaded remain
          visible; we will reconnect automatically.
        </p>
      )}

      {/* Composer */}
      <ChatComposer
        disabled={!canSend || sendingMedia}
        onSend={handleSendText}
        onAttach={handleAttachFiles}
        onVoiceNote={handleSendVoiceNote}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        placeholder={
          conversationClosed
            ? 'This conversation is closed'
            : requestBlocked
              ? 'Request limit reached — wait for acceptance'
              : canSend
                ? 'Type a message...'
                : 'Messaging is paused'
        }
        voiceEnabled
      />

      {/* Call modals */}
      <IncomingCallModal
        isOpen={!!incomingCall || outgoingCallPending}
        onClose={() => {
          setIncomingCall(null);
          setOutgoingCallPending(false);
        }}
        onAccept={(callType) => {
          setIncomingCall(null);
          setActiveCall(true);
          void callSignaling.acceptCall();
        }}
        onReject={handleRejectCall}
        callerName={
          outgoingCallPending
            ? `Calling ${conversationName}…`
            : incomingCall?.callerName ?? 'Member'
        }
        callerAvatar={
          outgoingCallPending ? senderAvatar : incomingCall?.callerAvatar ?? null
        }
        callType={
          outgoingCallPending
            ? (callSignaling.call.callType ?? 'voice')
            : incomingCall?.callType ?? 'voice'
        }
        isIncoming={!outgoingCallPending && !!incomingCall}
        timeoutSeconds={outgoingCallPending ? 30 : 30}
      />

      <ActiveCallScreen
        isOpen={activeCall}
        onEnd={handleEndCall}
        onMute={webrtc.toggleMute}
        onCamera={webrtc.toggleCamera}
        onSpeaker={() => {}}
        callType={incomingCall?.callType ?? 'voice'}
        isMuted={webrtc.isMuted}
        isCameraOff={webrtc.isCameraOff}
        localStream={webrtc.localStream}
        remoteStream={webrtc.remoteStream}
        duration={webrtc.duration}
        state={webrtc.state}
        error={webrtc.error}
      />

      <ForwardModal
        isOpen={forwardOpen}
        onClose={() => {
          setForwardOpen(false);
          setForwardMessageContent('');
        }}
        messageContent={forwardMessageContent}
        currentUserId={currentUserId}
      />

      {editingMessage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!savingEdit) setEditingMessage(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-message-title"
            className="w-full max-w-sm rounded-2xl border border-[#34283F] bg-[#1C1822] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="edit-message-title" className="mb-3 text-sm font-semibold text-[#F2E9E4]">
              Edit message
            </h2>
            <textarea
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              maxLength={2000}
              rows={4}
              autoFocus
              className="w-full resize-none rounded-xl border border-[#34283F] bg-[#131017] p-3 text-sm text-[#F2E9E4] outline-none focus:border-[#D4B18A]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                disabled={savingEdit}
                className="rounded-xl border border-[#34283F] px-4 py-2 text-sm text-[#B58A83] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={savingEdit || !editDraft.trim()}
                className="rounded-xl bg-[#C24A6E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        matchId={matchId}
      />
    </div>
  );
}
