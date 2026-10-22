import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Profile-view and profile-like data access, against a mocked Supabase client.
 *
 * The database tests prove the RPCs' behaviour; these tests prove the browser
 * layer narrows payloads, surfaces errors instead of returning plausible
 * defaults, clamps pagination, and sends the privacy-relevant filters.
 */

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };

  const state = {
    table: { data: null, error: null } as Result,
    rpc: { data: null, error: null } as Result,
    user: { id: 'user-1' } as unknown,
    calls: [] as { method: string; args: unknown[] }[],
    reset() {
      state.table = { data: null, error: null };
      state.rpc = { data: null, error: null };
      state.user = { id: 'user-1' };
      state.calls = [];
    },
  };

  const makeChain = (result: Result) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'delete', 'eq']) {
      chain[method] = (...args: unknown[]) => {
        state.calls.push({ method, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ method: 'rpc', args: [fn, args] });
      return state.rpc;
    },
    from: (table: string) => {
      state.calls.push({ method: 'from', args: [table] });
      return makeChain(state.table);
    },
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }));

import {
  ProfileViewError,
  fetchProfileViewCount,
  fetchProfileViewSummary,
  fetchProfileViewers,
  recordProfileView,
} from '@/lib/profile-views';
import { isProfileLiked, likeProfile, unlikeProfile } from '@/lib/likes';

const summaryPayload = {
  unique_viewers: 4,
  returning_viewers: 2,
  total_visits: 9,
  most_recent_at: '2026-10-20T10:00:00.000Z',
};

const viewerPayload = {
  viewer_id: 'user-2',
  first_name: 'Bo',
  last_name: 'Brown',
  has_last_name: true,
  username: 'bo_brown',
  display_name: 'Bo Brown',
  avatar_url: null,
  is_online: true,
  first_viewed_at: '2026-10-01T09:00:00.000Z',
  last_viewed_at: '2026-10-20T09:00:00.000Z',
  view_count: 3,
  is_followed_by_me: true,
};

beforeEach(() => {
  h.state.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('profile-views.recordProfileView', () => {
  it('requires a profile id', async () => {
    await expect(recordProfileView('')).rejects.toBeInstanceOf(ProfileViewError);
  });

  it('requires a signed-in member', async () => {
    h.state.user = null;
    await expect(recordProfileView('user-2')).rejects.toMatchObject({
      name: 'ProfileViewError',
      code: '28000',
    });
  });

  it('calls the RPC with the viewed id and narrows the result', async () => {
    h.state.rpc = {
      data: {
        recorded: true,
        is_new_viewer: true,
        unique_viewers: 3,
        total_visits: 5,
        viewer_visits: 2,
      },
      error: null,
    };

    await expect(recordProfileView('user-2')).resolves.toEqual({
      recorded: true,
      reason: undefined,
      is_new_viewer: true,
      unique_viewers: 3,
      total_visits: 5,
      viewer_visits: 2,
    });
    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['record_profile_view', { p_viewed_id: 'user-2' }],
    });
  });

  it('surfaces a database error as ProfileViewError', async () => {
    h.state.rpc = { data: null, error: { message: 'boom', code: 'XX000' } };
    await expect(recordProfileView('user-2')).rejects.toMatchObject({
      name: 'ProfileViewError',
      message: 'boom',
      code: 'XX000',
    });
  });
});

describe('profile-views.fetchProfileViewCount', () => {
  it('returns the aggregate number', async () => {
    h.state.rpc = { data: 12, error: null };
    await expect(fetchProfileViewCount('user-1')).resolves.toBe(12);
  });

  it('returns 0 for a missing id without calling the RPC', async () => {
    await expect(fetchProfileViewCount('')).resolves.toBe(0);
    expect(h.state.calls).toHaveLength(0);
  });

  it('rejects a malformed payload rather than inventing a count', async () => {
    h.state.rpc = { data: 'twelve', error: null };
    await expect(fetchProfileViewCount('user-1')).rejects.toBeInstanceOf(ProfileViewError);
  });
});

describe('profile-views.fetchProfileViewSummary', () => {
  it('narrows the summary payload', async () => {
    h.state.rpc = { data: summaryPayload, error: null };
    await expect(fetchProfileViewSummary()).resolves.toEqual(summaryPayload);
  });

  it('rejects a summary missing its counters', async () => {
    h.state.rpc = { data: { unique_viewers: 1 }, error: null };
    await expect(fetchProfileViewSummary()).rejects.toBeInstanceOf(ProfileViewError);
  });
});

describe('profile-views.fetchProfileViewers', () => {
  it('clamps pagination, trims search, and drops malformed rows', async () => {
    h.state.rpc = { data: [viewerPayload, { viewer_id: null }], error: null };

    await expect(
      fetchProfileViewers({ limit: 500, offset: -4, search: '  Bo  ' })
    ).resolves.toEqual([
      {
        viewer_id: 'user-2',
        first_name: 'Bo',
        last_name: 'Brown',
        has_last_name: true,
        username: 'bo_brown',
        display_name: 'Bo Brown',
        avatar_url: null,
        is_online: true,
        first_viewed_at: '2026-10-01T09:00:00.000Z',
        last_viewed_at: '2026-10-20T09:00:00.000Z',
        view_count: 3,
        is_followed_by_me: true,
      },
    ]);

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: [
        'list_profile_viewers',
        { p_limit: 100, p_offset: 0, p_search: 'Bo' },
      ],
    });
  });

  it('rejects a non-array payload', async () => {
    h.state.rpc = { data: { viewers: [] }, error: null };
    await expect(fetchProfileViewers()).rejects.toBeInstanceOf(ProfileViewError);
  });
});

describe('profile likes', () => {
  it('likes through the existing record_like RPC', async () => {
    h.state.rpc = {
      data: { liked: true, matched: false, match_id: null, matched_user_id: null },
      error: null,
    };

    await expect(likeProfile('user-2')).resolves.toEqual({
      liked: true,
      matched: false,
      match_id: null,
      matched_user_id: null,
    });
    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['record_like', { target_user: 'user-2', is_like_value: true }],
    });
  });

  it('unlikes by deleting only an active like, never a pass', async () => {
    await unlikeProfile('user-2');

    expect(h.state.calls).toContainEqual({ method: 'from', args: ['likes'] });
    expect(h.state.calls).toContainEqual({ method: 'delete', args: [] });
    expect(h.state.calls).toContainEqual({
      method: 'eq',
      args: ['liker_id', 'user-1'],
    });
    expect(h.state.calls).toContainEqual({
      method: 'eq',
      args: ['liked_id', 'user-2'],
    });
    expect(h.state.calls).toContainEqual({ method: 'eq', args: ['is_like', true] });
  });

  it('rejects unliking yourself before touching the table', async () => {
    await expect(unlikeProfile('user-1')).rejects.toThrow(/cannot like yourself/i);
    expect(h.state.calls).toHaveLength(0);
  });

  it('treats a pass as not liked and filters on is_like', async () => {
    h.state.table = { data: null, error: null };
    await expect(isProfileLiked('user-2')).resolves.toBe(false);
    expect(h.state.calls).toContainEqual({ method: 'eq', args: ['is_like', true] });
  });

  it('degrades a read failure to false', async () => {
    h.state.table = { data: null, error: { message: 'offline' } };
    await expect(isProfileLiked('user-2')).resolves.toBe(false);
  });
});
