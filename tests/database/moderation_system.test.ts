import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  MODERATOR,
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  anonReadCount,
  asAnon,
  asUser,
  createTestDb,
  rowCount,
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

describe('M21 — report threshold auto-enforces a chat ban', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`update public.moderation_settings set chat_report_threshold = 2`);
  });

  it('does nothing below the threshold', async () => {
    await report(db, USER_A, USER_B, 'harassment');
    expect(await restricted(db, 'is_chat_restricted', USER_B)).toBe(false);
  });

  it('bans once enough DISTINCT reporters report within the window', async () => {
    await report(db, USER_C, USER_B, 'harassment');
    expect(await restricted(db, 'is_chat_restricted', USER_B)).toBe(true);
  });

  it('the restricted member physically cannot send a message', async () => {
    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content) values ('m2','${USER_B}','hi')`
        )
      )
    ).rejects.toThrow(/muted/i);
  });

  it('records one ban, one warning, one in-app warning and one queued email', async () => {
    const bans = await owner<{ n: number; source: string }>(
      db,
      `select count(*)::int as n, min(source) as source from public.bans
        where user_id = '${USER_B}' and scope = 'chat'`
    );
    expect(bans[0].n).toBe(1);
    expect(bans[0].source).toBe('auto_threshold');

    const warnings = await owner<{ n: number }>(
      db,
      `select count(*)::int as n from public.moderation_warnings where user_id = '${USER_B}'`
    );
    expect(warnings[0].n).toBe(1);

    const notes = await owner<{ n: number; body: string }>(
      db,
      `select count(*)::int as n, min(body) as body from public.notifications
        where user_id = '${USER_B}' and type = 'warning'`
    );
    expect(notes[0].n).toBe(1);
    expect(notes[0].body).toMatch(/muted/i);

    const mail = await owner<{ n: number; recipient: string; status: string }>(
      db,
      `select count(*)::int as n, min(recipient) as recipient, min(status) as status
         from public.moderation_emails where user_id = '${USER_B}'`
    );
    expect(mail[0].n).toBe(1);
    expect(mail[0].recipient).toBe('bo@example.com');
    expect(mail[0].status).toBe('pending');
  });

  it('is idempotent — a further report does not stack a second ban', async () => {
    await report(db, USER_A, USER_B, 'harassment');
    const rows = await owner<{ n: number }>(
      db,
      `select count(*)::int as n from public.bans where user_id = '${USER_B}'`
    );
    expect(rows[0].n).toBe(1);
  });

  it('reflects the restriction through my_restrictions()', async () => {
    const out = await asUser(db, USER_B, async () => {
      const result = await db.query<{ r: { chat_banned: boolean } }>(
        `select public.my_restrictions() as r`
      );
      return result.rows[0].r;
    });
    expect(out.chat_banned).toBe(true);
  });
});

describe('M21 — nudity reports restrict video, underage needs AI or a moderator', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`update public.moderation_settings set video_report_threshold = 2`);
  });

  it('restricts video after the nudity threshold', async () => {
    await report(db, USER_A, USER_C, 'nudity');
    await report(db, USER_D, USER_C, 'nudity');
    expect(await restricted(db, 'is_video_restricted', USER_C)).toBe(true);
    // A video ban must not silently also mute chat.
    expect(await restricted(db, 'is_chat_restricted', USER_C)).toBe(false);
  });

  it('does NOT suspend on a bare underage report while underage_requires_ai is on', async () => {
    await report(db, USER_A, USER_D, 'underage');
    const susp = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.suspensions where user_id = '${USER_D}'`
    );
    expect(susp).toBe(0);
  });

  it('suspends for a year and flags the account when the AI requirement is waived', async () => {
    await db.exec(`update public.moderation_settings set underage_requires_ai = false`);
    await report(db, USER_B, USER_D, 'underage');

    const rows = await owner<{ days: number }>(
      db,
      `select extract(day from (ends_at - starts_at))::int as days
         from public.suspensions where user_id = '${USER_D}'`
    );
    expect(rows[0].days).toBeGreaterThanOrEqual(364);

    const flag = await owner<{ is_suspended: boolean }>(
      db,
      `select is_suspended from public.profiles where id = '${USER_D}'`
    );
    expect(flag[0].is_suspended).toBe(true);
  });
});

