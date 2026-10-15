import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  MODERATOR,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  affectedRows,
  anonReadCount,
  applyMigrations,
  asAnon,
  asUser,
  createTestDb,
  migrationFiles,
  queryAs,
  rowCount,
  scalarAs,
} from './harness';

/**
 * Every assertion here previously existed only as a throwaway script. They are
 * now permanent regression tests executed against the real migration files.
 *
 * Two rules this suite follows deliberately:
 *
 *   1. Every migration must APPLY and be RE-RUNNABLE. Both are asserted, because
 *      half-applied schema was a recurring problem for this project.
 *   2. RLS denies by *filtering rows*, not by raising an error. Cross-user write
 *      checks assert a zero affected-row count, not that a throw occurred. Using
 *      try/catch here previously produced a false "security breach" report.
 *      Blocked INSERTs are the exception: with no INSERT policy they DO raise.
 */

describe('migration health', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('applies the full migration set', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(9);
  });

  it('is idempotent — the whole set re-applies cleanly', async () => {
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it('enables RLS on every personal-data table', async () => {
    const result = await db.query<{ name: string; rls: boolean }>(`
      select c.relname as name, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in (
          'profiles','messages','follows','reports','blocked_users',
          'likes','matches','notifications','user_roles','admin_audit_log',
          'rate_limit_counters','rate_limit_rules','moments','moment_likes',
          'moment_comments','game_catalog','game_results'
        )
    `);
    expect(result.rows.length).toBe(17);
    expect(result.rows.filter((row) => row.rls !== true).map((row) => row.name)).toEqual([]);
  });

  it('has no INSERT policy missing WITH CHECK', async () => {
    const result = await db.query<{ tablename: string; policyname: string }>(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and cmd = 'INSERT' and with_check is null
    `);
    expect(result.rows).toEqual([]);
  });
});

describe('M6 — row level security', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('hides profiles from anonymous callers', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.profiles`)).toBe(0);
  });

  it('lets a signed-in member browse profiles', async () => {
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.profiles`)
    ).toBeGreaterThan(0);
  });

  it('has no policy granting profiles to anon or public', async () => {
    const result = await db.query<{ tablename: string; policyname: string }>(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and (roles && array['anon','public']::name[])
        and tablename = 'profiles'
    `);
    expect(result.rows).toEqual([]);
  });

  it('exposes public_profiles without birth_date', async () => {
    const result = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_name = 'public_profiles'
    `);
    const columns = result.rows.map((row) => row.column_name);
    expect(columns.length).toBeGreaterThan(10);
    expect(columns).not.toContain('birth_date');
  });

  it('blocks a non-owner from editing someone else’s profile', async () => {
    const changed = await affectedRows(
      db,
      USER_B,
      `update public.profiles set display_name = 'hacked' where id = '${USER_A}'`
    );
    expect(changed).toBe(0);

    const result = await db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = '${USER_A}'`
    );
    expect(result.rows[0].display_name).toBe('Ada');
  });
});

describe('M10 — likes and mutual matching', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  const like = (userId: string, target: string, isLike = true) =>
    asUser(db, userId, async () => {
      const result = await db.query<{
        out: { matched: boolean; match_id: string | null };
      }>(`select public.record_like('${target}'::uuid, ${isLike}) as out`);
      return result.rows[0].out;
    });

  it('creates no match on a one-way like', async () => {
    const result = await like(USER_A, USER_B);
    expect(result.matched).toBe(false);
    expect(result.match_id).toBeNull();
  });

  it('creates exactly one match when the interest is mutual', async () => {
    const result = await like(USER_B, USER_A);
    expect(result.matched).toBe(true);
    expect(typeof result.match_id).toBe('string');
    expect(await rowCount(db, 'matches')).toBe(1);
  });

  it('creates no match for a pass', async () => {
    const result = await like(USER_A, USER_C, false);
    expect(result.matched).toBe(false);
  });

  it('rejects liking yourself', async () => {
    await expect(like(USER_A, USER_A)).rejects.toThrow(/cannot like yourself/i);
  });

  it('scopes likes to the members involved', async () => {
    const seen = (userId: string) =>
      scalarAs(db, userId, `select count(*)::int as n from public.likes`);

    expect(await seen(USER_A)).toBe(3); // sent 2, received 1
    expect(await seen(USER_C)).toBe(1); // the pass about them
    expect(await seen(USER_D)).toBe(0); // uninvolved
  });

  it('stops a client forging a match directly', async () => {
    await expect(
      asUser(db, USER_D, () =>
        db.exec(
          `insert into public.matches (user_a, user_b) values ('${USER_A}','${USER_D}')`
        )
      )
    ).rejects.toThrow();
  });

  it('scopes matches to participants', async () => {
    const seen = (userId: string) =>
      scalarAs(db, userId, `select count(*)::int as n from public.matches`);

    expect(await seen(USER_A)).toBe(1);
    expect(await seen(USER_D)).toBe(0);
  });
});

