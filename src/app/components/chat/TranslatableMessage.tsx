'use client';

import { useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import { type TranslationProviderId } from '@/lib/translation';

export type TranslateFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface TranslatableMessageProps {
  content: string;
  isOwnMessage: boolean;
  targetLanguage: string;
  sourceLanguage?: string | null;
  fetchImpl?: TranslateFetch;
  onTranslated?: (provider: TranslationProviderId) => void;
}

interface TranslateResponseBody {
  translatedText?: unknown;
  provider?: unknown;
  error?: unknown;
  message?: unknown;
}

function readErrorMessage(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const body = raw as TranslateResponseBody;
  return typeof body.message === 'string' && body.message.trim() ? body.message : null;
}

export default function TranslatableMessage({
  content,
  isOwnMessage,
  targetLanguage,
  sourceLanguage = null,
  fetchImpl,
  onTranslated,
}: TranslatableMessageProps) {
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = async (): Promise<void> => {
    if (translatedContent !== null) {
      setIsExpanded((previous) => !previous);
      setError(null);
      return;
    }

    setError(null);
    setIsTranslating(true);

    try {
      const doFetch = fetchImpl ?? fetch;
      const response = await doFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          targetLanguage,
          sourceLanguage: sourceLanguage ?? undefined,
        }),
      });

      let raw: unknown = null;
      try {
        raw = await response.json();
      } catch {
        raw = null;
      }

      if (!response.ok) {
        setError('Translation failed');
        return;
      }

      const body = (typeof raw === 'object' && raw !== null ? raw : {}) as TranslateResponseBody;
      const translated = typeof body.translatedText === 'string' ? body.translatedText.trim() : '';

      if (!translated) {
        setError('Translation failed');
        return;
      }

      setTranslatedContent(translated);
      setIsExpanded(true);
      if (body.provider === 'deepl' || body.provider === 'mymemory' || body.provider === 'google') {
        onTranslated?.(body.provider as TranslationProviderId);
      }
    } catch (err) {
      console.error('[translation] request failed:', err);
      setError('Translation failed');
    } finally {
      setIsTranslating(false);
    }
  };

  const canTranslate = !isOwnMessage && content.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
      <div style={{ paddingBottom: canTranslate ? '24px' : '0' }}>
        {content}
      </div>

      {canTranslate && (
        <button
          type="button"
          onClick={() => void handleTranslate()}
          disabled={isTranslating}
          aria-label="Translate message"
          style={{
            position: 'absolute',
            bottom: '-4px',
            left: '8px',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            color: '#eae2f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isTranslating ? 'progress' : 'pointer',
            opacity: isTranslating ? 0.7 : 0.9,
            padding: 0,
            transition: 'opacity 0.15s ease',
          }}
        >
          {isTranslating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowLeftRight size={14} />
          )}
        </button>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: '10px', color: '#FCA5A5', marginTop: '4px' }}>
          {error}
        </p>
      )}

      {isExpanded && translatedContent && (
        <div
          style={{
            marginTop: '6px',
            padding: '8px 10px',
            borderRadius: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(216, 179, 138, 0.3)',
            color: '#eae2f0',
            fontSize: '12px',
            lineHeight: 1.4,
          }}
        >
          {translatedContent}
        </div>
      )}
    </div>
  );
}
