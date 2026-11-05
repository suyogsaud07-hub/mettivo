'use client';

import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Mic, MicOff, Paperclip, Send, X } from 'lucide-react';
import VoiceNoteRecorder from '@/app/components/chat/VoiceNoteRecorder';

interface ChatComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  onAttach: () => void;
  onVoiceNote?: (blob: Blob, durationSeconds: number) => void;
  placeholder?: string;
  voiceEnabled?: boolean;
}

export default function ChatComposer({
  disabled,
  onSend,
  onAttach,
  onVoiceNote,
  placeholder = 'Type a message...',
  voiceEnabled = true,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'previewing' | 'sending'>('idle');
  const [voiceDuration, setVoiceDuration] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = value.trim();
        if (text && !disabled) onSend(text);
      }
    },
    [value, disabled, onSend]
  );

  const clearInput = useCallback(() => {
    setValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, []);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (text && !disabled) {
      onSend(text);
      clearInput();
    }
  }, [value, disabled, onSend, clearInput]);

  const handleVoiceData = useCallback(
    (blob: Blob, durationSeconds: number) => {
      if (onVoiceNote) {
        setVoiceState('sending');
        onVoiceNote(blob, durationSeconds);
      }
      setVoiceState('idle');
      setVoiceDuration(0);
    },
    [onVoiceNote]
  );

  const hasContent = value.trim().length > 0 || voiceState !== 'idle';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className="flex gap-2 items-end px-4 pb-4 shrink-0 bg-[#131017]"
    >
      <input
        type="file"
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            URL.revokeObjectURL(e.target.value);
            onAttach();
          }
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => {
          const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
          input?.click();
        }}
        disabled={disabled}
        aria-label="Attach a photo or video"
        className="p-2.5 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#29202D] shrink-0"
      >
        <Paperclip size={18} />
      </button>

      {voiceEnabled && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setVoiceState((prev) => (prev === 'idle' ? 'recording' : 'idle'));
            }}
            disabled={disabled}
            aria-label="Record voice note"
            className={`p-1.5 rounded-full shrink-0 transition-all ${
              voiceState === 'recording'
                ? 'bg-[#C24A6E]/20 text-[#EF4444]'
                : 'bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] hover:bg-[#29202D] disabled:opacity-50'
            }`}
          >
            {voiceState === 'recording' ? (
              <MicOff size={16} strokeWidth={2} />
            ) : (
              <Mic size={16} strokeWidth={2} />
            )}
          </button>
        </div>
      )}

      <textarea
        ref={inputRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        style={{
          minHeight: '40px',
          maxHeight: '120px',
          overflowY: 'auto',
          resize: 'none',
        }}
        className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] placeholder-[#6B5B79] focus:outline-none focus:ring-1 focus:ring-[#D4B18A] disabled:opacity-50 disabled:cursor-not-allowed"
      />

      <button
        type="submit"
        disabled={!hasContent || disabled}
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg transition-all ${
          hasContent && !disabled
            ? 'bg-[#C24A6E] text-[#17121C] hover:bg-[#B33E5E]'
            : 'bg-[#1C1822] border border-[#34283F] text-[#6B5B79] disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
        aria-label="Send"
      >
        <Send size={16} />
      </button>
    </form>
  );
}
