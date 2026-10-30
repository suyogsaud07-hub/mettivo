import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  anonReadCount,
  applyMigrations,
  asUser,
  createEmptySupabaseDb,
  isRejected,
  queryAs,
  seed,
  systemicCount,
} from './harness';

interface StartResult {
  conversation_id: string;
  relationship_state: string;
}

describe('clean bootstrap — an empty Supabase project becomes the product', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createEmptySupabaseDb();
  });

  it('starts with no public project tables', async () => {
    const rows = await db.query<{ n: number }>(`
      select count(*)::int as n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(rows.rows[0].n).toBe(0);
  });

  it('applies and re-applies every migration in filename order', async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it('recreates the pre-migration tables with fail-closed RLS', async () => {
    const rows = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity
        and c.relname in ('profiles','messages','follows','reports','blocked_users')
      order by c.relname
    `);
    expect(rows.rows.map((row) => row.relname)).toEqual([
      'blocked_users',
      'follows',
      'messages',
      'profiles',
      'reports',
    ]);
  });

  it('adds the messages.match_id foreign key once matches exists', async () => {
    const rows = await db.query<{ conname: string }>(`
      select conname
      from pg_constraint
      where conrelid = 'public.messages'::regclass
        and conname = 'messages_match_id_fkey'
    `);
    expect(rows.rows).toEqual([{ conname: 'messages_match_id_fkey' }]);
  });

  it('supports follow, match, messaging and history-preserving block', async () => {
    await seed(
      db,
      `insert into public.profiles
         (id, display_name, age, gender, intention, country, onboarding_completed)
       values
         ('${USER_A}', 'Ada', 27, 'Woman', 'dating', 'Nepal', true),
         ('${USER_B}', 'Bo',  28, 'Man',   'dating', 'Nepal', true)
       on conflict (id) do update set
         display_name = excluded.display_name,
         age = excluded.age,
         gender = excluded.gender,
         intention = excluded.intention,
         country = excluded.country,
         onboarding_completed = excluded.onboarding_completed`
    );

    for (const [from, to] of [
      [USER_A, USER_B],
      [USER_B, USER_A],
    ]) {
      await asUser(db, from, () =>
        db.exec(
          `insert into public.follows (follower_id, following_id)
           values ('${from}','${to}')`
        )
      );
    }

    const match = await queryAs<{ kind: string }>(
      db,
      USER_A,
      `select kind from public.matches`
    );
    expect(match).toEqual([{ kind: 'match' }]);

    const started = await queryAs<{ result: StartResult }>(
      db,
      USER_A,
      `select public.start_conversation('${USER_B}'::uuid) as result`
    );
    const conversationId = started[0].result.conversation_id;
    expect(started[0].result.relationship_state).toBe('MATCHED');

    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${conversationId}','${USER_A}','before block')`
      )
    );

    await queryAs(
      db,
      USER_B,
      `select public.block_member('${USER_A}'::uuid)`
    );

    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.messages
          where match_id = '${conversationId}'::uuid`
      )
    ).toBe(1);

    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.messages (match_id, sender_id, content)
         values ('${conversationId}','${USER_A}','after block')`
      )
    ).toBe(true);

    expect(
      await anonReadCount(db, `select count(*)::int as n from public.messages`)
    ).toBe(0);
    expect(
      await anonReadCount(db, `select count(*)::int as n from public.profiles`)
    ).toBe(0);
  });
});
