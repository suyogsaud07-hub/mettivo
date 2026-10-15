import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyMigrations, createBaseDb, createLiveLikeDb } from './harness';

/**
 * R-14 — restore rehearsal (the schema half).
 *
 * A backup nobody has restored is a hypothesis. The same is true of a
 * repository: `CONSTITUTION.md` Article 3.12 says the migrations must be able to
 * rebuild the product, and until that is *demonstrated* it is an assumption.
 *
 * This suite rehearses a rebuild from nothing and then proves the result is
 * STRUCTURALLY IDENTICAL to a database built the ordinary way:
 *
 *   database A — every migration applied file by file (the development path)
 *   database B — `supabase/apply_all.sql`, the single artefact an operator
 *                pastes into the SQL editor (the recovery path)
 *
 * If those two ever diverge, a restore produces a database the tests have never
 * seen. That is exactly the failure this catches.
 *
 * The DATA half of R-14 — restoring a dump into a scratch project and timing it —
 * needs a project and credentials, and is scripted in
 * `scripts/restore-rehearsal.sh`. Until that has actually been run, R-14 stays
 * open in the risk register.
 */

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface NamedRow {
  name: string;
}

const TABLES = `
  select c.relname as name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by 1
`;

const COLUMNS = `
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, column_name
`;

const CONSTRAINTS = `
  select k.conname as name
  from pg_constraint k
  join pg_namespace n on n.oid = k.connamespace
  where n.nspname = 'public'
  order by 1
`;

const POLICIES = `
  select p.tablename || '.' || p.policyname || ':' || p.cmd as name
  from pg_policies p
  where p.schemaname = 'public'
  order by 1
`;

const FUNCTIONS = `
  select p.proname as name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by 1
`;

const INDEXES = `
  select indexname as name
  from pg_indexes
  where schemaname = 'public'
  order by 1
`;

describe('R-14 — rebuilding from the repository matches the normal path', () => {
  let normal: PGlite;
  let recovered: PGlite;
  let recoveredLiveShape: PGlite;

  beforeAll(async () => {
    normal = await createBaseDb();
    await applyMigrations(normal);

    recovered = await createBaseDb();
    await recovered.exec(readFileSync(join(process.cwd(), 'supabase', 'apply_all.sql'), 'utf8'));

    // A rebuild must also work against the live column types.
    recoveredLiveShape = await createLiveLikeDb();
    await recoveredLiveShape.exec(
      readFileSync(join(process.cwd(), 'supabase', 'apply_all.sql'), 'utf8')
    );
  });

  it('creates the same tables', async () => {
    const a = await normal.query<NamedRow>(TABLES);
    const b = await recovered.query<NamedRow>(TABLES);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));
  });

  it('creates the same columns, with the same types and nullability', async () => {
    const a = await normal.query<ColumnRow>(COLUMNS);
    const b = await recovered.query<ColumnRow>(COLUMNS);
    expect(b.rows).toEqual(a.rows);
  });

  it('creates the same constraints', async () => {
    const a = await normal.query<NamedRow>(CONSTRAINTS);
    const b = await recovered.query<NamedRow>(CONSTRAINTS);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));
  });

  it('creates the same RLS policies', async () => {
    const a = await normal.query<NamedRow>(POLICIES);
    const b = await recovered.query<NamedRow>(POLICIES);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));
  });

  it('creates the same functions', async () => {
    const a = await normal.query<NamedRow>(FUNCTIONS);
    const b = await recovered.query<NamedRow>(FUNCTIONS);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));
  });

  it('creates the same indexes', async () => {
    const a = await normal.query<NamedRow>(INDEXES);
    const b = await recovered.query<NamedRow>(INDEXES);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));
  });

  it('rebuilds the same tables, policies and functions on the live column types', async () => {
    const a = await normal.query<NamedRow>(TABLES);
    const b = await recoveredLiveShape.query<NamedRow>(TABLES);
    expect(b.rows.map((r) => r.name)).toEqual(a.rows.map((r) => r.name));

    const ap = await normal.query<NamedRow>(POLICIES);
    const bp = await recoveredLiveShape.query<NamedRow>(POLICIES);
    expect(bp.rows.map((r) => r.name)).toEqual(ap.rows.map((r) => r.name));

    const af = await normal.query<NamedRow>(FUNCTIONS);
    const bf = await recoveredLiveShape.query<NamedRow>(FUNCTIONS);
    expect(bf.rows.map((r) => r.name)).toEqual(af.rows.map((r) => r.name));
  });

  it('leaves the rebuilt database with RLS on every table', async () => {
    const result = await recovered.query<NamedRow>(`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity is not true
      order by 1
    `);
    expect(result.rows.map((row) => row.name)).toEqual([]);
  });

  it('rebuilds every table the tests depend on', async () => {
    const result = await recovered.query<NamedRow>(TABLES);
    const names = result.rows.map((row) => row.name);
    for (const table of [
      'profiles', 'messages', 'follows', 'reports', 'blocked_users', 'likes',
      'matches', 'notifications', 'moments', 'moment_likes', 'moment_comments',
      'game_catalog', 'game_results', 'user_roles', 'admin_audit_log',
      'rate_limit_counters', 'rate_limit_rules', 'match_read_state',
      'interest_categories', 'interests', 'prompt_catalogue',
    ]) {
      expect(names, `${table} must be rebuildable`).toContain(table);
    }
  });
});