describe('notifications', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    // A likes B, B likes back (mutual -> match), a follow, and a message.
    await asUser(db, USER_A, () =>
      db.query(`select public.record_like('${USER_B}'::uuid, true)`)
    );
    await asUser(db, USER_B, () =>
      db.query(`select public.record_like('${USER_A}'::uuid, true)`)
    );
    await asUser(db, USER_C, () =>
      db.exec(`insert into public.follows values ('${USER_C}','${USER_B}')`)
    );
  });

  const typesFor = async (userId: string) =>
    queryAs<{ type: string }>(
      db,
      userId,
      `select type from public.notifications order by created_at`
    ).then((rows) => rows.map((row) => row.type));

  it('notifies the recipient of a like', async () => {
    expect(await typesFor(USER_B)).toContain('like');
  });

  it('notifies both members of a match', async () => {
    expect(await typesFor(USER_A)).toContain('match');
    expect(await typesFor(USER_B)).toContain('match');
  });

  it('notifies the recipient of a follow', async () => {
    expect(await typesFor(USER_B)).toContain('follow');
  });

  it('notifies the other member about a message', async () => {
    const matchId = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const id = matchId.rows[0].id;
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content) values ('${id}','${USER_A}','hey')`
      )
    );
    expect(await typesFor(USER_B)).toContain('message');
  });

  it('notifies the reporter when a report is actioned', async () => {
    await db.exec(
      `insert into public.reports (reporter_id, reported_user_id, reason, status)
       values ('${USER_B}','${USER_C}','harassment','pending')`
    );
    await db.exec(`update public.reports set status = 'actioned' where reporter_id = '${USER_B}'`);
    expect(await typesFor(USER_B)).toContain('report');
  });

  it('never notifies a member about their own action', async () => {
    const before = await rowCount(db, 'notifications');
    await asUser(db, USER_A, () =>
      db.exec(`insert into public.follows values ('${USER_A}','${USER_A}')`)
    );
    expect(await rowCount(db, 'notifications')).toBe(before);
  });

  it('hides notifications from uninvolved members', async () => {
    expect(await typesFor(USER_D)).toEqual([]);
  });

  it('stops a member marking another member’s notification read', async () => {
    const changed = await affectedRows(
      db,
      USER_C,
      `update public.notifications set read_at = now() where user_id = '${USER_B}'`
    );
    expect(changed).toBe(0);
  });

  it('stops a client fabricating a notification', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.exec(`insert into public.notifications (user_id, type) values ('${USER_A}','like')`)
      )
    ).rejects.toThrow();
  });
});

describe('moments feed', () => {
  let db: PGlite;
  let postA: string;
  beforeAll(async () => {
    db = await createTestDb();
    postA = await asUser(db, USER_A, async () => {
      const result = await db.query<{ id: string }>(
        `insert into public.moments (author_id, caption, tags)
         values ('${USER_A}', 'Hello Moments', '{Trending}') returning id`
      );
      return result.rows[0].id;
    });
    await asUser(db, USER_B, () =>
      db.exec(`insert into public.moment_likes (moment_id, user_id) values ('${postA}','${USER_B}')`)
    );
    await asUser(db, USER_C, () =>
      db.exec(`insert into public.moment_likes (moment_id, user_id) values ('${postA}','${USER_C}')`)
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.moment_comments (moment_id, author_id, body) values ('${postA}','${USER_B}','nice')`
      )
    );
    await asUser(db, USER_B, () => db.query(`select public.share_moment('${postA}'::uuid)`));
  });

  it('aggregates likes, comments and shares in one read', async () => {
    const row = await asUser(db, USER_A, async () => {
      const result = await db.query<{
        like_count: number;
        comment_count: number;
        shares: number;
      }>(`select like_count, comment_count, shares from public.moment_feed where id = '${postA}'`);
      return result.rows[0];
    });
    expect(row.like_count).toBe(2);
    expect(row.comment_count).toBe(1);
    expect(row.shares).toBe(1);
  });

  it('reports liked_by_me per caller', async () => {
    const likedFor = async (userId: string) =>
      asUser(db, userId, async () => {
        const result = await db.query<{ liked_by_me: boolean }>(
          `select liked_by_me from public.moment_feed where id = '${postA}'`
        );
        return result.rows[0].liked_by_me;
      });

    expect(await likedFor(USER_B)).toBe(true);
    expect(await likedFor(USER_A)).toBe(false); // the author never liked their own post
  });

  it('makes double-liking impossible', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.moment_likes (moment_id, user_id) values ('${postA}','${USER_B}')`
        )
      )
    ).rejects.toThrow();
  });

  it('hides the feed from anonymous callers', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.moment_feed`)).toBe(0);
  });

  it('stops a non-author editing or deleting a moment', async () => {
    const edited = await affectedRows(
      db,
      USER_B,
      `update public.moments set caption = 'hacked' where id = '${postA}'`
    );
    const deleted = await affectedRows(
      db,
      USER_B,
      `delete from public.moments where id = '${postA}'`
    );
    expect(edited).toBe(0);
    expect(deleted).toBe(0);

    const row = await db.query<{ caption: string }>(
      `select caption from public.moments where id = '${postA}'`
    );
    expect(row.rows[0].caption).toBe('Hello Moments');
  });

  it('stops a member deleting another member’s comment', async () => {
    const deleted = await affectedRows(
      db,
      USER_C,
      `delete from public.moment_comments where moment_id = '${postA}'`
    );
    expect(deleted).toBe(0);
  });

  it('enforces the content constraints', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.moments (author_id, caption, tags)
           values ('${USER_A}', 'x', array['a','b','c','d','e','f','g'])`
        )
      )
    ).rejects.toThrow();

    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.moments (author_id, caption) values ('${USER_A}', repeat('x', 2001))`
        )
      )
    ).rejects.toThrow();
  });
});

