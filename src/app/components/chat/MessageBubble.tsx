'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeftRight,
  Copy,
  EyeOff,
  MessageCircle as ReplyIcon,
  Pin,
  Share2 as ForwardIcon,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  addMessageReaction,
  fetchMessageReactions,
  removeMessageReaction,
  subscribeToMessageReactions,
  type MessageReaction,
} from '@/lib/reactions';
import { unsendMessage } from '@/lib/messages';
import { pinMessage, unpinMessage, fetchPinnedMessages } from '@/lib/pins';
import ReactionBar from '@/app/components/chat/ReactionBar';
import ReactionPill from '@/app/components/chat/ReactionPill';
import MessageStatus from '@/app/components/chat/MessageStatus';
import { formatMessageTime } from '@/lib/chat-tokens';
import { type ChatMediaRow, type MessageRow } from '@/lib/types';

interface MessageBubbleProps {
  message: MessageRow;
  media: ChatMediaRow | null;
  isMe: boolean;
  currentUserId: string | null;
  isPinned: boolean;
  searchQuery?: string;
  onPinToggle?: () => void;
  onReply?: (message: MessageRow) => void;
  onForward?: (message: MessageRow) => void;
  /** Show sender avatar on received messages. */
  showAvatar?: boolean;
  /** Whether this is the first message from this sender in a group. */
  isGroupStart?: boolean;
  /** Whether the previous message is from the same sender. */
  isGrouped?: boolean;
  /** Sender's avatar URL (for received messages). */
  senderAvatar?: string | null;
  /** Sender's display name (shown on group start). */
  senderName?: string | null;
}

const ROSE = '#C24A6E';
const ROSE_HOVER = '#B33E5E';
const SURFACE = '#1C1822';
const BORDER = '#34283F';
const TEXT = '#F2E9E4';
const MUTED = '#B58A83';
const ACCENT = '#D4B18A';

function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  if (diffHours < 24) return `${diffHours}h`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (
    date.getTime() >= startOfYesterday.getTime() &&
    date.getTime() < startOfToday.getTime()
  ) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function canUnsend(message: MessageRow, currentUserId: string | null): boolean {
  if (!currentUserId || message.sender_id !== currentUserId) return false;
  const sent = new Date(message.created_at).getTime();
  if (Number.isNaN(sent)) return false;
  return Date.now() - sent < 10 * 60 * 1000;
}

function highlightMatches(text: string, query?: string): string {
  if (!query?.trim()) return text;
  const q = query.trim();
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<mark class="bg-[#D4B18A]/30 px-0.5 rounded">$1</mark>');
}

