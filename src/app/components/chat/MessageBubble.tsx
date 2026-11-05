'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Copy,
  EyeOff,
  Languages,
  MessageCircle as ReplyIcon,
  Pin,
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
import TranslatableMessage from '@/app/components/chat/TranslatableMessage';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';
import EmojiText from '@/app/components/chat/EmojiText';
import { MessageRow } from '@/lib/types';
import ChatMediaMessage from '@/app/components/chat/ChatMediaMessage';
import { ChatMediaReport } from '@/app/components/chat/ChatMediaMessage';
import { type ChatMediaByMessage } from '@/lib/chatMedia';

interface MessageBubbleProps {
  message: MessageRow;
  media: ChatMediaByMessage[string] | null;
  isMe: boolean;
  currentUserId: string | null;
  isPinned: boolean;
  searchQuery?: string;
  onPinToggle?: () => void;
  onReply?: (message: MessageRow) => void;
}

function formatRelative(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  if (diffHours < 24) return `${diffHours}h ago`;
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
  return text.replace(regex, '<mark class="bg-amber-500/30 px-0.5 rounded">$1</mark>');
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
}: MessageBubbleProps) {
  const { language: preferredTranslationLanguage } =
    usePreferredTranslationLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [reactionBarOpen, setReactionBarOpen] = useState(false);
  const [reactionBarPos, setReactionBarPos] = useState({ x: 0, y: 0 });
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [translationState, setTranslationState] = useState<{
    original: string;
    translated: string | null;
    showing: 'original' | 'translated' | null;
    loading: boolean;
  } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const reactionBarRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const [menuMounted, setMenuMounted] = useState(false);
  const [reactionBarMounted, setReactionBarMounted] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showMenuRef = useRef(false);

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
    setTranslationState({
      original: message.content,
      translated: null,
      showing: null,
      loading: true,
    });
    closeMenu();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetLang = (user?.user_metadata?.locale ?? 'en').toLowerCase();
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
      setTranslationState((prev) => ({
        ...(prev ?? { original: message.content, translated: null, showing: null, loading: true }),
        translated: json.translated ?? json.text ?? null,
        showing: 'translated',
        loading: false,
      }));
    } catch (err) {
      console.error('[translate] failed:', err);
      setTranslationState((prev) => ({
        ...(prev ?? { original: message.content, translated: null, showing: null, loading: true }),
        showing: 'original',
        loading: false,
      }));
    }
  }, [message.content, closeMenu]);

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
    const textToShow =
      translationState && translationState.showing !== 'original'
        ? translationState.translated ?? message.content
        : message.content;
    const highlighted = highlightMatches(textToShow, searchQuery);
    return <EmojiText text={highlighted} size={16} />;
  }, [message.content, translationState, searchQuery]);

  return (
    <div
      ref={messageRef}
      className={`flex items-end gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(e) => openMenu(e, 'menu')}
      onDoubleClick={() => setReactionBarOpen((o) => !o)}
    >
      {isPinned && (
        <div
          style={{
            position: 'absolute',
            top: -18,
            left: isMe ? 'auto' : 0,
            right: isMe ? 0 : 'auto',
          }}
          className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold"
        >
          Pinned
        </div>
      )}
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
              {!isMe && <ChatMediaReport media={media} />}
              <ChatMediaMessage media={media} isOwn={isMe} />
            </>
          ) : (
            <div className="relative group">
              <div
                className={`p-3 rounded-2xl max-w-[75%] ${
                  isMe ? 'bg-rose-500 text-white' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {displayContent}
                {translationState && (
                  <div className="mt-1 flex items-center gap-2">
                    {translationState.loading ? (
                      <span className="text-[10px] text-neutral-400">Translating…</span>
                    ) : (
                      <>
                        <button
                          onClick={() =>
                            setTranslationState((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    showing:
                                      prev.showing === 'original'
                                        ? 'translated'
                                        : 'original',
                                  }
                                : null
                            )
                          }
                          className="text-[10px] underline hover:text-neutral-300"
                        >
                          {translationState.showing === 'original'
                            ? 'Translate'
                            : 'Show Original'
                        }
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className={`absolute top-0 ${isMe ? '-left-24' : '-right-24'} hidden group-hover:flex flex-col gap-1 bg-neutral-800 rounded p-1 text-xs`}>
                <button onClick={() => handleReply()} className="px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap">
                  Reply
                </button>
                <button onClick={handleCopy} className="px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap">
                  Copy
                </button>
                {!isMe && (
                  <button onClick={handleDeleteForMe} className="px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap">
                    Delete for Me
                  </button>
                )}
                {isMe && (
                  <button
                    onClick={handleUnsend}
                    disabled={!showUnsend}
                    className={`px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap text-rose-400 ${
                      !showUnsend ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    Unsend
                  </button>
                )}
                <button
                  onClick={handlePinToggle}
                  className={`px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap ${
                    isPinned ? 'text-amber-400' : ''
                  }`}
                >
                  {isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button onClick={handleTranslate} className="px-2 py-1 hover:bg-neutral-700 rounded text-left whitespace-nowrap">
                  <Languages size={14} strokeWidth={2} /> Translate
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

        {reactionCounts.size > 0 && (
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

        <span
          style={{
            fontSize: '10px',
            color: isMe ? '#F2E9E4' : '#B58A83',
            marginTop: '2px',
            alignSelf: isMe ? 'flex-end' : 'flex-start',
          }}
        >
          {formatRelative(message.created_at)}
        </span>
      </div>

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
          <div
            className="bg-neutral-800 rounded-lg shadow-lg border border-neutral-700"
            style={{ minWidth: '160px' }}
          >
            <button
              onClick={handleReply}
              className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700"
            >
              <ReplyIcon size={14} strokeWidth={2} /> Reply
            </button>
            <button
              onClick={handleCopy}
              className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700"
            >
              <Copy size={14} strokeWidth={2} /> Copy
            </button>
            {!isMe && (
              <button
                onClick={handleDeleteForMe}
                className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700"
              >
                <EyeOff size={14} strokeWidth={2} /> Delete for Me
              </button>
            )}
            {isMe && (
              <button
                onClick={handleUnsend}
                disabled={!showUnsend}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-700 ${
                  !showUnsend
                    ? 'opacity-50 cursor-not-allowed text-neutral-500'
                    : 'text-rose-400'
                }`}
              >
                <Trash2 size={14} strokeWidth={2} /> Unsend
              </button>
            )}
            <button
              onClick={handlePinToggle}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-700 ${
                isPinned ? 'text-amber-400' : ''
              }`}
            >
              <Pin size={14} strokeWidth={2} /> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button onClick={handleTranslate} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-700">
              <Languages size={14} strokeWidth={2} /> Translate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
