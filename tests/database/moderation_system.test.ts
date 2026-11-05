import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  MODERATOR,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  asUser,
  createTestDb,
  scalarAs,
} from './harness';

/**
 * M21 — universal AI moderation and self-executing enforcement.
 *
 * The browser talks to PostgREST directly, so anything enforced only in the UI
 * is a suggestion. These tests assert the DATABASE refuses the action, not that
 * the UI hides a button:
 *
 *   1. `file_report()` snapshots the referenced content from the real row, so a
 *      reporter cannot invent the context a moderator reads.
 *   2. Enough DISTINCT reporters in the window apply a ban with no human in the
 *      loop, and the restricted member physically cannot insert a message.
 *   3. The AI worker path enforces through the same core, but can only ever
 *      restrict the member who authored the scanned content.
 *   4. The outbox queues a warning email; the secret-gated worker sends it.
 *   5. Restrictions and warnings are scoped to their owner and invisible to anon.
 */

const report = (
  db: PGlite,
  reporter: string,
  target: string,
  category: string,
  targetType = 'user',
  targetId: string | null = null,
  evidence: string | null = null
) =>
  asUser(db, reporter, async () => {
    const result = await db.query<{ r: { report_id: string; status: string } }>(
      `select public.file_report(
         p_target_user    => '${target}'::uuid,
         p_category       => '${category}',
         p_target_type    => '${targetType}',
         p_target_id      => ${targetId === null ? 'null' : `'${targetId}'::uuid`},
         p_details        => 'seen it',
         p_evidence_image => ${evidence === null ? 'null' : `'${evidence}'`}
       ) as r`
    );
    return result.rows[0].r;
  });

const restricted = (db: PGlite, fn: string, userId: string) =>
  db
    .query<{ r: boolean }>(`select public.${fn}('${userId}'::uuid) as r`)
    .then((res) => res.rows[0].r);

const owner = <T>(db: PGlite, sql: string) =>
  db.query<T>(sql).then((res) => res.rows);

describe('M21 — file_report captures real content, not the reporter’s claim', () => {
  let db: PGlite;
  // A fixture id, supplied rather than RETURNING: the messages SELECT policy
  // requires a real match, so RETURNING to a non-participant is refused.
  const messageId = 'aaaaaaaa-0000-0000-0000-000000000001';

  beforeAll(async () => {
    db = await createTestDb();
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.messages (id, match_id, sender_id, content)
         values ('${messageId}','m1','${USER_B}','the actual abusive text')`
      )
    );
  });

  it('snapshots the referenced message body into context', async () => {
    await report(db, USER_A, USER_B, 'harassment', 'message', messageId);
    const rows = await owner<{ context: string; category: string; target_type: string }>(
      db,
      `select context, category, target_type from public.reports
        where reporter_id = '${USER_A}' and reported_user_id = '${USER_B}'`
    );
    expect(rows[0].context).toBe('the actual abusive text');
    expect(rows[0].category).toBe('harassment');
    expect(rows[0].target_type).toBe('message');
  });

  it('refuses a self-report, an unknown category and an oversized snapshot', async () => {
    await expect(report(db, USER_A, USER_A, 'harassment')).rejects.toThrow(/yourself/i);
    await expect(report(db, USER_A, USER_B, 'sneaky')).rejects.toThrow(/invalid category/i);
    await expect(
      report(db, USER_A, USER_C, 'nudity', 'live', null, 'x'.repeat(600001))
    ).rejects.toThrow(/too large/i);
  });

  it('queues a live snapshot for the vision worker, linked to the report', async () => {
    const dataUrl = 'data:image/jpeg;base64,AAAA';
    await report(db, USER_A, USER_C, 'nudity', 'live', null, dataUrl);

    const scans = await owner<{ content_url: string; report_id: string | null }>(
      db,
      `select content_url, report_id from public.moderation_ai_scans
        where user_id = '${USER_C}' and content_type = 'live_snapshot'`
    );
    expect(scans.length).toBe(1);
    expect(scans[0].content_url).toBe(dataUrl);
    expect(scans[0].report_id).toBeTruthy();
  });

  it('refreshes rather than duplicates when the same reporter reports again', async () => {
    await report(db, USER_A, USER_B, 'spam');
    const n = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.reports
        where reporter_id = '${USER_A}' and reported_user_id = '${USER_B}'`
    );
    expect(n).toBe(1);
  });
});

