import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser side of the messaging and Explore More RPC contracts.
 *
 * The database suite proves the SQL. These tests pin the part that failed in
 * production: a deployed function that is missing must become a safe, retryable
 * message rather than leaking the PostgREST schema-cache detail, while a valid
 * payload must be narrowed instead of cast.
 */

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown };

  const state = {
    rpc: { data: null, error: null } as Result,
    table: { data: null, error: null } as Result,
    user: { id: 'user-1' } as unknown,
    calls: [] as { method: string; args: unknown[] }[],
    reset() {
      state.rpc = { data: null, error: null };
      state.table = { data: null, error: null };
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
  ConversationError,
  respondToConversationRequest,
  startConversation,
} from '@/lib/conversations';
import { fetchInbox, setConversationArchived } from '@/lib/inbox';
import { ExploreMoreError, fetchExploreCounts, fetchExploreFeed } from '@/lib/explore-more';

beforeEach(() => {
  h.state.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('messaging contract', () => {
  it('sends the existing p_target argument and narrows the response', async () => {
    h.state.rpc = {
      data: {
        conversation_id: 'conversation-1',
        relationship_state: 'MUTUAL_FOLLOW_CHAT',
        request_status: 'not_applicable',
        requested_by_me: false,
      },
      error: null,
    };

    await expect(startConversation('user-2')).resolves.toEqual({
      conversationId: 'conversation-1',
      relationshipState: 'MUTUAL_FOLLOW_CHAT',
      requestStatus: 'not_applicable',
      requestedByMe: false,
    });

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['start_conversation', { p_target: 'user-2' }],
    });
  });

  it('turns a missing deployed function into a safe retryable message', async () => {
    h.state.rpc = {
      data: null,
      error: {
        code: 'PGRST202',
        message:
          "Could not find the function public.start_conversation(p_target) in the schema cache",
      },
    };

    await expect(startConversation('user-2')).rejects.toMatchObject({
      name: 'ConversationError',
      message: 'Messaging is temporarily unavailable. Please try again shortly.',
    });

    await expect(startConversation('user-2')).rejects.not.toThrow(/schema cache|public\./);
  });

  it('surfaces a member-safe database refusal verbatim', async () => {
    h.state.rpc = {
      data: null,
      error: { code: '42501', message: 'Follow this member before sending a message request.' },
    };

    await expect(startConversation('user-2')).rejects.toThrow(
      /follow this member before sending a message request/i
    );
  });

  it('rejects a malformed payload instead of returning undefined state', async () => {
    h.state.rpc = { data: { conversation_id: 'conversation-1' }, error: null };

    await expect(startConversation('user-2')).rejects.toBeInstanceOf(ConversationError);
  });

  it('accepts or rejects a request through the recipient RPC', async () => {
    h.state.rpc = {
      data: {
        conversation_id: 'conversation-1',
        relationship_state: 'MESSAGE_REQUEST_ACCEPTED',
        request_status: 'accepted',
      },
      error: null,
    };

    await expect(respondToConversationRequest('conversation-1', true)).resolves.toMatchObject({
      conversationId: 'conversation-1',
      requestStatus: 'accepted',
    });

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['respond_to_conversation_request', { p_match_id: 'conversation-1', p_accept: true }],
    });
  });

  it('loads and narrows inbox summaries, dropping malformed rows', async () => {
    h.state.rpc = {
      data: [
        {
          match_id: 'conversation-1',
          other_user_id: 'user-2',
          other_display_name: 'Bo',
          other_username: 'bo',
          other_avatar_url: null,
          last_message: 'hello',
          last_message_at: '2026-10-20T10:00:00.000Z',
          last_message_is_mine: false,
          unread_count: 2,
          is_archived: false,
          is_request: true,
          is_online: true,
          relationship_state: 'MESSAGE_REQUEST_PENDING',
          request_status: 'pending',
          requested_by_me: false,
        },
        { match_id: null, other_user_id: 'user-3' },
      ],
      error: null,
    };

    await expect(fetchInbox()).resolves.toEqual([
      {
        matchId: 'conversation-1',
        otherUserId: 'user-2',
        displayName: 'Bo',
        username: 'bo',
        avatarUrl: null,
        lastMessage: 'hello',
        lastMessageAt: '2026-10-20T10:00:00.000Z',
        lastMessageIsMine: false,
        unreadCount: 2,
        isArchived: false,
        isRequest: true,
        isOnline: true,
        relationshipState: 'MESSAGE_REQUEST_PENDING',
        requestStatus: 'pending',
        requestedByMe: false,
      },
    ]);
  });

  it('does not pretend an unavailable inbox is empty', async () => {
    h.state.rpc = {
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function conversation_summaries' },
    };

    await expect(fetchInbox()).rejects.toThrow(/inbox is temporarily unavailable/i);
  });

  it('archives through the participant-checked RPC', async () => {
    h.state.rpc = { data: null, error: null };

    await expect(setConversationArchived('conversation-1', true)).resolves.toBeUndefined();

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['set_conversation_archived', { p_match_id: 'conversation-1', p_archived: true }],
    });
  });
});

