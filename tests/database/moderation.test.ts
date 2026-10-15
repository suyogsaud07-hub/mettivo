import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  MODERATOR,
  USER_A,
  USER_B,
  USER_C,
  asAnon,
  asUser,
  createTestDb,
  scalarAs,
  seed,
} from './harness';

/**
 * M13 — reporting and moderation workflow.
 *
 * The product promise is "reporting leads to a decision". These tests assert the
 * three things that makes true: the evidence survives a profile edit, only a
 * moderator can see the queue, and a decision is recorded with its actor.
 */

describe('M13 — reporting and moderation workflow', () => {
  let db: PGlite;
  let reportId = '';

  beforeAll(async () => {
    db = await createTestDb();

    await seed(
      db,
      `insert into public.user_roles (user_id, role)
       values ('${MODERATOR}','moderator') on conflict (user_id) do nothing`
    );

    // A reports B. B's display name at this moment is 'Bo'.
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.reports (reporter_id, reported_user_id, reason, details)
         values ('${USER_A}','${USER_B}','harassment','sent threatening messages')`
      )
    );

    const row = await db.query<{ id: string }>(
      `select id from public.reports where reporter_id = '${USER_A}'`
    );
    reportId = row.rows[0]?.id ?? '';
  });

  it('captures an evidence snapshot at report time', async () => {
    expect(reportId).not.toBe('');

    const result = await db.query<{ evidence: Record<string, unknown> | null }>(
      `select evidence from public.reports where id = '${reportId}'`
    );
    const evidence = result.rows[0]?.evidence;

    expect(evidence).toBeTruthy();
    expect(evidence?.reason).toBe('harassment');

    const profile = evidence?.reported_profile as Record<string, unknown> | null;
    expect(profile?.display_name).toBe('Bo');
  });

  it('keeps birth_date out of the evidence snapshot', async () => {
    // Article 1.4: a moderator needs to identify a member, not to accumulate
    // more personal data about them. This must fail the moment anyone adds the
    // column to the snapshot.
    const result = await db.query<{ has_birth_date: boolean }>(`
      select (evidence -> 'reported_profile') ? 'birth_date' as has_birth_date
      from public.reports
      where id = '${reportId}'
    `);
    expect(result.rows[0].has_birth_date).toBe(false);
  });

  it('survives the reported member editing their profile', async () => {
    await seed(
      db,
      `update public.profiles set display_name = 'Renamed' where id = '${USER_B}'`
    );

    // The live profile changed...
    expect(
      await scalarAs(
        db,
        MODERATOR,
        `select count(*)::int as n from public.profiles
          where id = '${USER_B}' and display_name = 'Renamed'`
      )
    ).toBe(1);

    // ...but the evidence still shows what the reporter saw.
    const result = await db.query<{ name: string }>(`
      select evidence -> 'reported_profile' ->> 'display_name' as name
      from public.reports where id = '${reportId}'
    `);
    expect(result.rows[0].name).toBe('Bo');
  });

  it('refuses the triage queue to a non-moderator and to anonymous callers', async () => {
    await expect(
      asUser(db, USER_C, () => db.query(`select * from public.admin_report_queue()`))
    ).rejects.toThrow(/moderator access required/i);

    await expect(
      asAnon(db, () => db.query(`select * from public.admin_report_queue()`))
    ).rejects.toThrow();
  });

  it('shows the report to a moderator', async () => {
    const rows = await asUser(db, MODERATOR, async () => {
      const r = await db.query<{
        report_id: string;
        reason: string;
        reporter_name: string;
        reported_name: string;
      }>(`select * from public.admin_report_queue('pending', 50)`);
      return r.rows;
    });

    expect(rows.length).toBeGreaterThan(0);
    const queue = rows.find((row) => row.report_id === reportId);
    expect(queue?.reason).toBe('harassment');
    expect(queue?.reporter_name).toBe('Ada');
  });

  it('refuses resolution to a non-moderator', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.admin_resolve_report('${reportId}'::uuid, 'dismissed', 'nope')`)
      )
    ).rejects.toThrow(/moderator access required/i);
  });

  it('rejects an invalid status', async () => {
    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_resolve_report('${reportId}'::uuid, 'banana', null)`)
      )
    ).rejects.toThrow(/invalid status/i);
  });

  it('records the decision, its actor and its note, and audits it', async () => {
    await asUser(db, MODERATOR, () =>
      db.query(
        `select public.admin_resolve_report('${reportId}'::uuid, 'actioned', 'confirmed via evidence')`
      )
    );

    const row = await db.query<{
      status: string;
      resolution_note: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
    }>(
      `select status, resolution_note, resolved_by, resolved_at
         from public.reports where id = '${reportId}'`
    );

    expect(row.rows[0].status).toBe('actioned');
    expect(row.rows[0].resolution_note).toBe('confirmed via evidence');
    expect(row.rows[0].resolved_by).toBe(MODERATOR);
    expect(row.rows[0].resolved_at).not.toBeNull();

    const audit = await db.query<{ n: number }>(
      `select count(*)::int as n from public.admin_audit_log
        where target_report_id = '${reportId}' and action = 'report.resolved'`
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('notifies the reporter once the report is actioned', async () => {
    // The M16 trigger generates the notification; M13 owns the state change.
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.notifications
          where user_id = '${USER_A}' and type = 'report'`
      )
    ).toBeGreaterThan(0);
  });

  it('leaves the queue empty once nothing is pending', async () => {
    const rows = await asUser(db, MODERATOR, async () => {
      const r = await db.query<{ report_id: string }>(
        `select * from public.admin_report_queue('pending', 50)`
      );
      return r.rows;
    });
    expect(rows).toEqual([]);
  });
});
