// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { UserResponse } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { rewindLastLike, LikeError } from '@/lib/likes';

vi.mock('@/lib/supabase', () => {
  const readLimit = vi.fn();
  const readOrder = vi.fn(() => ({ order: readOrder, limit: readLimit }));
  const readEq = vi.fn(() => ({ order: readOrder }));
  const readSelect = vi.fn(() => ({ eq: readEq }));

  const delSelect = vi.fn();
  const delEq3 = vi.fn(() => ({ select: delSelect }));
  const delEq2 = vi.fn(() => ({ eq: delEq3 }));
  const delEq1 = vi.fn(() => ({ eq: delEq2 }));
  const delDelete = vi.fn(() => ({ eq: delEq1 }));

  const from = vi.fn(() => ({ select: readSelect, delete: delDelete }));
  const getUser = vi.fn();

  const mockedSupabase = {
    from,
    auth: { getUser },
    __mocks: {
      readLimit,
      delSelect,
      readOrder,
      readEq,
      readSelect,
      delEq1,
      delEq2,
      delEq3,
      delDelete,
      getUser,
    },
  };
  return { supabase: mockedSupabase };
});

const mockedSupabase = vi.mocked(supabase) as unknown as {
  from: ReturnType<typeof import('@/lib/supabase').supabase.from>;
  auth: { getUser: ReturnType<typeof vi.fn> };
  __mocks: {
    readLimit: ReturnType<typeof vi.fn>;
    delSelect: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
};
const mockFrom = vi.mocked(mockedSupabase.from);
const mockReadLimit = vi.mocked(mockedSupabase.__mocks.readLimit);
const mockDelSelect = vi.mocked(mockedSupabase.__mocks.delSelect);
const mockGetUser = vi.mocked(mockedSupabase.__mocks.getUser);

describe('rewindLastLike', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewinds the most recent like and returns the target', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'me' } },
      error: null,
    } as unknown as UserResponse);
    mockReadLimit.mockResolvedValue({
      data: [{ id: 'like-1', liked_id: 'target-1', is_like: true, updated_at: 't1' }],
      error: null,
    });
    mockDelSelect.mockResolvedValue({ data: [{ liked_id: 'target-1', is_like: true }], error: null });

    const result = await rewindLastLike();

    expect(result).toEqual({ targetUserId: 'target-1', wasLike: true });
    expect(mockFrom).toHaveBeenCalledWith('likes');
  });

  it('returns null when there is no decision history', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'me' } },
      error: null,
    } as unknown as UserResponse);
    mockReadLimit.mockResolvedValue({ data: [], error: null });

    const result = await rewindLastLike();

    expect(result).toBeNull();
  });

  it('throws when not signed in', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    } as unknown as UserResponse);

    await expect(rewindLastLike()).rejects.toBeInstanceOf(LikeError);
  });

  it('throws when the optimistic delete affects no rows (concurrent decision)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'me' } },
      error: null,
    } as unknown as UserResponse);
    mockReadLimit.mockResolvedValue({
      data: [{ id: 'like-1', liked_id: 'target-1', is_like: true, updated_at: 't1' }],
      error: null,
    });
    mockDelSelect.mockResolvedValue({ data: [], error: null });

    await expect(rewindLastLike()).rejects.toBeInstanceOf(LikeError);
  });
});