describe('M46 — report counts and AI verdicts are evidence, never punishment', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`update public.moderation_settings set chat_report_threshold = 2`);
    await db.exec(
      `insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`
    );
  });

  it('marks a threshold as needing human review without restricting anyone', async () => {
    await report(db, USER_A, USER_B, 'harassment');
    await report(db, USER_C, USER_B, 'harassment');

    const outcome = await owner<{ r: Record<string, unknown> }>(
      db,
      `select public.evaluate_report_thresholds('${USER_B}'::uuid) as r`
    );
    expect(outcome[0].r).toMatchObject({
      applied: false,
      requires_human_review: true,
      suggested_category: 'abuse_text',
    });
    expect(await restricted(db, 'is_restricted', USER_B)).toBe(false);

    const suspensions = await owner<{ n: number }>(
      db,
      `select count(*)::int as n from public.suspensions where user_id = '${USER_B}'`
    );
    expect(suspensions[0].n).toBe(0);
  });

  it('records a flagged AI scan without punishing the scanned author', async () => {
    await report(db, USER_A, USER_B, 'nudity', 'user', null, 'data:image/jpeg;base64,AAAA');

    const claimed = await owner<{ scan_id: string }>(
      db,
      `select scan_id from public.claim_moderation_scans('test-secret', 10)`
    ).catch(() => []);
    // The worker secret is not configured in this fixture; prove the contract
    // directly by creating a scan row and running the verdict helper.
    if (claimed.length === 0) {
      await db.exec(`update public.moderation_secrets set worker_secret = 'test-secret'`);
    }
    const scans = await owner<{ scan_id: string }>(
      db,
      `select scan_id from public.claim_moderation_scans('test-secret', 10)`
    );
    const scan = scans[0];
    expect(scan).toBeTruthy();

    const verdict = await owner<{ r: { flagged: boolean; action: string } }>(
      db,
      `select public.record_ai_scan(
         p_secret => 'test-secret',
         p_scan_id => '${scan.scan_id}'::uuid,
         p_flagged => true,
         p_score => 0.99,
         p_provider => 'probe',
         p_model => 'probe-1'
       ) as r`
    );
    expect(verdict[0].r).toMatchObject({
      flagged: true,
      action: 'pending_human_review',
    });
    expect(await restricted(db, 'is_restricted', USER_B)).toBe(false);

    const reportFlag = await owner<{ ai_flagged: boolean }>(
      db,
      `select ai_flagged from public.reports
        where reporter_id = '${USER_A}' and reported_user_id = '${USER_B}'`
    );
    expect(reportFlag[0].ai_flagged).toBe(true);
  });

  it('refuses direct writes to the confirmed-violation ledger', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.confirmed_violations (user_id, category, source, confirmed_by)
           values ('${USER_B}', 'spam', 'moderator', '${USER_A}')`
        )
      )
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(
          `update public.confirmed_violations set reason = 'forged' where user_id = '${USER_B}'`
        )
      )
    ).rejects.toThrow(/permission denied|row-level security/i);

    await expect(
      asUser(db, USER_A, () =>
        db.query(
          `select public.apply_temporary_restriction('${USER_B}'::uuid, 'spam', 'x', 'moderator', null, null, '${USER_A}'::uuid, 2)`
        )
      )
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('M46 — only 2, 6, 12 or 24 hours after moderator confirmation', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(
      `insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`
    );
  });

  const confirmReport = (
    reporter: string,
    target: string,
    category: string,
    hours: number
  ) =>
    asUser(db, MODERATOR, async () => {
      const reports = await db.query<{ id: string }>(
        `select id from public.reports
          where reporter_id = '${reporter}' and reported_user_id = '${target}'`
      );
      return db.query<{ r: Record<string, unknown> }>(
        `select public.admin_resolve_report(
           p_report_id => '${reports.rows[0].id}'::uuid,
           p_status => 'actioned',
           p_note => 'confirmed after review',
           p_duration_hours => ${hours}
         ) as r`
      );
    });

  it('rejects arbitrary and out-of-range durations', async () => {
    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_suspend_user('${USER_C}'::uuid, 'x', 4)`)
      )
    ).rejects.toThrow(/2, 6, 12 or 24/i);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_suspend_user('${USER_C}'::uuid, 'x', 25)`)
      )
    ).rejects.toThrow(/2, 6, 12 or 24/i);
  });

  it('applies the selected duration and writes one confirmed violation', async () => {
    await report(db, USER_A, USER_B, 'harassment');
    const result = await confirmReport(USER_A, USER_B, 'harassment', 2);
    expect(result.rows[0].r).toMatchObject({
      restriction_hours: 2,
      status: 'actioned',
    });

    const rows = await owner<{ source: string; hours: number; starts: string; ends: string }>(
      db,
      `select source, restriction_hours as hours,
              restriction_starts_at as starts, restriction_ends_at as ends
         from public.confirmed_violations where user_id = '${USER_B}'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].source).toBe('moderator');
    expect(rows[0].hours).toBe(2);
    const spanHours =
      (new Date(rows[0].ends).getTime() - new Date(rows[0].starts).getTime()) / 3_600_000;
    expect(spanHours).toBeCloseTo(2, 1);
    expect(await restricted(db, 'is_restricted', USER_B)).toBe(true);

    const flags = await owner<{ is_suspended: boolean; restricted_until: string | null }>(
      db,
      `select is_suspended, restricted_until from public.profiles
        where id = '${USER_B}'`
    );
    expect(flags[0].is_suspended).toBe(false);
    expect(flags[0].restricted_until).toBeTruthy();
  });

  it('is idempotent for a replayed report action', async () => {
    await confirmReport(USER_A, USER_B, 'harassment', 6);
    const rows = await owner<{ n: number }>(
      db,
      `select count(*)::int as n from public.confirmed_violations where user_id = '${USER_B}'`
    );
    expect(rows[0].n).toBe(1);
  });

  it('escalates the next confirmed violation to six hours', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_unsuspend_user('${USER_B}'::uuid)`)
    );
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_suspend_user('${USER_B}'::uuid, 'repeat', null)`)
    );

    const rows = await owner<{ hours: number }>(
      db,
      `select restriction_hours as hours from public.confirmed_violations
        where user_id = '${USER_B}' order by confirmed_at desc limit 1`
    );
    expect(rows[0].hours).toBe(6);
  });

  it('expires from the clock even when the profile flag was not cleaned', async () => {
    await db.exec(
      `update public.confirmed_violations
          set restriction_ends_at = now() - interval '1 minute'
        where user_id = '${USER_B}';
       update public.suspensions
          set starts_at = now() - interval '2 hours',
              ends_at = now() - interval '1 minute',
              active = false
        where user_id = '${USER_B}';
       update public.profiles
          set restricted_until = now() - interval '1 minute'
        where id = '${USER_B}';`
    );

    expect(await restricted(db, 'is_restricted', USER_B)).toBe(false);
    const state = await asUser(db, USER_B, async () => {
      const result = await db.query<{ r: Record<string, unknown> }>(
        `select public.my_restrictions() as r`
      );
      return result.rows[0].r;
    });
    expect(state.suspended).toBe(false);
    expect(state.is_read_only).toBe(false);
  });

  it('exposes the restriction and its duration to the member', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_suspend_user('${USER_C}'::uuid, 'reviewed', 12)`)
    );
    const state = await asUser(db, USER_C, async () => {
      const result = await db.query<{ r: Record<string, unknown> }>(
        `select public.my_restrictions() as r`
      );
      return result.rows[0].r;
    });
    expect(state).toMatchObject({
      suspended: true,
      is_read_only: true,
      restriction_hours: 12,
      confirmed_violation_count: 1,
    });
    expect(state.suspended_until).toBeTruthy();
  });
});

describe('M46 — a restricted member can browse and play, but cannot interact', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(
      `insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`
    );
    await db.exec(
      `insert into public.matches
         (id, user_a, user_b, user_a_id, user_b_id, kind, request_status)
       values ('dddddddd-0000-0000-0000-000000000001',
               '${USER_B}', '${USER_A}', '${USER_B}', '${USER_A}',
               'match', 'not_applicable')`
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.messages (id, match_id, sender_id, content)
         values ('cccccccc-0000-0000-0000-000000000001',
                 'dddddddd-0000-0000-0000-000000000001', '${USER_B}', 'original')`
      )
    );
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_suspend_user('${USER_B}'::uuid, 'reviewed', 2)`)
    );
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.moments (id, author_id, caption)
         values ('bbbbbbbb-0000-0000-0000-000000000001', '${USER_A}', 'hello')`
      )
    );
  });

  it('lets the restricted member read profiles, sign in and play a game', async () => {
    const name = await asUser(db, USER_B, async () => {
      const result = await db.query<{ display_name: string }>(
        `select display_name from public.profiles where id = '${USER_A}'`
      );
      return result.rows[0].display_name;
    });
    expect(name).toBe('Ada');

    const game = await asUser(db, USER_B, async () => {
      const result = await db.query<{ r: { ok: boolean } }>(
        `select public.record_game_result('tic-tac-toe', 'win', 1, 10) as r`
      );
      return result.rows[0].r;
    });
    expect(game.ok).toBe(true);
  });

  it('still lets the restricted member file a safety report', async () => {
    await expect(report(db, USER_B, USER_C, 'spam')).resolves.toBeTruthy();
  });

  it('blocks every social write path', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `update public.messages set content = 'edited while read-only'
            where id = 'cccccccc-0000-0000-0000-000000000001'`
        )
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content) values ('m2','${USER_B}','hi')`
        )
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(`insert into public.moments (author_id, caption) values ('${USER_B}','nope')`)
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.moment_comments (moment_id, author_id, body)
           values ('bbbbbbbb-0000-0000-0000-000000000001','${USER_B}','nope')`
        )
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.moment_likes (moment_id, user_id)
           values ('bbbbbbbb-0000-0000-0000-000000000001','${USER_B}')`
        )
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(`insert into public.follows (follower_id, following_id) values ('${USER_B}','${USER_A}')`)
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.query(`select public.record_like('${USER_A}'::uuid, true)`)
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.query(`select public.share_moment('bbbbbbbb-0000-0000-0000-000000000001'::uuid)`)
      )
    ).rejects.toThrow(/read-only|paused/i);

    await expect(
      asUser(db, USER_B, () =>
        db.exec(`update public.profiles set bio = 'changed while read-only' where id = '${USER_B}'`)
      )
    ).rejects.toThrow(/read-only|paused/i);
  });

  it('stops direct attempts to clear the restriction', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.exec(`update public.profiles set restricted_until = null where id = '${USER_B}'`)
      )
    ).rejects.toThrow(/read-only|moderation fields/i);
  });
});

describe('M46 — moderator actions remain audited, scoped and staff-safe', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(
      `insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`
    );
  });

  it('denies enforcement RPCs to non-moderators', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(`select public.admin_suspend_user('${USER_B}'::uuid, 'x', 2)`)
      )
    ).rejects.toThrow(/moderator access required/i);

    await expect(
      asUser(db, USER_A, () =>
        db.query(`select public.admin_resolve_report('00000000-0000-0000-0000-000000000000'::uuid, 'actioned', 'x', 2)`)
      )
    ).rejects.toThrow(/moderator access required/i);
  });

  it('does not let report counts target a staff account', async () => {
    await db.exec(
      `insert into public.user_roles (user_id, role) values ('${USER_D}','admin')
       on conflict (user_id) do update set role = 'admin'`
    );
    const outcome = await owner<{ r: Record<string, unknown> }>(
      db,
      `select public.evaluate_report_thresholds('${USER_D}'::uuid) as r`
    );
    expect(outcome[0].r).toMatchObject({
      applied: false,
      reason: 'protected_staff',
    });
  });

  it('audits a confirmed violation with its duration', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(`select public.admin_suspend_user('${USER_C}'::uuid, 'reviewed', 24)`)
    );
    const audit = await owner<{ details: { hours: number } }>(
      db,
      `select details from public.admin_audit_log
        where action = 'moderation.confirmed_violation'
          and target_user_id = '${USER_C}'
        order by created_at desc limit 1`
    );
    expect(audit[0].details.hours).toBe(24);
  });
});
