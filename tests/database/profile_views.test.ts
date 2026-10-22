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
  isRejected,
  queryAs,
  seed,
  systemicCount,
} from './harness';

type RecordResult = {
  recorded: boolean;
  reason?: string;
  is_new_viewer?: boolean;
  unique_viewers?: number;
  total_visits?: number;
  viewer_visits?: number;
};

type Summary = {
  unique_viewers: number;
  returning_viewers: number;
  total_visits: number;
  most_recent_at: string | null;
};

type ViewerRow = {
  viewer_id: string;
  first_name: string | null;
  last_name: string | null;
  has_last_name: boolean;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_online: boolean;
  first_viewed_at: string;
  last_viewed_at: string;
  view_count: number;
  is_followed_by_me: boolean;
};

const VIEWER_KEYS = [
  'avatar_url',
  'display_name',
  'first_name',
  'first_viewed_at',
  'has_last_name',
  'is_followed_by_me',
  'is_online',
  'last_name',
  'last_viewed_at',
  'username',
  'view_count',
  'viewer_id',
];

describe('profile view analytics', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();

    await seed(
      db,
      `update public.profiles
         set display_name = 'Bo', first_name = 'Bo', last_name = 'Brown',
             has_last_name = true, username = 'bo_brown'
       where id = '${USER_B}';
       update public.profiles
         set display_name = 'Cy', first_name = 'Cy', last_name = 'Cruz',
             has_last_name = true, username = 'cy_cruz'
       where id = '${USER_C}';
       update public.profiles
         set display_name = 'Dee', first_name = 'Dee', last_name = null,
             has_last_name = false, username = 'dee'
       where id = '${USER_D}';`
    );
  });

  beforeEach(async () => {
    await seed(
      db,
      `delete from public.profile_viewers;
       delete from public.notifications where type in ('visitor', 'follow');
       delete from public.blocked_users;
       delete from public.follows;`
    );
  });

  async function recordView(viewerId: string, viewedId: string): Promise<RecordResult> {
    const rows = await queryAs<{ result: RecordResult }>(
      db,
      viewerId,
      `select public.record_profile_view('${viewedId}') as result`
    );
    return rows[0].result;
  }

  async function summaryAs(userId: string): Promise<Summary> {
    const rows = await queryAs<{ result: Summary }>(
      db,
      userId,
      `select public.profile_view_summary() as result`
    );
    return rows[0].result;
  }

  async function viewersAs(
    userId: string,
    limit = 30,
    offset = 0,
    search: string | null = null
  ): Promise<ViewerRow[]> {
    const searchSql = search === null ? 'null' : `'${search.replace(/'/g, "''")}'`;
    return queryAs<ViewerRow>(
      db,
      userId,
      `select * from public.list_profile_viewers(${limit}, ${offset}, ${searchSql})`
    );
  }

  function rowCount(): Promise<number> {
    return systemicCount(db, 'select count(*)::int as n from public.profile_viewers');
  }

  function visitorNotifications(): Promise<number> {
    return systemicCount(
      db,
      `select count(*)::int as n from public.notifications where type = 'visitor'`
    );
  }

  it('records a first visit as exactly one unique viewer', async () => {
    const result = await recordView(USER_B, USER_A);

    expect(result).toEqual({
      recorded: true,
      is_new_viewer: true,
      unique_viewers: 1,
      total_visits: 1,
      viewer_visits: 1,
    });
    expect(await rowCount()).toBe(1);
    expect(await visitorNotifications()).toBe(1);
  });

  it('keeps a repeat visitor on the same row and increments the visit count', async () => {
    await recordView(USER_B, USER_A);
    const second = await recordView(USER_B, USER_A);

    expect(second).toEqual({
      recorded: true,
      is_new_viewer: false,
      unique_viewers: 1,
      total_visits: 2,
      viewer_visits: 2,
    });
    expect(await rowCount()).toBe(1);
    expect(await visitorNotifications()).toBe(1);

    const rows = await viewersAs(USER_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].view_count).toBe(2);
  });

  it('does not record or notify a member viewing their own profile', async () => {
    const result = await recordView(USER_A, USER_A);

    expect(result).toEqual({ recorded: false, reason: 'self_view' });
    expect(await rowCount()).toBe(0);
    expect(await visitorNotifications()).toBe(0);
  });

  it('ignores views between blocked members, in either direction', async () => {
    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_A}', '${USER_B}')`
    );

    const result = await recordView(USER_B, USER_A);
    expect(result).toEqual({ recorded: false, reason: 'blocked' });
    expect(await rowCount()).toBe(0);
    expect(await visitorNotifications()).toBe(0);
    expect((await summaryAs(USER_A)).unique_viewers).toBe(0);
  });

  it('excludes a viewer who was blocked after visiting from every aggregate', async () => {
    await recordView(USER_B, USER_A);
    await recordView(USER_C, USER_A);

    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_A}', '${USER_C}')`
    );

    const afterBlock = await recordView(USER_B, USER_A);
    expect(afterBlock.unique_viewers).toBe(1);
    expect(afterBlock.total_visits).toBe(2);

    const summary = await summaryAs(USER_A);
    expect(summary.unique_viewers).toBe(1);
    expect(summary.total_visits).toBe(2);

    const count = await queryAs<{ n: number }>(
      db,
      USER_A,
      `select public.profile_view_count('${USER_A}') as n`
    );
    expect(count[0].n).toBe(1);

    const viewers = await viewersAs(USER_A);
    expect(viewers.map((row) => row.viewer_id)).toEqual([USER_B]);
  });

  it('derives the summary from auth.uid() and counts unique vs returning', async () => {
    await recordView(USER_B, USER_A);
    await recordView(USER_B, USER_A);
    await recordView(USER_C, USER_A);

    const owner = await summaryAs(USER_A);
    expect(owner.unique_viewers).toBe(2);
    expect(owner.returning_viewers).toBe(1);
    expect(owner.total_visits).toBe(3);
    expect(owner.most_recent_at).not.toBeNull();

    // B has viewers of their own? No: nobody viewed B, and B cannot read A's
    // analytics because the function ignores any notion of a target owner.
    const nonOwner = await summaryAs(USER_B);
    expect(nonOwner).toEqual({
      unique_viewers: 0,
      returning_viewers: 0,
      total_visits: 0,
      most_recent_at: null,
    });
  });

  it('lists public viewer fields to the owner only', async () => {
    await recordView(USER_B, USER_A);

    const ownerRows = await viewersAs(USER_A);
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]).toMatchObject({
      viewer_id: USER_B,
      first_name: 'Bo',
      last_name: 'Brown',
      has_last_name: true,
      username: 'bo_brown',
      display_name: 'Bo Brown',
      view_count: 1,
      is_followed_by_me: false,
    });

    // The exact projection proves no private column (email, birth_date, phone…)
    // can ride along with a future edit.
    expect(Object.keys(ownerRows[0]).sort()).toEqual(VIEWER_KEYS);

    // A non-owner gets nothing: the function derives the owner from auth.uid().
    expect(await viewersAs(USER_B)).toHaveLength(0);
    expect(await viewersAs(USER_C)).toHaveLength(0);
  });

  it('searches names and usernames and treats LIKE wildcards literally', async () => {
    await recordView(USER_B, USER_A);
    await recordView(USER_C, USER_A);
    await recordView(USER_D, USER_A);

    expect((await viewersAs(USER_A, 30, 0, 'Bo')).map((row) => row.viewer_id)).toEqual([
      USER_B,
    ]);
    expect((await viewersAs(USER_A, 30, 0, 'cy')).map((row) => row.viewer_id)).toEqual([
      USER_C,
    ]);

    // "%" is literal: nobody's name contains it. "_" is literal too, so it
    // matches the two usernames that really contain an underscore and not Dee
    // (which a single-character wildcard would also have matched).
    expect(await viewersAs(USER_A, 30, 0, '%')).toHaveLength(0);
    expect((await viewersAs(USER_A, 30, 0, '_')).map((row) => row.viewer_id).sort()).toEqual(
      [USER_B, USER_C].sort()
    );
    expect((await viewersAs(USER_A, 30, 0, 'dee')).map((row) => row.viewer_id)).toEqual([
      USER_D,
    ]);
    expect(await viewersAs(USER_A, 30, 0, 'nobody')).toHaveLength(0);
  });

  it('paginates distinct viewers without duplicates', async () => {
    await recordView(USER_B, USER_A);
    await recordView(USER_C, USER_A);
    await recordView(USER_D, USER_A);

    const pageOne = await viewersAs(USER_A, 2, 0);
    const pageTwo = await viewersAs(USER_A, 2, 2);

    expect(pageOne).toHaveLength(2);
    expect(pageTwo).toHaveLength(1);

    const ids = [...pageOne, ...pageTwo].map((row) => row.viewer_id).sort();
    expect(ids).toEqual([USER_B, USER_C, USER_D].sort());
  });

  it('reports whether the owner already follows each viewer', async () => {
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}', '${USER_B}')`
      )
    );
    await recordView(USER_B, USER_A);

    const rows = await viewersAs(USER_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_followed_by_me).toBe(true);
  });

  it('exposes the aggregate count to any member but never an identity', async () => {
    await recordView(USER_B, USER_A);

    const asOwner = await queryAs<{ n: number }>(
      db,
      USER_A,
      `select public.profile_view_count('${USER_A}') as n`
    );
    const asStranger = await queryAs<{ n: number }>(
      db,
      USER_C,
      `select public.profile_view_count('${USER_A}') as n`
    );

    expect(asOwner[0].n).toBe(1);
    expect(asStranger[0].n).toBe(1);
  });

  it('denies anon the table and every RPC', async () => {
    await recordView(USER_B, USER_A);

    const tablePrivileges = await db.query<{
      anon_select: boolean;
      authenticated_select: boolean;
    }>(`
      select has_table_privilege('anon', 'public.profile_viewers', 'select') as anon_select,
             has_table_privilege('authenticated', 'public.profile_viewers', 'select') as authenticated_select
    `);
    expect(tablePrivileges.rows[0]).toEqual({
      anon_select: false,
      authenticated_select: false,
    });

    const anonCalls = [
      `select public.profile_view_count('${USER_A}')`,
      `select public.record_profile_view('${USER_A}')`,
      `select public.profile_view_summary()`,
      `select * from public.list_profile_viewers(30, 0, null)`,
      `select * from public.profile_viewers`,
    ];

    for (const sql of anonCalls) {
      expect(
        await (async () => {
          try {
            await asAnon(db, () => db.exec(sql));
            return false;
          } catch {
            return true;
          }
        })()
      ).toBe(true);
    }

    // Authenticated members may call the RPCs but still cannot read the table
    // directly: the SECURITY DEFINER functions are the only path in.
    expect(
      await isRejected(db, USER_A, `select * from public.profile_viewers`)
    ).toBe(true);
  });
});
