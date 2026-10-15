'use client';

import { useEffect, useState, use } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { type MessageRow } from '@/lib/types';

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
  const [error, setError] = useState<string | null>(null);

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

      setMessages((data ?? []) as MessageRow[]);
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
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [matchId]);

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

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-4 bg-neutral-950 text-white">
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
                {msg.content}
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
    </div>
  );
}
