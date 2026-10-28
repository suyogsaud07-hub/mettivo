import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  applyMigrations,
  asUser,
  createLiveLikeDb,
  isRejected,
  migrationFiles,
  queryAs,
  scalarAs,
  seed,
} from './harness';

interface StartResult {
  conversation_id: string;
  relationship_state: string;
  request_status: string;
  requested_by_me: boolean;
}

interface SendState {
  relationship_state: string;
  request_status: string;
  is_request: boolean;
  requested_by_me: boolean;
  can_respond: boolean;
  sent_count: number;
  send_limit: number;
  can_send: boolean;
  other_has_replied: boolean;
}

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

const state = async (db: PGlite, userId: string, matchId: string): Promise<SendState> => {
  const rows = await queryAs<SendState>(
    db,
    userId,
    `select * from public.conversation_send_state('${matchId}'::uuid)`
  );
  return rows[0];
};

describe('M40 — live-shaped matches and explicit message requests', () => {
  let db: PGlite;
  let conversationId: string;

  beforeAll(async () => {
    db = await createLiveLikeDb();
    await applyMigrations(db);
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}','${USER_C}','${USER_D}')`
    );
  });

  it('has no conversations table or messages.conversation_id dependency', async () => {
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.matches`)
    ).toBe(0);
    const tables = await db.query<{ name: string }>(`
      select to_regclass('public.conversations')::text as name
    `);
    expect(tables.rows[0].name).toBeNull();
    const columns = await db.query<{ n: number }>(`
      select count(*)::int as n
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'messages'
        and column_name = 'conversation_id'
    `);
    expect(columns.rows[0].n).toBe(0);
  });

  it('keeps the message write guards installed', async () => {
    const triggers = await db.query<{ tgname: string }>(`
      select tgname
      from pg_trigger
      where tgrelid = 'public.messages'::regclass
        and not tgisinternal
    `);
    expect(triggers.rows.map((row) => row.tgname)).toEqual(
      expect.arrayContaining([
        'enforce_message_request_limit_trg',
        'notify_on_message_trg',
        'reject_blocked_message_trg',
        'require_message_participation_trg',
      ])
    );
  });

  it('creates a pending request without a follow and synchronizes both column pairs', async () => {
    const result = await start(db, USER_A, USER_B);
    conversationId = result.conversation_id;
    expect(result.relationship_state).toBe('MESSAGE_REQUEST_PENDING');
    expect(result.request_status).toBe('pending');
    expect(result.requested_by_me).toBe(true);

    const rows = await queryAs<{
      user_a_id: string;
      user_b_id: string;
      user_a: string;
      user_b: string;
      kind: string;
      request_status: string;
      requested_by: string;
      status: string;
    }>(
      db,
      USER_A,
      `select user_a_id, user_b_id, user_a, user_b, kind, request_status, requested_by, status
         from public.matches where id = '${conversationId}'`
    );
    expect(rows[0]).toMatchObject({
      kind: 'request',
      request_status: 'pending',
      requested_by: USER_A,
      status: 'pending',
    });
    expect(rows[0].user_a_id).toBe(rows[0].user_a);
    expect(rows[0].user_b_id).toBe(rows[0].user_b);
  });

  it('does not make opening the request an acceptance', async () => {
    const opened = await start(db, USER_B, USER_A);
    expect(opened.conversation_id).toBe(conversationId);
    expect(opened.relationship_state).toBe('MESSAGE_REQUEST_PENDING');
    expect(opened.requested_by_me).toBe(false);
    expect((await state(db, USER_B, conversationId)).can_respond).toBe(true);
  });

  it('projects the request in the recipient inbox without a conversations table', async () => {
    const rows = await queryAs<{
      match_id: string;
      is_request: boolean;
      relationship_state: string;
      requested_by_me: boolean;
    }>(
      db,
      USER_B,
      `select match_id, is_request, relationship_state, requested_by_me
         from public.conversation_summaries()`
    );
    expect(rows).toEqual([
      {
        match_id: conversationId,
        is_request: true,
        relationship_state: 'MESSAGE_REQUEST_PENDING',
        requested_by_me: false,
      },
    ]);
  });

  it('caps the requester at three messages, then allows four after acceptance', async () => {
    await send(db, USER_A, conversationId, 'one');
    await send(db, USER_A, conversationId, 'two');
    await send(db, USER_A, conversationId, 'three');

    expect(await state(db, USER_A, conversationId)).toMatchObject({
      sent_count: 3,
      send_limit: 3,
      can_send: false,
      relationship_state: 'MESSAGE_REQUEST_PENDING',
    });
    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.messages (match_id, sender_id, content)
         values ('${conversationId}','${USER_A}','four')`
      )
    ).toBe(true);

    const accepted = await queryAs<{ result: { request_status: string } }>(
      db,
      USER_B,
      `select public.respond_to_conversation_request('${conversationId}'::uuid, true) as result`
    );
    expect(accepted[0].result.request_status).toBe('accepted');

    await send(db, USER_A, conversationId, 'four');
    expect(await state(db, USER_A, conversationId)).toMatchObject({
      sent_count: 4,
      can_send: true,
      relationship_state: 'MESSAGE_REQUEST_ACCEPTED',
    });
  });

  it('rejects a direct reverse duplicate instead of creating a second conversation', async () => {
    await expect(
      db.exec(
        `insert into public.matches (user_a_id, user_b_id, user_a, user_b)
         values ('${USER_B}','${USER_A}','${USER_B}','${USER_A}')`
      )
    ).rejects.toThrow();
  });

  it('makes same-gender mutual follows chat-only', async () => {
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}','${USER_C}')`
      )
    );
    await asUser(db, USER_C, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_C}','${USER_A}')`
      )
    );

    const result = await start(db, USER_A, USER_C);
    expect(result.relationship_state).toBe('MUTUAL_FOLLOW_CHAT');

    const rows = await queryAs<{ kind: string }>(
      db,
      USER_A,
      `select kind from public.matches where id = '${result.conversation_id}'`
    );
    expect(rows[0].kind).toBe('mutual_follow');
    expect(
      await scalarAs(
        db,
        USER_A,
        `select matches_count::int as n from public.profiles where id = '${USER_A}'`
      )
    ).toBe(0);
  });

  it('still creates a romantic match for opposite-gender mutual follows', async () => {
    await asUser(db, USER_D, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_D}','${USER_A}')`
      )
    );
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}','${USER_D}')`
      )
    );

    const result = await start(db, USER_A, USER_D);
    expect(result.relationship_state).toBe('MATCHED');
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.matches
          where id = '${result.conversation_id}' and kind = 'match'`
      )
    ).toBe(1);
    expect(
      await scalarAs(
        db,
        USER_A,
        `select matches_count::int as n from public.profiles where id = '${USER_A}'`
      )
    ).toBe(1);
  });
});


describe('M40 preflight', () => {
  const M40 = '20261015560000_m40_live_messaging_compatibility.sql';

  const applyThroughM39 = async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M40)
    );
    return db;
  };

  it('stops when legacy and canonical participants disagree', async () => {
    const db = await applyThroughM39();
    await seed(
      db,
      `insert into public.matches (user_a_id, user_b_id, user_a, user_b)
       values ('${USER_A}','${USER_B}','${USER_A}','${USER_C}')`
    );

    await expect(applyMigrations(db, [M40])).rejects.toThrow(
      'legacy and canonical match participants disagree'
    );
  });

  it('stops when the same unordered pair exists twice', async () => {
    const db = await applyThroughM39();
    await seed(
      db,
      `insert into public.matches (user_a_id, user_b_id, user_a, user_b)
       values
         ('${USER_A}','${USER_B}','${USER_A}','${USER_B}'),
         ('${USER_B}','${USER_A}','${USER_B}','${USER_A}')`
    );

    await expect(applyMigrations(db, [M40])).rejects.toThrow(
      'duplicate/reverse match rows exist'
    );
  });
});
