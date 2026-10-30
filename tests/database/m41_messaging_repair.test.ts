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
  systemicCount,
} from './harness';

interface StartResult {
  conversation_id: string;
  relationship_state: string;
  request_status: string;
  requested_by_me: boolean;
}

interface SendState {
  is_request: boolean;
  can_respond: boolean;
  can_send: boolean;
  requested_by_me: boolean;
}

const M41 = '20261015570000_m41_block_history_and_request_authority.sql';

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
    `select is_request, can_respond, can_send, requested_by_me
       from public.conversation_send_state('${matchId}'::uuid)`
  );
  return rows[0];
};

describe('M41 — blocked history and request authority', () => {
  let db: PGlite;

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

  it('closes a blocked conversation with history and keeps its media', async () => {
    const result = await start(db, USER_A, USER_B);
    await send(db, USER_A, result.conversation_id, 'before block');

    const message = await db.query<{ id: string }>(
      `select id from public.messages
        where match_id = '${result.conversation_id}'::uuid
          and content = 'before block'`
    );

    await seed(
      db,
      `insert into public.chat_media (message_id, match_id, sender_id, storage_path)
       values ('${message.rows[0].id}','${result.conversation_id}','${USER_A}','${USER_A}/m41.jpg')`
    );

    const blocked = await queryAs<{ result: { matches_removed: number } }>(
      db,
      USER_A,
      `select public.block_member('${USER_B}'::uuid) as result`
    );
    expect(blocked[0].result.matches_removed).toBe(1);

    const match = await db.query<{ kind: string; status: string }>(
      `select kind, status from public.matches where id = '${result.conversation_id}'::uuid`
    );
    expect(match.rows[0]).toEqual({ kind: 'closed', status: 'closed' });

    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.messages
          where match_id = '${result.conversation_id}'::uuid`
      )
    ).toBe(1);
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.chat_media
          where match_id = '${result.conversation_id}'::uuid`
      )
    ).toBe(1);

    // The participant may still read the retained history and media, but the
    // request/block guard refuses every new message.
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.chat_media
          where match_id = '${result.conversation_id}'::uuid`
      )
    ).toBe(1);
    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.messages (match_id, sender_id, content)
         values ('${result.conversation_id}','${USER_A}','after block')`
      )
    ).toBe(true);
  });

  it('retains media, archive, settings and receipts when blocking a conversation with no messages', async () => {
    const result = await start(db, USER_A, USER_C);
    const matchId = result.conversation_id;

    await seed(
      db,
      `insert into public.chat_media (message_id, match_id, sender_id, storage_path)
       values (gen_random_uuid(), '${matchId}','${USER_A}','${USER_A}/m41-orphan.jpg');
       insert into public.conversation_archive (match_id, user_id)
       values ('${matchId}','${USER_A}');
       insert into public.chat_settings (match_id, updated_by)
       values ('${matchId}','${USER_A}');
       insert into public.match_read_state (match_id, user_id)
       values ('${matchId}','${USER_A}');`
    );

    const blocked = await queryAs<{ result: { matches_removed: number } }>(
      db,
      USER_A,
      `select public.block_member('${USER_C}'::uuid) as result`
    );
    expect(blocked[0].result.matches_removed).toBe(1);

    const match = await db.query<{
      kind: string;
      request_status: string;
      status: string;
    }>(
      `select kind, request_status, status from public.matches
        where id = '${matchId}'::uuid`
    );
    expect(match.rows[0]).toEqual({
      kind: 'closed',
      request_status: 'not_applicable',
      status: 'closed',
    });

    for (const table of [
      'chat_media',
      'conversation_archive',
      'chat_settings',
      'match_read_state',
    ]) {
      expect(
        await systemicCount(
          db,
          `select count(*)::int as n from public.${table}
            where match_id = '${matchId}'::uuid`
        )
      ).toBe(1);
    }

    for (const userId of [USER_A, USER_C]) {
      expect(
        await isRejected(
          db,
          userId,
          `select public.respond_to_conversation_request(
             '${matchId}'::uuid, true
           )`
        )
      ).toBe(true);
    }
  });

  it('refuses to accept a request whose requester is unknown', async () => {
    const result = await start(db, USER_C, USER_D);
    await seed(
      db,
      `update public.matches set requested_by = null
        where id = '${result.conversation_id}'::uuid`
    );

    for (const userId of [USER_C, USER_D]) {
      expect(await state(db, userId, result.conversation_id)).toMatchObject({
        is_request: false,
        can_respond: false,
        can_send: false,
      });
      expect(
        await isRejected(
          db,
          userId,
          `select public.respond_to_conversation_request(
             '${result.conversation_id}'::uuid, true
           )`
        )
      ).toBe(true);
    }
  });
});

