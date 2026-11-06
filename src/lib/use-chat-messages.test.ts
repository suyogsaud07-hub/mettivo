// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { supabase } from '@/lib/supabase';
import { useChatMessages } from '@/lib/use-chat-messages';
import type { ChatMessage } from '@/lib/chat-types';
import type { MessageRecord } from '@/lib/messages';

type RealtimePayload = {
  eventType: 'INSERT' | 'UPDATE';
  new: {
    id: string;
    match_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    delivered_at: string | null;
    seen_at: string | null;
  } | null;
};

type OnCall = { event: string; config: unknown; cb: unknown };
type SubscribeCb = (status: string, err?: unknown) => void;

interface MockChannel {
  topic: string;
  _ons: OnCall[];
  on(event: string, config: unknown, cb: unknown): MockChannel;
  subscribe(cb?: SubscribeCb): MockChannel;
}

const capture = {
  created: [] as MockChannel[],
  onCalls: [] as OnCall[],
  subscribeCbs: [] as SubscribeCb[],
  removeChannelCalls: [] as MockChannel[],
  channelCount: 0,
};

beforeEach(() => {
  capture.created.length = 0;
  capture.onCalls.length = 0;
  capture.subscribeCbs.length = 0;
  capture.removeChannelCalls.length = 0;
  capture.channelCount = 0;
  vi.clearAllMocks();
});

vi.mock('@/lib/supabase', () => {
  function makeChannel(matchId: string): MockChannel {
    capture.channelCount++;
    const ch: MockChannel = {
      topic: `chat:${matchId}`,
      _ons: [],
      on(event: string, config: unknown, cb: unknown) {
        ch._ons.push({ event, config, cb });
        capture.onCalls.push({ event, config, cb });
        return ch;
      },
      subscribe(cb?: SubscribeCb) {
        if (cb) capture.subscribeCbs.push(cb);
        capture.created.push(ch);
        return ch;
      },
    };
    return ch;
  }
  return {
    supabase: {
      channel: vi.fn((name: string) => {
        const matchId = String(name).replace(/^chat:/, '');
        return makeChannel(matchId);
      }) as unknown as MockInstance<(name: string) => MockChannel>,
      removeChannel: vi.fn((ch: MockChannel) => {
        capture.removeChannelCalls.push(ch);
      }) as unknown as MockInstance<(ch: MockChannel) => void>,
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'user-a' } } })),
      },
    },
  };
});

vi.mock('@/lib/messages', () => ({
  fetchMessages: vi.fn(() => Promise.resolve<MessageRecord[]>([])),
  sendMessage: vi.fn(() =>
    Promise.resolve({
      id: 's1',
      matchId: 'm',
      senderId: 'user-a',
      content: 'hi',
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      seenAt: null,
    } as MessageRecord)
  ),
}));

function insertPayload(id: string, matchId: string): RealtimePayload {
  return {
    eventType: 'INSERT',
    new: {
      id,
      match_id: matchId,
      sender_id: 'user-b',
      content: 'hello',
      created_at: new Date().toISOString(),
      delivered_at: null,
      seen_at: null,
    },
  };
}

const channelMock = supabase.channel as unknown as MockInstance<
  (name: string) => MockChannel
>;
const removeChannelMock = supabase.removeChannel as unknown as MockInstance<
  (ch: MockChannel) => void
>;

async function renderHook(matchId: string) {
  let result: ReturnType<typeof useChatMessages> | undefined;
  let current = matchId;
  const Container = () => {
    result = useChatMessages(current, {
      display_name: 'Bob',
      avatar_url: null,
    });
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Container));
  });
  // Flush the async auth + message-fetch chain so `loading` settles before
  // realtime events are injected in tests (otherwise the initial `setItems`
  // from the fetch can race with realtime inserts).
  for (let i = 0; i < 100; i++) {
    await act(async () => {
      await Promise.resolve();
    });
    if (result?.loading === false) break;
  }
  return {
    result: () => result!,
    setMatchId: async (id: string) => {
      current = id;
      act(() => {
        root.render(React.createElement(Container));
      });
      for (let i = 0; i < 100; i++) {
        await act(async () => {
          await Promise.resolve();
        });
        if (result?.loading === false) break;
      }
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
    latestChannel: (): MockChannel => capture.created[capture.created.length - 1]!,
  };
}

