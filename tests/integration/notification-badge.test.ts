import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Notification read-state and the shared badge.
 *
 * Opening Notifications must mark only the signed-in member's currently-unread
 * rows, then clear the badge that `MobileNav` renders. A failure must surface,
 * never be reported as success.
 */

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown; count?: number | null };

  const state = {
    table: { data: null, error: null, count: null } as Result,
    user: { id: 'user-1' } as unknown,
    calls: [] as { method: string; args: unknown[] }[],
    reset() {
      state.table = { data: null, error: null, count: null };
      state.user = { id: 'user-1' };
      state.calls = [];
    },
  };

  const makeChain = (result: Result) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'eq', 'is', 'order', 'limit']) {
      chain[method] = (...args: unknown[]) => {
        state.calls.push({ method, args });
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      state.calls.push({ method: 'from', args: [table] });
      return makeChain(state.table);
    },
  };

  return { state, supabase };
});

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }));

import { markAllNotificationsRead, markNotificationRead, NotificationError } from '@/lib/notifications';
import {
  getNotificationUnreadSnapshot,
  refreshNotificationUnreadCount,
  setNotificationUnreadCount,
  subscribeToNotificationUnread,
} from '@/lib/notification-badge';

beforeEach(() => {
  h.state.reset();
  setNotificationUnreadCount(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('mark-all read', () => {
  it('updates only the signed-in member’s unread rows', async () => {
    await markAllNotificationsRead();

    expect(h.state.calls).toContainEqual({ method: 'from', args: ['notifications'] });
    expect(h.state.calls).toContainEqual({
      method: 'update',
      args: [{ read_at: expect.any(String) }],
    });
    expect(h.state.calls).toContainEqual({ method: 'eq', args: ['user_id', 'user-1'] });
    expect(h.state.calls).toContainEqual({ method: 'is', args: ['read_at', null] });
  });

  it('requires a trusted session rather than taking a user id parameter', async () => {
    h.state.user = null;

    await expect(markAllNotificationsRead()).rejects.toMatchObject({
      name: 'NotificationError',
      code: '28000',
    });
    expect(h.state.calls.some((call) => call.method === 'from')).toBe(false);
  });

  it('reports a failed bulk update instead of pretending it succeeded', async () => {
    h.state.table = {
      data: null,
      error: { code: '42501', message: 'permission denied for table notifications' },
      count: null,
    };

    await expect(markAllNotificationsRead()).rejects.toBeInstanceOf(NotificationError);
  });

  it('rejects an empty notification id before contacting the database', async () => {
    await expect(markNotificationRead('')).rejects.toBeInstanceOf(NotificationError);
    expect(h.state.calls).toHaveLength(0);
  });
});

describe('shared unread badge', () => {
  it('reads the caller’s unread count and publishes it to subscribers', async () => {
    h.state.table = { data: null, error: null, count: 4 };

    const seen: number[] = [];
    const unsubscribe = subscribeToNotificationUnread(() => {
      seen.push(getNotificationUnreadSnapshot());
    });

    await refreshNotificationUnreadCount();
    unsubscribe();

    expect(getNotificationUnreadSnapshot()).toBe(4);
    expect(seen).toContain(4);
  });

  it('clears the badge immediately after a successful bulk read', async () => {
    h.state.table = { data: null, error: null, count: 7 };
    await refreshNotificationUnreadCount();
    expect(getNotificationUnreadSnapshot()).toBe(7);

    setNotificationUnreadCount(0);
    expect(getNotificationUnreadSnapshot()).toBe(0);
  });

  it('never publishes a negative count', () => {
    setNotificationUnreadCount(-3);
    expect(getNotificationUnreadSnapshot()).toBe(0);
  });
});
