import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, USER_C, asAnon, asUser, createTestDb, seed } from './harness';

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

describe('M29 — Subbu bans are real and caller-scoped', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('applies a two-day ban to the caller and reports it', async () => {
    const applied = await asUser(db, USER_A, async () => {
      const result = await db.query<{ out: { ok: boolean; banned_until: string; reason: string } }>(
        `select public.apply_self_ban(2, 'verbal_harassment') as out`,
      );
      return result.rows[0].out;
    });

    expect(applied.ok).toBe(true);
    expect(applied.reason).toBe('verbal_harassment');

    const status = await banStatus(db, USER_A);
    expect(status.banned).toBe(true);
    expect(status.ban_reason).toBe('verbal_harassment');
    expect(new Date(status.banned_until ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a duration outside the 1–30 day policy', async () => {
    await expect(
      asUser(db, USER_B, () => db.query(`select public.apply_self_ban(0, 'x')`)),
    ).rejects.toThrow(/invalid ban duration/i);

    await expect(
      asUser(db, USER_B, () => db.query(`select public.apply_self_ban(31, 'x')`)),
    ).rejects.toThrow(/invalid ban duration/i);
  });

  it('can only ever affect the caller', async () => {
    // The function takes no target. Bo's ban must not touch Ada's record.
    await asUser(db, USER_B, () => db.query(`select public.apply_self_ban(2, 'spam')`));

    const ada = await banStatus(db, USER_A);
    expect(ada.ban_reason).toBe('verbal_harassment');

    const bo = await banStatus(db, USER_B);
    expect(bo.banned).toBe(true);
    expect(bo.ban_reason).toBe('spam');
  });

  it('does not let a member change their own ban columns directly', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(`update public.profiles set banned_until = null where id = '${USER_A}'`),
      ),
    ).rejects.toThrow(/moderation fields/i);

    await expect(
      asUser(db, USER_A, () =>
        db.query(`update public.profiles set banned_until = now() + interval '1 year' where id = '${USER_A}'`),
      ),
    ).rejects.toThrow(/moderation fields/i);

    expect((await banStatus(db, USER_A)).banned).toBe(true);
  });

  it('reports an expired ban as not banned', async () => {
    await seed(
      db,
      `update public.profiles set banned_until = now() - interval '1 minute' where id = '${USER_B}'`,
    );

    const status = await banStatus(db, USER_B);
    expect(status.banned).toBe(false);
    expect(status.banned_until).not.toBeNull();
  });

  it('shows each member only their own ban state', async () => {
    expect((await banStatus(db, USER_C)).banned).toBe(false);
    expect((await banStatus(db, USER_C)).ban_reason).toBeNull();
  });

  it('denies both RPCs to anonymous callers', async () => {
    await expect(asAnon(db, () => db.query(`select public.my_ban_status()`))).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query(`select public.apply_self_ban(2, 'x')`)),
    ).rejects.toThrow();
  });

  it('records the ban in the moderation audit log', async () => {
    const result = await db.query<{ n: number }>(
      `select count(*)::int as n from public.admin_audit_log where action = 'user.subbu_banned'`,
    );
    expect(result.rows[0].n).toBeGreaterThan(0);
  });
});
