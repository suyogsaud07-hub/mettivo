import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_D,
  affectedRows,
  anonReadCount,
  createTestDb,
  isRejected,
  queryAs,
  seed,
  writeEffect,
} from './harness';

/**
 * M39 — Explore More metadata.
 *
 * The seven categories and three Dating Goals are public reference data, but
 * only administrators with `settings.manage` may change them. These tests prove:
 *   * the exact goal set and intention mapping,
 *   * unique keys/titles and no duplicate "Serious Relationship" category,
 *   * anonymous/member write denial and admin-only RPC access,
 *   * disabling a goal immediately removes it from counts and feeds,
 *   * the M36 eligibility/feed behaviour still works.
 */

const ADMIN = USER_D;
const VIEWER = USER_A;
const CANDIDATE = USER_B;

type GoalRow = {
  goal_key: string;
  title: string;
  intention_value: string;
  sort_order: number;
  is_active: boolean;
};

describe('M39 — Explore More metadata', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(
      db,
      `insert into public.user_roles (user_id, role) values ('${ADMIN}', 'admin')
       on conflict (user_id) do update set role = excluded.role;

       update public.profiles
          set onboarding_completed = true,
              age = 29,
              gender = 'Woman',
              city = 'Kathmandu',
              intention = 'dating',
              looking_for = array['Men']
        where id = '${VIEWER}';

       update public.profiles
          set onboarding_completed = true,
              age = 31,
              gender = 'Man',
              city = 'Kathmandu',
              intention = 'dating',
              looking_for = array['Women']
        where id = '${CANDIDATE}';`
    );
  });

  it('keeps exactly three active goals with the stable intention mapping', async () => {
    const rows = await queryAs<GoalRow>(
      db,
      VIEWER,
      `select goal_key, title, intention_value, sort_order, is_active
         from public.explore_dating_goals
        order by sort_order`
    );

    expect(rows).toEqual([
      {
        goal_key: 'friendship',
        title: 'Friendship and Networking',
        intention_value: 'friendship',
        sort_order: 10,
        is_active: true,
      },
      {
        goal_key: 'serious',
        title: 'Serious Relationship',
        intention_value: 'dating',
        sort_order: 20,
        is_active: true,
      },
      {
        goal_key: 'casual',
        title: 'Casual & Open to Options',
        intention_value: 'both',
        sort_order: 30,
        is_active: true,
      },
    ]);
  });

  it('keeps exactly seven primary categories and no top-level "Serious Relationship"', async () => {
    const rows = await queryAs<{ n: number; serious: number }>(
      db,
      VIEWER,
      `select count(*)::int as n,
              count(*) filter (where lower(title) = 'serious relationship')::int as serious
         from public.explore_categories
        where is_active`
    );

    expect(rows[0]).toEqual({ n: 7, serious: 0 });
  });

  it('keeps both metadata tables unreadable by an anonymous caller', async () => {
    expect(
      await anonReadCount(db, 'select count(*)::int as n from public.explore_categories')
    ).toBe(0);
    expect(
      await anonReadCount(db, 'select count(*)::int as n from public.explore_dating_goals')
    ).toBe(0);
  });

  it('denies direct metadata writes by members', async () => {
    expect(
      await writeEffect(
        db,
        VIEWER,
        `update public.explore_categories
            set title = 'Hacked'
          where id = 'dating-goals'`
      )
    ).toBe(0);

    expect(
      await writeEffect(
        db,
        VIEWER,
        `insert into public.explore_dating_goals
           (goal_key, title, intention_value, sort_order)
         values ('casual', 'Duplicate', 'both', 99)`
      )
    ).toBe(0);

    const rows = await queryAs<{ title: string }>(
      db,
      VIEWER,
      `select title from public.explore_categories where id = 'dating-goals'`
    );
    expect(rows[0]?.title).toBe('Dating Goals');
  });

  it('allows only administrators to call the metadata RPCs', async () => {
    expect(
      await isRejected(
        db,
        VIEWER,
        `select public.admin_upsert_explore_goal(
           'serious', 'Serious Relationship',
           'People who explicitly want a committed relationship.',
           'dating', 20, true
         )`
      )
    ).toBe(true);

    await expect(
      queryAs(
        db,
        ADMIN,
        `select public.admin_upsert_explore_goal(
           'serious', 'Serious Relationship',
           'People who explicitly want a committed relationship.',
           'dating', 20, true
         )`
      )
    ).resolves.toBeDefined();

    const goals = await queryAs<GoalRow>(
      db,
      VIEWER,
      `select goal_key, title, intention_value, sort_order, is_active
         from public.explore_dating_goals
        order by sort_order`
    );
    expect(goals).toHaveLength(3);
  });

  it('keeps goal keys, titles and intention mappings unique', async () => {
    const duplicateIntention = await isRejected(
      db,
      ADMIN,
      `select public.admin_upsert_explore_goal(
         'casual', 'Casual & Open to Options',
         'People who are open to whatever develops naturally.',
         'dating', 30, true
       )`
    );
    expect(duplicateIntention).toBe(true);

    const duplicateTitle = await isRejected(
      db,
      ADMIN,
      `select public.admin_upsert_explore_goal(
         'serious', 'Friendship and Networking',
         'People who explicitly want a committed relationship.',
         'dating', 20, true
       )`
    );
    expect(duplicateTitle).toBe(true);

    const serious = await queryAs<GoalRow>(
      db,
      VIEWER,
      `select goal_key, title, intention_value, sort_order, is_active
         from public.explore_dating_goals
        where goal_key = 'serious'`
    );
    expect(serious[0]?.title).toBe('Serious Relationship');
    expect(serious[0]?.intention_value).toBe('dating');
  });

  it('lets admins create, update, hide and remove category metadata', async () => {
    const id = 'operator-test';
    try {
      await queryAs(
        db,
        ADMIN,
        `select public.admin_upsert_explore_category(
           '${id}', 'Operator Test', 'Temporary category for the metadata test.',
           '{}', '{}', '{}', '{}', 99, false
         )`
      );

      const memberRows = await queryAs<{ id: string }>(
        db,
        VIEWER,
        `select id from public.explore_categories where id = '${id}'`
      );
      expect(memberRows).toHaveLength(0);

      const adminRows = await queryAs<{
        id: string;
        title: string;
        is_active: boolean;
        updated_at: string;
      }>(
        db,
        ADMIN,
        `select id, title, is_active, updated_at::text
           from public.explore_categories where id = '${id}'`
      );
      expect(adminRows).toHaveLength(1);
      expect(adminRows[0]?.is_active).toBe(false);
      expect(adminRows[0]?.updated_at).toBeTruthy();

      await queryAs(
        db,
        ADMIN,
        `select public.admin_upsert_explore_category(
           '${id}', 'Operator Test Updated',
           'Temporary category for the metadata test.',
           '{}', '{}', '{}', '{}', 99, false
         )`
      );

      const updated = await queryAs<{ title: string }>(
        db,
        ADMIN,
        `select title from public.explore_categories where id = '${id}'`
      );
      expect(updated[0]?.title).toBe('Operator Test Updated');
    } finally {
      await seed(db, `delete from public.explore_categories where id = '${id}'`);
    }
  });

  it('rejects a top-level category titled "Serious Relationship"', async () => {
    const rejected = await isRejected(
      db,
      ADMIN,
      `select public.admin_upsert_explore_category(
         'serious-relationship', 'Serious Relationship',
         'Should be a goal, not a category.',
         '{}', '{}', '{}', '{}', 99, false
       )`
    );
    expect(rejected).toBe(true);
  });

  it('hides a disabled goal from members but keeps it visible to admins', async () => {
    try {
      await queryAs(
        db,
        ADMIN,
        `select public.admin_upsert_explore_goal(
           'serious', 'Serious Relationship',
           'People who explicitly want a committed relationship.',
           'dating', 20, false
         )`
      );

      const memberGoals = await queryAs<GoalRow>(
        db,
        VIEWER,
        `select goal_key, title, intention_value, sort_order, is_active
           from public.explore_dating_goals
          order by sort_order`
      );
      expect(memberGoals.map((goal) => goal.goal_key)).toEqual([
        'friendship',
        'casual',
      ]);

      const adminGoals = await queryAs<GoalRow>(
        db,
        ADMIN,
        `select goal_key, title, intention_value, sort_order, is_active
           from public.explore_dating_goals
          order by sort_order`
      );
      expect(adminGoals).toHaveLength(3);
      expect(adminGoals.find((goal) => goal.goal_key === 'serious')?.is_active).toBe(
        false
      );

      const counts = await queryAs<{ goal_key: string | null; profile_count: number }>(
        db,
        VIEWER,
        'select goal_key, profile_count from public.explore_more_counts()'
      );
      expect(
        counts.find((row) => row.goal_key === 'serious')
      ).toBeUndefined();

      expect(
        await isRejected(
          db,
          VIEWER,
          `select * from public.explore_more_feed('dating-goals', 'serious')`
        )
      ).toBe(true);
    } finally {
      await queryAs(
        db,
        ADMIN,
        `select public.admin_upsert_explore_goal(
           'serious', 'Serious Relationship',
           'People who explicitly want a committed relationship.',
           'dating', 20, true
         )`
      );
    }
  });

  it('serves the serious goal feed from the stored intention mapping', async () => {
    const rows = await queryAs<{ id: string; intention: string }>(
      db,
      VIEWER,
      `select id, intention
         from public.explore_more_feed('dating-goals', 'serious')`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(CANDIDATE);
    expect(rows[0]?.intention).toBe('dating');

    const counts = await queryAs<{ goal_key: string | null; profile_count: number }>(
      db,
      VIEWER,
      'select goal_key, profile_count from public.explore_more_counts()'
    );
    expect(
      counts.find((row) => row.goal_key === 'serious')?.profile_count
    ).toBe(1);
  });

  it('keeps profile intention owner-only', async () => {
    expect(
      await affectedRows(
        db,
        CANDIDATE,
        `update public.profiles
            set intention = 'friendship'
          where id = '${VIEWER}'`
      )
    ).toBe(0);

    const rows = await queryAs<{ intention: string }>(
      db,
      VIEWER,
      `select intention from public.profiles where id = '${VIEWER}'`
    );
    expect(rows[0]?.intention).toBe('dating');
  });
});
