'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SUBBU_NAME } from '@/lib/bot/constants';

interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string; // Added for Mettivo Clicks
  createdAt: string;
}

/**
 * The opening bubble. Fixed id so the server-rendered greeting matches the
 * client's first paint (no hydration mismatch from a random uuid).
 */
const GREETING: BotMessage = {
  id: 'subbu-greeting',
  role: 'assistant',
  content:
    "Hey, I'm Subbu — your Mettivo assistant. 😊 I can help you set up your " +
    'profile, explain how matching works, hand out dating advice, or just chat to keep you company. ' +
    'If you\'re feeling bored, send me a Mettivo Click (📸) and I\'ll hype you up! What do you need?',
  createdAt: '',
};

/** `HH:mm` — deterministic within a render, so markup stays hydration-safe. */
function formatClock(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `/chat/subbu` — the Subbu companion room.
 */
export default function SubbuChatPage() {
  const [messages, setMessages] = useState<BotMessage[]>([GREETING]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the newest bubble in view as the thread grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, thinking]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to Base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      void sendMessage('Check out this Mettivo Click!', base64);
    };
    reader.readAsDataURL(file);
    
    // Reset input so the same file can be uploaded again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const sendMessage = async (text: string, imageUrl?: string) => {
    const content = text.trim();
    if ((!content && !imageUrl) || thinking) return;

    const outgoing: BotMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content || 'Sent a photo',
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    const history = [...messages, outgoing];

    setMessages(history);
    setDraft('');
    setError(null);
    setThinking(true);

    try {
      const response = await fetch('/api/bot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The greeting is an assistant turn, so it replays as context exactly
        // as the model produced it.
        body: JSON.stringify({
          messages: history.map((m) => ({ 
            role: m.role, 
            content: m.content,
            imageUrl: m.imageUrl // Pass image to API
          })),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      const reply =
        payload && typeof payload === 'object' && 'reply' in payload
          ? (payload as { reply?: unknown }).reply
          : undefined;

      if (!response.ok || typeof reply !== 'string' || reply.length === 0) {
        const message =
          payload && typeof payload === 'object' && 'message' in payload
            ? (payload as { message?: unknown }).message
            : undefined;
        setError(typeof message === 'string' ? message : 'Subbu could not answer. Please try again.');
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      setError('Subbu is unavailable right now. Please try again.');
    } finally {
      setThinking(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(draft);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto p-4 bg-neutral-950 text-white">
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/chat"
          className="px-3 py-1 rounded text-sm bg-neutral-800 hover:bg-neutral-700"
        >
          ← Back
        </Link>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white"
          >
            S
          </span>
          <div className="text-right">
            <p className="text-sm font-semibold leading-tight">{SUBBU_NAME}</p>
            <p className="text-[11px] leading-tight text-neutral-400">AI assistant & Moderator</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
        {messages.map((msg) => {
          const isMe = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`p-3 rounded-2xl max-w-[75%] whitespace-pre-wrap ${
                  isMe ? 'bg-rose-500 text-white' : 'bg-neutral-800 text-neutral-200'
                }`}
              >
                {/* Display the Mettivo Click image if it exists */}
                {msg.imageUrl && (
                  <img 
                    src={msg.imageUrl} 
                    alt="Mettivo Click" 
                    className="rounded-lg mb-2 max-h-60 object-cover w-full" 
                  />
                )}
                {msg.content}
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-neutral-500">
                {isMe ? 'You' : SUBBU_NAME} · {formatClock(msg.createdAt)}
              </span>
            </div>
          );
        })}

        {thinking && (
          <div className="flex justify-start">
            <div
              role="status"
              aria-label={`${SUBBU_NAME} is typing`}
              className="flex items-center gap-1 rounded-2xl bg-neutral-800 px-3 py-3"
            >
              <span className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-neutral-500 animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-center text-xs text-rose-400">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex gap-2 items-center">
        <input 
          type="file" 
          accept="image/*" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={thinking}
          className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-rose-400 disabled:opacity-50 transition"
          title="Send Mettivo Click"
        >
          📸
        </button>

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message Subbu…"
          aria-label="Message Subbu"
          disabled={thinking}
          className="flex-1 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-white focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={thinking || draft.trim().length === 0}
          className="px-5 py-3 bg-rose-500 font-semibold rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}