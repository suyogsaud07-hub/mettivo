'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveChatMessage } from '@/lib/live/signaling';

/**
 * The compact text chat that sits in the corner of the live screen.
 *
 * Messages travel over the same Realtime channel as the call and are never
 * persisted, so closing the call forgets the conversation — the live experience
 * is meant to be ephemeral. The session hook clears its `messages` array on both
 * "Next" and "Stop", and this drawer unmounts the instant `phase` leaves `live`,
 * so the thread and the draft reset together with no extra bookkeeping here.
 *
 * The drawer is collapsed by default so it never covers the video until the
 * member wants it; the toggle carries a badge for messages received while it is
 * closed.
 */

export interface LiveChatDrawerProps {
  messages: LiveChatMessage[];
  onSend: (text: string) => void;
}

function ChatBubbleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function LiveChatDrawer({ messages, onSend }: LiveChatDrawerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="live-chat-toggle"
        onClick={() => setOpen(true)}
        aria-label="Open live chat"
        style={{
          position: 'fixed',
          right: '14px',
          bottom: '100px',
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 18px',
          borderRadius: '999px',
          border: '1px solid #34283f',
          backgroundColor: '#211a28',
          color: '#eae2f0',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        <ChatBubbleIcon /> Chat
        {messages.length > 0 && (
          <span style={{
            minWidth: '18px',
            height: '18px',
            padding: '0 5px',
            borderRadius: '999px',
            backgroundColor: '#d8b38a',
            color: '#1a130c',
            fontSize: '11px',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {messages.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      data-testid="live-chat-drawer"
      style={{
        position: 'fixed',
        right: '12px',
        bottom: '96px',
        zIndex: 60,
        width: 'min(290px, 84vw)',
        maxHeight: '46vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(33, 26, 40, 0.96)',
        border: '1px solid #34283f',
        borderRadius: '18px',
        overflow: 'hidden',
        boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid #34283f',
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#d8b38a' }}>Live chat</span>
        <button
          type="button"
          data-testid="live-chat-close"
          onClick={() => setOpen(false)}
          aria-label="Close live chat"
          style={{ background: 'none', border: 'none', color: '#b58a83', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div
        ref={listRef}
        data-testid="live-chat-messages"
        role="log"
        aria-live="polite"
        aria-label="Live chat messages"
        style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
        {messages.length === 0 ? (
          <p style={{ margin: 0, fontSize: '12px', color: '#9b8ba6' }}>
            Say hi — messages disappear when the call ends.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.mine ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                padding: '8px 12px',
                borderRadius: '14px',
                fontSize: '13px',
                lineHeight: 1.4,
                wordBreak: 'break-word',
                backgroundColor: message.mine ? '#d8b38a' : '#2d2336',
                color: message.mine ? '#1a130c' : '#eae2f0',
              }}
            >
              {message.text}
            </div>
          ))
        )}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', padding: '10px 12px', borderTop: '1px solid #34283f' }}>
        <input
          type="text"
          data-testid="live-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message…"
          aria-label="Live chat message"
          maxLength={280}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '10px 12px',
            borderRadius: '12px',
            border: '1px solid #3e314b',
            backgroundColor: '#251d2d',
            color: '#eae2f0',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          data-testid="live-chat-send"
          disabled={!draft.trim()}
          style={{
            padding: '10px 16px',
            borderRadius: '12px',
            border: 'none',
            background: 'linear-gradient(135deg, #d8b38a, #c78c8d)',
            color: '#1a130c',
            fontSize: '13px',
            fontWeight: 800,
            cursor: draft.trim() ? 'pointer' : 'default',
            opacity: draft.trim() ? 1 : 0.6,
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
