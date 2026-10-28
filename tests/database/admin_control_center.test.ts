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
  isRejected,
  queryAs,
  scalarAs,
  seed,
} from './harness';

/**
 * M32 — administrative control center.
 *
 * The console is only safe if PostgreSQL enforces the same boundary as the UI.
 * These tests prove the permission map, the staff-role boundary, the anonymous
 * denial on the new tables, and the shared-secret webhook writer.
 */

const ADMIN = USER_D;
const SUPPORT = USER_C;

describe('M32 — administrative control center', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(
      db,
      `insert into public.user_roles (user_id, role) values
         ('${ADMIN}', 'admin'),
         ('${SUPPORT}', 'support'),
         ('${MODERATOR}', 'moderator')
       on conflict (user_id) do update set role = excluded.role`
    );
  });

  it('keeps every new table unreadable by an anonymous caller', async () => {
    for (const table of [
      'subscription_plans',
      'subscriptions',
      'payment_events',
      'notification_campaigns',
      'admin_settings',
    ]) {
      expect(
        await anonReadCount(db, `select count(*)::int as n from public.${table}`),
        table
      ).toBe(0);
    }
  });

  it('keeps follows unreadable by an anonymous caller', async () => {
    await seed(
      db,
      `insert into public.follows (follower_id, following_id)
       values ('${USER_A}', '${USER_B}')
       on conflict do nothing`
    );
    expect(
      await anonReadCount(db, 'select count(*)::int as n from public.follows')
    ).toBe(0);
  });

  it('reports the caller’s own role and least-privilege permissions', async () => {
    const rows = await queryAs<{ me: Record<string, unknown> }>(
      db,
      SUPPORT,
      'select public.admin_me() as me'
    );
    const me = rows[0]?.me;
    expect(me?.role).toBe('support');
    const permissions = me?.permissions as string[];
    expect(permissions).toContain('users.view');
    expect(permissions).toContain('subscriptions.view');
    expect(permissions).not.toContain('users.manage');
    expect(permissions).not.toContain('payments.manage');
    expect(permissions).not.toContain('settings.manage');
    expect(permissions).not.toContain('staff.manage');
  });

  it('denies the dashboard to an ordinary member and to anonymous callers', async () => {
    await expect(
      asUser(db, USER_A, () => db.query('select public.admin_dashboard_stats()'))
    ).rejects.toThrow(/dashboard access required/i);

    await expect(
      asAnon(db, () => db.query('select public.admin_dashboard_stats()'))
    ).rejects.toThrow();
  });

  it('allows support to read accounts but not to change roles', async () => {
    const rows = await queryAs<{ user_id: string }>(
      db,
      SUPPORT,
      `select user_id from public.admin_user_list(null, null, 10, 0)`
    );
    expect(rows.length).toBeGreaterThan(0);

    await expect(
      asUser(db, SUPPORT, () =>
        db.query(`select public.admin_set_role('${USER_A}'::uuid, 'admin')`)
      )
    ).rejects.toThrow(/staff management access required/i);
  });

  it('never lets a client write user_roles directly', async () => {
    expect(
      await isRejected(
        db,
        ADMIN,
        `insert into public.user_roles (user_id, role) values ('${USER_A}', 'admin')`
      )
    ).toBe(true);
  });

  it('changes a role through the audited RPC', async () => {
    await asUser(db, ADMIN, () =>
      db.query(`select public.admin_set_role('${USER_B}'::uuid, 'finance')`)
    );

    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.user_roles
          where user_id = '${USER_B}' and role = 'finance'`
      )
    ).toBe(1);

    const audit = await queryAs<{ n: number }>(
      db,
      ADMIN,
      `select count(*)::int as n from public.admin_audit_log
        where action = 'staff.role_changed'
          and target_user_id = '${USER_B}'`
    );
    expect(audit[0]?.n).toBe(1);
  });

  it('refuses to grant an unknown role', async () => {
    await expect(
      asUser(db, ADMIN, () =>
        db.query(`select public.admin_set_role('${USER_A}'::uuid, 'root')`)
      )
    ).rejects.toThrow(/unknown role/i);
  });

  it('seeds honest draft plans and never invents a price', async () => {
    const rows = await queryAs<{ code: string; price_minor: number; is_active: boolean }>(
      db,
      ADMIN,
      `select code, price_minor, is_active from public.subscription_plans order by code`
    );
    const premium = rows.find((row) => row.code === 'premium');
    const premiumPlus = rows.find((row) => row.code === 'premium_plus');
    const free = rows.find((row) => row.code === 'free');

    expect(free?.is_active).toBe(true);
    expect(premium?.is_active).toBe(false);
    expect(premium?.price_minor).toBe(0);
    expect(premiumPlus?.is_active).toBe(false);
  });

  it('refuses revenue access to a moderator', async () => {
    await expect(
      asUser(db, MODERATOR, () => db.query('select public.admin_payment_summary()'))
    ).rejects.toThrow(/payment access required/i);
  });

  it('requires the exact shared secret before writing a payment event', async () => {
    await seed(
      db,
      `update public.admin_settings
       set value = '{"secret":"whsec_test_only"}'::jsonb
       where key = 'payment_webhook_secret'`
    );

    await expect(
      asAnon(db, () =>
        db.query(
          `select public.record_payment_event(
             'wrong', 'evt_wrong', 'checkout.session.completed')`
        )
      )
    ).rejects.toThrow(/webhook authentication failed/i);

    const first = await asAnon(db, async () => {
      const result = await db.query<{ outcome: Record<string, unknown> }>(
        `select public.record_payment_event(
           'whsec_test_only',
           'evt_paid_1',
           'invoice.paid',
           'stripe',
           '${USER_A}'::uuid,
           'free',
           2500,
           null,
           0,
           'usd',
           'active',
           now() + interval '30 days',
           '{"event_id":"evt_paid_1"}'::jsonb
         ) as outcome`
      );
      return result.rows[0]?.outcome;
    });

    expect(first?.ok).toBe(true);
    expect(first?.duplicate).toBe(false);

    const duplicate = await asAnon(db, async () => {
      const result = await db.query<{ outcome: Record<string, unknown> }>(
        `select public.record_payment_event(
           'whsec_test_only', 'evt_paid_1', 'invoice.paid') as outcome`
      );
      return result.rows[0]?.outcome;
    });
    expect(duplicate?.duplicate).toBe(true);

    expect(
      await scalarAs(
        db,
        ADMIN,
        `select count(*)::int as n from public.payment_events where event_id = 'evt_paid_1'`
      )
    ).toBe(1);
  });

  it('links a subscription only for a real plan and an allowed status', async () => {
    await asAnon(db, () =>
      db.query(
        `select public.record_payment_event(
           'whsec_test_only', 'evt_sub_1', 'customer.subscription.updated',
           'stripe', '${USER_A}'::uuid, 'free', null, null, 0, 'usd',
           'active', now() + interval '30 days', '{}'::jsonb)`
      )
    );

    expect(
      await scalarAs(
        db,
        ADMIN,
        `select count(*)::int as n from public.subscriptions
          where user_id = '${USER_A}' and status = 'active'`
      )
    ).toBe(1);

    // A status the product does not model must not silently create a row.
    await asAnon(db, () =>
      db.query(
        `select public.record_payment_event(
           'whsec_test_only', 'evt_sub_bad', 'customer.subscription.updated',
           'stripe', '${USER_B}'::uuid, 'free', null, null, 0, 'usd',
           'paused', null, '{}'::jsonb)`
      )
    );
    expect(
      await scalarAs(
        db,
        ADMIN,
        `select count(*)::int as n from public.subscriptions where user_id = '${USER_B}'`
      )
    ).toBe(0);
  });

  it('keeps a payment event even when the member no longer exists', async () => {
    await asAnon(db, () =>
      db.query(
        `select public.record_payment_event(
           'whsec_test_only', 'evt_deleted_user', 'invoice.paid',
           'stripe', '00000000-0000-0000-0000-000000000000'::uuid,
           'free', 1000, null, 0, 'usd', 'active', null, '{}'::jsonb)`
      )
    );

    const rows = await queryAs<{ user_id: string | null }>(
      db,
      ADMIN,
      `select user_id from public.payment_events where event_id = 'evt_deleted_user'`
    );
    expect(rows[0]?.user_id).toBeNull();
  });

  it('keeps the audit log admin-only', async () => {
    const rows = await queryAs<{ action: string }>(
      db,
      ADMIN,
      `select action from public.admin_audit_list(null, 10, 0)`
    );
    expect(rows.length).toBeGreaterThan(0);

    await expect(
      asUser(db, SUPPORT, () => db.query('select * from public.admin_audit_list(null, 10, 0)'))
    ).rejects.toThrow(/audit access required/i);
  });

  it('keeps system settings admin-only', async () => {
    await expect(
      asUser(db, MODERATOR, () => db.query('select public.admin_settings_get()'))
    ).rejects.toThrow(/settings access required/i);

    const settings = await asUser(db, ADMIN, async () => {
      const result = await db.query<{ settings: Record<string, unknown> }>(
        'select public.admin_settings_get() as settings'
      );
      return result.rows[0]?.settings;
    });
    const secret = settings?.payment_webhook_secret as Record<string, unknown>;
    expect(secret.configured).toBe(true);
    expect(secret.secret).toBeUndefined();
  });

  it('blocks direct reads of admin settings and payment payloads', async () => {
    expect(
      await isRejected(db, ADMIN, 'select value from public.admin_settings')
    ).toBe(true);

    expect(
      await isRejected(db, ADMIN, 'select payload from public.payment_events')
    ).toBe(true);

    // Finance may read reconciliation columns, but never the raw payload.
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(event_id)::int as n from public.payment_events`
      )
    ).toBeGreaterThan(0);

    expect(
      await isRejected(db, USER_B, 'select payload from public.payment_events')
    ).toBe(true);
  });

  it('does not expose the audit trail directly to moderators or support', async () => {
    expect(
      await scalarAs(db, ADMIN, 'select count(*)::int as n from public.admin_audit_log')
    ).toBeGreaterThan(0);

    expect(
      await scalarAs(db, MODERATOR, 'select count(*)::int as n from public.admin_audit_log')
    ).toBe(0);

    expect(
      await scalarAs(db, SUPPORT, 'select count(*)::int as n from public.admin_audit_log')
    ).toBe(0);
  });

  it('limits direct role reads to the caller or a super admin', async () => {
    expect(
      await scalarAs(db, SUPPORT, 'select count(*)::int as n from public.user_roles')
    ).toBe(1);

    expect(
      await scalarAs(db, MODERATOR, 'select count(*)::int as n from public.user_roles')
    ).toBe(1);

    expect(
      await scalarAs(db, ADMIN, 'select count(*)::int as n from public.user_roles')
    ).toBeGreaterThan(1);
  });

  it('stops a moderator from acting on another staff account', async () => {
    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_set_user_status('${SUPPORT}'::uuid, 'suspended', 'x')`)
      )
    ).rejects.toThrow(/staff account/i);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_warn_user('${SUPPORT}'::uuid, 'x')`)
      )
    ).rejects.toThrow(/staff account/i);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(`select public.admin_suspend_user('${SUPPORT}'::uuid, 'x')`)
      )
    ).rejects.toThrow(/staff account/i);

    await expect(
      asUser(db, MODERATOR, () =>
        db.query(
          `select public.admin_apply_moderation_action('${SUPPORT}'::uuid, 'spam', 'chat', 'x')`
        )
      )
    ).rejects.toThrow(/staff account/i);
  });

  it('does not let report thresholds enforce against staff', async () => {
    const result = await db.query<{ outcome: Record<string, unknown> }>(
      `select public.evaluate_report_thresholds('${ADMIN}'::uuid) as outcome`
    );
    expect(result.rows[0]?.outcome).toMatchObject({
      applied: false,
      reason: 'protected_staff',
    });
  });
});
