import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  applyMigrations,
  asUser,
  createBaseDb,
  migrationFiles,
  scalarAs,
} from './harness';

const LAST_MIGRATION_WITH_CHAT_SCHEMA = '20261104000006_restricted_access_hardening.sql';
const CHAT_INTERACTIONS_MIGRATION = '20261106000010_message_interactions.sql';

describe('M47 — chat message interactions', () => {
  let db: PGlite;
  let matchId = '';
  let messageId = '';

  beforeAll(async () => {
    db = await createBaseDb();
    const precedingMigrations = migrationFiles().filter(
      (file) => file <= LAST_MIGRATION_WITH_CHAT_SCHEMA,
    );
    await applyMigrations(db, precedingMigrations);
    await applyMigrations(db, [CHAT_INTERACTIONS_MIGRATION]);
    await applyMigrations(db, [CHAT_INTERACTIONS_MIGRATION]);

    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}','${USER_B}') on conflict do nothing`,
      ),
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_B}','${USER_A}') on conflict do nothing`,
      ),
    );
    const match = await db.query<{ id: string }>(
      `select id from public.matches
        where user_a = least('${USER_A}'::uuid,'${USER_B}'::uuid)
          and user_b = greatest('${USER_A}'::uuid,'${USER_B}'::uuid)`,
    );
    matchId = match.rows[0].id;

    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchId}','${USER_A}','hello')`,
      ),
    );
    const message = await db.query<{ id: string }>(
      `select id from public.messages where match_id = '${matchId}'`,
    );
    messageId = message.rows[0].id;
  });

  it('adds an edit flag and lets the sender update their message', async () => {
    const initialFlag = await asUser(db, USER_A, async () => {
      const result = await db.query<{ is_edited: boolean }>(
        `select is_edited from public.messages where id = '${messageId}'`,
      );
      return result.rows[0].is_edited;
    });
    expect(initialFlag).toBe(false);

    await asUser(db, USER_A, () =>
      db.query(
        `update public.messages
         set content = 'edited', is_edited = true
         where id = '${messageId}'`,
      ),
    );
    const edited = await db.query<{ content: string; is_edited: boolean }>(
      `select content, is_edited from public.messages where id = '${messageId}'`,
    );
    expect(edited.rows[0]).toEqual({ content: 'edited', is_edited: true });
  });

  it('pins and unpins for only the authenticated member', async () => {
    await asUser(db, USER_B, () =>
      db.query(`select public.pin_message('${matchId}'::uuid, '${messageId}'::uuid)`),
    );
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.pinned_messages
         where match_id = '${matchId}' and message_id = '${messageId}' and user_id = '${USER_B}'`,
      ),
    ).toBe(1);

    await asUser(db, USER_B, () =>
      db.query(`select public.unpin_message('${matchId}'::uuid, '${messageId}'::uuid)`),
    );
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.pinned_messages
         where match_id = '${matchId}' and message_id = '${messageId}' and user_id = '${USER_B}'`,
      ),
    ).toBe(0);
  });

  it('deletes a message only from the caller’s view', async () => {
    await asUser(db, USER_B, () =>
      db.query(`select public.delete_message_for_me('${messageId}'::uuid)`),
    );
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.message_deletions
         where message_id = '${messageId}' and user_id = '${USER_B}'`,
      ),
    ).toBe(1);
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.message_deletions
         where message_id = '${messageId}' and user_id = '${USER_A}'`,
      ),
    ).toBe(0);
  });

  it('rejects interaction RPCs from conversation non-participants', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.pin_message('${matchId}'::uuid, '${messageId}'::uuid)`),
      ),
    ).rejects.toThrow(/not a conversation participant/i);
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.delete_message_for_me('${messageId}'::uuid)`),
      ),
    ).rejects.toThrow(/not a conversation participant/i);
  });
});
