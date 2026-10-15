import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §3.2 — the Settings data-access modules against a mocked Supabase client.
 *
 * Two behaviours are load-bearing and modelled here:
 *
 *   * READS ARE SOFT. `fetchNotificationPreferences` / `fetchPrivacyPreferences`
 *     must never blank the screen for a member who has no stored row, or a
 *     deployment that has not yet run the M20 migration. Both resolve to the
 *     documented defaults.
 *   * WRITES ARE LOUD. A save that silently did not happen is a lie, so a failed
 *     `upsert` must throw rather than resolve.
 *
 * Avatar upload is checked for the same reason: it must reject a non-image or an
 * oversize file locally, and surface a Storage failure instead of reporting a
 * success the profile row never received.
 */

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };

  const state = {
    row: { data: null, error: null } as Result,
    upsert: { error: null } as { error: unknown },
    upsertArgs: null as { values: Record<string, unknown>; options: unknown } | null,
    upload: { error: null } as { error: unknown },
    publicUrl: 'https://cdn.test/storage/v1/object/public/avatars/user-1/pic.webp',
    removed: [] as string[][],
    user: null as Record<string, unknown> | null,
    reset() {
      state.row = { data: null, error: null };
      state.upsert = { error: null };
      state.upsertArgs = null;
      state.upload = { error: null };
      state.removed = [];
      state.user = {
        id: 'user-1',
        email: 'ada@example.com',
        phone: null,
        created_at: '2024-01-02T00:00:00.000Z',
        identities: [{ provider: 'email' }],
        app_metadata: { providers: ['email'] },
      };
    },
  };

  const makeReadChain = (result: Result) => {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) chain[method] = passthrough;
    chain.single = async () => result;
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: () => ({
      select: () => makeReadChain(state.row),
      upsert: (values: Record<string, unknown>, options: unknown) => {
        state.upsertArgs = { values, options };
        return Promise.resolve(state.upsert);
      },
    }),
    storage: {
      from: () => ({
        upload: async () => state.upload,
        getPublicUrl: () => ({ data: { publicUrl: state.publicUrl } }),
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { error: null };
        },
      }),
    },
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }));

vi.mock('@/lib/media', () => ({
  MediaError: class MediaError extends Error {},
  isImageFile: (file: File) => file.type.startsWith('image/'),
  prepareMedia: async (file: File) => ({
    mediaType: 'image',
    blob: file,
    previewUrl: '',
    width: 10,
    height: 10,
  }),
}));

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  SettingsError,
  fetchAccountMeta,
  fetchNotificationPreferences,
  fetchPrivacyPreferences,
  saveNotificationPreferences,
  savePrivacyPreferences,
  type ProfileVisibility,
} from '@/lib/settings';
import { AvatarError, saveAvatar } from '@/lib/avatar';

function fakeFile(name: string, type: string, size: number): File {
  return { name, type, size } as unknown as File;
}

beforeEach(() => {
  h.state.reset();
  vi.clearAllMocks();
});

describe('settings preferences', () => {
  it('falls back to the documented defaults when there is no stored row', async () => {
    h.state.row = { data: null, error: null };
    await expect(fetchNotificationPreferences()).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('treats a missing M20 column as "use the defaults", not an error', async () => {
    h.state.row = {
      data: null,
      error: { code: '42703', message: 'column user_preferences.notify_push does not exist' },
    };
    await expect(fetchNotificationPreferences()).resolves.toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('reads stored booleans', async () => {
    h.state.row = {
      data: {
        notify_new_matches: false,
        notify_messages: true,
        notify_likes: true,
        notify_moments: false,
        notify_push: false,
        notify_email: true,
      },
      error: null,
    };
    await expect(fetchNotificationPreferences()).resolves.toEqual({
      notify_new_matches: false,
      notify_messages: true,
      notify_likes: true,
      notify_moments: false,
      notify_push: false,
      notify_email: true,
    });
  });

  it('normalises an unknown visibility back to the default', async () => {
    h.state.row = {
      data: { show_online_status: false, hide_distance: true, profile_visibility: 'weird' },
      error: null,
    };
    await expect(fetchPrivacyPreferences()).resolves.toEqual({
      show_online_status: false,
      hide_distance: true,
      profile_visibility: 'public',
    });
  });

  it('saves only the supplied keys, keyed on user_id', async () => {
    await saveNotificationPreferences({ notify_likes: false });
    expect(h.state.upsertArgs).toEqual({
      values: { user_id: 'user-1', notify_likes: false },
      options: { onConflict: 'user_id' },
    });
  });

  it('throws when a save is attempted while signed out', async () => {
    h.state.user = null;
    await expect(saveNotificationPreferences({ notify_likes: false })).rejects.toBeInstanceOf(
      SettingsError
    );
  });

  it('throws when the database rejects the save', async () => {
    h.state.upsert = { error: { code: '42501', message: 'permission denied' } };
    await expect(saveNotificationPreferences({ notify_likes: false })).rejects.toBeInstanceOf(
      SettingsError
    );
  });

  it('rejects an invalid visibility before it reaches the database', async () => {
    await expect(
      savePrivacyPreferences({ profile_visibility: 'friends' as ProfileVisibility })
    ).rejects.toBeInstanceOf(SettingsError);
  });
});

describe('account metadata', () => {
  it('maps the auth user to the fields the Account sheet renders', async () => {
    await expect(fetchAccountMeta()).resolves.toEqual({
      email: 'ada@example.com',
      phone: null,
      createdAt: '2024-01-02T00:00:00.000Z',
      providers: ['email'],
    });
  });

  it('throws when there is no signed-in user', async () => {
    h.state.user = null;
    await expect(fetchAccountMeta()).rejects.toBeInstanceOf(SettingsError);
  });
});

describe('avatar upload', () => {
  it('rejects a file that is not an image', async () => {
    await expect(saveAvatar(fakeFile('doc.pdf', 'application/pdf', 1024))).rejects.toBeInstanceOf(
      AvatarError
    );
  });

  it('rejects an image over the size ceiling', async () => {
    await expect(
      saveAvatar(fakeFile('huge.jpg', 'image/jpeg', 9 * 1024 * 1024))
    ).rejects.toBeInstanceOf(AvatarError);
  });

  it('uploads, points avatar_url at the object, and returns the URL', async () => {
    const url = await saveAvatar(fakeFile('pic.jpg', 'image/jpeg', 1024));
    expect(url).toBe(h.state.publicUrl);
    expect(h.state.upsertArgs).toEqual({
      values: { id: 'user-1', avatar_url: h.state.publicUrl },
      options: { onConflict: 'id' },
    });
  });

  it('surfaces a Storage failure instead of reporting success', async () => {
    h.state.upload = { error: { message: 'new row violates row-level security policy' } };
    await expect(saveAvatar(fakeFile('pic.jpg', 'image/jpeg', 1024))).rejects.toBeInstanceOf(
      AvatarError
    );
  });

  it('does not try to delete a legacy data: URL', async () => {
    await saveAvatar(fakeFile('pic.jpg', 'image/jpeg', 1024), 'data:image/png;base64,AAAA');
    expect(h.state.removed).toEqual([]);
  });

  it('removes the previous avatar when it lived in our bucket', async () => {
    await saveAvatar(
      fakeFile('pic.jpg', 'image/jpeg', 1024),
      'https://x.supabase.co/storage/v1/object/public/avatars/user-1/old.png'
    );
    expect(h.state.removed).toEqual([['user-1/old.png']]);
  });
});
