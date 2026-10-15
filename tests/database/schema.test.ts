import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_A, USER_B, createTestDb, migrationFiles } from './harness';

/**
 * M4 — Supabase schema consolidation.
 *
 * The database is the only authority in this product, so its *structure* is
 * itself a testable contract:
 *
 *   1. every table in `public` has RLS enabled and a primary key,
 *   2. every foreign key points at a real table,
 *   3. every foreign key is backed by an index (unindexed FKs make the erasure
 *      cascade and the RLS checks scan),
 *   4. no foreign key to the erasure root can block account deletion,
 *   5. no migration depends on the `uuid-ossp` extension,
 *   6. the reports/blocked_users integrity constraints actually exist.
 *
 * A failure here is a schema defect, not a test defect.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** SQL text with `--` line comments and `/* *\/` blocks removed. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

describe('M4 — schema integrity', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('enables RLS on every table in public', async () => {
    const result = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity is not true
    `);
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('gives every table a primary key', async () => {
    const result = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not exists (
          select 1 from pg_constraint k
          where k.conrelid = c.oid and k.contype = 'p'
        )
    `);
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('references only tables that exist', async () => {
    // `confrelid = 0` means the FK target vanished: the repository and a
    // rebuilt database disagree.
    const result = await db.query<{ conname: string; table: string }>(`
      select k.conname, k.conrelid::regclass::text as table
      from pg_constraint k
      join pg_namespace n on n.oid = k.connamespace
      where n.nspname = 'public' and k.contype = 'f' and k.confrelid = 0
    `);
    expect(result.rows).toEqual([]);
  });

  it('backs every foreign key with an index', async () => {
    // PostgreSQL does not create these. Without them, the `on delete cascade`
    // walk during account erasure is a sequential scan per referencing table.
    const result = await db.query<{ table_name: string; column_name: string }>(`
      select
        k.conrelid::regclass::text as table_name,
        a.attname                   as column_name
      from pg_constraint k
      join pg_namespace n on n.oid = k.connamespace
      join pg_attribute a
        on a.attrelid = k.conrelid
       and a.attnum   = k.conkey[1]
      where n.nspname = 'public'
        and k.contype = 'f'
        and not exists (
          select 1
          from pg_index i
          where i.indrelid = k.conrelid
            and i.indisvalid
            and i.indkey[0] = k.conkey[1]
        )
      order by 1, 2
    `);
    expect(
      result.rows.map((row) => `${row.table_name}.${row.column_name}`),
      'foreign key columns with no index'
    ).toEqual([]);
  });

  it('never lets a foreign key block account erasure', async () => {
    // `delete_my_account()` cascades from `auth.users`. `confdeltype`:
    // c = cascade, n = set null, d = set default. 'a' (no action) and
    // 'r' (restrict) would make erasure fail with a foreign-key violation.
    const result = await db.query<{ conname: string; confdeltype: string }>(`
      select k.conname, k.confdeltype
      from pg_constraint k
      join pg_namespace n on n.oid = k.connamespace
      where n.nspname = 'public'
        and k.contype = 'f'
        and k.confrelid = to_regclass('auth.users')
        and k.confdeltype not in ('c', 'n', 'd')
    `);
    expect(result.rows, 'these foreign keys would block erasure').toEqual([]);
  });

  it('uses no extension-dependent UUID function', () => {
    // `uuid_generate_v4()` needs the `uuid-ossp` extension; `gen_random_uuid()`
    // is built in from PostgreSQL 13, so a migration never creates one.
    // Comments are stripped first — prose *about* the ban is not a violation.
    const offenders = migrationFiles().filter((file) =>
      /uuid_generate_v4/i.test(
        stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      )
    );
    expect(offenders).toEqual([]);
  });

  it('installs the reports and blocked_users integrity constraints', async () => {
    const result = await db.query<{ conname: string }>(`
      select k.conname
      from pg_constraint k
      where k.conname in (
        'reports_reporter_reported_key',
        'reports_status_check',
        'reports_no_self_report',
        'reports_reporter_id_fkey',
        'reports_reported_user_id_fkey',
        'blocked_users_blocker_blocked_key',
        'blocked_users_no_self_block',
        'blocked_users_blocker_id_fkey',
        'blocked_users_blocked_user_id_fkey',
        'follows_pkey'
      )
      order by k.conname
    `);
    expect(result.rows.map((row) => row.conname)).toEqual([
      'blocked_users_blocked_user_id_fkey',
      'blocked_users_blocker_blocked_key',
      'blocked_users_blocker_id_fkey',
      'blocked_users_no_self_block',
      'follows_pkey',
      'reports_no_self_report',
      'reports_reported_user_id_fkey',
      'reports_reporter_id_fkey',
      'reports_reporter_reported_key',
      'reports_status_check',
    ]);
  });

  it('rejects a duplicate report, a self-block and a duplicate follow', async () => {
    await db.exec(
      `insert into public.reports (reporter_id, reported_user_id, reason)
       values ('${USER_A}','${USER_B}','harassment')`
    );

    await expect(
      db.exec(
        `insert into public.reports (reporter_id, reported_user_id, reason)
         values ('${USER_A}','${USER_B}','fake_profile')`
      )
    ).rejects.toThrow(/reports_reporter_reported_key|duplicate key/i);

    await expect(
      db.exec(
        `insert into public.blocked_users (blocker_id, blocked_user_id)
         values ('${USER_A}','${USER_A}')`
      )
    ).rejects.toThrow(/blocked_users_no_self_block|check constraint/i);

    await expect(
      db.exec(
        `insert into public.reports (reporter_id, reported_user_id, reason)
         values ('${USER_A}','${USER_A}','harassment')`
      )
    ).rejects.toThrow(/reports_no_self_report|check constraint/i);

    // Duplicate follows were possible before M4 gave the table a key.
    await db.exec(`insert into public.follows values ('${USER_A}','${USER_B}')`);
    await expect(
      db.exec(`insert into public.follows values ('${USER_A}','${USER_B}')`)
    ).rejects.toThrow(/follows_pkey|duplicate key/i);

    // A self-follow stays legal: the notification trigger suppresses it, and
    // the product must not error on it.
    await expect(
      db.exec(`insert into public.follows values ('${USER_A}','${USER_A}')`)
    ).resolves.toBeDefined();
  });
});
