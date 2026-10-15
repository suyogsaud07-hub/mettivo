import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Database test harness.
 *
 * Boots a real PostgreSQL (PGlite, the WASM build) in memory, creates the
 * pre-existing Supabase objects the migrations depend on, then applies every
 * file in `supabase/migrations` in filename order.
 *
 * This means the migration files themselves are under test: if one stops being
 * executable, or stops being idempotent, the suite fails. That is the property
 * the M4/M6 milestones kept tripping over.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export const USER_A = '11111111-1111-1111-1111-111111111111';
export const USER_B = '22222222-2222-2222-2222-222222222222';
export const USER_C = '33333333-3333-3333-3333-333333333333';
export const USER_D = '44444444-4444-4444-4444-444444444444';
export const MODERATOR = '99999999-9999-9999-9999-999999999999';

/** The schema Supabase provides before any of this project's migrations run. */
const BASE_SCHEMA = `
  create schema if not exists auth;
  create role anon nologin;
  create role authenticated nologin;

  -- Stands in for Supabase's auth.uid(), which reads the JWT subject.
  create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

  create table auth.users (id uuid primary key);
  insert into auth.users (id) values
    ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}'), ('${MODERATOR}');

  -- Mirrors the live profiles table, including the columns the M6 view reads.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text, age integer, gender text, city text, country text,
    avatar_url text, photos text[], bio text, intention text, looking_for text[],
    hobbies text[], pets text[], personality text[], religion text, politics text,
    drinking text, smoking text, interests text[], prompts jsonb,
    is_online boolean default false, is_verified boolean default false,
    onboarding_completed boolean default false, updated_at timestamptz default now(),
    birth_date date
  );
  insert into public.profiles (id, display_name, gender, country) values
    ('${USER_A}', 'Ada',  'Woman', 'Nepal'),
    ('${USER_B}', 'Bo',   'Man',   'Nepal'),
    ('${USER_C}', 'Cy',   'Woman', 'Nepal'),
    ('${USER_D}', 'Dee',  'Man',   'Nepal'),
    ('${MODERATOR}', 'Mod', 'Woman', 'Nepal');

  create table public.messages (
    id uuid primary key default gen_random_uuid(),
    match_id text, sender_id uuid, content text, created_at timestamptz default now()
  );
  create table public.follows (follower_id uuid, following_id uuid);
  create table public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid, reported_user_id uuid, reason text, details text,
    status text default 'pending', created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table public.blocked_users (
    id uuid primary key default gen_random_uuid(),
    blocker_id uuid, blocked_user_id uuid, created_at timestamptz default now()
  );

  grant usage on schema public to anon, authenticated;
  grant select, insert, update, delete on
    public.profiles, public.messages, public.follows, public.reports, public.blocked_users
    to authenticated;

  -- Supabase grants the anon role table privileges by default and relies on RLS
  -- as the gate. Mirroring that here means the anon tests prove RLS is working,
  -- rather than accidentally proving only that a GRANT is missing.
  grant select, insert, update, delete on
    public.profiles, public.messages, public.follows, public.reports, public.blocked_users
    to anon;

  -- A real Supabase project also runs
  --   alter default privileges in schema public grant all on tables to anon, authenticated;
  -- so every table created later by a migration arrives world-grantable and RLS
  -- alone decides what is visible. Without this, an "anonymous reads zero rows"
  -- assertion on a migration-created table passes merely because the GRANT is
  -- missing -- proving nothing about RLS. Grants are not the boundary here.
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated;
`;

/** Migration filenames in the order they must be applied. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export async function applyMigrations(
  db: PGlite,
  files: string[] = migrationFiles()
): Promise<void> {
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
  }
}

/**
 * A database that mirrors the LIVE project's column types.
 *
 * The default `BASE_SCHEMA` declares `messages.match_id` as `text`, but the live
 * project declares it `uuid` (verified by probing PostgREST: a non-uuid filter
 * value is rejected with `22P02 invalid input syntax for type uuid`, while a
 * genuine text column such as `profiles.display_name` accepts it).
 *
 * That single divergence made the whole migration set look correct locally while
 * `create policy ... where m.id::text = messages.match_id` failed on the live
 * project with `operator does not exist: text = uuid`. `CREATE POLICY` IS
 * type-checked at creation time, so it is the first thing to break.
 *
 * This variant exists so the suite can never make that assumption again.
 */
export async function createLiveLikeDb(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(BASE_SCHEMA.replace('match_id text,', 'match_id uuid,'));

  // The live project already has a `matches` table (an older shape): only `id`
  // and `created_at`, with `user_a`/`user_b` added by the M10 migration.
  await db.exec(`
    create table if not exists public.matches (
      id         uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now()
    );
  `);

  return db;
}

