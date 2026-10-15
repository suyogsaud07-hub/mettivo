'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import {
  LOCALE_OPTIONS,
  localeName,
  localeNativeName,
  searchLocales,
  type LocaleCode,
} from '@/lib/locales';

/**
 * The global language picker.
 *
 * WHAT MAKES IT FUNCTIONAL RATHER THAN DECORATIVE
 *   Selecting an entry calls `changeLanguage`, which writes the member's choice
 *   and re-renders every consumer of `useLanguage()` through
 *   `useSyncExternalStore`. The list is not a display list: every code in it has
 *   strings in `src/lib/locale-data.ts`, so choosing one actually changes the UI
 *   text. A code with no strings is not in `LOCALE_CODES`, and therefore cannot
 *   reach this component at all.
 *
 * THE SEARCH FIELD IS NOT OPTIONAL POLISH
 *   There are ~50 languages. Scrolling a 50-row list on a phone to find Korean
 *   is a worse experience than typing "kor". The field searches the English
 *   name, the native name AND a small alias table, so "mandarin", "日本語" and
 *   "japanese" all reach the same row.
 *
 * ACCESSIBILITY
 *   A combobox: the trigger owns `aria-expanded`/`aria-controls`, the list is a
 *   `listbox` of `option` rows with `aria-selected`, and the active row is
 *   tracked with `aria-activedescendant` while the input keeps focus. Arrow keys,
 *   Home/End, Enter and Escape all work, which matters because a 50-item list is
 *   unusable by keyboard otherwise.
 *
 * STYLING
 *   "Midnight Romance": `#211a28` surface, `#34283f` border, `#eae2f0` text, and
 *   `#4a1c2e` for the selected row. The palette is read from the `--mr-*` tokens
 *   in `globals.css` so this cannot drift from the rest of the auth/brand surface.
 */

const mr = {
  surface: 'var(--mr-card)',
  border: 'var(--mr-card-border)',
  accent: 'var(--mr-gold)',
  accentText: 'var(--mr-gold-text)',
  text: 'var(--mr-heading)',
  muted: 'var(--mr-placeholder)',
  selected: 'var(--mr-burgundy)',
  selectedBorder: 'var(--mr-burgundy-border)',
  input: 'var(--mr-input)',
  inputBorder: 'var(--mr-input-border)',
} as const;

const LIST_ID = 'mettivo-language-listbox';

export interface LanguagePickerProps {
  /** Rendered width of the trigger. Defaults to a comfortable 220px. */
  width?: number | string;
  /** `chip` is the compact landing-header treatment; `row` is the settings row. */
  appearance?: 'chip' | 'row';
}

