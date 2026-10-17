'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { LOCALE_OPTIONS, localeName, type LocaleCode } from '@/lib/locales';

/**
 * The top-right language trigger that matches the Bumble header pattern.
 *
 * Trigger: a rounded-2xl box (`h-11`, `px-4`, `#29202D` surface, `#F2E9E4`
 * text) carrying a globe icon and a chevron. Clicking it opens a floating
 * glassmorphic card anchored beneath the globe button.
 *
 * Floating card: `#F2E9E4` fill with a `#D4B18C` hairline and a soft shadow,
 * positioned absolutely below the trigger. It is shifted inward so it never
 * touches the right edge of the viewport. A sticky "SELECT LANGUAGE" header
 * sits above a scrollable list (`max-h-[400px]`) of every translated language.
 * Picking one writes `mettivo_preferred_lang` to localStorage and updates the
 * translation context so the whole page re-renders in the chosen language.
 */

export default function HeaderLanguageDropdown() {
  const { language, changeLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState(language);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  /** Persist to localStorage (the key the brief names) and sync translations. */
  const persist = useCallback(
    (code: LocaleCode) => {
      try {
        window.localStorage.setItem('mettivo_preferred_lang', code);
      } catch {
        // localStorage can throw in private mode; the context still applies.
      }
      changeLanguage(code);
      setSelectedCode(code);
      setIsOpen(false);
    },
    [changeLanguage]
  );

  // Measure the trigger so the card opens exactly beneath the globe button.
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAnchor({ left: rect.right, top: rect.bottom + 10 });
  }, [isOpen]);

  const close = useCallback(() => setIsOpen(false), []);

  // Click outside closes.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [close]);

  const Chevron = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transition: 'transform 0.2s ease',
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onClick={() => setIsOpen(!isOpen)}
      role="button"
      tabIndex={0}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
      aria-label={`Select language. Current: ${localeName(language)}`}
    >
      {/* Trigger button: rounded-2xl, h-11, px-4, #29202D surface. */}
      <button
        type="button"
        className="flex items-center gap-2 rounded-2xl h-11 px-4 bg-[#29202D] border border-transparent text-[#F2E9E4] text-sm font-medium shadow-sm hover:bg-[#3a303d] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4B18A]"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '16px' }}>
          🌐
        </span>
        <span className="hidden sm:inline truncate">{localeName(language)}</span>
        {Chevron}
      </button>

      {/* Floating card, anchored under the trigger and shifted inward. */}
      {isOpen && anchor && (
        <div
          style={{
            position: 'fixed',
            // Align the card's right edge with the trigger's right edge, then
            // shift it inward so it never clips the viewport's right edge.
            left: Math.min(anchor.left - 320 + 44, window.innerWidth - 336 - 16),
            top: anchor.top,
            width: 320,
            zIndex: 60,
          }}
        >
          <div className="bg-[#F2E9E4] border border-[#D4B18A] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.75)] rounded-xl overflow-hidden flex flex-col">
            {/* Sticky header: globe icon + "SELECT LANGUAGE". */}
            <div className="border-b border-[#D4B18A]/50 bg-[#F2E9E4]/90 px-4 py-3 flex items-center gap-2 sticky top-0 z-10">
              <span className="text-[#17121C]" style={{ fontSize: '16px' }}>
                🌐
              </span>
              <span className="text-[#17121C] text-xs font-semibold tracking-wider uppercase leading-none">
                SELECT LANGUAGE
              </span>
            </div>

            {/* Scrollable language list. */}
            <div className="max-h-[400px] overflow-y-auto px-2 py-2">
              {LOCALE_OPTIONS.map((option) => {
                const active = option.code === selectedCode;
                return (
                  <button
                    key={option.code}
                    type="button"
                    onClick={() => persist(option.code)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                      active
                        ? 'bg-[#4A1828] text-[#F2E9E4] font-semibold'
                        : 'hover:bg-[#17121C] hover:text-[#4A1828] text-[#17121C]'
                    }`}
                  >
                    {option.nativeName}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
