import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  applyMigrations,
  asUser,
  createLiveLikeDb,
  migrationFiles,
  seed,
  systemicCount,
} from './harness';

/**
 * The migration set against the LIVE project's column types.
 *
 * WHY THIS FILE EXISTS
 *   The default harness declares `messages.match_id` as `text`. The live project
 *   declares it `uuid`, verified by probing PostgREST (a non-uuid filter value is
 *   rejected with `22P02 invalid input syntax for type uuid`, while a genuine
 *   text column such as `profiles.display_name` accepts it).
 *
 *   That single divergence let the suite pass locally while
 *   `create policy ... where m.id::text = messages.match_id` failed on the live
 *   project with `operator does not exist: text = uuid`. `CREATE POLICY` IS
 *   type-checked at creation, so the operator hit it the moment they pasted the
 *   bootstrap script.
 *
 *   Fixing the cast was not enough on its own: `plpgsql` bodies are NOT
 *   type-checked at creation (proven in the same investigation), so the message
 *   triggers could still fail at runtime. Everything here therefore exercises the
 *   paths at RUNTIME, not just their creation.
 */

describe('live-shaped database (match_id as uuid)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createLiveLikeDb();
    await applyMigrations(db);

    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true, age = 27, is_online = true
        where id in ('${USER_A}','${USER_B}')`
    );
  });

  it('applies and re-applies the whole migration set', async () => {
    // `beforeAll` already applied it once; this is the idempotency half.
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it('declares match_id as uuid, mirroring the live project', async () => {
    const result = await db.query<{ data_type: string }>(`
      select data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'match_id'
    `);
    expect(result.rows[0]?.data_type).toBe('uuid');
  });

  it('creates a match through mutual follows with uuid match ids', async () => {
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}','${USER_B}') on conflict do nothing`
      )
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_B}','${USER_A}') on conflict do nothing`
      )
    );

    const matches = await db.query<{ n: number }>(`select count(*)::int as n from public.matches`);
    expect(matches.rows[0].n).toBeGreaterThan(0);
  });

  it('runs every message trigger at runtime', async () => {
    // This is the assertion that matters: the M11 participant policy, the M11
    // participation trigger, the M12 blocked-delivery trigger and the M16
    // notification trigger all execute here. A stale one-sided cast would blow
    // up on this INSERT, not at migration time.
    const match = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const matchId = match.rows[0].id;

    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchId}','${USER_A}','hello from the live shape')`
        )
      )
    ).resolves.toBeDefined();

    // The M16 trigger must have produced a notification for the recipient.
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.notifications
          where user_id = '${USER_B}' and type = 'message'`
      ),
      'the message notification trigger must fire with a uuid match_id'
    ).toBeGreaterThan(0);
  });

  it('computes unread counts with a uuid match_id', async () => {
    const match = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const matchId = match.rows[0].id;

    const unread = await asUser(db, USER_B, async () => {
      const r = await db.query<{ unread: number }>(
        `select unread from public.unread_counts() where match_id = '${matchId}'::uuid`
      );
      return r.rows[0]?.unread ?? -1;
    });

    expect(unread).toBe(1);
  });

  it('refuses delivery to a blocked pair and retains a conversation with history', async () => {
    // Insert the block directly to isolate the M12 delivery trigger, which is
    // what protects legacy data where a match outlives a block.
    const match = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const matchId = match.rows[0].id;

    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_B}','${USER_A}') on conflict do nothing`
    );

    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchId}','${USER_A}','should not arrive')`
        )
      )
    ).rejects.toThrow(/cannot message this member/i);

    // M41: blocking retains the conversation as closed when it has history, so
    // the message and media ledger rows are not destroyed by the block.
    await seed(db, `delete from public.blocked_users`);
    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_B}'::uuid)`));
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.matches
          where id = '${matchId}'::uuid and kind = 'closed'`
      ),
      'blocking must close the conversation with history'
    ).toBe(1);
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.messages
          where match_id = '${matchId}'::uuid`
      ),
      'blocking must not delete message history'
    ).toBe(1);
  });

  it('keeps anonymous callers at zero rows on this shape too', async () => {
    const { anonReadCount } = await import('./harness');
    for (const table of ['profiles', 'messages', 'matches', 'notifications', 'blocked_users']) {
      expect(
        await anonReadCount(db, `select count(*)::int as n from public.${table}`),
        `${table} must stay unreadable anonymously`
      ).toBe(0);
    }
  });

  it('ships a migration set that is non-trivial', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(16);
  });
});
