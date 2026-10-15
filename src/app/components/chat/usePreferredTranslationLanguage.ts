'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  fetchPreferredTranslationLanguage,
  savePreferredTranslationLanguage,
} from '@/lib/preferences';
import { isSupportedLanguageCode } from '@/lib/translation';

/**
 * The language a member's incoming chat messages should be translated into.
 *
 * Shared by `/chat/[matchId]` (which needs it per message) and
 * `/profile/settings` (which changes it), so the two can never disagree about
 * what is currently selected.
 *
 * WHY A HOOK AND NOT A CONTEXT PROVIDER
 *   Only two screens care, and they are never mounted together. A provider would
 *   add a fetch to every page that happens to sit under it; this fetches where
 *   it is actually used. If a third consumer appears, promote it to
 *   `useSyncExternalStore` per CODING_STANDARDS §2.
 *
 * FAILURE POLICY
 *   A preference is never worth blocking a chat screen over. Any error falls
 *   back to the default and is logged; `save` reports failure to the caller so
 *   the settings UI can show a real message.
 */
export interface PreferredTranslationLanguage {
  /** Current value; always a supported code. */
  language: string;
  /** True until the stored value has been read. */
  isLoading: boolean;
  /** Persists a new value. Throws a `PreferencesError` the caller can render. */
  save: (code: string) => Promise<void>;
}

export function usePreferredTranslationLanguage(): PreferredTranslationLanguage {
  const [language, setLanguage] = useState<string>(DEFAULT_TRANSLATION_LANGUAGE);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    void fetchPreferredTranslationLanguage()
      .then((stored) => {
        if (!isMounted) return;
        // Defensive: the data module already falls back, but a value that
        // reached the state anyway must not be able to reach a request URL.
        setLanguage(isSupportedLanguageCode(stored) ? stored : DEFAULT_TRANSLATION_LANGUAGE);
      })
      .catch((err: unknown) => {
        console.error('[preferences] could not read translation language:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const save = useCallback(async (code: string): Promise<void> => {
    await savePreferredTranslationLanguage(code);
    setLanguage(code);
  }, []);

  return { language, isLoading, save };
}
