import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  asAnon,
  asUser,
  createTestDb,
  queryAs,
  seed,
} from './harness';

/**
 * M58 — GO GLOBAL for discover_profiles().
 *
 * Pins the geographic behaviour of the discovery RPC:
 *   * local mode (p_is_global = false) enforces the distance cap and fails
 *     closed when the caller has no location (never a worldwide leak),
 *   * global mode (p_is_global = true) bypasses the distance cap while
 *     preserving every non-geographic eligibility rule.
 */

const USER_E = '55555555-5555-5555-5555-555555555555';

// Kathmandu (viewer) and a co-located candidate -> distance 0 metres.
const KATHMANDU_LAT = 27.7172;
const KATHMANDU_LNG = 85.3240;
// New York -> thousands of kilometres from Kathmandu.
const NYC_LAT = 40.7128;
const NYC_LNG = -74.0060;

const pointSql = (lat: number, lng: number) =>
  `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography(Point, 4326)`;

// Every candidate is onboarded, public, 30 years old, a Woman, at the given
// point. The viewer (USER_A) is a Man so gender matching is driven by p_genders.
const candidateSql = (id: string, name: string, lat: number, lng: number) =>
  `insert into public.profiles
    (id, display_name, age, gender, city, country, intention, looking_for, interests,
     is_online, is_verified, onboarding_completed, is_suspended, location, snapped_location, updated_at)
   values
    ('${id}', '${name}', 30, 'Woman', 'Kathmandu', 'Nepal', 'both', '{}', '{}',
     false, false, true, false,
     ${pointSql(lat, lng)}, ${pointSql(lat, lng)}, now());
   update public.user_preferences
   set profile_visibility = 'public', show_online_status = true
   where user_id = '${id}';`;

describe('M58 — discover_profiles() GO GLOBAL', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();

    await seed(db, `
      insert into auth.users (id, email) values
        ('${USER_E}', 'eve@example.com');

      ${candidateSql(USER_B, 'Bo', KATHMANDU_LAT, KATHMANDU_LNG)}
      ${candidateSql(USER_C, 'Cy', NYC_LAT, NYC_LNG)}
      ${candidateSql(USER_D, 'Dee', NYC_LAT, NYC_LNG)}
      ${candidateSql(USER_E, 'Eve', KATHMANDU_LAT, KATHMANDU_LNG)}
    `);
  });

  beforeEach(async () => {
    // Reset per-test eligibility decisions and blocks; keep locations/visibility.
    await seed(db, `
      delete from public.likes where liker_id = '${USER_A}';
      delete from public.matches where user_a = '${USER_A}' or user_b = '${USER_A}';
      delete from public.blocked_users where blocker_id = '${USER_A}' or blocked_user_id = '${USER_A}';
      update public.profiles set is_suspended = false where id in ('${USER_B}','${USER_C}','${USER_D}','${USER_E}');
      update public.user_preferences set profile_visibility = 'public' where user_id in ('${USER_B}','${USER_C}','${USER_D}','${USER_E}');
    `);
  });

  const ids = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

  const discover = (viewerId: string, args: string) =>
    queryAs<{ id: string; distance_meters: number | null }>(
      db,
      viewerId,
      `select id, distance_meters from public.discover_profiles(${args})`,
    );

  it('local mode 1 KM returns only the co-located eligible profile', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, 1, false`);
    expect(ids(rows)).toEqual([USER_B]);
  });

  it('local mode 50 KM still excludes the intercontinental candidate', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, 50, false`);
    expect(ids(rows)).toEqual([USER_B]);
  });

  it('global mode returns eligible profiles worldwide', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).toEqual(expect.arrayContaining([USER_B, USER_C, USER_D]));
  });

  it('global mode works without the caller location (distance_meters null)', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', null, null, 0, null, true`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.distance_meters === null)).toBe(true);
  });

  it('local mode with missing caller location fails closed (no worldwide leak)', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', null, null, 0, 50, false`);
    expect(rows.length).toBe(0);
  });

  it('global mode excludes a blocked profile', async () => {
    await seed(db, `insert into public.blocked_users (blocker_id, blocked_user_id) values ('${USER_A}', '${USER_B}')`);
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes a suspended profile', async () => {
    await seed(db, `update public.profiles set is_suspended = true where id = '${USER_B}'`);
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes a private profile', async () => {
    await seed(db, `update public.user_preferences set profile_visibility = 'private' where user_id = '${USER_B}'`);
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes an already-liked (swiped) profile', async () => {
    await seed(db, `insert into public.likes (liker_id, liked_id) values ('${USER_A}', '${USER_B}')`);
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes an already-matched profile', async () => {
    await seed(db, `insert into public.matches (user_a, user_b) values (least('${USER_A}','${USER_B}'), greatest('${USER_A}','${USER_B}'))`);
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes an age mismatch', async () => {
    await seed(db, `update public.profiles set age = 65 where id = '${USER_B}'`);
    const rows = await discover(USER_A, `18, 30, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('global mode excludes a gender mismatch', async () => {
    await seed(db, `update public.profiles set gender = 'Man' where id = '${USER_B}'`);
    const rows = await discover(USER_A, `18, 99, array['Woman']::text[], 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true`);
    expect(ids(rows)).not.toContain(USER_B);
  });

  it('pagination p_offset does not repeat page one', async () => {
    const pageOne = await discover(USER_A, `18, 99, null, 50, false, '{}', null, null, 0, null, true`);
    const pageTwo = await discover(USER_A, `18, 99, null, 50, false, '{}', null, null, ${pageOne.length}, null, true`);
    const pageTwoIds = ids(pageTwo);
    expect(pageTwoIds.some((id) => ids(pageOne).includes(id))).toBe(false);
  });

  it('anonymous callers cannot invoke discover_profiles', async () => {
    let rejected = false;
    await asAnon(db, async () => {
      try {
        await db.query(
          `select * from public.discover_profiles(18, 99, null, 50, false, '{}', ${KATHMANDU_LAT}, ${KATHMANDU_LNG}, 0, null, true)`,
        );
      } catch {
        rejected = true;
      }
    });
    expect(rejected).toBe(true);
  });

  it('distance_meters is null when no caller location is supplied', async () => {
    const rows = await discover(USER_A, `18, 99, null, 50, false, '{}', null, null, 0, null, true`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.distance_meters === null)).toBe(true);
  });
});
