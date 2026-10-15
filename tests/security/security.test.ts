import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  USER_A,
  USER_B,
  USER_C,
  affectedRows,
  anonReadCount,
  asAnon,
  asUser,
  createTestDb,
  seed,
  systemicCount,
  writeEffect,
} from '../database/harness';

/**
 * M17 — security and privacy testing.
 *
 * Four families of assertion:
 *   1. Auth bypass attempts   — an anonymous caller must learn nothing.
 *   2. Privilege escalation   — a member must not be able to grant themselves
 *                              power or forge records.
 *   3. Database hardening     — SECURITY DEFINER functions must pin search_path,
 *                              and must derive identity from auth.uid() rather
 *                              than accepting a user id.
 *   4. Secrets hygiene        — no service key, JWT, or .env file in the repo.
 *   5. Public surface hygiene — discovery reads the allow-listed projection, so
 *                              private columns never leave the database.
 *
 * Live-project verification (HTTPS headers, real anon-key probing) lives in
 * scripts/verify-rls.sh and runs in CI against the deployed project.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

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
  // M17: member-scoped settings. An anonymous caller must read zero rows.
  'user_preferences',
];

describe('1. auth bypass attempts (anonymous callers)', () => {
  it('cannot read a single row from any personal-data table', async () => {
    // Guard against a vacuous pass. On these tables Supabase grants anonymous
    // callers table privileges and relies on RLS alone -- the harness mirrors
    // that. Pin the grant here: if it ever goes missing, "zero rows" would prove
    // only that a GRANT is absent, not that RLS works.
    //
    // `profiles` is deliberately absent: M15 revokes table-wide SELECT from anon
    // there, so its denial is structural rather than policy-based. That is
    // asserted separately below -- it is a stronger position, not a weaker one.
    for (const table of ['messages', 'follows', 'reports', 'blocked_users']) {
      expect(
        await systemicCount(
          db,
          `select count(*)::int as n
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = '${table}'
              and has_table_privilege('anon', c.oid, 'SELECT')`
        ),
        `anon lacks SELECT on ${table}: the zero-row assertion would be vacuous`
      ).toBe(1);
    }

    const leaks: string[] = [];

    for (const table of PERSONAL_TABLES) {
      const rows = await anonReadCount(db, `select count(*)::int as n from public.${table}`);
      if (rows > 0) leaks.push(`${table}: ${rows} rows`);
    }

    expect(leaks).toEqual([]);
  });

  it('cannot read the public profile projection', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.public_profiles`)).toBe(0);
  });

  it('cannot read the aggregated moments feed', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.moment_feed`)).toBe(0);
  });

  it('cannot execute privileged RPCs', async () => {
    const privileged = [
      `select public.export_my_data()`,
      `select public.delete_my_account()`,
      `select public.record_like('${USER_A}'::uuid, true)`,
      `select public.share_moment(gen_random_uuid())`,
      `select public.record_game_result('tic-tac-toe','win',1,1)`,
      `select public.admin_suspend_user('${USER_A}'::uuid,'x')`,
    ];

    for (const statement of privileged) {
      await expect(
        asAnon(db, () => db.query(statement)),
        `anon should not run: ${statement}`
      ).rejects.toThrow();
    }
  });
});

describe('2. privilege escalation attempts', () => {
  it('cannot grant itself a moderator role', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.exec(`insert into public.user_roles (user_id, role) values ('${USER_C}','admin')`)
      )
    ).rejects.toThrow();
  });

  it('cannot promote itself by updating an existing role', async () => {
    // C starts with no row, so give it an ordinary one as the owner. The
    // escalation under test is "flip my own role", not "invent a row".
    await seed(
      db,
      `insert into public.user_roles (user_id, role) values ('${USER_C}','user')
         on conflict (user_id) do nothing`
    );

    const changed = await writeEffect(
      db,
      USER_C,
      `update public.user_roles set role = 'admin' where user_id = '${USER_C}'`
    );
    expect(changed).toBe(0);

    // The role must genuinely still be 'user', not merely "no error raised".
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.user_roles
          where user_id = '${USER_C}' and role = 'user'`
      )
    ).toBe(1);
  });

  it('cannot lift its own suspension', async () => {
    // A no-op write would not exercise the guard: it only fires when a
    // moderation column actually changes, so suspend C first (as an admin
    // would). Otherwise `set is_suspended = false` on an already-false row
    // succeeds while proving nothing.
    await seed(
      db,
      `update public.profiles
          set is_suspended = true, suspended_at = now(), suspension_reason = 'test'
        where id = '${USER_C}'`
    );
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.profiles
          where id = '${USER_C}' and is_suspended`
      )
    ).toBe(1);

    await expect(
      asUser(db, USER_C, () =>
        db.exec(`update public.profiles set is_suspended = false where id = '${USER_C}'`)
      )
    ).rejects.toThrow(/moderation fields/i);

    // The suspension must have survived the attempt.
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.profiles
          where id = '${USER_C}' and is_suspended`
      )
    ).toBe(1);

    // Leave the fixture clean for the cases that follow.
    await seed(
      db,
      `update public.profiles
          set is_suspended = false, suspended_at = null, suspension_reason = null
        where id = '${USER_C}'`
    );
  });

  it('cannot forge a match, a notification or a game result', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.exec(`insert into public.matches (user_a, user_b) values ('${USER_A}','${USER_B}')`)
      )
    ).rejects.toThrow();

    await expect(
      asUser(db, USER_C, () =>
        db.exec(`insert into public.notifications (user_id, type) values ('${USER_A}','like')`)
      )
    ).rejects.toThrow();

    await expect(
      asUser(db, USER_C, () =>
        db.exec(
          `insert into public.game_results (user_id, game_id, outcome) values ('${USER_A}','tic-tac-toe','win')`
        )
      )
    ).rejects.toThrow();
  });

  it('cannot read another member’s private rows', async () => {
    // Notifications and game results have no INSERT policy by design: their rows
    // come only from SECURITY DEFINER triggers/RPCs. Seed B's rows the way the
    // backend does, as the owner -- not by inventing a policy the product
    // deliberately omits.
    await seed(
      db,
      `insert into public.notifications (user_id, type) values ('${USER_B}','like')`
    );
    await seed(
      db,
      `insert into public.game_results (user_id, game_id, outcome)
       values ('${USER_B}','tic-tac-toe','win')`
    );

    // Without this the assertions below would pass vacuously on an empty table.
    for (const table of ['notifications', 'game_results']) {
      expect(
        await systemicCount(
          db,
          `select count(*)::int as n from public.${table} where user_id = '${USER_B}'`
        ),
        `fixture missing: ${table} has no row for USER_B`
      ).toBeGreaterThan(0);
    }

    for (const table of ['notifications', 'game_results']) {
      const visible = await asUser(db, USER_C, async () => {
        const result = await db.query<{ n: number }>(
          `select count(*)::int as n from public.${table} where user_id = '${USER_B}'`
        );
        return result.rows[0]?.n ?? 0;
      });
      expect(visible, `USER_C must not see USER_B rows in ${table}`).toBe(0);
    }
  });

  it('cannot write rows as another member', async () => {
    const forgedLike = await affectedRows(
      db,
      USER_C,
      `update public.likes set is_like = false where liker_id = '${USER_A}'`
    );
    expect(forgedLike).toBe(0);
  });
});

describe('3. database hardening', () => {
  it('pins search_path on every SECURITY DEFINER function', async () => {
    // An unpinned search_path lets a caller shadow tables or operators and
    // escalate through a SECURITY DEFINER function.
    const result = await db.query<{ proname: string }>(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
          where cfg like 'search_path=%'
        )
    `);
    expect(result.rows.map((row) => row.proname)).toEqual([]);
  });

  it('derives identity from auth.uid() instead of a user-id parameter', async () => {
    // None of these may accept the acting user as an argument, otherwise the
    // caller could act on somebody else's account.
    const result = await db.query<{ proname: string; args: string }>(`
      select p.proname, pg_get_function_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'record_like','export_my_data','delete_my_account','share_moment',
          'record_game_result','admin_set_report_status','admin_unsuspend_user'
        )
    `);

    const offender = result.rows.find((row) =>
      /(^|,\s*)(p_)?(actor|me|caller|user|user_id)\s+uuid/i.test(row.args)
    );
    expect(offender, `function ${offender?.proname} takes a caller id`).toBeUndefined();
  });

  it('keeps the admin RPCs executable only by authenticated members', async () => {
    const result = await db.query<{ proname: string; anon_can: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('admin_suspend_user','admin_unsuspend_user','admin_set_report_status','delete_my_account')
    `);

    expect(result.rows.length).toBe(4);
    expect(result.rows.filter((row) => row.anon_can).map((row) => row.proname)).toEqual([]);
  });

  it('has RLS forced off only where an owner bypass is required', async () => {
    // Tables must not rely on the table owner bypassing RLS. This asserts every
    // personal-data table has RLS ENABLED (forced enforcement is a Supabase
    // dashboard concern, but enabled is non-negotiable).
    const result = await db.query<{ relname: string; rls: boolean }>(`
      select c.relname, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `);
    expect(result.rows.filter((row) => row.rls !== true).map((row) => row.relname)).toEqual([]);
  });
});

describe('4. secrets hygiene', () => {
  const root = process.cwd();

  it('git-ignores .env.local', () => {
    const ignored = execSync('git check-ignore .env.local || true', {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    expect(ignored).toBe('.env.local');
  });

  it('contains no service_role key or JWT in shipped source', () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          scan(relative);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|json|html)$/.test(entry.name)) continue;
        const contents = readFileSync(join(root, relative), 'utf8');
        // A JWT is three base64url segments; Supabase keys are JWTs. Scanned in
        // the RAW text on purpose: a key hidden in a comment is still a key.
        if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(contents)) {
          offenders.push(`${relative} (JWT-shaped string)`);
        }
        // Prose that *names* the privileged key is documentation, not a key, so
        // comments are stripped before this check. `src/lib/env.ts` documents the
        // prohibition by name; flagging that would push people to stop writing
        // the rule down.
        if (
          /service_role/i.test(contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')) &&
          !relative.includes('.test.')
        ) {
          offenders.push(`${relative} (mentions service_role)`);
        }
      }
    };

    scan('src');
    scan('public');
    expect(offenders).toEqual([]);
  });

  it('only exposes NEXT_PUBLIC_* environment variables to the browser', () => {
    /**
     * Scope: files that can end up in the BROWSER bundle.
     *
     * A `process.env.FOO` read is only a leak when the module is bundled for the
     * client, where Next inlines the value. This check used to walk every `.ts`
     * under `src/`, which flagged server route handlers for reading their own
     * secrets — a false positive that would push a future author to obfuscate a
     * legitimate read (`process.env['KEY']`) to get a green test.
     *
     * `src/app/**\/route.ts` is a Route Handler: it runs only on the server, so
     * a plain `process.env.DEEPL_API_KEY` there is correct and is the readable
     * way to do it. Everything else in `src/` is fair game for the scanner,
     * because any other module can be imported by a client component.
     *
     * The `service_role`/JWT scan above still covers ALL of `src/`, so excluding
     * handlers here does not widen it.
     *
     * KNOWN BOUNDARY: a server-only *library* (not a route handler) that needs a
     * secret — currently `src/lib/translation-service.ts` reading
     * `DEEPL_API_KEY` — cannot use a literal `process.env.NAME` read without
     * tripping this check, because a path cannot prove a module is server-only.
     * Such a module therefore reads through the injected-source pattern
     * `src/lib/env.ts` already uses. That is deliberately conservative: the scan
     * errs toward flagging, and the failure mode is an awkward read rather than
     * a shipped key.
     */
    const clientFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(relative);
          continue;
        }
        if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
        // Route handlers execute on the server only.
        if (/(^|\/)route\.ts$/.test(relative)) continue;
        clientFiles.push(relative);
      }
    };
    walk('src');

    const leaked: string[] = [];
    for (const file of clientFiles) {
      const contents = readFileSync(join(root, file), 'utf8');
      const matches = contents.matchAll(/process\.env\.([A-Z0-9_]+)/g);
      for (const match of matches) {
        if (!match[1].startsWith('NEXT_PUBLIC_') && !match[1].includes('NODE_ENV')) {
          leaked.push(`${file}: ${match[1]}`);
        }
      }
    }

    expect(leaked).toEqual([]);
  });
});

