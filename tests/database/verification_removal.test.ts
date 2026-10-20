import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  anonReadCount,
  createTestDb,
  isRejected,
  seed,
  systemicCount,
} from './harness';

/**
 * M31 — face and voice verification are gone.
 *
 * The UI and API removal is covered elsewhere. This suite proves the database
 * no longer enforces (or exposes) the retired feature:
 *
 *   * the M24 onboarding trigger is gone, so a member can publish without any
 *     verification record;
 *   * the secret-gated writer RPCs and the status reader are gone;
 *   * the historical audit tables are retained with RLS still enabled.
 */

describe('M31 — face/voice verification removal', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it('lets a member publish onboarding without a verification record', async () => {
    const rejected = await isRejected(
      db,
      USER_A,
      `update public.profiles
          set onboarding_completed = true,
              avatar_url = 'data:image/jpeg;base64,avatar',
              photos = array['data:image/jpeg;base64,one']
        where id = '${USER_A}'`
    );
    expect(rejected).toBe(false);

    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.profiles
          where id = '${USER_A}' and onboarding_completed`
      )
    ).toBe(1);
  });

  it('removed the enforcement trigger and the verification RPCs', async () => {
    const trigger = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_trigger
       where tgname = 'enforce_verification_before_onboarding_trg'
    `);
    expect(trigger.rows[0]?.n).toBe(0);

    const functions = await db.query<{ n: number }>(`
      select count(*)::int as n
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'record_verification',
           'record_photo_check',
           'get_my_verification',
           'enforce_verification_before_onboarding'
         )
    `);
    expect(functions.rows[0]?.n).toBe(0);
  });

  it('retains the historical audit tables with RLS enabled', async () => {
    const tables = await db.query<{ name: string; rls: boolean }>(`
      select c.relname as name, c.relrowsecurity as rls
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('profile_verifications','profile_photo_checks')
    `);
    expect(tables.rows).toHaveLength(2);
    expect(tables.rows.filter((table) => table.rls !== true)).toEqual([]);
  });

  it('still hides historical verification rows from anonymous callers', async () => {
    await seed(
      db,
      `insert into public.profile_verifications (user_id, face_verified)
       values ('${USER_A}', true)`
    );

    expect(
      await anonReadCount(db, `select count(*)::int as n from public.profile_verifications`)
    ).toBe(0);
    expect(
      await anonReadCount(db, `select count(*)::int as n from public.profile_photo_checks`)
    ).toBe(0);
  });
});
