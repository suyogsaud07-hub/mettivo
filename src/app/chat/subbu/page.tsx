'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SUBBU_NAME } from '@/lib/bot/constants';
import { parseBanStatus, suspensionBanner } from '@/lib/bot/moderation';
import { supabase } from '@/lib/supabase';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `HH:mm` — deterministic within a render, so markup stays hydration-safe. */
function formatClock(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MAX_UPLOAD_EDGE = 1024;
const UPLOAD_QUALITY = 0.8;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale + re-encode before upload.
 *
 * A phone photo is several MB of base64, which would blow the API's request
 * ceiling and the classifier's per-image cap. A 1024 px JPEG is a few hundred
 * KB and still more than enough for Subbu (and for moderation). If the browser
 * cannot decode the file we fall back to the original data URL and let the API
 * reject it cleanly.
 */
async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return readAsDataUrl(file);

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return readAsDataUrl(file);
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', UPLOAD_QUALITY);
  } catch {
    return readAsDataUrl(file);
  }
}

/**
 * `/chat/subbu` — the Subbu companion room.
 *
 * BANS ARE REAL HERE
 *   On mount the page reads the caller's own ban through `my_ban_status()`.
 *   While it is in the future the composer (text, send, image upload) is
 *   disabled and a red banner states the expiry. A 403 from the API carries the
 *   fresh `banned_until`, so a ban issued mid-conversation locks the composer
 *   immediately — no refresh required.
 */
export default function SubbuChatPage() {
  const [messages, setMessages] = useState<BotMessage[]>([GREETING]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banUntil, setBanUntil] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // `banUntil` is only ever set while the ban is live: the loader and the 403
  // handler both check the timestamp before storing it, and a timer clears it
  // the moment it expires. That keeps render pure (no clock read) while still
  // locking the composer instantly.
  const isBanned = banUntil !== null;

  // Keep the newest bubble in view as the thread grows.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, thinking]);

  // Read the existing ban on load. `my_ban_status()` accepts no id, so this can
  // only ever return the signed-in member's own state.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc('my_ban_status');
      if (cancelled || rpcError) return;
      const status = parseBanStatus(data);
      if (status.banned && status.until) setBanUntil(status.until);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-enable the composer automatically when the ban expires.
  useEffect(() => {
    if (!banUntil) return;
    const remaining = new Date(banUntil).getTime() - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setBanUntil(null), remaining + 1000);
    return () => window.clearTimeout(timer);
  }, [banUntil]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isBanned) return;

    void (async () => {
      try {
        const dataUrl = await compressImage(file);
        await sendMessage('Check out this Mettivo Click!', dataUrl);
      } catch {
        setError('That image could not be read. Please try another.');
      } finally {
        // Reset input so the same file can be uploaded again if needed.
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    })();
  };

  const sendMessage = async (text: string, imageUrl?: string) => {
    const content = text.trim();
    if ((!content && !imageUrl) || thinking || isBanned) return;

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
        // Only the upload being sent now carries an image. Replaying every old
        // image would grow the request without bound (and give the model older
        // media nobody re-screened). The greeting is replayed as context.
        body: JSON.stringify({
          messages: history.map((m, index) => ({
            role: m.role,
            content: m.content,
            ...(index === history.length - 1 && m.imageUrl ? { imageUrl: m.imageUrl } : {}),
          })),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      const record = isRecord(payload) ? payload : null;
      const code = typeof record?.error === 'string' ? record.error : '';

      // A real ban: lock the composer now and show the expiry.
      if (response.status === 403 && code === 'banned') {
        const status = parseBanStatus(record);
        if (status.banned && status.until) setBanUntil(status.until);
        setError(null);
        return;
      }

      const reply = typeof record?.reply === 'string' ? record.reply : '';

      if (!response.ok || reply.length === 0) {
        const message =
          typeof record?.message === 'string'
            ? record.message
            : 'Subbu could not answer. Please try again.';
        setError(message);
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

      {isBanned && banUntil && (
        <div
          role="alert"
          data-testid="subbu-ban-banner"
          className="mb-4 rounded-xl border border-red-400 bg-red-600 px-4 py-3 text-sm font-medium leading-snug text-white shadow-lg"
        >
          {suspensionBanner(banUntil)}
        </div>
      )}

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
          disabled={isBanned}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={thinking || isBanned}
          className="p-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-rose-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
          title="Send Mettivo Click"
        >
          📸
        </button>

        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isBanned ? 'Your account is suspended' : 'Message Subbu…'}
          aria-label="Message Subbu"
          disabled={thinking || isBanned}
          className="flex-1 p-3 rounded-xl bg-neutral-900 border border-neutral-800 text-white focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={thinking || isBanned || draft.trim().length === 0}
          className="px-5 py-3 bg-rose-500 font-semibold rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}
