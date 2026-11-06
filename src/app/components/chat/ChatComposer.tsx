'use client';

import { useCallback, useRef, useState } from 'react';
import { ArrowRight, Mic, MicOff, Paperclip, Send, X } from 'lucide-react';
import VoiceNoteRecorder from '@/app/components/chat/VoiceNoteRecorder';

interface ChatComposerProps {
  disabled: boolean;
  onSend: (text: string, replyTo?: string) => void;
  onAttach: (files: FileList) => void;
  onVoiceNote?: (blob: Blob, durationSeconds: number) => void;
  placeholder?: string;
  voiceEnabled?: boolean;
  replyTo: { id: string; content: string; senderId: string } | null;
  onClearReply: () => void;
}

/** Maximum image file size: 10 MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Maximum video file size: 100 MB. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Maximum simultaneous attachments. */
export const MAX_ATTACHMENTS = 10;

function isImageMime(type: string): boolean {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'].includes(type.toLowerCase());
}

function isVideoMime(type: string): boolean {
  return ['video/mp4', 'video/webm', 'video/quicktime', 'video/mov'].includes(type.toLowerCase());
}

export function validateAttachment(file: File): { ok: true } | { ok: false; reason: string } {
  const type = file.type.toLowerCase();

  if (isImageMime(type)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: 'Image is too large (max 10 MB).' };
    }
    return { ok: true };
  }

  if (isVideoMime(type)) {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, reason: 'Video is too large (max 100 MB).' };
    }
    return { ok: true };
  }

  return { ok: false, reason: 'Unsupported file type. Use JPEG, PNG, WebP, GIF, MP4, or WebM.' };
}

export default function ChatComposer({
  disabled,
  onSend,
  onAttach,
  onVoiceNote,
  placeholder = 'Type a message...',
  voiceEnabled = true,
  replyTo,
  onClearReply,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'previewing' | 'sending'>('idle');
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clearUploadError = useCallback(() => setUploadError(null), []);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = value.trim();
        if (text && !disabled) {
          onSend(text, replyTo?.id);
          setValue('');
          onClearReply();
        }
      }
    },
    [value, disabled, onSend, replyTo?.id, onClearReply]
  );

  const clearInput = useCallback(() => {
    setValue('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }, []);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (text && !disabled) {
      onSend(text, replyTo?.id);
      clearInput();
      onClearReply();
    }
  }, [value, disabled, onSend, replyTo?.id, clearInput, onClearReply]);

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

  /** Synchronous file-picker trigger — runs inside the user's click handler. */
  const handleAttachmentClick = useCallback(() => {
    setUploadError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      if (files.length > MAX_ATTACHMENTS) {
        setUploadError(`You can attach at most ${MAX_ATTACHMENTS} files at once.`);
        e.target.value = '';
        return;
      }

      const invalid: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const result = validateAttachment(files[i]);
        if (!result.ok) {
          invalid.push(result.reason);
        }
      }

      if (invalid.length > 0) {
        setUploadError(invalid.join(' '));
        e.target.value = '';
        return;
      }

      onAttach(files);
      e.target.value = '';
    },
    [onAttach]
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
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={handleAttachmentClick}
        disabled={disabled}
        aria-label="Attach a photo or video"
        className="p-2.5 rounded-full bg-[#1C1822] border border-[#34283F] text-[#F2E9E4] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#29202D] shrink-0"
      >
        <Paperclip size={18} />
      </button>

      {voiceEnabled && <VoiceNoteRecorder onSend={handleVoiceData} />}

      {replyTo && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1C1822] border border-[#34283F] shrink-0"
        >
          <div className="flex-1 min-w-0">
            <span className="text-[10px] text-[#D4B18A]/70 font-medium">Replying to</span>
            <span className="text-xs text-[#F2E9E4] truncate block">{replyTo.content}</span>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            aria-label="Clear reply"
            className="p-1 text-[#B58A83] hover:text-[#F2E9E4] hover:bg-[#29202D] rounded"
          >
            <X size={14} strokeWidth={2} />
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

      {uploadError && (
        <p className="text-xs text-[#EF4444] ml-2 shrink-0 whitespace-nowrap">{uploadError}</p>
      )}
    </form>
  );
}
