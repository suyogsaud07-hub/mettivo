'use client';

import { useState } from 'react';
import { isSupportedLanguageCode, type TranslationProviderId } from '@/lib/translation';

/**
 * A chat message bubble with an on-demand translate control.
 *
 * WHY ON-DEMAND
 *   Nothing is translated until the member taps the control. Auto-translating a
 *   thread would spend a paid provider's quota on every message a member scrolls
 *   past, and it would replace the sender's own words with a machine's before
 *   the member ever chose to read them. The translation is an explicit,
 *   reversible addition — tap again to collapse it.
 *
 * STATE OWNERSHIP
 *   The original message is never mutated. `translatedContent` holds the fetched
 *   text alongside it, which is what lets the toggle be lossless. All of this is
 *   local component state: no page navigation, no reload.
 *
 * STYLING
 *   "Midnight Romance": deep plum card `#211a28`, gold accent `#d8b38a`, soft
 *   text `#eae2f0`, muted `#9b8ba6`. The values are the `--mr-*` tokens from
 *   `globals.css` so the component cannot drift from the stylesheet.
 */

const mr = {
  card: 'var(--mr-card)',
  cardBorder: 'var(--mr-card-border)',
  gold: 'var(--mr-gold)',
  goldText: 'var(--mr-gold-text)',
  heading: 'var(--mr-heading)',
  muted: 'var(--mr-placeholder)',
  error: '#FCA5A5',
} as const;

/** Where the translated text is fetched from. Injectable so it can be tested. */
export type TranslateFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface TranslatableMessageProps {
  /** The original message text. Never modified. */
  content: string;
  /** True when the signed-in member sent it; their own bubbles get no control. */
  isOwnMessage: boolean;
  /** Language to translate INTO. */
  targetLanguage: string;
  /** Best-effort source hint, or `null` for automatic detection. */
  sourceLanguage?: string | null;
  /** Overridable for tests. Defaults to the global `fetch`. */
  fetchImpl?: TranslateFetch;
  onTranslated?: (provider: TranslationProviderId) => void;
}

interface TranslateResponseBody {
  translatedText?: unknown;
  provider?: unknown;
  error?: unknown;
  message?: unknown;
}

/** Narrows the API's error body without casting to a shaky shape. */
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
    // Already fetched: this is a pure UI toggle, no second request.
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
          // `undefined` is dropped by JSON.stringify; the route treats a missing
          // source as automatic detection.
          sourceLanguage: sourceLanguage ?? undefined,
        }),
      });

      // Read the body once: an error response carries the same envelope.
      let raw: unknown = null;
      try {
        raw = await response.json();
      } catch {
        raw = null;
      }

      if (!response.ok) {
        throw new Error(
          readErrorMessage(raw) ?? 'We could not translate this message. Please try again.'
        );
      }

      const body = (typeof raw === 'object' && raw !== null ? raw : {}) as TranslateResponseBody;
      const translated = typeof body.translatedText === 'string' ? body.translatedText.trim() : '';

      // An empty translation is a failure, not a translation. Showing the bubble
      // with nothing under it would look like the feature silently did nothing.
      if (!translated) {
        throw new Error('That message could not be translated.');
      }

      setTranslatedContent(translated);
      setIsExpanded(true);
      if (body.provider === 'deepl' || body.provider === 'mymemory') {
        onTranslated?.(body.provider);
      }
    } catch (err) {
      // A network failure and a rejected request are the same thing to a member.
      console.error('[translation] request failed:', err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'We could not translate this message. Please try again.'
      );
    } finally {
      // CONSTITUTION Article 2.8: a loading state must always terminate.
      setIsTranslating(false);
    }
  };

  const canTranslate = !isOwnMessage && content.trim().length > 0;
  const label = isTranslating
    ? 'Translating…'
    : isExpanded
      ? 'Hide translation'
      : translatedContent !== null
        ? 'Show translation'
        : 'Translate';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {content}

      {/*
        The control sits BENEATH the bubble, matching the pattern in the brief.
        `aria-expanded` reflects the toggle so a screen reader announces state,
        and `aria-busy` covers the in-flight request.
      */}
      {canTranslate && (
        <button
          type="button"
          data-testid={`translate-button-${isOwnMessage ? 'own' : 'other'}`}
          onClick={() => void handleTranslate()}
          disabled={isTranslating}
          aria-expanded={isExpanded}
          aria-busy={isTranslating}
          aria-label={`${label} (${targetLanguage})`}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '999px',
            border: `1px solid ${mr.cardBorder}`,
            backgroundColor: isExpanded ? mr.gold : mr.card,
            color: isExpanded ? mr.goldText : mr.gold,
            fontSize: '11px',
            fontWeight: 700,
            cursor: isTranslating ? 'progress' : 'pointer',
            opacity: isTranslating ? 0.6 : 1,
            transition: 'background-color 0.15s ease, color 0.15s ease',
          }}
        >
          {/* Swap/sync glyph — the same affordance the referenced games use. */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 8h13l-3-3M20 16H7l3 3" />
          </svg>
          {label}
        </button>
      )}

      {error && (
        <p role="alert" data-testid="translate-error" style={{ margin: 0, fontSize: '11px', color: mr.error }}>
          {error}
        </p>
      )}

      {isExpanded && translatedContent && (
        <div
          data-testid="translated-content"
          data-target-language={targetLanguage}
          style={{
            marginTop: '2px',
            padding: '10px 12px',
            borderRadius: '12px',
            backgroundColor: mr.card,
            border: `1px solid ${mr.cardBorder}`,
            // Marks the machine's words as distinct from the sender's.
            borderLeft: `3px solid ${mr.gold}`,
            color: mr.heading,
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              display: 'block',
              marginBottom: '4px',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: mr.muted,
            }}
          >
            Translated
            {isSupportedLanguageCode(targetLanguage) ? ` → ${targetLanguage.toUpperCase()}` : ''}
          </span>
          {translatedContent}
        </div>
      )}
    </div>
  );
}