describe('M21 — the AI worker enforces only against the content author', () => {
  let db: PGlite;
  let scanId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`update public.moderation_secrets set worker_secret = 'test-secret'`);
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('ai','${USER_B}','something the reviewer will flag')`
      )
    );
  });

  it('refuses the worker RPCs without the secret, whatever the role', async () => {
    await expect(
      db.query(`select * from public.claim_moderation_scans('wrong', 10)`)
    ).rejects.toThrow(/worker access required/i);

    const leaked = await asAnon(db, async () => {
      try {
        await db.query(`select * from public.claim_moderation_scans('wrong', 10)`);
        return true;
      } catch {
        return false;
      }
    });
    expect(leaked).toBe(false);
  });

  it('refuses when the stored secret is NULL (no three-valued-logic bypass)', async () => {
    // Regression: a bare `p_secret = (select worker_secret ...)` yields NULL,
    // and `if not NULL` is not taken — so on a fresh database with no secret
    // configured every worker RPC used to run unguarded. The guard must treat
    // "no secret stored" as a refusal, not a pass.
    await db.exec(`update public.moderation_secrets set worker_secret = null`);
    try {
      await expect(
        db.query(`select * from public.claim_moderation_scans('guessed', 10)`)
      ).rejects.toThrow(/worker access required/i);
      await expect(db.query(`select public.moderation_policy('guessed')`)).rejects.toThrow(
        /worker access required/i
      );
    } finally {
      await db.exec(`update public.moderation_secrets set worker_secret = 'test-secret'`);
    }
  });

  it('hands the tunable policy to the worker only with the secret', async () => {
    const rows = await owner<{ r: { chat_report_threshold: number; ai_text_threshold: number } }>(
      db,
      `select public.moderation_policy('test-secret') as r`
    );
    expect(rows[0].r.chat_report_threshold).toBeGreaterThan(0);
    expect(rows[0].r.ai_text_threshold).toBeGreaterThan(0);

    await expect(db.query(`select public.moderation_policy('nope')`)).rejects.toThrow(
      /worker access required/i
    );
  });

  it('claims the queued message scan', async () => {
    const rows = await owner<{ scan_id: string; content_text: string; user_id: string }>(
      db,
      `select * from public.claim_moderation_scans('test-secret', 10)`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].content_text).toBe('something the reviewer will flag');
    expect(rows[0].user_id).toBe(USER_B);
    scanId = rows[0].scan_id;
  });

  it('applies a chat restriction from the verdict and records the log', async () => {
    const verdict = await owner<{ r: { flagged: boolean; action: string } }>(
      db,
      `select public.record_ai_scan(
         p_secret => 'test-secret',
         p_scan_id => '${scanId}'::uuid,
         p_flagged => true,
         p_score   => 0.97,
         p_provider => 'probe',
         p_model   => 'probe-1'
       ) as r`
    );
    expect(verdict[0].r.flagged).toBe(true);
    expect(verdict[0].r.action).toBe('chat');
    expect(await restricted(db, 'is_chat_restricted', USER_B)).toBe(true);

    const log = await owner<{ source: string }>(
      db,
      `select source from public.bans where user_id = '${USER_B}' and scope = 'chat'`
    );
    expect(log[0].source).toBe('ai');
  });

  it('ships the queued email through the secret-gated outbox worker', async () => {
    const pending = await owner<{ email_id: string; recipient: string }>(
      db,
      `select email_id, recipient from public.claim_moderation_emails('test-secret', 10)`
    );
    expect(pending.length).toBe(1);
    expect(pending[0].recipient).toBe('bo@example.com');

    await db.query(
      `select public.mark_moderation_email(
         p_secret => 'test-secret',
         p_email_id => '${pending[0].email_id}'::uuid,
         p_sent => true,
         p_provider => 'resend',
         p_provider_id => 'abc'
       )`
    );

    const status = await owner<{ status: string; provider_id: string }>(
      db,
      `select status, provider_id from public.moderation_emails where id = '${pending[0].email_id}'`
    );
    expect(status[0].status).toBe('sent');
    expect(status[0].provider_id).toBe('abc');
  });
});

describe('M21 — restrictions and warnings are owner-scoped and moderator-readable', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(`update public.moderation_settings set chat_report_threshold = 1`);
    await report(db, USER_A, USER_B, 'harassment');
    await db.exec(`insert into public.user_roles (user_id, role) values ('${MODERATOR}','moderator')`);
  });

  it('lets the restricted member read their own ban', async () => {
    expect(await scalarAs(db, USER_B, `select count(*)::int as n from public.bans`)).toBe(1);
  });

  it('hides the ban from an uninvolved member', async () => {
    expect(await scalarAs(db, USER_C, `select count(*)::int as n from public.bans`)).toBe(0);
    expect(
      await scalarAs(db, USER_C, `select count(*)::int as n from public.moderation_warnings`)
    ).toBe(0);
  });

  it('lets a moderator read the warning, and anon read nothing', async () => {
    expect(
      await scalarAs(db, MODERATOR, `select count(*)::int as n from public.moderation_warnings`)
    ).toBeGreaterThan(0);
    expect(await anonReadCount(db, `select count(*)::int as n from public.bans`)).toBe(0);
    expect(
      await anonReadCount(db, `select count(*)::int as n from public.moderation_emails`)
    ).toBe(0);
  });

  it('keeps the worker secret out of every client role', async () => {
    // No SELECT privilege at all, so the read is rejected before RLS is even
    // consulted — the strongest form of "invisible".
    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select count(*)::int as n from public.moderation_secrets`)
      )
    ).rejects.toThrow(/permission denied/i);
    expect(await anonReadCount(db, `select count(*)::int as n from public.moderation_secrets`)).toBe(0);
  });

  it('lets a moderator force an action, but not on themselves', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(
        `select public.admin_apply_moderation_action('${USER_D}'::uuid, 'spam', 'chat', 'manual')`
      )
    );
    expect(await restricted(db, 'is_chat_restricted', USER_D)).toBe(true);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(
          `select public.admin_apply_moderation_action('${MODERATOR}'::uuid, 'spam', 'chat', 'x')`
        )
      )
    ).rejects.toThrow(/yourself/i);
  });

  it('stops a client fabricating a ban row', async () => {
    const before = await rowCount(db, 'bans');
    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.bans (user_id, scope, category, ends_at)
           values ('${USER_D}','chat','harassment', now() + interval '1 day')`
        )
      )
    ).rejects.toThrow(/row-level security|permission denied/i);
    expect(await rowCount(db, 'bans')).toBe(before);
  });
});
