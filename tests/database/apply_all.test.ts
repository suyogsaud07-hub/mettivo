import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anonReadCount, createBaseDb, createLiveLikeDb, migrationFiles } from './harness';

/**
 * The operator's bootstrap file.
 *
 * `supabase/apply_all.sql` is what a human pastes into the Supabase SQL Editor
 * to take a live project from un-migrated to fully protected. Nothing else in
 * the suite tests that artifact — the per-file harness applies the migrations
 * individually. If the bundle is stale, truncated or ordered wrongly, the
 * failure would otherwise be discovered in production.
 *
 * Three properties, all of which have failed before on this project:
 *   1. it applies cleanly in ONE pass, in order;
 *   2. re-running it is a no-op (half-applied state is a real risk here);
 *   3. afterwards, an anonymous caller reads ZERO rows (RISK_REGISTER R-01).
 */

const BUNDLE = join(process.cwd(), 'supabase', 'apply_all.sql');

const PERSONAL_TABLES = [
  'profiles',
  'messages',
  'follows',
  'reports',
  'blocked_users',
  'likes',
  'matches',
  'notifications',
  'admin_audit_log',
  'rate_limit_counters',
  'moments',
  'moment_likes',
  'moment_comments',
  'game_results',
  'match_read_state',
  'user_roles',
  'reports',
  // M17: member-scoped settings. RLS must be on and enforced like any other row
  // that belongs to exactly one member.
  'user_preferences',
  // M24 audit tables retained after face/voice verification was removed in M31.
  // They still hold member-scoped historical rows and must stay dark to an
  // anonymous caller.
  'profile_verifications',
  'profile_photo_checks',
];

describe('apply_all.sql — the operator bootstrap', () => {
  let sql = '';
  let db: PGlite;

  beforeAll(async () => {
    sql = readFileSync(BUNDLE, 'utf8');
    db = await createBaseDb();
  });

  it('contains every migration, in filename order', () => {
    const positions = migrationFiles().map((file) => {
      const header = `-- # ${file}`;
      return { file, at: sql.indexOf(header) };
    });

    // Every migration must be present...
    expect(positions.filter((entry) => entry.at === -1).map((entry) => entry.file)).toEqual([]);

    // ...and the order of the headers must match the filename order.
    const ordered = positions.map((entry) => entry.at);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it('never uses an extension-dependent UUID function', () => {
    // Comments are stripped: the bundle's prose explains the ban.
    const code = sql.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/uuid_generate_v4/i);
  });

  it('applies cleanly in a single pass', async () => {
    await expect(db.exec(sql)).resolves.toBeDefined();
  });

  it('re-applies as a no-op', async () => {
    // This is the property that catches half-applied work: an operator who is
    // unsure whether they finished can simply run it again.
    await expect(db.exec(sql)).resolves.toBeDefined();
  });

  it('leaves every personal-data table RLS-enabled', async () => {
    const result = await db.query<{ relname: string }>(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relrowsecurity is not true
    `);
    expect(result.rows.map((row) => row.relname)).toEqual([]);
  });

  it('leaves anonymous callers unable to read a single personal row', async () => {
    // The exact property `./scripts/verify-rls.sh` checks against the live
    // project, asserted here against a database built only from the bundle.
    const leaks: string[] = [];
    for (const table of new Set(PERSONAL_TABLES)) {
      const rows = await anonReadCount(db, `select count(*)::int as n from public.${table}`);
      if (rows > 0) leaks.push(`${table}: ${rows} rows`);
    }
    expect(leaks).toEqual([]);
  });

  it('leaves the allow-listed projections unreadable anonymously', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.public_profiles`)).toBe(0);
    expect(await anonReadCount(db, `select count(*)::int as n from public.moment_feed`)).toBe(0);
  });

  it('installs the blocking and moderation functions the UI depends on', async () => {
    const result = await db.query<{ proname: string }>(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'is_blocked_pair','block_member','unblock_member','unmatch_member',
          'discover_profiles','record_like','unread_counts','mark_conversation_read',
          'admin_report_queue','admin_resolve_report','snapshot_report_evidence'
        )
      order by p.proname
    `);
    expect(result.rows.map((row) => row.proname)).toEqual([
      'admin_report_queue',
      'admin_resolve_report',
      'block_member',
      'discover_profiles',
      'is_blocked_pair',
      'mark_conversation_read',
      'record_like',
      'snapshot_report_evidence',
      'unblock_member',
      'unmatch_member',
      'unread_counts',
    ]);
  });

  it('applies cleanly on a live-shaped database too', async () => {
    // The bundle must work against the LIVE column types, not only the default
    // harness shape. This is the exact combination that failed for the operator
    // with "operator does not exist: text = uuid".
    const liveDb = await createLiveLikeDb();
    await expect(liveDb.exec(sql)).resolves.toBeDefined();
    await expect(liveDb.exec(sql)).resolves.toBeDefined();
  });

  it('seeds the interest and prompt catalogue', async () => {
    const interests = await db.query<{ n: number }>(
      `select count(*)::int as n from public.interests`
    );
    const prompts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.prompt_catalogue`
    );
    expect(interests.rows[0].n).toBeGreaterThan(0);
    expect(prompts.rows[0].n).toBeGreaterThan(0);
  });
});
