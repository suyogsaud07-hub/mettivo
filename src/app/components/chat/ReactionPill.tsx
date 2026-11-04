'use client';

import { useCallback, useState } from 'react';
import { addMessageReaction, removeMessageReaction } from '@/lib/reactions';
import EmojiText from '@/app/components/chat/EmojiText';

interface ReactionPillProps {
  messageId: string;
  emoji: string;
  count: number;
  mine: boolean;
  onToggle: () => void;
}

export default function ReactionPill({
  messageId,
  emoji,
  count,
  mine,
  onToggle,
}: ReactionPillProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mine) {
        await removeMessageReaction(messageId, emoji);
      } else {
        await addMessageReaction(messageId, emoji);
      }
      onToggle();
    } catch (err) {
      console.error('[reaction pill] toggle failed:', err);
    } finally {
      setBusy(false);
    }
  }, [messageId, emoji, mine, busy, onToggle]);

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '10px',
        backgroundColor: mine ? '#D4B18A' : '#29202D',
        border: mine ? 'none' : '1px solid #3A2E44',
        color: mine ? '#17121C' : '#F2E9E4',
        fontSize: '12px',
        fontWeight: mine ? 700 : 400,
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <EmojiText text={emoji} size={14} />
      <span style={{ lineHeight: 1 }}>{count}</span>
    </button>
  );
}
