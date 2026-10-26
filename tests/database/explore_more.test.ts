import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  asAnon,
  asUser,
  createTestDb,
  isRejected,
  queryAs,
  seed,
  systemicCount,
} from './harness';

/**
 * M36 — Explore More.
 *
 * Counts and cards must be the same population: every category count is read
 * from `explore_eligible_profiles()`, the exact set the feed uses. These tests
 * prove the shared set from the database — not from UI filtering — including
 * blocks, suspensions, bans, private profiles, prior decisions, gender/age
 * preferences and the three Dating Goals.
 */

const USER_E = '55555555-5555-5555-5555-555555555555';
const USER_F = '66666666-6666-6666-6666-666666666666';
const USER_G = '77777777-7777-7777-7777-777777777777';
const USER_H = '88888888-8888-8888-8888-888888888888';
const USER_J = '12121212-1212-1212-1212-121212121212';

interface CountRow {
  category_id: string;
  goal_key: string | null;
  profile_count: number;
}

interface FeedRow {
  id: string;
  display_name: string;
  intention: string | null;
  match_score: number;
  category_hits: number;
  is_online: boolean;
}

const countFor = (rows: CountRow[], category: string, goal: string | null = null) =>
  rows.find((row) => row.category_id === category && row.goal_key === goal)?.profile_count;

const feed = (db: PGlite, userId: string, args: string) =>
  queryAs<FeedRow>(db, userId, `select * from public.explore_more_feed(${args})`);