describe('5. public surface hygiene', () => {
  const root = process.cwd();
  const DISCOVERY_DIR = 'src/app/discover';
  const OWN_ROW_FROM_PROFILES = /\.from\(\s*['"]profiles['"]\s*\)\s*\.select\(\s*['"]\*['"]\s*\)/;

  const sourceFiles = (dir: string): string[] => {
    const files: string[] = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        files.push(...sourceFiles(relative));
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(relative);
      }
    }
    return files;
  };

  it('never selects * from profiles on a discovery surface', () => {
    // A discovery surface renders OTHER members, so `select('*')` there ships
    // birth_date, politics and religion to every signed-in member. The own-row
    // gatekeeper reads a named column and is unaffected by this pattern.
    const offenders = sourceFiles(DISCOVERY_DIR).filter((file) =>
      OWN_ROW_FROM_PROFILES.test(readFileSync(join(root, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  it('reads every discovery feed through the allow-listed RPC', () => {
    // M9/M12 moved eligibility server-side: neither discovery surface may query
    // `profiles` for candidates, and both must go through the RPC that excludes
    // blocked, suspended and already-decided members.
    for (const file of [
      'src/app/discover/page.tsx',
      'src/app/discover/mettivo_live/page.tsx',
    ]) {
      expect(
        readFileSync(join(root, file), 'utf8'),
        `${file} must use the ranked discovery path`
      ).toContain('fetchDiscoveryCandidates');
    }

    const lib = readFileSync(join(root, 'src/lib/discovery.ts'), 'utf8');
    expect(lib).toContain("rpc('discover_profiles'");
  });
});

describe('6. birth_date is unreadable by every role', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.profiles set birth_date = '1998-05-04' where id = '${USER_A}'`);
  });

  it('grants no column-level SELECT on birth_date to anon or authenticated', async () => {
    // Filtered to SELECT on purpose: `column_privileges` also derives rows from
    // the table-level INSERT/UPDATE grants, so an unfiltered count is noisy and
    // would not mean what it appears to.
    const result = await db.query<{ n: number }>(`
      select count(*)::int as n
      from information_schema.column_privileges
      where table_schema = 'public'
        and table_name   = 'profiles'
        and column_name  = 'birth_date'
        and privilege_type = 'SELECT'
        and grantee in ('anon', 'authenticated')
    `);
    expect(result.rows[0].n).toBe(0);
  });

  it('keeps SELECT on birth_date for the owner, which the definer functions need', async () => {
    // If this ever hits zero, `export_my_data()` and `my_birth_date()` break.
    const result = await db.query<{ n: number }>(`
      select count(*)::int as n
      from information_schema.column_privileges
      where table_schema = 'public'
        and table_name   = 'profiles'
        and column_name  = 'birth_date'
        and privilege_type = 'SELECT'
        and grantee not in ('anon', 'authenticated')
    `);
    expect(result.rows[0].n).toBeGreaterThan(0);
  });

  it('keeps table-wide SELECT away from anon on profiles', async () => {
    // The denial is structural, not merely an RLS filter.
    const result = await db.query<{ n: number }>(`
      select count(*)::int as n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'profiles'
        and has_table_privilege('anon', c.oid, 'SELECT')
    `);
    expect(result.rows[0].n).toBe(0);
  });

  it('refuses an authenticated member reading any birth_date', async () => {
    // A table-wide REVOKE plus a column re-GRANT is the only form that works:
    // a bare `revoke select (col)` is a no-op while a table grant exists.
    await expect(
      asUser(db, USER_B, async () => {
        await db.query(`select birth_date from public.profiles where id = '${USER_A}'`);
      })
    ).rejects.toThrow(/permission denied/i);
  });

  it('still lets a member read every other column of another member', async () => {
    // Proof the fix did not over-lock: discovery-style reads keep working.
    const rows = await asUser(db, USER_B, async () => {
      const r = await db.query<{ display_name: string; age: number }>(
        `select display_name, age from public.profiles where id = '${USER_A}'`
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('returns only the caller’s own birth date through my_birth_date()', async () => {
    // Normalise before comparing: PGlite hands back a `Date` (whose String()
    // renders in the machine's local zone), while PostgREST sends a
    // 'YYYY-MM-DD' string. Both describe the same day.
    const isoDay = (value: unknown): string =>
      value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

    const mine = await asUser(db, USER_A, async () => {
      const r = await db.query<{ d: unknown }>(`select public.my_birth_date() as d`);
      return r.rows[0].d;
    });
    expect(isoDay(mine)).toBe('1998-05-04');

    // USER_B has no birth date set, and the function cannot be pointed at A.
    const theirs = await asUser(db, USER_B, async () => {
      const r = await db.query<{ d: unknown }>(`select public.my_birth_date() as d`);
      return r.rows[0].d;
    });
    expect(theirs).toBeNull();
  });

  it('refuses my_birth_date() to an anonymous caller', async () => {
    await expect(asAnon(db, () => db.query(`select public.my_birth_date()`))).rejects.toThrow();
  });
});