export default function MessageBubble({
  message,
  media,
  isMe,
  currentUserId,
  isPinned,
  searchQuery,
  onPinToggle,
  onReply,
  onForward,
  showAvatar = true,
  isGroupStart = true,
  isGrouped = false,
  senderAvatar = null,
  senderName = null,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [reactionBarPos, setReactionBarPos] = useState({ x: 0, y: 0 });
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [isTranslated, setIsTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactionBarRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const [menuMounted, setMenuMounted] = useState(false);
  const [reactionBarMounted, setReactionBarMounted] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMenuRef = useRef(false);

  const messageType = message.message_type ?? 'text';
  const isCallLog = messageType === 'video_call' || messageType === 'audio_call';

  useEffect(() => {
    let cancelled = false;
    fetchMessageReactions([message.id]).then((map) => {
      if (!cancelled) setReactions(map.get(message.id) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [message.id]);

  useEffect(() => {
    setMenuMounted(!!menuRef.current);
    setReactionBarMounted(!!reactionBarRef.current);
  }, [menuRef, reactionBarRef]);

  useEffect(() => {
    const unsub = subscribeToMessageReactions(
      message.match_id,
      message.id,
      () => {
        fetchMessageReactions([message.id]).then((map) => {
          setReactions(map.get(message.id) ?? []);
        });
      }
    );
    return () => unsub();
  }, [message.match_id, message.id]);

  // Resolve a signed URL for private-bucket audio so the <audio> element can
  // play it. Regenerated when the media row changes.
  useEffect(() => {
    let cancelled = false;

    if (!(media?.media_type === 'audio' && media.storage_path)) {
      return;
    }

    (async () => {
      const { data, error } = await supabase.storage
        .from('chat-media')
        .createSignedUrl(media.storage_path, 300);
      if (!cancelled && !error && data?.signedUrl) {
        setAudioUrl(data.signedUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [media]);

  const myEmojis = useMemo(
    () =>
      reactions
        .filter((r) => r.userId === currentUserId)
        .map((r) => r.emoji),
    [reactions, currentUserId]
  );

  const reactionCounts = useMemo(() => {
    const counts = new Map<string, { count: number; mine: boolean }>();
    for (const r of reactions) {
      const cur = counts.get(r.emoji) ?? { count: 0, mine: false };
      counts.set(r.emoji, {
        count: cur.count + 1,
        mine: cur.mine || r.userId === currentUserId,
      });
    }
    return counts;
  }, [reactions, currentUserId]);

  const openMenu = useCallback(
    (e: React.MouseEvent | TouchEvent, kind: 'menu' | 'reaction') => {
      e.preventDefault();
      e.stopPropagation();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const pos = { x: clientX, y: clientY };
      if (kind === 'menu') {
        setMenuPos(pos);
        setMenuOpen(true);
      } else {
        setReactionBarPos({ x: clientX, y: clientY - 8 });
        setReactionBarOpen(true);
      }
    },
    []
  );

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setReactionBarOpen(false);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch (err) {
      console.error('[copy] failed:', err);
    } finally {
      closeMenu();
    }
  }, [message.content, closeMenu]);

  const handleForward = useCallback(() => {
    closeMenu();
    if (onForward) onForward(message);
  }, [message, closeMenu, onForward]);

  const handleDeleteForMe = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      closeMenu();
      return;
    }
    try {
      await supabase
        .from('message_deletions')
        .insert({ message_id: message.id, user_id: user.id });
    } catch (err) {
      console.error('[delete for me] failed:', err);
    } finally {
      closeMenu();
    }
  }, [message.id, closeMenu]);

  const handleUnsend = useCallback(async () => {
    try {
      await unsendMessage(message.id);
    } catch (err) {
      console.error('[unsend] failed:', err);
    } finally {
      closeMenu();
    }
  }, [message.id, closeMenu]);

  const handlePinToggle = useCallback(async () => {
    if (!currentUserId) return;
    try {
      if (isPinned) {
        await unpinMessage(message.match_id, message.id);
      } else {
        await pinMessage(message.match_id, message.id);
      }
      onPinToggle?.();
    } catch (err) {
      console.error('[pin] toggle failed:', err);
    } finally {
      closeMenu();
    }
  }, [message.match_id, message.id, isPinned, currentUserId, onPinToggle, closeMenu]);

  const handleReply = useCallback(() => {
    closeMenu();
    if (onReply) onReply(message);
  }, [message, closeMenu, onReply]);

  const handleTranslate = useCallback(async () => {
    // Revert instantly without an API call when already translated.
    if (isTranslated) {
      setIsTranslated(false);
      return;
    }
    if (translationLoading) return;
    setTranslationLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetLang =
        (user?.user_metadata?.preferred_language ??
          user?.user_metadata?.locale ??
          'en').toLowerCase();
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message.content,
          targetLanguage: targetLang,
        }),
      });
      if (!res.ok) throw new Error('Translation failed');
      const json = await res.json();
      setTranslatedText(
        json.translatedText ?? json.translated ?? json.text ?? null,
      );
      setIsTranslated(true);
    } catch (err) {
      console.error('[translate] failed:', err);
    } finally {
      setTranslationLoading(false);
    }
  }, [message.content, isTranslated, translationLoading]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      showMenuRef.current = true;
      pressTimer.current = setTimeout(() => {
        if (showMenuRef.current) {
          openMenu(e as unknown as React.MouseEvent, 'reaction');
        }
      }, 500);
    },
    [openMenu]
  );

  const onPointerUp = useCallback(() => {
    showMenuRef.current = false;
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  const onPointerLeave = useCallback(() => {
    showMenuRef.current = false;
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeMenu]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inMenu = menuRef.current && menuRef.current.contains(target);
      const inReactionBar =
        reactionBarRef.current && reactionBarRef.current.contains(target);
      const inMessage = messageRef.current && messageRef.current.contains(target);
      if (!inMenu && !inReactionBar && !inMessage) {
        closeMenu();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [closeMenu]);

  const showUnsend = canUnsend(message, currentUserId);

  const displayContent = useMemo(() => {
    const textToShow = isTranslated
      ? (translatedText ?? message.content)
      : message.content;
    const highlighted = highlightMatches(textToShow, searchQuery);
    return <div
      className="prose-sm prose-invert max-w-none text-[14px] leading-relaxed break-words whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />;
  }, [message.content, isTranslated, translatedText, searchQuery]);

  const callLabel = (): string => {
    if (messageType === 'video_call') return 'Missed video call';
    if (messageType === 'audio_call') return message.content || 'Audio call';
    return '';
  };

  const bubbleClass = isMe
    ? `bg-[#C24A6E] text-white rounded-2xl rounded-tr-sm p-3`
    : `bg-[#1C1822] text-[#F2E9E4] border border-[#34283F] rounded-2xl rounded-tl-sm p-3`;

  const containerClass = `flex items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`;

  return (
    <div
      ref={messageRef}
      className={`mb-2 ${containerClass} w-full`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => openMenu(e, 'menu')}
      onDoubleClick={() => setReactionBarOpen((o) => !o)}
    >
      {/* Call log — centered system message */}
      {isCallLog && !isMe ? (
        <div className="flex flex-col items-center justify-center my-4 w-full">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1C1822] border border-[#34283F] shadow-sm">
            {messageType === 'video_call' ? (
              <div className="w-5 h-5 rounded-full bg-[#EF4444]/15 text-[#EF4444] flex items-center justify-center text-xs">
                📹
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-[#10B981]/15 text-[#10B981] flex items-center justify-center text-xs">
                📞
              </div>
            )}
            <span className="text-xs font-medium text-[#F2E9E4]">{callLabel()}</span>
            <span className="text-[10px] text-[#6B5B79] ml-1">{formatRelative(message.created_at)}</span>
          </div>
        </div>
      ) : null}

      {!isCallLog && (
        <>
          {/* Received message: avatar on the left */}
          {!isMe && showAvatar && senderAvatar && isGroupStart ? (
            <img
              src={senderAvatar}
              alt=""
              className="w-6 h-6 rounded-full border border-[#34283F] object-cover shrink-0 flex-shrink-0"
              style={{ width: 24, height: 24 }}
              aria-hidden
            />
          ) : null}

          <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
            {reactionBarOpen && reactionBarMounted ? (
              <div
                ref={reactionBarRef}
                style={{
                  position: 'fixed',
                  left: reactionBarPos.x,
                  top: reactionBarPos.y,
                  zIndex: 50,
                }}
              >
                <ReactionBar
                  messageId={message.id}
                  myReactions={myEmojis}
                  onClose={() => setReactionBarOpen(false)}
                  x={reactionBarPos.x}
                  y={reactionBarPos.y}
                />
              </div>
            ) : null}

            <div className="relative group">
              {media ? (
                <>
                  {media.media_type === 'audio' ? (
                    <div className={bubbleClass}>
                      {audioUrl ? (
                        <audio
                          src={audioUrl}
                          controls
                          preload="none"
                          className="w-full"
                        />
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 text-[#B58A83] text-xs">
                          🔊 Loading audio…
                        </div>
                      )}
                    </div>
                  ) : media.media_type === 'video' ? (
                    <div className={bubbleClass}>
                      🎬
                      <span className="ml-1 text-xs">{isMe ? 'Your media' : 'Photo or video'}</span>
                    </div>
                  ) : (
                    <div className={bubbleClass}>
                      🖼️
                      <span className="ml-1 text-xs">{isMe ? 'Your media' : 'Photo or video'}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="relative group">
                  <div className={bubbleClass}>
                    {isGroupStart && senderName && !isMe ? (
                      <span className="text-[10px] text-[#D4B18A]/70 font-medium mb-1 block">
                        {senderName}
                      </span>
                    ) : null}
                    {displayContent}
                  </div>
                  <div
                    className={`absolute top-0 ${isMe ? '-left-24' : '-right-24'} hidden group-hover:flex flex-col gap-1 bg-[#1C1822] rounded p-1 text-xs border border-[#34283F]`}
                  >
                    <button onClick={() => handleReply()} className="px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4]">
                      Reply
                    </button>
                    <button onClick={handleForward} className="px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4]">
                      Forward
                    </button>
                    <button onClick={handleCopy} className="px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4]">
                      Copy
                    </button>
                    {!isMe && (
                      <button onClick={handleDeleteForMe} className="px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4]">
                        Delete for Me
                      </button>
                    )}
                    {isMe && (
                      <button
                        onClick={handleUnsend}
                        disabled={!showUnsend}
                        className={`px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4] ${!showUnsend ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        Unsend
                      </button>
                    )}
                    <button
                      onClick={handlePinToggle}
                      className={`px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4] ${isPinned ? 'text-[#D4B18A]' : ''}`}
                    >
                      {isPinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button onClick={handleTranslate} className="px-2 py-1 hover:bg-[#34283F] rounded text-left whitespace-nowrap text-[#F2E9E4] flex items-center gap-1">
                      <ArrowLeftRight size={14} strokeWidth={2} /> Translate
                    </button>
                  </div>
                </div>
              )}
              {isMe && !media && (
                <MessageStatus
                  deliveredAt={message.delivered_at ?? null}
                  seenAt={message.seen_at ?? null}
                  className="mt-0.5 pr-1"
                />
              )}
            </div>

            {reactionCounts.size > 0 && !isGrouped && (
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  marginTop: '2px',
                  marginLeft: isMe ? 'auto' : 0,
                }}
              >
                {[...reactionCounts.entries()].map(([emoji, info]) => (
                  <ReactionPill
                    key={emoji}
                    messageId={message.id}
                    emoji={emoji}
                    count={info.count}
                    mine={info.mine}
                    onToggle={() => {
                      fetchMessageReactions([message.id]).then((map) => {
                        setReactions(map.get(message.id) ?? []);
                      });
                    }}
                  />
                ))}
              </div>
            )}

            {!isGrouped && messageType === 'text' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  marginTop: '2px',
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    color: isMe ? '#F2E9E4' : '#B58A83',
                  }}
                >
                  {formatRelative(message.created_at)}
                </span>
                <button
                  type="button"
                  onClick={handleTranslate}
                  disabled={translationLoading}
                  aria-label={isTranslated ? 'Show original' : 'Translate message'}
                  title={isTranslated ? 'Show original' : 'Translate'}
                  className={`p-1 rounded flex items-center justify-center transition-colors ${isTranslated ? 'bg-[#D4B18A] text-black' : 'bg-blue-600 text-white'}`}
                >
                  <ArrowLeftRight size={12} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>

          {/* Sent message: avatar on the right */}
          {isMe && showAvatar && senderAvatar && isGroupStart ? (
            <img
              src={senderAvatar}
              alt=""
              className="w-6 h-6 rounded-full border border-[#34283F] object-cover shrink-0 flex-shrink-0"
              style={{ width: 24, height: 24 }}
              aria-hidden
            />
          ) : null}
        </>
      )}

      {menuOpen && menuMounted && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: menuPos.x,
            top: menuPos.y,
            zIndex: 60,
          }}
        >
          <div className="bg-[#1C1822] rounded-lg shadow-xl border border-[#34283F]" style={{ minWidth: '170px' }}>
            {onReply && (
              <button
                onClick={handleReply}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2"
              >
                <ReplyIcon size={14} strokeWidth={2} /> Reply
              </button>
            )}
            {onForward && (
              <button
                onClick={handleForward}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2"
              >
                <ForwardIcon size={14} strokeWidth={2} /> Forward
              </button>
            )}
            <button
              onClick={handleCopy}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2"
            >
              <Copy size={14} strokeWidth={2} /> Copy
            </button>
            {!isMe && (
              <button
                onClick={handleDeleteForMe}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2"
              >
                <EyeOff size={14} strokeWidth={2} /> Delete for Me
              </button>
            )}
            {isMe && (
              <button
                onClick={handleUnsend}
                disabled={!showUnsend}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] flex items-center gap-2 ${
                  !showUnsend
                    ? 'opacity-50 cursor-not-allowed text-[#6B5B79]'
                    : 'text-[#C24A6E]'
                }`}
              >
                <Trash2 size={14} strokeWidth={2} /> Unsend
              </button>
            )}
            <button
              onClick={handlePinToggle}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2 ${isPinned ? 'text-[#D4B18A]' : ''}`}
            >
              <Pin size={14} strokeWidth={2} /> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button onClick={handleTranslate} className="w-full text-left px-3 py-2 text-sm hover:bg-[#34283F] text-[#F2E9E4] flex items-center gap-2">
              <ArrowLeftRight size={14} strokeWidth={2} /> Translate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
