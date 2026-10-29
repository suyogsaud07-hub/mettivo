import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  anonReadCount,
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
  let bToCRequestId: string;

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

  it('gives an anonymous caller zero inbox rows', async () => {
    expect(
      await anonReadCount(
        db,
        `select count(*)::int as n from public.conversation_summaries()`
      )
    ).toBe(0);
  });

  it('does not let the sender accept their own request', async () => {
    const result = await start(db, USER_B, USER_C);
    bToCRequestId = result.conversation_id;

    expect(result.relationship_state).toBe('MESSAGE_REQUEST_PENDING');
    expect(result.requested_by_me).toBe(true);
    expect(
      await isRejected(
        db,
        USER_B,
        `select public.respond_to_conversation_request('${bToCRequestId}'::uuid, true)`
      )
    ).toBe(true);

    expect(await state(db, USER_B, bToCRequestId)).toMatchObject({
      requested_by_me: true,
      can_respond: false,
      send_limit: 3,
    });
  });

  it('allows two-way messaging without a cap after acceptance', async () => {
    const accepted = await queryAs<{ result: { request_status: string } }>(
      db,
      USER_C,
      `select public.respond_to_conversation_request('${bToCRequestId}'::uuid, true) as result`
    );
    expect(accepted[0].result.request_status).toBe('accepted');

    for (let i = 0; i < 4; i += 1) {
      await send(db, USER_B, bToCRequestId, `sender ${i}`);
    }
    await send(db, USER_C, bToCRequestId, 'recipient one');
    await send(db, USER_C, bToCRequestId, 'recipient two');

    expect(await state(db, USER_B, bToCRequestId)).toMatchObject({
      relationship_state: 'MESSAGE_REQUEST_ACCEPTED',
      request_status: 'accepted',
      sent_count: 4,
      can_send: true,
    });
    expect(await state(db, USER_C, bToCRequestId)).toMatchObject({
      relationship_state: 'MESSAGE_REQUEST_ACCEPTED',
      request_status: 'accepted',
      sent_count: 2,
      can_send: true,
    });
  });

  it('preserves history when a request is rejected', async () => {
    const result = await start(db, USER_C, USER_D);
    await send(db, USER_C, result.conversation_id, 'keep this history');

    const rejected = await queryAs<{ result: { request_status: string } }>(
      db,
      USER_D,
      `select public.respond_to_conversation_request('${result.conversation_id}'::uuid, false) as result`
    );
    expect(rejected[0].result.request_status).toBe('rejected');

    expect(
      await scalarAs(
        db,
        USER_C,
        `select count(*)::int as n from public.messages
          where match_id = '${result.conversation_id}'::uuid
            and content = 'keep this history'`
      )
    ).toBe(1);
    expect(
      await isRejected(
        db,
        USER_C,
        `insert into public.messages (match_id, sender_id, content)
         values ('${result.conversation_id}','${USER_C}','after rejection')`
      )
    ).toBe(true);
  });

  it('blocks message delivery in both directions without deleting history', async () => {
    const result = await start(db, USER_B, USER_D);
    await send(db, USER_B, result.conversation_id, 'before block');

    // Insert the block directly so the match survives long enough to exercise
    // the delivery trigger; `block_member` closes a conversation with history
    // and is covered by the blocking and M41 suites.
    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_D}','${USER_B}')`
    );

    expect(
      await isRejected(
        db,
        USER_B,
        `insert into public.messages (match_id, sender_id, content)
         values ('${result.conversation_id}','${USER_B}','blocked sender')`
      )
    ).toBe(true);
    expect(
      await isRejected(
        db,
        USER_D,
        `insert into public.messages (match_id, sender_id, content)
         values ('${result.conversation_id}','${USER_D}','blocked recipient')`
      )
    ).toBe(true);
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.messages
          where match_id = '${result.conversation_id}'::uuid`
      )
    ).toBe(1);
  });
});


describe('M38 preflight', () => {
  const M38 = '20261015540000_m38_relationship_messaging.sql';

  it('drops the live uuid-returning function before creating the jsonb version', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M38)
    );
    await db.exec(`
      create function public.start_conversation(p_target uuid)
      returns uuid
      language sql
      as $$ select gen_random_uuid() $$;
    `);

    await expect(applyMigrations(db, [M38])).resolves.toBeUndefined();

    const result = await db.query<{ result: string }>(`
      select pg_get_function_result(
        'public.start_conversation(uuid)'::regprocedure
      ) as result
    `);
    expect(result.rows[0].result).toBe('jsonb');
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

  it('keeps existing messages when classifying a legacy conversation', async () => {
    const db = await applyThroughM39();

    const match = await db.query<{ id: string }>(
      `insert into public.matches (user_a_id, user_b_id, user_a, user_b)
       values ('${USER_A}','${USER_B}','${USER_A}','${USER_B}')
       returning id`
    );
    const matchId = match.rows[0].id;

    await seed(
      db,
      `insert into public.messages (match_id, sender_id, content)
       values ('${matchId}','${USER_A}','existing history')`
    );

    await applyMigrations(db, [M40]);

    const rows = await queryAs<{ content: string; kind: string }>(
      db,
      USER_A,
      `select msg.content, m.kind
         from public.messages msg
         join public.matches m on m.id::text = msg.match_id::text
        where msg.match_id = '${matchId}'::uuid`
    );
    expect(rows).toEqual([{ content: 'existing history', kind: 'request' }]);
  });
});

describe('M40 legacy matches.status constraint', () => {
  const M40 = '20261015560000_m40_live_messaging_compatibility.sql';

  const applyThroughM39 = async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M40)
    );
    return db;
  };

  it('replaces the legacy check before closing a conversation', async () => {
    const db = await applyThroughM39();

    await seed(
      db,
      `insert into public.matches (user_a_id, user_b_id, user_a, user_b, status)
       values
         ('${USER_A}','${USER_B}','${USER_A}','${USER_B}','pending'),
         ('${USER_A}','${USER_C}','${USER_A}','${USER_C}','accepted'),
         ('${USER_A}','${USER_D}','${USER_A}','${USER_D}','blocked')`
    );

    await expect(
      db.exec(
        `update public.matches set status = 'closed'
          where user_a_id = '${USER_A}' and user_b_id = '${USER_B}'`
      )
    ).rejects.toThrow(/matches_status_check/);

    await applyMigrations(db, [M40]);

    const preserved = await db.query<{ status: string }>(`
      select status
      from public.matches
      where user_a_id = '${USER_A}'
        and user_b_id in ('${USER_B}','${USER_C}','${USER_D}')
      order by user_b_id
    `);
    expect(preserved.rows.map((row) => row.status)).toEqual([
      'pending',
      'accepted',
      'blocked',
    ]);

    await expect(
      db.exec(
        `update public.matches set status = 'closed'
          where user_a_id = '${USER_A}' and user_b_id = '${USER_B}'`
      )
    ).resolves.toBeDefined();

    const constraint = await db.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.matches'::regclass
        and conname = 'matches_status_check'
    `);
    expect(constraint.rows).toHaveLength(1);
    expect(constraint.rows[0].definition).toContain("'closed'");
  });
});
