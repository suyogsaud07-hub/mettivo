import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, USER_C, USER_D, asAnon, asUser, createTestDb } from './harness';

interface BanStatus {
  banned: boolean;
  banned_until: string | null;
  ban_reason: string | null;
}

async function banStatus(db: PGlite, userId: string): Promise<BanStatus> {
  return asUser(db, userId, async () => {
    const result = await db.query<{ out: BanStatus }>(
      `select public.my_ban_status() as out`,
    );
    return result.rows[0].out;
  });
}

describe('M46 — Subbu cannot self-issue a restriction', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('returns a disabled no-op and writes no restriction', async () => {
    const applied = await asUser(db, USER_A, async () => {
      const result = await db.query<{ out: { ok: boolean; disabled: boolean } }>(
        `select public.apply_self_ban(2, 'verbal_harassment') as out`,
      );
      return result.rows[0].out;
    });

    expect(applied.ok).toBe(false);
    expect(applied.disabled).toBe(true);

    const status = await banStatus(db, USER_A);
    expect(status.banned).toBe(false);
    expect(status.banned_until).toBeNull();
  });

  it('can only ever affect the caller and never another member', async () => {
    await asUser(db, USER_B, () => db.query(`select public.apply_self_ban(2, 'spam')`));

    const ada = await banStatus(db, USER_A);
    expect(ada.banned).toBe(false);

    const bo = await banStatus(db, USER_B);
    expect(bo.banned).toBe(false);
    expect(bo.ban_reason).toBeNull();

    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from public.confirmed_violations`
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('does not let a member change their own moderation columns directly', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(`update public.profiles set banned_until = now() + interval '1 year' where id = '${USER_A}'`),
      ),
    ).rejects.toThrow(/moderation fields/i);

    expect((await banStatus(db, USER_A)).banned).toBe(false);
  });

  it('reports each member only their own state', async () => {
    expect((await banStatus(db, USER_C)).banned).toBe(false);
    expect((await banStatus(db, USER_C)).ban_reason).toBeNull();
  });

  it('surfaces a legacy banned_until timestamp instead of hiding the clock', async () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await db.query(
      `update public.profiles
          set banned_until = $1::timestamptz,
              ban_reason = 'legacy_sub_bu_ban'
        where id = $2`,
      [until, USER_D],
    );

    const status = await banStatus(db, USER_D);
    expect(status.banned).toBe(true);
    expect(status.banned_until).toBeTruthy();
    expect(status.ban_reason).toBe('legacy_sub_bu_ban');
  });

  it('denies both RPCs to anonymous callers', async () => {
    await expect(asAnon(db, () => db.query(`select public.my_ban_status()`))).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query(`select public.apply_self_ban(2, 'x')`)),
    ).rejects.toThrow();
  });

  it('writes no Subbu audit entry', async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.admin_audit_log where action = 'user.subbu_banned'`
    );
    expect(result.rows[0].n).toBe(0);
  });
});
