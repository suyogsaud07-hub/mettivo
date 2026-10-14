'use client';
import { useEffect, useState, use } from 'react';
import { supabase } from '../../lib/supabase';

export default function ChatPage({ params }: { params: Promise<{ matchId: string }> }) {
  const resolvedParams = use(params);
  const matchId = resolvedParams.matchId;

  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    };

    init();

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
        (payload: any) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUserId) return;

    await supabase.from('messages').insert({
      match_id: matchId,
      sender_id: currentUserId,
      content: newMessage.trim(),
    });

    setNewMessage('');
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-4 bg-neutral-950 text-white">
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
        {messages.map((msg) => {
          const isMe = msg.sender_id === currentUserId;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`p-3 rounded-2xl max-w-[75%] ${isMe ? 'bg-rose-500 text-white' : 'bg-neutral-800 text-neutral-200'}`}>
                {msg.content}
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={sendMessage} className="flex gap-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-white focus:outline-none"
        />
        <button type="submit" className="px-5 py-3 bg-rose-500 font-semibold rounded-xl text-white">
          Send
        </button>
      </form>
    </div>
  );
}
