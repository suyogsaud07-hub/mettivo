'use client';

import { useCallback, useState } from 'react';
import { addMessageReaction, removeMessageReaction } from '@/lib/reactions';

const REACTION_EMOJIS = ['❤️', '😂', '😭', '👍', '😡', '🤔'];

interface ReactionBarProps {
  messageId: string;
  myReactions: string[]; // emojis the current user has reacted with
  onClose: () => void;
  x: number;
  y: number;
}

export default function ReactionBar({
  messageId,
  myReactions,
  onClose,
  x,
  y,
}: ReactionBarProps) {
  const [adding, setAdding] = useState<string | null>(null);

  const handleAdd = async (emoji: string) => {
    if (adding) return;
    setAdding(emoji);
    try {
      if (myReactions.includes(emoji)) {
        await removeMessageReaction(messageId, emoji);
      } else {
        await addMessageReaction(messageId, emoji);
      }
    } catch (err) {
      console.error('[reaction] toggle failed:', err);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        zIndex: 50,
        display: 'flex',
        gap: '6px',
        padding: '6px',
        borderRadius: '10px',
        backgroundColor: '#1C1822',
        border: '1px solid #29202D',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      {REACTION_EMOJIS.map((emoji) => {
        const active = myReactions.includes(emoji);
        const busy = adding === emoji;
        return (
          <button
            key={emoji}
            onClick={() => void handleAdd(emoji)}
            disabled={busy}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: active ? '#D4B18A' : '#29202D',
              border: active ? 'none' : '1px solid #3A2E44',
              color: active ? '#17121C' : '#F2E9E4',
              fontSize: '20px',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        );
      })}
      <button
        onClick={onClose}
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          backgroundColor: 'transparent',
          border: 'none',
          color: '#B58A83',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '6px',
        }}
        aria-label="Close reactions"
      >
        ✕
      </button>
    </div>
  );
}