describe('Explore More contract', () => {
  it('reads category and goal counts from the shared RPC', async () => {
    h.state.rpc = {
      data: [
        { category_id: 'coffee-food', goal_key: null, profile_count: 4 },
        { category_id: 'dating-goals', goal_key: 'serious', profile_count: 2 },
      ],
      error: null,
    };

    const counts = await fetchExploreCounts();
    expect(counts.categories['coffee-food']).toBe(4);
    expect(counts.goals.serious).toBe(2);

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: ['explore_more_counts', { p_min_age: 18, p_max_age: 99 }],
    });
  });

  it('turns a missing Explore function into a safe retryable message', async () => {
    h.state.rpc = {
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function explore_more_counts' },
    };

    await expect(fetchExploreCounts()).rejects.toMatchObject({
      name: 'ExploreMoreError',
      message: 'Explore More is temporarily unavailable. Please try again shortly.',
    });
  });

  it('passes every feed argument the SQL function requires', async () => {
    h.state.rpc = {
      data: [
        {
          id: 'user-2',
          first_name: 'Bo',
          last_name: 'Brown',
          has_last_name: true,
          username: 'bo',
          display_name: 'Bo Brown',
          age: 30,
          gender: 'Man',
          city: 'Pokhara',
          country: 'Nepal',
          avatar_url: null,
          photos: [],
          bio: 'Hello',
          intention: 'dating',
          looking_for: ['Women'],
          hobbies: [],
          pets: [],
          mbti: null,
          interests: ['coffee'],
          prompts: {},
          is_online: false,
          is_verified: false,
          match_score: 42,
          category_hits: 1,
        },
      ],
      error: null,
    };

    const page = await fetchExploreFeed({
      category: 'coffee-food',
      limit: 1,
      excludeIds: ['user-3'],
    });

    expect(page.candidates).toHaveLength(1);
    expect(page.candidates[0]).toMatchObject({ id: 'user-2', matchScore: 42, categoryHits: 1 });
    expect(page.nextCursor).toBe('42:user-2');

    expect(h.state.calls).toContainEqual({
      method: 'rpc',
      args: [
        'explore_more_feed',
        {
          p_category_id: 'coffee-food',
          p_goal: null,
          p_cursor: null,
          p_limit: 1,
          p_min_age: 18,
          p_max_age: 99,
          p_exclude_ids: ['user-3'],
        },
      ],
    });
  });

  it('maps a database refusal to the documented Explore errors', async () => {
    h.state.rpc = { data: null, error: { code: '22023', message: 'Unknown category' } };

    await expect(fetchExploreFeed({ category: 'coffee-food' })).rejects.toBeInstanceOf(
      ExploreMoreError
    );
  });
});
