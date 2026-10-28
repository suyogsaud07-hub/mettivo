import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  asUser,
  createTestDb,
  isRejected,
  queryAs,
  scalarAs,
  seed,
} from './harness';

type RelationshipState =
  | 'MATCHED'
  | 'MUTUAL_FOLLOW_CHAT'
  | 'MESSAGE_REQUEST_PENDING'
  | 'MESSAGE_REQUEST_ACCEPTED'
  | 'BLOCKED'
  | 'UNAVAILABLE';

interface StartResult {
  conversation_id: string;
  relationship_state: RelationshipState;
  request_status: string;
  requested_by_me: boolean;
}

interface RespondResult {
  conversation_id: string;
  relationship_state: RelationshipState;
  request_status: string;
}

interface SendState {
  relationship_state: RelationshipState;
  request_status: string;
  is_request: boolean;
  requested_by_me: boolean;
  can_respond: boolean;
  sent_count: number;
  send_limit: number;
  can_send: boolean;
  other_has_replied: boolean;
}

const follow = (db: PGlite, from: string, to: string) =>
  asUser(db, from, () =>
    db.exec(
      `insert into public.follows (follower_id, following_id)
       values ('${from}','${to}')`
    )
  );

const start = async (db: PGlite, from: string, to: string): Promise<StartResult> => {
  const rows = await queryAs<{ result: StartResult }>(
    db,
    from,
    `select public.start_conversation('${to}'::uuid) as result`
  );
  return rows[0].result;
};

const send = (db: PGlite, userId: string, matchId: string, content: string) =>
  asUser(db, userId, () =>
    db.exec(
      `insert into public.messages (match_id, sender_id, content)
       values ('${matchId}','${userId}','${content}')`
    )
  );

const sendState = async (db: PGlite, userId: string, matchId: string): Promise<SendState> => {
  const rows = await queryAs<SendState>(
    db,
    userId,
    `select * from public.conversation_send_state('${matchId}'::uuid)`
  );
  return rows[0];
};

const matchesCount = (db: PGlite, userId: string) =>
  scalarAs(
    db,
    userId,
    `select matches_count::int as n from public.profiles where id = '${userId}'`
  );

describe('M38 — cross-gender mutual follows are romantic matches', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set onboarding_completed = true`);
    await follow(db, USER_A, USER_B);
  });

  it('does not create a conversation from a one-way follow', async () => {
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.matches`)
    ).toBe(0);
  });

  it('creates one MATCHED conversation when the follow is returned', async () => {
    await follow(db, USER_B, USER_A);
    const rows = await queryAs<{ id: string; kind: string }>(
      db,
      USER_A,
      `select id, kind from public.matches`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('match');
  });

  it('reports MATCHED and counts as a romantic match for both members', async () => {
    const result = await start(db, USER_A, USER_B);
    expect(result.relationship_state).toBe('MATCHED');
    expect(result.request_status).toBe('not_applicable');
    expect(result.requested_by_me).toBe(false);
    expect(await matchesCount(db, USER_A)).toBe(1);
    expect(await matchesCount(db, USER_B)).toBe(1);
  });

  it('does not cap messages in a romantic match', async () => {
    const result = await start(db, USER_A, USER_B);
    await send(db, USER_A, result.conversation_id, 'one');
    await send(db, USER_A, result.conversation_id, 'two');
    await send(db, USER_A, result.conversation_id, 'three');
    await send(db, USER_A, result.conversation_id, 'four');
    const state = await sendState(db, USER_A, result.conversation_id);
    expect(state.can_send).toBe(true);
    expect(state.relationship_state).toBe('MATCHED');
  });
});