describe('game zone', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  const record = (userId: string, gameId: string, outcome: string, score: number) =>
    asUser(db, userId, async () => {
      const result = await db.query<{ r: { outcome: string } }>(
        `select public.record_game_result('${gameId}','${outcome}',${score},10) as r`
      );
      return result.rows[0].r;
    });

  it('seeds the playable catalogue', async () => {
    // M14 seeded tic-tac-toe + uno-lite; M16 added the seven social mini-games
    // the Game Hub renders. Nine playable rows, and every id the client
    // registry can launch must exist here or `record_game_result()` rejects its
    // score as an unknown game.
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.game_catalog where is_playable`
    );
    expect(result.rows[0].n).toBe(9);

    const ids = await db.query<{ game_id: string }>(
      `select game_id from public.game_catalog where is_playable order by game_id`
    );
    expect(ids.rows.map((row) => row.game_id)).toEqual([
      'icebreaker',
      'memory-match',
      'speed-matching',
      'spin-the-wheel',
      'tic-tac-toe',
      'truth-or-dare',
      'twenty-questions',
      'uno-lite',
      'word-guess',
    ]);
  });

  it('records a real result', async () => {
    expect((await record(USER_A, 'tic-tac-toe', 'win', 10)).outcome).toBe('win');
  });

  it('accepts an M16 game id and still enforces its score ceiling', async () => {
    // Deliberately USER_C: this suite's other assertions count USER_A's rows, so
    // a successful insert here must not change that ledger.
    expect((await record(USER_C, 'memory-match', 'win', 100)).outcome).toBe('win');
    await expect(record(USER_C, 'memory-match', 'win', 101)).rejects.toThrow(/out of range/i);
    await expect(record(USER_C, 'truth-or-dare', 'win', 16)).rejects.toThrow(/out of range/i);
  });

  it('rejects unknown, non-playable, malformed and out-of-range results', async () => {
    await expect(record(USER_A, 'pac-man', 'win', 1)).rejects.toThrow(/unknown game/i);
    await expect(record(USER_A, 'ludo-royale', 'win', 1)).rejects.toThrow(/not playable/i);
    await expect(record(USER_A, 'tic-tac-toe', 'destroyed', 1)).rejects.toThrow(/invalid outcome/i);
    await expect(record(USER_A, 'tic-tac-toe', 'win', 9999)).rejects.toThrow(/out of range/i);
  });

  it('stops a client forging a result row', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.game_results (user_id, game_id, outcome) values ('${USER_B}','tic-tac-toe','win')`
        )
      )
    ).rejects.toThrow();
  });

  it('scopes results to their owner', async () => {
    const seen = (userId: string) =>
      scalarAs(db, userId, `select count(*)::int as n from public.game_results`);

    expect(await seen(USER_A)).toBe(1);
    expect(await seen(USER_B)).toBe(0);
  });

  it('hides results from anonymous callers', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.game_results`)).toBe(0);
  });
});

describe('M14 — moderation and abuse controls', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`);
  });

  it('lets a moderator suspend a member', async () => {
    const result = await asUser(db, MODERATOR, async () => {
      const r = await db.query<{ r: { suspended: boolean } }>(
        `select public.admin_suspend_user('${USER_A}'::uuid,'test') as r`
      );
      return r.rows[0].r;
    });
    expect(result.suspended).toBe(true);
  });

  it('stops a suspended member posting', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.exec(`insert into public.messages (match_id, sender_id, content) values ('m','${USER_A}','spam')`)
      )
    ).rejects.toThrow(/suspended/i);
  });

  it('stops a member clearing their own suspension', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.exec(`update public.profiles set is_suspended = false where id = '${USER_A}'`)
      )
    ).rejects.toThrow(/moderation fields/i);
  });

  it('refuses moderation actions to non-moderators', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.admin_suspend_user('${USER_D}'::uuid,'x')`)
      )
    ).rejects.toThrow(/moderator access required/i);
  });

  it('restores access after unsuspension', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_unsuspend_user('${USER_A}'::uuid)`)
    );

    // If the suspension were still in force the trigger would reject this.
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content) values ('m4','${USER_A}','back')`
      )
    );

    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.messages where match_id = 'm4'`
    );
    expect(result.rows[0].n).toBe(1);
  });

  it('enforces the per-action rate limit', async () => {
    await db.exec(`update public.rate_limit_rules set max_events = 2 where action = 'messages'`);

    let allowed = 0;
    let limited = false;
    for (let i = 0; i < 5; i += 1) {
      try {
        await asUser(db, USER_C, () =>
          db.exec(
            `insert into public.messages (match_id, sender_id, content) values ('m5','${USER_C}','x${i}')`
          )
        );
        allowed += 1;
      } catch {
        limited = true;
        break;
      }
    }

    expect(limited).toBe(true);
    expect(allowed).toBeLessThanOrEqual(2);
  });

  it('shows the audit log only to moderators', async () => {
    const auditCount = (userId: string) =>
      scalarAs(db, userId, `select count(*)::int as n from public.admin_audit_log`);

    expect(await auditCount(MODERATOR)).toBeGreaterThan(0);
    expect(await auditCount(USER_C)).toBe(0);
  });
});