/**
 * Fresh database with the Supabase base objects and NO project migrations.
 *
 * Use this to assert something about the migration set as a whole — for example
 * that `supabase/apply_all.sql`, the file an operator pastes into the SQL
 * Editor, applies cleanly in one pass.
 */
export async function createBaseDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  return db;
}

/** Fresh database with the base schema and every migration applied. */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await applyMigrations(db);
  return db;
}

/** Runs `fn` as a signed-in member, the way Supabase sets the JWT claim. */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  await db.exec(`set role authenticated;`);
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
    // `set_config(..., false)` is session-scoped: without clearing it, auth.uid()
    // keeps returning the last acting user for every later top-level statement.
    // Clearing restores the real "no session" state that a backend/superuser
    // write sees, which the moderation guard distinguishes via `auth.uid() is null`.
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/** Runs `fn` as an anonymous caller carrying only the public anon key. */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

/**
 * Rows a write actually changed, run as `userId`.
 *
 * IMPORTANT: RLS denies by *filtering rows*, not by raising an error, so a
 * `try/catch` around a statement proves nothing. Assert the effect — 0 changed
 * rows — instead. This distinction produced a false "security breach" during
 * the M10 work.
 */
export async function affectedRows(
  db: PGlite,
  userId: string,
  sql: string
): Promise<number> {
  return asUser(db, userId, async () => {
    const result = await db.query(sql);
    return result.affectedRows ?? 0;
  });
}

/**
 * Rows a write changed, counting an outright rejection as **zero effect**.
 *
 * A caller can be denied in two different ways:
 *   * the table privilege is missing, or a blocked INSERT violates WITH CHECK
 *     -> PostgreSQL raises, and
 *   * the row is filtered by an RLS `USING` clause on UPDATE/DELETE
 *     -> no error, zero rows changed.
 *
 * Both mean the caller did not get their way, which is the property under test,
 * so "no effect" is the honest combined assertion. Use `affectedRows` when the
 * distinction itself matters.
 */
export async function writeEffect(
  db: PGlite,
  userId: string,
  sql: string
): Promise<number> {
  try {
    return await affectedRows(db, userId, sql);
  } catch {
    return 0;
  }
}

/**
 * Arrange a fixture as the database owner, with no session attached.
 *
 * Some rows are only ever written by SECURITY DEFINER triggers (notifications,
 * game results). A test that needs such a row present must seed it the way the
 * backend does, not by inventing an INSERT policy the product deliberately
 * omits. `auth.uid()` is cleared so the moderation guard sees `null` and lets
 * the owner write moderation columns.
 */
export async function seed(db: PGlite, sql: string): Promise<void> {
  await db.exec(`reset role;`);
  await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  await db.exec(sql);
}

/** Rows a table holds, counted as the owner (no RLS, no session). */
export async function systemicCount(db: PGlite, sql: string): Promise<number> {
  await db.exec(`reset role;`);
  await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  const result = await db.query<{ n: number }>(sql);
  return result.rows[0]?.n ?? 0;
}

export async function rowCount(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table}`
  );
  return result.rows[0]?.n ?? 0;
}

/** Runs a query as `userId` and returns the typed rows. */
export async function queryAs<T>(
  db: PGlite,
  userId: string,
  sql: string
): Promise<T[]> {
  return asUser(db, userId, async () => {
    const result = await db.query<T>(sql);
    return result.rows;
  });
}

/** A single count from a `select count(*)::int as n` query, run as `userId`. */
export async function scalarAs(
  db: PGlite,
  userId: string,
  sql: string
): Promise<number> {
  const rows = await queryAs<{ n: number }>(db, userId, sql);
  return rows[0]?.n ?? 0;
}

/** True when the statement raises (a real policy violation, not a filtered row). */
export async function isRejected(
  db: PGlite,
  userId: string,
  sql: string
): Promise<boolean> {
  try {
    await asUser(db, userId, () => db.exec(sql));
    return false;
  } catch {
    return true;
  }
}

/**
 * Rows an anonymous caller can read from a `select count(*)::int as n` query.
 *
 * Returns 0 both when RLS filters everything out and when the statement is
 * rejected outright with "permission denied" — either way the anonymous caller
 * learns nothing, which is the property under test.
 */
export async function anonReadCount(db: PGlite, sql: string): Promise<number> {
  try {
    return await asAnon(db, async () => {
      const result = await db.query<{ n: number }>(sql);
      return result.rows[0]?.n ?? 0;
    });
  } catch {
    return 0;
  }
}
