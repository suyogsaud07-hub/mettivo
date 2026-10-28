import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  asUser,
  createTestDb,
  isRejected,
  queryAs,
  rowCount,
  scalarAs,
  systemicCount,
} from './harness';

/**
 * M23 — social graph matches and list privacy.
 *
 * The product rules under test, proven from the database because the browser is
 * never trusted:
 *
 *   * a match is a Woman/Female <-> Man/Male pair ONLY,
 *   * a reciprocal cross-gender follow forms the match,
 *   * a same-gender or one-way connection never does,
 *   * unfollowing tears the match back down,
 *   * messaging stays impossible without a match,
 *   * Followers are viewable by any member; Following is owner-only,
 *   * `notifications.body` is part of the guaranteed base shape.
 *
 * Fixture genders (from the harness): A = Woman, B = Man, C = Woman, D = Man.
 */

const follow = (db: PGlite, from: string, to: string) =>
  asUser(db, from, () =>
    db.exec(
      `insert into public.follows (follower_id, following_id)
       values ('${from}','${to}')`
    )
  );

describe('M23 — reciprocal cross-gender follow forms a match', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('creates no match on a one-way follow', async () => {
    await follow(db, USER_A, USER_B);
    expect(await rowCount(db, 'matches')).toBe(0);
  });

  it('creates the match when the follow is mirrored', async () => {
    await follow(db, USER_B, USER_A);
    expect(await rowCount(db, 'matches')).toBe(1);
  });

  it('increments matches_count for both members', async () => {
    const countFor = (id: string) =>
      systemicCount(db, `select matches_count::int as n from public.profiles where id = '${id}'`);
    expect(await countFor(USER_A)).toBe(1);
    expect(await countFor(USER_B)).toBe(1);
  });

  it('notifies both members of the new match', async () => {
    const types = (id: string) =>
      queryAs<{ type: string }>(
        db,
        id,
        `select type from public.notifications where type = 'match'`
      ).then((rows) => rows.map((row) => row.type));
    expect(await types(USER_A)).toContain('match');
    expect(await types(USER_B)).toContain('match');
  });

  it('removes the match again when one side unfollows', async () => {
    await asUser(db, USER_B, () =>
      db.exec(
        `delete from public.follows
          where follower_id = '${USER_B}' and following_id = '${USER_A}'`
      )
    );
    expect(await rowCount(db, 'matches')).toBe(0);
    expect(
      await systemicCount(db, `select matches_count::int as n from public.profiles where id = '${USER_A}'`)
    ).toBe(0);
  });

  it('does not create a match from a mutual like', async () => {
    // A and B are a cross-gender pair; a mutual like must still not match.
    await asUser(db, USER_A, () =>
      db.query(`select public.record_like('${USER_B}'::uuid, true)`)
    );
    await asUser(db, USER_B, () =>
      db.query(`select public.record_like('${USER_A}'::uuid, true)`)
    );
    expect(await rowCount(db, 'matches')).toBe(0);
  });
});

describe('M23 — same-gender pairs never match', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('creates a mutual-follow chat but never a romantic match', async () => {
    await follow(db, USER_A, USER_C); // Woman -> Woman
    await follow(db, USER_C, USER_A);
    const rows = await queryAs<{ kind: string }>(
      db,
      USER_A,
      `select kind from public.matches`
    );
    expect(rows).toEqual([{ kind: 'mutual_follow' }]);
  });

  it('refuses to match a mutual same-gender like', async () => {
    const like = (userId: string, target: string) =>
      asUser(db, userId, async () => {
        const result = await db.query<{
          out: { matched: boolean; match_id: string | null };
        }>(`select public.record_like('${target}'::uuid, true) as out`);
        return result.rows[0].out;
      });

    expect((await like(USER_A, USER_C)).matched).toBe(false);
    expect((await like(USER_C, USER_A)).matched).toBe(false);
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.matches where kind = 'match'`
      )
    ).toBe(0);
  });
});

describe('M23 — messaging requires a match', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('leaves no conversation to message on a one-way follow', async () => {
    await follow(db, USER_A, USER_B);
    expect(await rowCount(db, 'matches')).toBe(0);
    // No match means no conversation id exists for A to send to.
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.matches`)
    ).toBe(0);
  });

  it('opens a conversation once the follow is mutual', async () => {
    await follow(db, USER_B, USER_A);
    const result = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const matchId = result.rows[0].id;

    await expect(
      asUser(db, USER_A, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchId}','${USER_A}','hi')`
        )
      )
    ).resolves.toBeDefined();

    // The other member of the match can read it.
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.messages where match_id = '${matchId}'`
      )
    ).toBe(1);
  });

  it('stops an outsider writing to the matched pair’s conversation', async () => {
    const result = await db.query<{ id: string }>(`select id from public.matches limit 1`);
    const matchId = result.rows[0].id;
    expect(
      await isRejected(
        db,
        USER_D,
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchId}','${USER_D}','intruder')`
      )
    ).toBe(true);
  });
});

describe('M23 — follower and following list privacy', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await follow(db, USER_A, USER_B);
    await follow(db, USER_C, USER_B);
    await follow(db, USER_A, USER_C);
  });

  it('lets any member read a member’s followers', async () => {
    const rows = await queryAs<{ id: string }>(
      db,
      USER_D,
      `select id from public.list_followers('${USER_B}'::uuid) order by id`
    );
    expect(rows.map((row) => row.id).sort()).toEqual([USER_A, USER_C].sort());
  });

  it('marks which followers the caller already follows', async () => {
    const rows = await queryAs<{ id: string; is_followed_by_me: boolean }>(
      db,
      USER_A,
      `select id, is_followed_by_me from public.list_followers('${USER_B}'::uuid)`
    );
    const self = rows.find((row) => row.id === USER_A);
    const other = rows.find((row) => row.id === USER_C);
    expect(self?.is_followed_by_me).toBe(false); // A does not follow themself
    expect(other?.is_followed_by_me).toBe(true); // A follows C
  });

  it('refuses another member’s following list', async () => {
    expect(
      await isRejected(db, USER_D, `select * from public.list_following('${USER_B}'::uuid)`)
    ).toBe(true);
  });

  it('lets a member read their own following list', async () => {
    const rows = await queryAs<{ id: string }>(
      db,
      USER_B,
      `select id from public.list_following('${USER_B}'::uuid)`
    );
    expect(rows).toEqual([]); // B follows nobody
  });
});

describe('M23 — notifications shape', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('has a body column', async () => {
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public'
            and table_name = 'notifications'
            and column_name = 'body'`
      )
    ).toBe(1);
  });

  it('stores a follow notification the recipient can read', async () => {
    await follow(db, USER_A, USER_B);
    const rows = await queryAs<{ type: string; body: string | null }>(
      db,
      USER_B,
      `select type, body from public.notifications where actor_id = '${USER_A}'`
    );
    expect(rows.some((row) => row.type === 'follow')).toBe(true);
  });

  it('counts unread notifications per recipient', async () => {
    const unread = await scalarAs(
      db,
      USER_B,
      `select count(*)::int as n from public.notifications where read_at is null`
    );
    expect(unread).toBeGreaterThan(0);
  });
});