// Count only message items, excluding date separators.
const messageItems = (items: ReturnType<typeof useChatMessages>['items']) =>
  items.filter((i): i is ChatMessage => 'senderId' in i);

describe('useChatMessages realtime subscription lifecycle', async () => {
  it('TEST 1 — configures listeners before subscribe on initial mount', async () => {
    const { result, unmount, latestChannel } = await renderHook('match-a');

    const r = result();
    expect(r.items).toEqual([]);
    expect(r.loading).toBe(false);
    expect(r.realtimeError).toBeNull();

    expect(channelMock).toHaveBeenCalledWith('chat:match-a');

    const ch = latestChannel();
    expect(ch).toBeDefined();

    // Every postgres_changes listener is registered via .on() ...
    const postgresOns = capture.onCalls.filter((c) => c.event === 'postgres_changes');
    expect(postgresOns.length).toBeGreaterThan(0);
    const tableFilter = postgresOns[0].config as { table: string; filter: string };
    expect(tableFilter.table).toBe('messages');
    expect(tableFilter.filter).toBe('match_id=eq.match-a');

    // ... and .subscribe() is called once, as the final operation.
    expect(capture.subscribeCbs.length).toBe(1);
    expect(capture.onCalls.length).toBeGreaterThanOrEqual(1);

    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(ch);
  });

  it('TEST 2 — rerendering with the same matchId does not recreate the channel', async () => {
    const { result, setMatchId } = await renderHook('match-a');
    const channelCountBefore = capture.channelCount;
    const removeCountBefore = capture.removeChannelCalls.length;

    // Force a re-render with the same match id (unrelated UI state changed).
    await setMatchId('match-a');

    expect(result().items).toEqual([]);
    expect(capture.channelCount).toBe(channelCountBefore);
    expect(capture.removeChannelCalls.length).toBe(removeCountBefore);
  });

  it('TEST 3 — match change removes the old channel and creates the new one', async () => {
    const { result, setMatchId, latestChannel, unmount } = await renderHook('match-a');
    const chA = latestChannel()!;

    await setMatchId('match-b');

    expect(removeChannelMock).toHaveBeenCalledWith(chA);
    expect(channelMock).toHaveBeenLastCalledWith('chat:match-b');

    const chB = latestChannel();
    expect(chB).not.toBe(chA);

    // Bring the new channel to SUBSCRIBED.
    const subCbB = capture.subscribeCbs[capture.subscribeCbs.length - 1];
    act(() => {
      subCbB('SUBSCRIBED');
    });
    expect(result().subscriptionStatus).toBe('SUBSCRIBED');

    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(chB);
  });

  it('TEST 4 — unmount removes the channel', async () => {
    const { latestChannel, unmount } = await renderHook('match-a');
    const ch = latestChannel();
    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(ch);
  });

  it('TEST 5 — remounting the same conversation does not duplicate message processing', async () => {
    const { result, latestChannel, unmount } = await renderHook('match-a');
    const chA = latestChannel()!;

    const subCbA = capture.subscribeCbs[capture.subscribeCbs.length - 1];
    act(() => {
      subCbA('SUBSCRIBED');
    });

    const insertCb = (chA._ons.find((o) => o.event === 'postgres_changes') as OnCall)
      .cb as (payload: RealtimePayload) => void;

    act(() => {
      insertCb(insertPayload('m1', 'match-a'));
    });
    expect(messageItems(result().items).length).toBe(1);

    // The same row delivered again is suppressed (dedup).
    act(() => {
      insertCb(insertPayload('m1', 'match-a'));
    });
    expect(messageItems(result().items).length).toBe(1);

    // A different row is appended.
    act(() => {
      insertCb(insertPayload('m2', 'match-a'));
    });
    expect(messageItems(result().items).length).toBe(2);

    unmount();
    expect(removeChannelMock).toHaveBeenCalledWith(chA);

    // Remount: fresh channel, no stale processing from the previous channel.
    const { result: r2, latestChannel: lc2, unmount: unmount2 } =
      await renderHook('match-a');
    const chB = lc2();
    expect(chB).not.toBe(chA);
    expect(capture.removeChannelCalls.filter((c) => c === chA).length).toBe(1);
    const subCbB = capture.subscribeCbs[capture.subscribeCbs.length - 1];
    act(() => {
      subCbB('SUBSCRIBED');
    });
    expect(r2().subscriptionStatus).toBe('SUBSCRIBED');
    unmount2();
  });

  it('TEST 7 — a realtime failure does not crash and keeps messages visible', async () => {
    const { result, latestChannel, unmount } = await renderHook('match-a');
    const ch = latestChannel();

    const subCb = capture.subscribeCbs[capture.subscribeCbs.length - 1];
    act(() => {
      subCb('SUBSCRIBED');
    });
    expect(result().subscriptionStatus).toBe('SUBSCRIBED');

    // Deliver a message, then fail the subscription.
    const insertCb = (ch._ons.find((o) => o.event === 'postgres_changes') as OnCall)
      .cb as (payload: RealtimePayload) => void;
    act(() => {
      insertCb(insertPayload('m1', 'match-a'));
    });
    expect(messageItems(result().items).length).toBe(1);

    act(() => {
      subCb('CHANNEL_ERROR', new Error('websocket boom'));
    });

    // The page must not crash: error surfaced separately, messages remain.
    expect(result().realtimeError).toContain('boom');
    expect(result().subscriptionStatus).toBe('CHANNEL_ERROR');
    expect(messageItems(result().items).length).toBe(1);
    expect(result().loading).toBe(false);

    unmount();
  });

  it('TEST 8 — reconnection is bounded and stops after max attempts', async () => {
    vi.useFakeTimers();
    try {
      const { result, unmount } = await renderHook('match-a');

      const subCb = capture.subscribeCbs[capture.subscribeCbs.length - 1];
      act(() => {
        subCb('SUBSCRIBED');
      });

      // Failure 1 -> schedules retry #1 (2000 ms).
      act(() => {
        subCb('CHANNEL_ERROR', new Error('boom'));
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(removeChannelMock).toHaveBeenCalledTimes(1);
      expect(capture.created.length).toBe(2);

      const subCb2 = capture.subscribeCbs[capture.subscribeCbs.length - 1];
      // Failure 2 -> schedules retry #2 (4000 ms).
      act(() => {
        subCb2('CHANNEL_ERROR', new Error('boom'));
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(removeChannelMock).toHaveBeenCalledTimes(2);
      expect(capture.created.length).toBe(3);

      const subCb3 = capture.subscribeCbs[capture.subscribeCbs.length - 1];
      // Failure 3 -> schedules retry #3 (6000 ms), the last allowed retry.
      act(() => {
        subCb3('CHANNEL_ERROR', new Error('boom'));
      });
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(removeChannelMock).toHaveBeenCalledTimes(3);
      expect(capture.created.length).toBe(4);

      // Failure 4 on the current channel -> retry cap (3) reached, no retry.
      const subCb4 = capture.subscribeCbs[capture.subscribeCbs.length - 1];
      act(() => {
        subCb4('CHANNEL_ERROR', new Error('boom'));
      });
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(removeChannelMock).toHaveBeenCalledTimes(3);
      expect(capture.created.length).toBe(4);
      expect(result().realtimeError).toContain('boom');

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
