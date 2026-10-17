import { supabase } from '@/lib/supabase';
import { DEFAULT_TRANSLATION_LANGUAGE, normaliseLanguageCode } from '@/lib/translation';
import { isLocaleCode } from '@/lib/locales';

/**
 * M17 — the member's translation preference, client side.
 *
 * Mirrors `src/lib/profile.ts`: a typed export, a thrown, user-safe error for
 * anything that failed, and an explicit column list rather than `select('*')`.
 *
 * THE ONE DELIBERATE SOFT FAILURE
 *   `fetchPreferredTranslationLanguage()` returns the default instead of
 *   throwing. A preference is decoration around a conversation: if the read
 *   fails, the member still sees their chat, and a missing row is the normal
 *   state for a member who has never opened settings. `savePreferredTranslation-
 *   Language()` is the opposite — a save that silently did not happen is a lie,
 *   so it throws.
 *
 * Identity comes from `supabase.auth.getUser()`, never from a caller argument
 * (`CONSTITUTION.md` Article 1.2), and the RLS policy on `user_preferences`
 * enforces the same scope in the database.
 */

/**
 * Re-exported from `src/lib/translation.ts`, where the value lives so the server
 * route can use the same default without importing this module (and therefore
 * the browser client). The settings surface imports it from here.
 */
export { DEFAULT_TRANSLATION_LANGUAGE };

/** Raised when a preference could not be validated or saved. */
export class PreferencesError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PreferencesError';
    this.code = code;
  }
}

function readPreferredLanguage(row: unknown): string | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const value = (row as Record<string, unknown>).preferred_translation_language;
  return typeof value === 'string' ? normaliseLanguageCode(value) : null;
}

/**
 * The language this member wants incoming messages translated into.
 *
 * Never throws and never blocks a conversation:
 *   * no session              → the default,
 *   * no row yet              → the default,
 *   * a read error or a throw → logged, then the default.
 *
 * The returned value is always a member of `SUPPORTED_LANGUAGE_CODES`, so a
 * caller can feed it straight into a translation request.
 */
export async function fetchPreferredTranslationLanguage(): Promise<string> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      // Expected whenever the page renders before the session is restored; not
      // worth a log line on its own.
      return DEFAULT_TRANSLATION_LANGUAGE;
    }

    const { data, error } = await supabase
      .from('user_preferences')
      .select('preferred_translation_language')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[preferences] load failed:', error.message);
      return DEFAULT_TRANSLATION_LANGUAGE;
    }

    return readPreferredLanguage(data) ?? DEFAULT_TRANSLATION_LANGUAGE;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[preferences] load threw:', message);
    return DEFAULT_TRANSLATION_LANGUAGE;
  }
}

/**
 * Stores the member's preferred translation language.
 *
 * Upsert, keyed on `user_id`: a row may legitimately not exist yet (the settings
 * page is the first write for most members), and a bare `update()` would affect
 * zero rows and report success — a silent data-loss bug (`AGENTS.md` #6).
 */
export async function savePreferredTranslationLanguage(code: string): Promise<void> {
  const normalised = normaliseLanguageCode(code);
  if (!normalised) {
    throw new PreferencesError('Choose a language Mettivo can translate into.');
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new PreferencesError(
      'You need to be signed in to save your language preference.',
      userError?.code
    );
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      { user_id: user.id, preferred_translation_language: normalised },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('[preferences] save failed:', error.message);
    throw new PreferencesError(
      `We could not save your language preference: ${error.message}`,
      error.code
    );
  }
}

/**
 * The member's chosen interface (UI) language, or `null` when there is no
 * session or nothing has been stored yet.
 *
 * Soft-fails like `fetchPreferredTranslationLanguage`: a member who has never
 * opened Settings has no row, which is normal, and a transient read error must
 * not stop the app from rendering.
 */
export async function fetchInterfaceLanguage(): Promise<string | null> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return null;

    const { data, error } = await supabase
      .from('user_preferences')
      .select('interface_language')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[preferences] interface language load failed:', error.message);
      return null;
    }

    const value =
      typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>).interface_language
        : null;

    return typeof value === 'string' && isLocaleCode(value) ? value : null;
  } catch (err) {
    console.error('[preferences] interface language load threw:', err);
    return null;
  }
}

/**
 * Stores the member's chosen interface language.
 *
 * Upsert keyed on `user_id`, like the translation preference: the row may not
 * exist yet, and a bare `update()` would report success on zero rows.
 */
export async function saveInterfaceLanguage(code: string): Promise<void> {
  if (!isLocaleCode(code)) {
    throw new PreferencesError('Choose a language Mettivo supports.');
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new PreferencesError(
      'You need to be signed in to save your language preference.',
      userError?.code
    );
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: user.id, interface_language: code }, { onConflict: 'user_id' });

  if (error) {
    console.error('[preferences] interface language save failed:', error.message);
    throw new PreferencesError(
      `We could not save your language preference: ${error.message}`,
      error.code
    );
  }
}