describe('M15 — privacy and erasure', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await asUser(db, USER_A, () =>
      db.exec(`insert into public.messages (match_id, sender_id, content) values ('m','${USER_A}','hello')`)
    );
    await asUser(db, USER_A, () =>
      db.exec(`insert into public.follows values ('${USER_A}','${USER_B}')`)
    );
    await asUser(db, USER_A, () =>
      db.query(`select public.record_like('${USER_B}'::uuid, true)`)
    );
  });

  it('exports the caller’s own data', async () => {
    const payload = await asUser(db, USER_A, async () => {
      const result = await db.query<{ data: Record<string, unknown> }>(
        `select public.export_my_data() as data`
      );
      return result.rows[0].data;
    });

    expect(payload.profile).toBeTruthy();
    expect(Array.isArray(payload.likes_sent)).toBe(true);
    expect(Array.isArray(payload.messages_sent)).toBe(true);
  });

  it('refuses erasure to anonymous callers', async () => {
    await expect(asAnon(db, () => db.query(`select public.delete_my_account()`))).rejects.toThrow();
  });

  it('erases the account, its activity and its identity', async () => {
    const before = await rowCount(db, 'profiles');
    const result = await asUser(db, USER_A, async () => {
      const r = await db.query<{ data: { deleted: Record<string, number> } }>(
        `select public.delete_my_account() as data`
      );
      return r.rows[0].data;
    });

    const remainingUsers = await db.query<{ n: number }>(`select count(*)::int as n from auth.users`);
    expect(remainingUsers.rows[0].n).toBe(4); // the other four members survive
    expect(await rowCount(db, 'profiles')).toBe(before - 1);
    expect(await rowCount(db, 'messages')).toBe(0);
    expect(await rowCount(db, 'likes')).toBe(0);
    expect(await rowCount(db, 'follows')).toBe(0);
    expect(result.deleted.messages).toBe(1);
  });

  it('leaves an audit record that survives erasure', async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.admin_audit_log where action = 'self_deleted' or action = 'user.self_deleted'`
    );
    expect(result.rows[0].n).toBeGreaterThan(0);
  });
});

describe('onboarding wizard — profile columns', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  /**
   * The exact column set `handleSubmit` sends in the single upsert at
   * src/app/profile/edit/page.tsx. If the wizard gains a field, this list and
   * the migration must gain it together -- otherwise step 15 fails at runtime
   * with a PostgREST 400 while every other test stays green.
   */
  const WIZARD_PAYLOAD_COLUMNS = [
    'id', 'display_name', 'avatar_url', 'photos', 'gender', 'pronouns',
    'birth_date', 'age', 'country', 'city', 'height', 'physical_attributes',
    'intention', 'looking_for', 'sexual_orientation', 'mbti', 'personality',
    'hobbies', 'pets', 'smoking', 'drinking', 'exercise', 'education',
    'profession', 'languages_spoken', 'bio', 'onboarding_completed',
  ];

  const WIZARD_ONLY_COLUMNS = [
    'pronouns', 'physical_attributes', 'sexual_orientation', 'mbti',
    'height', 'exercise', 'education', 'profession', 'languages_spoken',
  ];

  it('has every column the wizard payload writes', async () => {
    const result = await db.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles'
    `);
    const present = new Set(result.rows.map((row) => row.column_name));
    const missing = WIZARD_PAYLOAD_COLUMNS.filter((column) => !present.has(column));
    expect(missing, 'columns the onboarding wizard writes but the schema lacks').toEqual([]);
  });

  it('keeps the wizard-only fields out of the public projection', async () => {
    const result = await db.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'public_profiles'
    `);
    const exposed = new Set(result.rows.map((row) => row.column_name));
    // New columns are private by default: they must be added to the allow-list
    // deliberately, never inherited through a `select *`.
    expect(WIZARD_ONLY_COLUMNS.filter((column) => exposed.has(column))).toEqual([]);
  });

  it('never exposes birth_date on the public projection', async () => {
    const result = await db.query<{ n: number }>(`
      select count(*)::int as n
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'public_profiles'
        and column_name = 'birth_date'
    `);
    expect(result.rows[0].n).toBe(0);
  });
});
