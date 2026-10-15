'use client';

import { useEffect, useState, use, useSyncExternalStore } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { markConversationRead } from '@/lib/messages';
import { type MessageRow } from '@/lib/types';
import {
  NO_RESTRICTIONS,
  describeRestriction,
  fetchMyRestrictions,
  type MyRestrictions,
} from '@/lib/reports';
import { ReportButton } from '@/app/components/moderation/ReportButton';
import { ReportModal } from '@/app/components/moderation/ReportModal';
import TranslatableMessage from '@/app/components/chat/TranslatableMessage';
import { usePreferredTranslationLanguage } from '@/app/components/chat/usePreferredTranslationLanguage';

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
}: {
  params: Promise<{ matchId: string }>;
}) {
  // Next.js 16 passes `params` as a promise; `use()` unwraps it in a client
  // component without blocking the initial render.
  const resolvedParams = use(params);
  const matchId = resolvedParams.matchId;

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [restrictions, setRestrictions] = useState<MyRestrictions>(NO_RESTRICTIONS);

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

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;
      if (user) setCurrentUserId(user.id);

      // M21: a banned or suspended member can read but not compose. The
      // database enforces this too (a BEFORE INSERT trigger); the notice just
      // explains the disabled composer instead of letting a send silently fail.
      const myRestrictions = await fetchMyRestrictions();
      if (isMounted) setRestrictions(myRestrictions);

      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at')
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

      // M11: opening a thread reads it. The badge is computed server-side from
      // `last_read_at`, so it must be stamped here or the count never clears.
      void markConversationRead(matchId);

      // Determine the other user in the match
      if (user && messagesData.length > 0) {
        const otherSender = messagesData.find(m => m.sender_id !== user.id);
        if (otherSender) {
          setOtherUserId(otherSender.sender_id);
        }
      }
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
          setMessages((prev) => [...prev, inserted]);

          // Also update otherUserId if we haven't set it yet
          if (!otherUserId && inserted.sender_id !== currentUserId) {
            setOtherUserId(inserted.sender_id);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [matchId, currentUserId, otherUserId]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    const content = newMessage.trim();
    if (!content || !currentUserId) return;

    const { error: insertError } = await supabase.from('messages').insert({
      match_id: matchId,
      sender_id: currentUserId,
      content,
    });

    if (insertError) {
      console.error('Failed to send message:', insertError.message);
      setError('Message could not be sent.');
      return;
    }

    setError(null);
    setNewMessage('');
  };

  const handleReported = () => {
    setReportOpen(false);
    setMenuOpen(false);
  };

  const handleBlock = async () => {
    if (!otherUserId) return;

    setBlocking(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to block a user.');
        return;
      }

      const { error: insertError } = await supabase
        .from('blocked_users')
        .insert({
          blocker_id: user.id,
          blocked_user_id: otherUserId,
        });

      if (insertError) {
        if (insertError.code === '23505') {
          setError('You have already blocked this user.');
        } else {
          console.error('Failed to block user:', insertError.message);
          setError(`Could not block user: ${insertError.message}`);
        }
        return;
      }

      setMenuOpen(false);
      alert('User blocked successfully. They will no longer appear in your discover feed or messages.');
    } catch (err) {
      console.error('Unexpected error blocking user:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setBlocking(false);
    }
  };

  const restrictionMessage = describeRestriction(restrictions);
  const canSend = restrictionMessage === null;

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-4 bg-neutral-950 text-white">
      {/* Header with back button and report/block menu */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => window.history.back()}
          className="px-3 py-1 rounded text-sm bg-neutral-800 hover:bg-neutral-700"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded bg-neutral-800 hover:bg-neutral-700"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          {/* Report/Block Menu */}
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 z-10">
              <div className="px-4 py-2">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">Safety</p>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  disabled={!otherUserId}
                >
                  Report User
                </button>
                <button
                  onClick={handleBlock}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 mt-1"
                  disabled={blocking}
                >
                  {blocking ? 'Blocking...' : 'Block User'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
          return (
            <div
              key={msg.id}
              className={`flex items-end gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}
            >
              {/* Only incoming messages offer a report, and it points at the
                  exact message so `file_report` captures it as context. */}
              {!isMe && (
                <ReportButton
                  targetUserId={msg.sender_id}
                  targetType="message"
                  targetId={msg.id}
                  title="Report this message"
                  ariaLabel="Report this message"
                  className="mb-1"
                />
              )}
              <div
                className={`p-3 rounded-2xl max-w-[75%] ${
                  isMe ? 'bg-rose-500 text-white' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {/* Translation is on-demand and per message: nothing is sent to
                    the provider until the member taps the control, and the
                    original text is never replaced. */}
                <TranslatableMessage
                  content={msg.content}
                  isOwnMessage={isMe}
                  targetLanguage={preferredTranslationLanguage}
                  sourceLanguage={sourceLanguageHint}
                />
              </div>
            </div>
          );
        })}
      </div>

      {restrictionMessage && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-xs text-amber-200"
        >
          {restrictionMessage}
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 text-center text-xs text-rose-400">
          {error}
        </p>
      )}

      <form onSubmit={sendMessage} className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={canSend ? 'Type a message...' : 'Messaging is paused'}
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
        targetType="user"
        title="Report member"
        onSubmitted={handleReported}
      />
    </div>
  );
}