describe('M38 — same-gender mutual follows can chat without a romantic match', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set onboarding_completed = true`);
    await follow(db, USER_A, USER_C);
    await follow(db, USER_C, USER_A);
  });

  it('creates a chat-enabled mutual-follow row but no romantic match or count', async () => {
    const rows = await queryAs<{ kind: string }>(
      db,
      USER_A,
      `select kind from public.matches`
    );
    expect(rows).toEqual([{ kind: 'mutual_follow' }]);
    expect(await matchesCount(db, USER_A)).toBe(0);
    expect(await matchesCount(db, USER_C)).toBe(0);
  });

  it('opens a MUTUAL_FOLLOW_CHAT conversation on demand', async () => {
    const result = await start(db, USER_A, USER_C);
    expect(result.relationship_state).toBe('MUTUAL_FOLLOW_CHAT');
    expect(await matchesCount(db, USER_A)).toBe(0);
    expect(await matchesCount(db, USER_C)).toBe(0);
  });

  it('allows both members to send without the request cap', async () => {
    const result = await start(db, USER_A, USER_C);
    for (let i = 0; i < 5; i += 1) {
      await send(db, USER_A, result.conversation_id, `a${i}`);
    }
    await send(db, USER_C, result.conversation_id, 'reply');
    const state = await sendState(db, USER_A, result.conversation_id);
    expect(state.can_send).toBe(true);
    expect(state.relationship_state).toBe('MUTUAL_FOLLOW_CHAT');
  });
});

describe('M38 — a one-way follow creates a three-message request', () => {
  let db: PGlite;
  let conversationId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set onboarding_completed = true`);
    await follow(db, USER_A, USER_B);
    conversationId = (await start(db, USER_A, USER_B)).conversation_id;
  });

  it('starts as a pending request from the follower', async () => {
    const rows = await queryAs<{
      kind: string;
      request_status: string;
      requested_by: string;
    }>(
      db,
      USER_A,
      `select kind, request_status, requested_by from public.matches where id = '${conversationId}'`
    );
    expect(rows[0]).toEqual({
      kind: 'request',
      request_status: 'pending',
      requested_by: USER_A,
    });
    expect(await matchesCount(db, USER_A)).toBe(0);
    expect(await matchesCount(db, USER_B)).toBe(0);
  });

  it('shows opposite request direction to each participant', async () => {
    const sender = await sendState(db, USER_A, conversationId);
    const recipient = await sendState(db, USER_B, conversationId);
    expect(sender.is_request).toBe(false);
    expect(sender.requested_by_me).toBe(true);
    expect(sender.can_respond).toBe(false);
    expect(recipient.is_request).toBe(true);
    expect(recipient.requested_by_me).toBe(false);
    expect(recipient.can_respond).toBe(true);
  });

  it('shows the request only in the recipient inbox request tab', async () => {
    const senderRows = await queryAs<{ is_request: boolean; requested_by_me: boolean }>(
      db,
      USER_A,
      `select is_request, requested_by_me from public.conversation_summaries()`
    );
    const recipientRows = await queryAs<{ is_request: boolean; requested_by_me: boolean }>(
      db,
      USER_B,
      `select is_request, requested_by_me from public.conversation_summaries()`
    );
    expect(senderRows[0]).toMatchObject({ is_request: false, requested_by_me: true });
    expect(recipientRows[0]).toMatchObject({ is_request: true, requested_by_me: false });
  });

  it('lets the requester send exactly three messages while pending', async () => {
    await send(db, USER_A, conversationId, 'one');
    await send(db, USER_A, conversationId, 'two');
    await send(db, USER_A, conversationId, 'three');
    expect(await sendState(db, USER_A, conversationId)).toMatchObject({
      sent_count: 3,
      send_limit: 3,
      can_send: false,
      relationship_state: 'MESSAGE_REQUEST_PENDING',
    });
    expect(await isRejected(db, USER_A, `insert into public.messages (match_id, sender_id, content) values ('${conversationId}','${USER_A}','four')`)).toBe(true);
  });

  it('refuses a non-participant responding to the request', async () => {
    expect(
      await isRejected(
        db,
        USER_C,
        `select public.respond_to_conversation_request('${conversationId}'::uuid, true)`
      )
    ).toBe(true);
  });

  it('auto-accepts when the recipient replies and lifts the cap', async () => {
    await send(db, USER_B, conversationId, 'accepted by reply');
    const state = await sendState(db, USER_A, conversationId);
    expect(state.relationship_state).toBe('MESSAGE_REQUEST_ACCEPTED');
    expect(state.can_send).toBe(true);
    await send(db, USER_A, conversationId, 'four');
  });
});

describe('M38 — rejecting a request is permanent', () => {
  let db: PGlite;
  let conversationId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set onboarding_completed = true`);
    await follow(db, USER_A, USER_B);
    conversationId = (await start(db, USER_A, USER_B)).conversation_id;
    await send(db, USER_A, conversationId, 'hello');
  });

  it('lets only the recipient accept or reject', async () => {
    expect(
      await isRejected(
        db,
        USER_A,
        `select public.respond_to_conversation_request('${conversationId}'::uuid, false)`
      )
    ).toBe(true);

    const rows = await queryAs<{ result: RespondResult }>(
      db,
      USER_B,
      `select public.respond_to_conversation_request('${conversationId}'::uuid, false) as result`
    );
    expect(rows[0].result).toMatchObject({
      conversation_id: conversationId,
      relationship_state: 'UNAVAILABLE',
      request_status: 'rejected',
    });
  });

  it('refuses further messages and refuses to reopen the request', async () => {
    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.messages (match_id, sender_id, content)
         values ('${conversationId}','${USER_A}','again')`
      )
    ).toBe(true);
    expect(await isRejected(db, USER_A, `select public.start_conversation('${USER_B}'::uuid)`)).toBe(true);
    const state = await sendState(db, USER_B, conversationId);
    expect(state.can_respond).toBe(false);
    expect(state.can_send).toBe(false);
  });
});

describe('M40 — any eligible authenticated member may initiate contact', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set onboarding_completed = true`);
  });

  it('creates a pending request without requiring a follow', async () => {
    const result = await start(db, USER_A, USER_B);
    expect(result.relationship_state).toBe('MESSAGE_REQUEST_PENDING');
    expect(result.request_status).toBe('pending');
    expect(result.requested_by_me).toBe(true);
    expect(await matchesCount(db, USER_A)).toBe(0);
    expect(await matchesCount(db, USER_B)).toBe(0);
  });

  it('is idempotent and never creates a second row for the pair', async () => {
    const first = await start(db, USER_A, USER_B);
    const second = await start(db, USER_A, USER_B);
    expect(second.conversation_id).toBe(first.conversation_id);
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.matches`)
    ).toBe(1);
  });

  it('does not treat the recipient opening the thread as acceptance', async () => {
    const opened = await start(db, USER_B, USER_A);
    expect(opened.relationship_state).toBe('MESSAGE_REQUEST_PENDING');
    expect(opened.requested_by_me).toBe(false);
  });

  it('refuses a recipient who has not completed onboarding', async () => {
    await seed(
      db,
      `update public.profiles set onboarding_completed = false where id = '${USER_B}'`
    );
    expect(await isRejected(db, USER_A, `select public.start_conversation('${USER_B}'::uuid)`)).toBe(true);
  });

  it('refuses a blocked pair', async () => {
    await seed(
      db,
      `update public.profiles set onboarding_completed = true where id = '${USER_B}'`
    );
    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_B}','${USER_A}')`
    );
    expect(await isRejected(db, USER_A, `select public.start_conversation('${USER_B}'::uuid)`)).toBe(true);
  });
});