describe('M36 — Explore More eligibility, counts, goals and pagination', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();

    await seed(db, `
      insert into auth.users (id, email) values
        ('${USER_E}', 'eve@example.com'),
        ('${USER_F}', 'fay@example.com'),
        ('${USER_G}', 'gus@example.com'),
        ('${USER_H}', 'hana@example.com'),
        ('${USER_J}', 'jon@example.com');

      update public.profiles as p set
        first_name = v.first_name, last_name = v.last_name,
        has_last_name = v.has_last_name, username = v.username,
        display_name = v.display_name, age = v.age, gender = v.gender,
        city = v.city, country = v.country, avatar_url = v.avatar_url,
        photos = v.photos, bio = v.bio, intention = v.intention,
        looking_for = v.looking_for, hobbies = v.hobbies, pets = v.pets,
        mbti = v.mbti, interests = v.interests, prompts = v.prompts,
        is_verified = v.is_verified, onboarding_completed = v.onboarding_completed,
        last_seen_at = v.last_seen_at
      from (values
        ('${USER_A}'::uuid, 'Ada', null::text, false, 'ada_e', 'Ada', 28, 'Woman', 'Kathmandu',
         'Nepal', 'a.jpg', array['a.jpg'], 'Ada bio', 'both', array['Men'],
         array['Coffee & Tea'], array[]::text[], 'INFJ',
         array['coffee','hiking'], '{"simple-pleasures":"coffee"}'::jsonb, true, true, now()),
        ('${USER_B}'::uuid, 'Bo', null::text, false, 'bo_e', 'Bo', 30, 'Man', 'Pokhara',
         'Nepal', 'b.jpg', array['b.jpg'], 'Bo bio', 'dating', array['Women'],
         array['Travel','Cooking'], array['Dog lover'], 'ENFP',
         array['coffee','hiking','travel'], '{"simple-pleasures":"coffee"}'::jsonb, true, true, now()),
        ('${USER_C}'::uuid, 'Cy', null::text, false, 'cy_e', 'Cy', 25, 'Woman', 'Lalitpur',
         'Nepal', 'c.jpg', array['c.jpg'], 'Cy bio', 'friendship', array['Men'],
         array['Gaming'], array[]::text[], 'INTP',
         array['gaming'], '{}'::jsonb, false, true, now()),
        ('${USER_D}'::uuid, 'Dee', null::text, false, 'dee_e', 'Dee', 32, 'Man', 'Nepalgunj',
         'Nepal', 'd.jpg', array['d.jpg'], 'Dee bio', 'dating', array['Women'],
         array[]::text[], array[]::text[], null,
         array['coffee'], '{}'::jsonb, false, true, now())
      ) as v(id, first_name, last_name, has_last_name, username, display_name, age,
             gender, city, country, avatar_url, photos, bio, intention, looking_for,
             hobbies, pets, mbti, interests, prompts, is_verified,
             onboarding_completed, last_seen_at)
      where p.id = v.id;

      insert into public.profiles
        (id, first_name, last_name, has_last_name, username, display_name, age,
         gender, city, country, avatar_url, photos, bio, intention, looking_for,
         hobbies, pets, mbti, interests, prompts, is_verified,
         onboarding_completed, last_seen_at)
      values
        ('${USER_E}', 'Eve', null, false, 'eve_e', 'Eve', 26, 'Man', 'Birgunj',
         'Nepal', 'e.jpg', array['e.jpg'], 'Eve bio', 'friendship', array['Women'],
         array['Gaming'], array['Cat lover'], 'ISTJ',
         array['gaming'], '{}'::jsonb, true, true, now()),
        ('${USER_F}', 'Fay', null, false, 'fay_e', 'Fay', 29, 'Man', 'Biratnagar',
         'Nepal', 'f.jpg', array['f.jpg'], 'Fay bio', 'dating', array['Women'],
         array[]::text[], array[]::text[], null,
         array['coffee'], '{}'::jsonb, false, true, now()),
        ('${USER_G}', 'Gus', null, false, 'gus_e', 'Gus', 31, 'Man', 'Butwal',
         'Nepal', 'g.jpg', array['g.jpg'], 'Gus bio', 'dating', array['Women'],
         array[]::text[], array[]::text[], null,
         array['coffee'], '{}'::jsonb, false, true, now()),
        ('${USER_H}', 'Hana', null, false, 'hana_e', 'Hana', 27, 'Man', 'Dharan',
         'Nepal', 'h.jpg', array['h.jpg'], 'Hana bio', 'dating', array['Women'],
         array[]::text[], array[]::text[], null,
         array['coffee'], '{}'::jsonb, false, true, now()),
        ('${USER_J}', 'Jon', null, false, 'jon_e', 'Jon', 33, 'Man', 'Hetauda',
         'Nepal', 'j.jpg', array['j.jpg'], 'Jon bio', 'dating', array['Women'],
         array[]::text[], array[]::text[], null,
         array['coffee'], '{}'::jsonb, false, true, now());

      update public.user_preferences set profile_visibility = 'private' where user_id = '${USER_D}';
      update public.profiles set is_suspended = true where id = '${USER_F}';
      update public.profiles set banned_until = now() + interval '30 days' where id = '${USER_G}';

      insert into public.likes (liker_id, liked_id, is_like)
      values ('${USER_A}', '${USER_H}', true);

      insert into public.blocked_users (blocker_id, blocked_user_id)
      values ('${USER_A}', '${USER_J}');
    `);
  });

  it('ships exactly seven active curated categories', async () => {
    expect(
      await systemicCount(db, `select count(*)::int as n from public.explore_categories where is_active`)
    ).toBe(7);

    const ids = await queryAs<{ id: string }>(
      db,
      USER_A,
      `select id from public.explore_categories order by sort_order`
    );
    expect(ids.map((row) => row.id)).toEqual([
      'dating-goals',
      'coffee-food',
      'nature-adventure',
      'gamers-entertainment',
      'pet-lovers',
      'travel-partners',
      'new-friends',
    ]);
  });

  it('counts only the members the feed may actually show', async () => {
    const rows = await queryAs<CountRow>(
      db,
      USER_A,
      `select * from public.explore_more_counts(18, 99)`
    );

    expect(countFor(rows, 'coffee-food')).toBe(1);
    expect(countFor(rows, 'nature-adventure')).toBe(1);
    expect(countFor(rows, 'gamers-entertainment')).toBe(1);
    expect(countFor(rows, 'pet-lovers')).toBe(2);
    expect(countFor(rows, 'travel-partners')).toBe(1);
    expect(countFor(rows, 'new-friends')).toBe(1);
    expect(countFor(rows, 'dating-goals')).toBe(2);

    // Private D, suspended F, banned G, liked H, blocked J and the
    // gender-excluded C never contribute.
    expect(countFor(rows, 'dating-goals', 'serious')).toBe(1);
    expect(countFor(rows, 'dating-goals', 'friendship')).toBe(1);
    expect(countFor(rows, 'dating-goals', 'casual')).toBe(0);
  });

  it('applies the viewer age range to counts and feed alike', async () => {
    const counts = await queryAs<CountRow>(
      db,
      USER_A,
      `select * from public.explore_more_counts(31, 40)`
    );
    expect(countFor(counts, 'coffee-food')).toBe(0);
    expect(countFor(counts, 'pet-lovers')).toBe(0);

    const rows = await feed(db, USER_A, `'coffee-food', null, null, 20, 31, 40`);
    expect(rows).toEqual([]);
  });

  it('filters a category by real profile signals and public eligibility', async () => {
    const rows = await feed(db, USER_A, `'coffee-food', null, null, 20, 18, 99`);
    expect(rows.map((row) => row.display_name)).toEqual(['Bo']);
  });

  it('requires the candidate’s own stored intention for each Dating Goal', async () => {
    const serious = await feed(db, USER_A, `'dating-goals', 'serious', null, 20, 18, 99`);
    const friendship = await feed(db, USER_A, `'dating-goals', 'friendship', null, 20, 18, 99`);
    const casual = await feed(db, USER_A, `'dating-goals', 'casual', null, 20, 18, 99`);

    expect(serious.map((row) => row.display_name)).toEqual(['Bo']);
    expect(friendship.map((row) => row.display_name)).toEqual(['Eve']);
    expect(casual).toEqual([]);
  });

  it('returns no duplicate cards across cursor pages', async () => {
    const first = await feed(db, USER_A, `'pet-lovers', null, null, 1, 18, 99`);
    expect(first).toHaveLength(1);

    const cursor = `${first[0].match_score}:${first[0].id}`;
    const second = await feed(
      db,
      USER_A,
      `'pet-lovers', null, '${cursor}', 1, 18, 99, array['${first[0].id}']::uuid[]`
    );

    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    expect(new Set([first[0].id, second[0].id]).size).toBe(2);
  });

  it('rejects an unknown category, a missing goal and a malformed cursor', async () => {
    await expect(feed(db, USER_A, `'not-a-category', null, null, 20, 18, 99`)).rejects.toThrow();
    await expect(feed(db, USER_A, `'dating-goals', null, null, 20, 18, 99`)).rejects.toThrow();
    await expect(
      feed(db, USER_A, `'coffee-food', null, 'not-a-cursor', 20, 18, 99`)
    ).rejects.toThrow();
  });

  it('never returns private profile fields', async () => {
    const rows = await queryAs<Record<string, unknown>>(
      db,
      USER_A,
      `select * from public.explore_more_feed('coffee-food', null, null, 20, 18, 99)`
    );
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0]);
    expect(keys).not.toContain('birth_date');
    expect(keys).not.toContain('religion');
    expect(keys).not.toContain('politics');
    expect(keys).not.toContain('banned_until');
  });

  it('blocks direct reads of the internal eligible set and anonymous access', async () => {
    expect(
      await isRejected(db, USER_A, `select * from public.explore_eligible_profiles(18, 99)`)
    ).toBe(true);

    await expect(
      asAnon(db, () => db.query(`select * from public.explore_more_counts(18, 99)`))
    ).rejects.toThrow();
    await expect(
      asAnon(db, () =>
        db.query(`select * from public.explore_more_feed('coffee-food', null, null, 20, 18, 99)`)
      )
    ).rejects.toThrow();
    await expect(
      asAnon(db, () => db.query(`select * from public.explore_categories`))
    ).rejects.toThrow();
  });

  it('keeps all seven categories readable by a signed-in member', async () => {
    expect(
      await queryAs<{ id: string }>(db, USER_A, `select id from public.explore_categories`)
    ).toHaveLength(7);
    // Defensive: the helper above is exercised as the user, not the owner.
    expect(await asUser(db, USER_A, () => db.query(`select 1`))).toBeDefined();
  });
});
