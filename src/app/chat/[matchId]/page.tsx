'use client';

import { useEffect, useState, use, useSyncExternalStore } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { markConversationRead } from '@/lib/messages';
import { type MessageRow } from '@/lib/types';
import { type ReportRow, type BlockedUserRow, type BlockedUserWithProfile } from '@/lib/types';
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
  const [reporting, setReporting] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);

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

  const handleReport = async () => {
    if (!otherUserId || !reportReason) return;

    setReporting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to report a user.');
        return;
      }

      const { error: insertError } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          reported_user_id: otherUserId,
          reason: reportReason,
          details: reportReason === 'other' ? reportDetails.trim() : null,
        });

      if (insertError) {
        if (insertError.code === '23505') {
          setError('You have already reported this user.');
        } else {
          console.error('Failed to submit report:', insertError.message);
          setError(`Could not submit report: ${insertError.message}`);
        }
        return;
      }

      setShowReportModal(false);
      setReportReason('');
      setReportDetails('');
      setMenuOpen(false);
      alert('Report submitted successfully. Our safety team will review it.');
    } catch (err) {
      console.error('Unexpected error submitting report:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setReporting(false);
    }
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
                    setShowReportModal(true);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  disabled={reporting}
                >
                  {reporting ? 'Reporting...' : 'Report User'}
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
              className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
            >
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
          placeholder="Type a message..."
          aria-label="Message"
          className="flex-1 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-white focus:outline-none"
        />
        <button
          type="submit"
          className="px-5 py-3 bg-rose-500 font-semibold rounded-xl text-white"
        >
          Send
        </button>
      </form>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl">
            {/* Close button */}
            <button
              onClick={() => setShowReportModal(false)}
              className="absolute top-3 right-3 rounded-full bg-neutral-200 dark:bg-neutral-800 p-1.5 hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors"
              aria-label="Close"
            >
              <svg className="h-4 w-4 stroke-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Report user</h3>
            </div>

            <div className="px-6 py-5">
              <form onSubmit={(e) => {
                e.preventDefault();
                handleReport();
              }}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Reason for reporting</label>
                    <select
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                      disabled={reporting}
                    >
                      <option value="">Select a reason...</option>
                      <option value="harassment">Harassment or hate speech</option>
                      <option value="fake_profile">Fake profile or scam</option>
                      <option value="inappropriate">Inappropriate content</option>
                      <option value="underage">Underage user</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  {reportReason === "other" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Please explain</label>
                      <textarea
                        rows={3}
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                        placeholder="Tell us more about what happened..."
                        disabled={reporting}
                      />
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowReportModal(false)}
                      className="px-3 py-1.5 rounded text-sm bg-neutral-200 hover:bg-neutral-300"
                      disabled={reporting}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-rose-500 text-white rounded hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!reportReason || (reportReason === "other" && !reportDetails.trim()) || reporting}
                    >
                      Submit report
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
