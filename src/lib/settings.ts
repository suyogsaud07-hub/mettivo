import { supabase } from '@/lib/supabase';
import { isMissingColumnError } from '@/lib/postgrest-errors';

/**
 * Settings data access — notification and privacy preferences, plus the account
 * metadata the Account sheet renders.
 *
 * SHAPE OF THIS MODULE
 *   Mirrors `src/lib/preferences.ts`: an explicit column list, identity taken
 *   from `supabase.auth.getUser()` (never a caller argument), and a narrow set of
 *   thrown, user-safe errors for anything that failed.
 *
 * THE SOFT/LOUD SPLIT
 *   Reads fall back to documented defaults: a member who has never opened
 *   settings has no stored row, and a deployment that has not yet run the M20
 *   migration simply lacks the columns. Neither is an error worth blocking the
 *   screen for. Writes are the opposite — a save that silently did not happen is
 *   a lie, so they throw.
 */

/** Raised when a preference could not be validated or saved. */
export class SettingsError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
  }
}

export interface NotificationPreferences {
  notify_new_matches: boolean;
  notify_messages: boolean;
  notify_likes: boolean;
  notify_moments: boolean;
  notify_push: boolean;
  notify_email: boolean;
}

export type ProfileVisibility = 'public' | 'matches' | 'private';

export interface PrivacyPreferences {
  show_online_status: boolean;
  hide_distance: boolean;
  profile_visibility: ProfileVisibility;
}

/** Defaults mirror the M20 column defaults, so an un-migrated read is honest. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  notify_new_matches: true,
  notify_messages: true,
  notify_likes: true,
  notify_moments: true,
  notify_push: true,
  notify_email: false,
};

/** Defaults mirror the M20 column defaults. */
export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = {
  show_online_status: true,
  hide_distance: false,
  profile_visibility: 'public',
};

/** The closed set of profile visibilities, with the copy the sheet renders. */
export const PROFILE_VISIBILITY_OPTIONS: readonly {
  value: ProfileVisibility;
  label: string;
  description: string;
}[] = [
  {
    value: 'public',
    label: 'Everyone',
    description: 'Any member can find and view your profile.',
  },
  {
    value: 'matches',
    label: 'Matches only',
    description: 'Only people you have matched with can view your profile.',
  },
  {
    value: 'private',
    label: 'Only me',
    description: 'Your profile is hidden from discovery and other members.',
  },
];

export function normaliseVisibility(value: unknown): ProfileVisibility | null {
  return value === 'public' || value === 'matches' || value === 'private' ? value : null;
}

/** Metadata for the Account sheet, read from the auth user (not a table). */
export interface AccountMeta {
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  providers: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requireUserId(): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

/**
 * Reads a set of preference columns, falling back per column to the defaults.
 *
 * A missing row, a failed read, or a column that the M20 migration has not yet
 * added all resolve to the defaults rather than throwing.
 */
async function readPreferences(): Promise<Record<string, unknown> | null> {
  const userId = await requireUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('user_preferences')
    .select(
      'notify_new_matches, notify_messages, notify_likes, notify_moments, notify_push, notify_email, show_online_status, hide_distance, profile_visibility'
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // The M20 columns may not exist yet; the defaults are still correct.
    if (!isMissingColumnError(error)) {
      console.error('[settings] preference read failed:', error.message);
    }
    return null;
  }

  return isRecord(data) ? data : null;
}

function readBoolean(record: Record<string, unknown> | null, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const row = await readPreferences();
  return {
    notify_new_matches: readBoolean(row, 'notify_new_matches', DEFAULT_NOTIFICATION_PREFERENCES.notify_new_matches),
    notify_messages: readBoolean(row, 'notify_messages', DEFAULT_NOTIFICATION_PREFERENCES.notify_messages),
    notify_likes: readBoolean(row, 'notify_likes', DEFAULT_NOTIFICATION_PREFERENCES.notify_likes),
    notify_moments: readBoolean(row, 'notify_moments', DEFAULT_NOTIFICATION_PREFERENCES.notify_moments),
    notify_push: readBoolean(row, 'notify_push', DEFAULT_NOTIFICATION_PREFERENCES.notify_push),
    notify_email: readBoolean(row, 'notify_email', DEFAULT_NOTIFICATION_PREFERENCES.notify_email),
  };
}

export async function fetchPrivacyPreferences(): Promise<PrivacyPreferences> {
  const row = await readPreferences();
  return {
    show_online_status: readBoolean(row, 'show_online_status', DEFAULT_PRIVACY_PREFERENCES.show_online_status),
    hide_distance: readBoolean(row, 'hide_distance', DEFAULT_PRIVACY_PREFERENCES.hide_distance),
    profile_visibility:
      normaliseVisibility(row?.profile_visibility) ?? DEFAULT_PRIVACY_PREFERENCES.profile_visibility,
  };
}

async function upsertPreferences(patch: Record<string, unknown>): Promise<void> {
  const userId = await requireUserId();
  if (!userId) {
    throw new SettingsError('You need to be signed in to change your settings.', '28000');
  }

  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });

  if (error) {
    console.error('[settings] preference save failed:', error.message);
    throw new SettingsError(`We could not save that setting: ${error.message}`, error.code);
  }
}

/** Persists a partial notification update; only the supplied keys are written. */
export async function saveNotificationPreferences(
  patch: Partial<NotificationPreferences>
): Promise<void> {
  const clean: Record<string, boolean> = {};
  for (const key of Object.keys(patch) as (keyof NotificationPreferences)[]) {
    const value = patch[key];
    if (typeof value === 'boolean') clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return;
  await upsertPreferences(clean);
}

/** Persists a partial privacy update; only the supplied keys are written. */
export async function savePrivacyPreferences(patch: Partial<PrivacyPreferences>): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (typeof patch.show_online_status === 'boolean') {
    clean.show_online_status = patch.show_online_status;
  }
  if (typeof patch.hide_distance === 'boolean') clean.hide_distance = patch.hide_distance;
  if (patch.profile_visibility !== undefined) {
    const visibility = normaliseVisibility(patch.profile_visibility);
    if (!visibility) {
      throw new SettingsError('Choose who can see your profile.');
    }
    clean.profile_visibility = visibility;
  }
  if (Object.keys(clean).length === 0) return;
  await upsertPreferences(clean);
}

/**
 * Account metadata for the Account sheet.
 *
 * Email, phone and the creation date live on the auth user; the linked sign-in
 * providers are read from `identities` when present and from `app_metadata`
 * otherwise, so the list is correct for password, OAuth and phone accounts.
 */
export async function fetchAccountMeta(): Promise<AccountMeta> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new SettingsError('We could not load your account details.', error?.code);
  }

  const providers = new Set<string>();
  for (const identity of user.identities ?? []) {
    if (identity.provider) providers.add(identity.provider);
  }
  const fromMetadata = user.app_metadata?.providers;
  if (Array.isArray(fromMetadata)) {
    for (const provider of fromMetadata) {
      if (typeof provider === 'string') providers.add(provider);
    }
  }
  if (providers.size === 0 && user.app_metadata?.provider) {
    providers.add(String(user.app_metadata.provider));
  }

  return {
    email: user.email ?? null,
    phone: user.phone ?? null,
    createdAt: user.created_at ?? null,
    providers: Array.from(providers),
  };
}

/** The current account email, for pre-filling the change-email field. */
export async function currentEmail(): Promise<string> {
  const meta = await fetchAccountMeta();
  return meta.email ?? '';
}
