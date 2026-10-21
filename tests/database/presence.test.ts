import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  asAnon,
  asUser,
  createTestDb,
  queryAs,
  seed,
} from './harness';

/**
 * Reliable presence.
 *
 * Online state must come from a short, authenticated heartbeat window — not
 * from a boolean a client can leave behind forever. These tests also pin the
 * privacy control: hiding online status must hide it everywhere presence is
 * read, including discovery ordering.
 */

const setCandidate = (id: string, lastSeen: string, visibility = 'public') =>
  `update public.profiles
   set onboarding_completed = true,
       age = 30,
       gender = case when '${id}' = '${USER_A}' then 'Woman' else 'Man' end,
       is_online = true,
       last_seen_at = ${lastSeen},
       updated_at = now()
   where id = '${id}';
   update public.user_preferences
   set show_online_status = true, profile_visibility = '${visibility}'
   where user_id = '${id}';`;

describe('presence heartbeat and derived online state', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await seed(
      db,
      `update public.profiles
       set last_seen_at = null, is_online = false, onboarding_completed = true, age = 30
       where id in ('${USER_A}','${USER_B}','${USER_C}');
       update public.user_preferences
       set show_online_status = true, profile_visibility = 'public'
       where user_id in ('${USER_A}','${USER_B}','${USER_C}');`
    );
  });

  it('records a heartbeat for the authenticated caller only', async () => {
    await seed(
      db,
      `update public.profiles
       set is_online = false, last_seen_at = now() - interval '3 minutes'
       where id = '${USER_B}'`
    );

    await asUser(db, USER_A, () => db.exec('select public.touch_presence();'));

    const own = await queryAs<{ is_online: boolean }>(
      db,
      USER_A,
      `select is_online from public.profiles where id = '${USER_A}'`
    );
    // last_seen_at is deliberately not granted to clients; the public
    // projection derives online state without revealing the exact time.
    const seen = await db.query<{ seen: boolean }>(
      `select last_seen_at >= now() - interval '10 seconds' as seen
       from public.profiles where id = '${USER_A}'`
    );
    const untouched = await db.query<{ seen: boolean }>(
      `select last_seen_at >= now() - interval '10 seconds' as seen
       from public.profiles where id = '${USER_B}'`
    );

    expect(own[0]?.is_online).toBe(true);
    expect(seen.rows[0]?.seen).toBe(true);
    expect(untouched.rows[0]?.seen).toBe(false);
  });

  it('expires a stale heartbeat instead of trusting is_online forever', async () => {
    await seed(
      db,
      `update public.profiles
       set is_online = true, last_seen_at = now() - interval '3 minutes'
       where id = '${USER_B}'`
    );

    const rows = await queryAs<{ is_online: boolean }>(
      db,
      USER_A,
      `select is_online from public.public_profiles where id = '${USER_B}'`
    );

    expect(rows[0]?.is_online).toBe(false);
  });

  it('honours the member’s show_online_status privacy setting', async () => {
    await seed(
      db,
      `update public.profiles
       set is_online = true, last_seen_at = now()
       where id = '${USER_B}';
       update public.user_preferences
       set show_online_status = false
       where user_id = '${USER_B}'`
    );

    const rows = await queryAs<{ is_online: boolean }>(
      db,
      USER_A,
      `select is_online from public.public_profiles where id = '${USER_B}'`
    );

    expect(rows[0]?.is_online).toBe(false);
  });

  it('orders a genuine heartbeat before a stale online flag', async () => {
    await seed(
      db,
      `${setCandidate(USER_A, "now() - interval '3 minutes'")}
       ${setCandidate(USER_B, 'now()')}`
    );

    const rows = await queryAs<{ id: string; is_online: boolean }>(
      db,
      USER_C,
      `select id, is_online from public.discover_profiles(18, 99, null, 50, false)`
    );

    expect(rows[0]?.id).toBe(USER_B);
    expect(rows[0]?.is_online).toBe(true);
    expect(rows.find((row) => row.id === USER_A)?.is_online).toBe(false);
  });

  it('excludes a non-public profile from discovery', async () => {
    await seed(
      db,
      `${setCandidate(USER_A, 'now()')}
       update public.user_preferences
       set profile_visibility = 'private'
       where user_id = '${USER_A}'`
    );

    const rows = await queryAs<{ id: string }>(
      db,
      USER_C,
      `select id from public.discover_profiles(18, 99, null, 50, false)`
    );

    expect(rows.map((row) => row.id)).not.toContain(USER_A);
  });

  it('never lets an anonymous caller invoke the heartbeat', async () => {
    const rejected = await asAnon(db, async () => {
      try {
        await db.exec('select public.touch_presence();');
        return false;
      } catch {
        return true;
      }
    });

    expect(rejected).toBe(true);
  });
});