describe('M41 repair', () => {
  it('derives a missing requester from the first valid message sender', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}')`
    );

    const result = await start(db, USER_A, USER_B);
    await send(db, USER_A, result.conversation_id, 'the original request');
    await seed(
      db,
      `update public.matches set requested_by = null
        where id = '${result.conversation_id}'::uuid`
    );

    await applyMigrations(db, [M41]);

    const repaired = await db.query<{
      requested_by: string;
      request_status: string;
      kind: string;
    }>(
      `select requested_by, request_status, kind
         from public.matches where id = '${result.conversation_id}'::uuid`
    );
    expect(repaired.rows[0]).toMatchObject({
      requested_by: USER_A,
      request_status: 'pending',
      kind: 'request',
    });
  });

  it('closes an empty pending request as an idempotent tombstone', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}')`
    );

    const result = await start(db, USER_A, USER_B);
    await seed(
      db,
      `update public.matches set requested_by = null
        where id = '${result.conversation_id}'::uuid`
    );

    await applyMigrations(db, [M41]);
    const first = await db.query<{
      kind: string;
      request_status: string;
      status: string;
      requested_by: string | null;
      updated_at: string;
    }>(
      `select kind, request_status, status, requested_by, updated_at::text
         from public.matches where id = '${result.conversation_id}'::uuid`
    );
    expect(first.rows[0]).toMatchObject({
      kind: 'closed',
      request_status: 'not_applicable',
      status: 'closed',
      requested_by: null,
    });

    await applyMigrations(db, [M41]);
    const second = await db.query<{ updated_at: string }>(
      `select updated_at::text from public.matches
        where id = '${result.conversation_id}'::uuid`
    );
    expect(second.rows[0].updated_at).toBe(first.rows[0].updated_at);
  });

  it('retains dependent history when closing a malformed pending request', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}')`
    );

    const result = await start(db, USER_A, USER_B);
    const matchId = result.conversation_id;
    await seed(
      db,
      `update public.matches set requested_by = null where id = '${matchId}'::uuid;
       insert into public.chat_media (message_id, match_id, sender_id, storage_path)
       values (gen_random_uuid(), '${matchId}','${USER_A}','${USER_A}/m41-repair.jpg');
       insert into public.conversation_archive (match_id, user_id)
       values ('${matchId}','${USER_A}');
       insert into public.chat_settings (match_id, updated_by)
       values ('${matchId}','${USER_A}');
       insert into public.match_read_state (match_id, user_id)
       values ('${matchId}','${USER_A}');`
    );

    await applyMigrations(db, [M41]);

    const match = await db.query<{ kind: string; status: string }>(
      `select kind, status from public.matches where id = '${matchId}'::uuid`
    );
    expect(match.rows[0]).toEqual({ kind: 'closed', status: 'closed' });

    for (const table of [
      'chat_media',
      'conversation_archive',
      'chat_settings',
      'match_read_state',
    ]) {
      expect(
        await systemicCount(
          db,
          `select count(*)::int as n from public.${table}
            where match_id = '${matchId}'::uuid`
        )
      ).toBe(1);
    }
  });

  it('closes a malformed pending request whose only messages are from a non-participant', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}','${USER_C}')`
    );

    const result = await start(db, USER_A, USER_B);
    const matchId = result.conversation_id;
    await seed(
      db,
      `update public.matches set requested_by = null where id = '${matchId}'::uuid;
       alter table public.messages disable trigger require_message_participation_trg;
       alter table public.messages disable trigger enforce_message_request_limit_trg;
       insert into public.messages (match_id, sender_id, content)
       values ('${matchId}','${USER_C}','legacy non-participant message');
       alter table public.messages enable trigger require_message_participation_trg;
       alter table public.messages enable trigger enforce_message_request_limit_trg;`
    );

    await applyMigrations(db, [M41]);

    const match = await db.query<{
      kind: string;
      request_status: string;
      requested_by: string | null;
    }>(
      `select kind, request_status, requested_by
         from public.matches where id = '${matchId}'::uuid`
    );
    expect(match.rows[0]).toEqual({
      kind: 'closed',
      request_status: 'not_applicable',
      requested_by: null,
    });
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.messages
          where match_id = '${matchId}'::uuid`
      )
    ).toBe(1);
  });

  it('clears an invalid non-null requester on an accepted request without closing it', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}','${USER_C}')`
    );

    const result = await start(db, USER_A, USER_B);
    await seed(
      db,
      `update public.matches
          set request_status = 'accepted', status = 'accepted', requested_by = '${USER_C}'
        where id = '${result.conversation_id}'::uuid`
    );

    await applyMigrations(db, [M41]);

    const match = await db.query<{
      kind: string;
      request_status: string;
      requested_by: string | null;
    }>(
      `select kind, request_status, requested_by
         from public.matches where id = '${result.conversation_id}'::uuid`
    );
    expect(match.rows[0]).toEqual({
      kind: 'request',
      request_status: 'accepted',
      requested_by: null,
    });
  });

  it('leaves an accepted request with no recoverable requester stable on re-run', async () => {
    const db = await createLiveLikeDb();
    await applyMigrations(
      db,
      migrationFiles().filter((file) => file < M41)
    );
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27
        where id in ('${USER_A}','${USER_B}')`
    );

    const result = await start(db, USER_A, USER_B);
    await seed(
      db,
      `update public.matches
          set request_status = 'accepted', status = 'accepted', requested_by = null
        where id = '${result.conversation_id}'::uuid`
    );

    await applyMigrations(db, [M41]);
    const before = await db.query<{ updated_at: string }>(
      `select updated_at::text from public.matches
        where id = '${result.conversation_id}'::uuid`
    );

    await applyMigrations(db, [M41]);
    const after = await db.query<{
      updated_at: string;
      requested_by: string | null;
      request_status: string;
    }>(
      `select updated_at::text, requested_by, request_status
         from public.matches where id = '${result.conversation_id}'::uuid`
    );

    expect(after.rows[0]).toMatchObject({
      updated_at: before.rows[0].updated_at,
      requested_by: null,
      request_status: 'accepted',
    });

    // The runbook's post-M41 invariant ignores an accepted row whose historical
    // requester is null, but still flags accepted rows with an invalid id.
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.matches
          where kind = 'request'
            and (
              (request_status = 'pending'
                and (requested_by is null
                     or requested_by not in (user_a_id, user_b_id)))
              or (request_status = 'accepted'
                and requested_by is not null
                and requested_by not in (user_a_id, user_b_id))
            )`
      )
    ).toBe(0);
  });
});