export default function LanguagePicker({ width = 220, appearance = 'chip' }: LanguagePickerProps) {
  const { language, changeLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const results = useMemo(() => searchLocales(query), [query]);

  /**
   * Open/close with a focus contract: opening focuses the search field so the
   * member can type immediately, and closing returns focus to the trigger rather
   * than dropping it to the document body.
   */
  const open = () => {
    setQuery('');
    setActiveIndex(Math.max(0, results.findIndex((option) => option.code === language)));
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const select = (code: LocaleCode) => {
    changeLanguage(code);
    close();
  };

  // Focus the search field once the panel exists.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Click outside closes. Pointerdown rather than click so the panel is gone
  // before a stray click on the page behind it is handled.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  // Keep the highlighted row in view while arrowing through the list.
  useEffect(() => {
    if (!isOpen) return;
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, results.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = results[activeIndex];
        if (option) select(option.code);
        break;
      }
      default:
        break;
    }
  };

  const currentNative = localeNativeName(language);

  const isRow = appearance === 'row';

  const triggerStyle: React.CSSProperties = isRow
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'none',
        border: 'none',
        color: mr.muted,
        fontSize: '13px',
        cursor: 'pointer',
        padding: 0,
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        maxWidth: width,
        padding: '8px 12px',
        borderRadius: '999px',
        backgroundColor: mr.surface,
        border: `1px solid ${mr.border}`,
        color: mr.text,
        fontSize: '13px',
        cursor: 'pointer',
      };

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onKeyDown={handleKeyDown}>
      <button
        type="button"
        data-testid="language-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? LIST_ID : undefined}
        aria-label={`Change language. Current: ${localeName(language)}`}
        onClick={() => (isOpen ? close() : open())}
        style={triggerStyle}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span data-testid="language-trigger-label" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {currentNative}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          data-testid="language-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 200,
            width: 'min(92vw, 320px)',
            backgroundColor: mr.surface,
            border: `1px solid ${mr.border}`,
            borderRadius: '16px',
            boxShadow: '0 18px 40px rgba(0, 0, 0, 0.55)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '12px 12px 8px' }}>
            <label htmlFor="mettivo-language-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
              Search languages
            </label>
            <input
              id="mettivo-language-search"
              ref={inputRef}
              data-testid="language-search"
              type="search"
              role="combobox"
              autoComplete="off"
              aria-expanded={isOpen}
              aria-controls={LIST_ID}
              aria-activedescendant={
                results[activeIndex] ? `mettivo-lang-${results[activeIndex].code}` : undefined
              }
              placeholder="Search languages…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '10px',
                border: `1px solid ${mr.inputBorder}`,
                backgroundColor: mr.input,
                color: mr.text,
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <ul
            id={LIST_ID}
            role="listbox"
            aria-label="Languages"
            data-testid="language-list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: '0 8px 8px',
              maxHeight: '46vh',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              // Smooth, slim scrollbar for a long list. `scrollbar-width` covers
              // Firefox and Chromium 121+; `scrollbarColor` is the modern
              // standard that replaces the old ::-webkit-scrollbar overrides.
              scrollbarWidth: 'thin',
              scrollbarColor: `${mr.border} transparent`,
            }}
          >
            {results.length === 0 && (
              <li
                data-testid="language-empty"
                style={{ padding: '14px 10px', color: mr.muted, fontSize: '13px', textAlign: 'center' }}
              >
                No language matches “{query}”.
              </li>
            )}

            {results.map((option, index) => {
              const isSelected = option.code === language;
              const isActive = index === activeIndex;

              return (
                <li key={option.code} role="none">
                  <button
                    type="button"
                    id={`mettivo-lang-${option.code}`}
                    ref={(node) => {
                      rowRefs.current[index] = node;
                    }}
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`language-option-${option.code}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(option.code)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      width: '100%',
                      padding: '10px 12px',
                      marginTop: '2px',
                      borderRadius: '10px',
                      border: `1px solid ${isSelected ? mr.selectedBorder : 'transparent'}`,
                      backgroundColor: isSelected ? mr.selected : isActive ? 'rgba(216, 179, 138, 0.10)' : 'transparent',
                      color: mr.text,
                      textAlign: 'left',
                      fontSize: '14px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
                      <span style={{ fontWeight: isSelected ? 700 : 500 }}>{option.nativeName}</span>
                      {/* Omitted when the endonym IS the English name ("English",
                          "Nepali"), which would otherwise print twice. */}
                      {option.nativeName !== option.englishName && (
                        <span style={{ fontSize: '11px', color: mr.muted }}>{option.englishName}</span>
                      )}
                    </span>
                    {isSelected && (
                      <span aria-hidden="true" style={{ color: mr.accent, fontWeight: 700 }}>
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/*
            Honesty note. These strings are machine-translated (see
            scripts/generate-locales.mjs); saying so is better than letting a
            member assume a human reviewed their language.
          */}
          <p
            style={{
              margin: 0,
              padding: '8px 14px 12px',
              borderTop: `1px solid ${mr.border}`,
              color: mr.muted,
              fontSize: '10px',
              lineHeight: 1.5,
            }}
          >
            {LOCALE_OPTIONS.length} languages available · translations are machine-generated and
            being improved
          </p>
        </div>
      )}
    </div>
  );
}
