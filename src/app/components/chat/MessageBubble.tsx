'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeftRight,
  Copy,
  EyeOff,
  Forward,
  Languages,
  Pencil,
  Pin,
  Reply,
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
import MessageStatus from '@/app/components/chat/MessageStatus';
import ReactionPill from '@/app/components/chat/ReactionPill';
import { type ChatMediaRow, type MessageRow } from '@/lib/types';

interface MessageBubbleProps {
  message: MessageRow;
  media: ChatMediaRow | null;
  isMe: boolean;
  currentUserId: string | null;
  isPinned: boolean;
  searchQuery?: string;
  onPinToggle?: () => void | Promise<void>;
  onReply?: (message: MessageRow) => void;
  onForward?: (message: MessageRow) => void;
  onEdit?: (message: MessageRow) => void;
  onUnsend?: (message: MessageRow) => Promise<void>;
  onDeleteForMe?: (message: MessageRow) => Promise<void>;
  showAvatar?: boolean;
  isGroupStart?: boolean;
  senderAvatar?: string | null;
  senderName?: string | null;
}

const QUICK_REACTIONS = ['❤️', '😂', '😭', '👍', '😡', '🤔'] as const;
const LONG_PRESS_MS = 500;
const MENU_WIDTH = 260;
const MENU_HEIGHT = 350;

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
  if (date.getTime() >= startOfYesterday.getTime() && date.getTime() < startOfToday.getTime()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function canUnsend(message: MessageRow, currentUserId: string | null): boolean {
  if (!currentUserId || message.sender_id !== currentUserId) return false;
  const sent = new Date(message.created_at).getTime();
  return !Number.isNaN(sent) && Date.now() - sent < 10 * 60 * 1000;
}

function renderHighlightedText(text: string, query?: string): ReactNode {
  if (!query?.trim()) return text;
  const regex = new RegExp(
    `(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
    'gi',
  );
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(
      <mark key={`${match.index}-${match[0]}`} className="rounded bg-[#D4B18A]/30 px-0.5">
        {match[0]}
      </mark>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
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
  onEdit,
  onUnsend,
  onDeleteForMe,
  showAvatar = true,
  isGroupStart = true,
  senderAvatar = null,
  senderName = null,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 80 });
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [isTranslated, setIsTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [audioUrlState, setAudioUrlState] = useState<{ storagePath: string; url: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressPoint = useRef<{ x: number; y: number } | null>(null);

  const messageType = message.message_type ?? 'text';
  const isCallLog = messageType === 'video_call' || messageType === 'audio_call';
  const audioUrl =
    media?.media_type === 'audio' && media.storage_path === audioUrlState?.storagePath
      ? audioUrlState.url
      : null;

  const refreshReactions = useCallback(async () => {
    const map = await fetchMessageReactions([message.id]);
    setReactions(map.get(message.id) ?? []);
  }, [message.id]);

  useEffect(() => {
    let cancelled = false;
    void fetchMessageReactions([message.id]).then((map) => {
      if (!cancelled) setReactions(map.get(message.id) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [message.id]);

  useEffect(() => {
    return subscribeToMessageReactions(message.match_id, message.id, () => {
      void refreshReactions();
    });
  }, [message.match_id, message.id, refreshReactions]);

  useEffect(() => {
    let cancelled = false;
    if (media?.media_type !== 'audio' || !media.storage_path) return;

    void supabase.storage
      .from('chat-media')
      .createSignedUrl(media.storage_path, 300)
      .then(({ data, error }) => {
        if (error) {
          console.error('[chat audio] signed URL failed:', error.message);
          return;
        }
        if (!cancelled) {
          setAudioUrlState({ storagePath: media.storage_path, url: data.signedUrl });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [media]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  const myEmojis = useMemo(
    () => reactions.filter((reaction) => reaction.userId === currentUserId).map((reaction) => reaction.emoji),
    [reactions, currentUserId],
  );

  const reactionCounts = useMemo(() => {
    const counts = new Map<string, { count: number; mine: boolean }>();
    for (const reaction of reactions) {
      const current = counts.get(reaction.emoji) ?? { count: 0, mine: false };
      counts.set(reaction.emoji, {
        count: current.count + 1,
        mine: current.mine || reaction.userId === currentUserId,
      });
    }
    return counts;
  }, [reactions, currentUserId]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const openMenuAt = useCallback((clientX: number, clientY: number) => {
    const x = Math.max(8, Math.min(clientX - MENU_WIDTH / 2, window.innerWidth - MENU_WIDTH - 8));
    const y = Math.max(58, Math.min(clientY - 70, window.innerHeight - MENU_HEIGHT - 8));
    setMenuPos({ x, y });
    setMenuOpen(true);
  }, []);

  const clearPressTimer = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressPoint.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'touch') return;
      if (menuRef.current?.contains(event.target as Node)) return;
      pressPoint.current = { x: event.clientX, y: event.clientY };
      pressTimer.current = setTimeout(() => {
        if (pressPoint.current) openMenuAt(pressPoint.current.x, pressPoint.current.y);
        pressTimer.current = null;
      }, LONG_PRESS_MS);
    },
    [openMenuAt],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!pressPoint.current) return;
      if (Math.hypot(event.clientX - pressPoint.current.x, event.clientY - pressPoint.current.y) > 12) {
        clearPressTimer();
      }
    },
    [clearPressTimer],
  );

  const toggleTranslation = useCallback(async () => {
    if (isTranslated) {
      setIsTranslated(false);
      return;
    }
    if (translationLoading) return;

    setTranslationLoading(true);
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      const targetLanguage = String(
        user?.user_metadata?.preferred_language ?? user?.user_metadata?.locale ?? 'en',
      ).toLowerCase();
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.content, targetLanguage }),
      });
      if (!response.ok) throw new Error('Translation failed.');
      const result: unknown = await response.json();
      if (typeof result !== 'object' || result === null) throw new Error('Translation response was invalid.');
      const translated =
        'translatedText' in result && typeof result.translatedText === 'string'
          ? result.translatedText
          : 'translated' in result && typeof result.translated === 'string'
            ? result.translated
            : 'text' in result && typeof result.text === 'string'
              ? result.text
              : null;
      if (!translated) throw new Error('No translated text was returned.');
      setTranslatedText(translated);
      setIsTranslated(true);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Could not translate this message.';
      console.error('[translate] failed:', error);
      setToast({ message: messageText, type: 'error' });
    } finally {
      setTranslationLoading(false);
    }
  }, [isTranslated, message.content, translationLoading]);

  const handleReaction = useCallback(
    async (emoji: string) => {
      try {
        if (myEmojis.includes(emoji)) {
          await removeMessageReaction(message.id, emoji);
        } else {
          await addMessageReaction(message.id, emoji);
        }
        await refreshReactions();
        setToast({ message: 'Reaction saved.', type: 'success' });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'Could not save your reaction.';
        setToast({ message: messageText, type: 'error' });
      } finally {
        closeMenu();
      }
    },
    [closeMenu, message.id, myEmojis, refreshReactions],
  );

  const runAction = useCallback(
    async (successMessage: string, action: () => void | Promise<void>) => {
      closeMenu();
      try {
        await action();
        setToast({ message: successMessage, type: 'success' });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'That action could not be completed.';
        setToast({ message: messageText, type: 'error' });
      }
    },
    [closeMenu],
  );

  useEffect(() => {
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (menuOpen && !menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('pointerdown', onOutsidePointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onOutsidePointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeMenu, menuOpen]);

  const displayedText = isTranslated ? translatedText ?? message.content : message.content;
  const messageText = renderHighlightedText(displayedText, searchQuery);
  const bubbleClass = isMe
    ? 'rounded-2xl rounded-tr-sm bg-[#C24A6E] p-3 text-white'
    : 'rounded-2xl rounded-tl-sm border border-[#34283F] bg-[#1C1822] p-3 text-[#F2E9E4]';
  const canEdit = isMe && messageType === 'text' && Boolean(onEdit);
  const showUnsend = isMe && Boolean(onUnsend);

  return (
    <div
      ref={messageRef}
      className={`mb-2 flex w-full items-end gap-2 ${isMe ? 'justify-end' : 'justify-start'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clearPressTimer}
      onPointerCancel={clearPressTimer}
      onPointerLeave={clearPressTimer}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenuAt(event.clientX, event.clientY);
      }}
    >
      {isCallLog && !isMe ? (
        <div className="my-4 flex w-full flex-col items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-[#34283F] bg-[#1C1822] px-3 py-1.5 shadow-sm">
            <span className="text-xs">{messageType === 'video_call' ? '📹' : '📞'}</span>
            <span className="text-xs font-medium text-[#F2E9E4]">
              {messageType === 'video_call' ? 'Missed video call' : message.content || 'Audio call'}
            </span>
            <span className="ml-1 text-[10px] text-[#6B5B79]">{formatRelative(message.created_at)}</span>
          </div>
        </div>
      ) : (
        <>
          {!isMe && showAvatar && senderAvatar && isGroupStart && (
            <img
              src={senderAvatar}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-[#34283F] object-cover"
              aria-hidden
            />
          )}

          <div className={`flex min-w-0 flex-col ${isMe ? 'items-end' : 'items-start'}`}>
            <div className="relative max-w-full">
              {media?.media_type === 'audio' ? (
                <div className={bubbleClass}>
                  {audioUrl ? (
                    <audio src={audioUrl} controls preload="none" className="w-full" />
                  ) : (
                    <span className="text-xs text-[#B58A83]">Loading audio…</span>
                  )}
                </div>
              ) : media ? (
                <div className={bubbleClass}>
                  {media.media_type === 'video' ? '🎬' : '🖼️'}
                  <span className="ml-1 text-xs">{isMe ? 'Your media' : 'Photo or video'}</span>
                </div>
              ) : (
                <div className={bubbleClass}>
                  {isGroupStart && senderName && !isMe && (
                    <span className="mb-1 block text-[10px] font-medium text-[#D4B18A]/70">
                      {senderName}
                    </span>
                  )}
                  <div className="prose-sm prose-invert max-w-full min-w-0 break-words whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">
                    {messageText}
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
              <div className={`mt-0.5 flex flex-wrap gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                {[...reactionCounts.entries()].map(([emoji, info]) => (
                  <ReactionPill
                    key={emoji}
                    messageId={message.id}
                    emoji={emoji}
                    count={info.count}
                    mine={info.mine}
                    onToggle={() => void refreshReactions()}
                  />
                ))}
              </div>
            )}

            {messageType === 'text' && (
              <div className={`mt-0.5 flex items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                <span className={`text-[10px] ${isMe ? 'text-[#F2E9E4]' : 'text-[#B58A83]'}`}>
                  {formatRelative(message.created_at)}
                </span>
                {message.is_edited && (
                  <span className={`text-[10px] ${isMe ? 'text-[#F2E9E4]/70' : 'text-[#B58A83]'}`}>
                    (edited)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void toggleTranslation()}
                  disabled={translationLoading}
                  aria-label={isTranslated ? 'Show original' : 'Translate message'}
                  title={isTranslated ? 'Show original' : 'Google Translate'}
                  className={`flex items-center justify-center rounded p-1 transition-colors disabled:opacity-50 ${
                    isTranslated ? 'bg-[#D4B18A] text-black' : 'bg-blue-600 text-white'
                  }`}
                >
                  <ArrowLeftRight size={12} strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>

          {isMe && showAvatar && senderAvatar && isGroupStart && (
            <img
              src={senderAvatar}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full border border-[#34283F] object-cover"
              aria-hidden
            />
          )}
        </>
      )}

      {menuOpen && (
        <div
          ref={menuRef}
          className="fixed z-[60] w-[260px]"
          style={{ left: menuPos.x, top: menuPos.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="mb-2 flex items-center justify-between gap-1 rounded-full border border-[#34283F] bg-[#1C1822] px-2 py-1.5 shadow-xl">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React ${emoji}`}
                title={emoji}
                onClick={() => void handleReaction(emoji)}
                className={`rounded-full px-1.5 py-1 text-xl transition-transform hover:scale-125 ${
                  myEmojis.includes(emoji) ? 'bg-[#D4B18A]/20' : ''
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="max-h-[min(70vh,340px)] overflow-y-auto rounded-xl border border-[#34283F] bg-[#1C1822] py-1 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                closeMenu();
                onReply?.(message);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F]"
            >
              <Reply size={15} /> Reply
            </button>
            <button
              type="button"
              onClick={() => {
                closeMenu();
                onForward?.(message);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F]"
            >
              <Forward size={15} /> Forward
            </button>
            <button
              type="button"
              onClick={() =>
                void runAction('Copied!', async () => {
                  await navigator.clipboard.writeText(message.content);
                })
              }
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F]"
            >
              <Copy size={15} /> Copy
            </button>
            <button
              type="button"
              onClick={() => {
                closeMenu();
                void toggleTranslation();
              }}
              disabled={translationLoading}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F] disabled:opacity-50"
            >
              <Languages size={15} /> {isTranslated ? 'Show Original' : 'Translate'}
            </button>
            <button
              type="button"
              onClick={() => void runAction(isPinned ? 'Message unpinned.' : 'Message pinned.', async () => onPinToggle?.())}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-[#34283F] ${
                isPinned ? 'text-[#D4B18A]' : 'text-[#F2E9E4]'
              }`}
            >
              <Pin size={15} /> {isPinned ? 'Unpin' : 'Pin'}
            </button>
            {isMe && (
              <>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMenu();
                      onEdit?.(message);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F]"
                  >
                    <Pencil size={15} /> Edit
                  </button>
                )}
                {showUnsend && (
                  <button
                    type="button"
                    disabled={!canUnsend(message, currentUserId)}
                    onClick={() =>
                      void runAction('Message unsent.', async () => {
                        if (!onUnsend) throw new Error('Unsend is unavailable.');
                        await onUnsend(message);
                      })
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 size={15} /> Unsend
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() =>
                void runAction('Message deleted for you.', async () => {
                  if (!onDeleteForMe) throw new Error('Delete for me is unavailable.');
                  await onDeleteForMe(message);
                })
              }
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-[#F2E9E4] hover:bg-[#34283F]"
            >
              <EyeOff size={15} /> Delete for Me
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-8 left-1/2 z-[70] -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-xl ${
            toast.type === 'success'
              ? 'border-emerald-500/40 bg-[#211A28] text-[#F2E9E4]'
              : 'border-red-500/40 bg-[#211A28] text-[#F2E9E4]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
