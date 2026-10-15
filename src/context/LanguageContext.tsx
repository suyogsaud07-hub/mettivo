'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { translations, type Language, type TranslationKey } from '@/lib/translations';

const STORAGE_KEY = 'mettivo_language';
const DEFAULT_LANGUAGE: Language = 'en';

/**
 * The selected language lives in localStorage, which is external state. It is
 * therefore exposed through `useSyncExternalStore` rather than copied into
 * component state inside an effect (which would cause a cascading render).
 */
const listeners = new Set<() => void>();

/** In-memory value, so a failed/blocked localStorage write still applies. */
let memoryLanguage: Language | null = null;

function isLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(translations, value)
  );
}

function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // localStorage can throw in private mode / sandboxed iframes.
    return DEFAULT_LANGUAGE;
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);

  // Keep other tabs in sync.
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      memoryLanguage = null;
      onStoreChange();
    }
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', handleStorage);
  };
}

function getSnapshot(): Language {
  return memoryLanguage ?? readStoredLanguage();
}

function getServerSnapshot(): Language {
  // The server has no localStorage, so always render the default language on
  // the server and during hydration.
  return DEFAULT_LANGUAGE;
}

/** Persist and broadcast a language change. */
export function setLanguagePreference(language: Language) {
  memoryLanguage = language;

  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore storage failures (private mode); the in-memory value still applies.
  }

  emit();
}

interface LanguageContextProps {
  language: Language;
  changeLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const changeLanguage = useCallback((lang: Language) => {
    setLanguagePreference(lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string =>
      translations[language]?.[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key,
    [language]
  );

  const value = useMemo(
    () => ({ language, changeLanguage, t }),
    [language, changeLanguage, t]
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
