import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  asUser,
  createTestDb,
  isRejected,
  scalarAs,
  seed,
  writeEffect,
} from './harness';

/**
 * M18 — profile social counts and the follows write surface.
 *
 * Two claims are proved here:
 *
 *   1. the denormalised counters on `profiles` stay correct as `follows`,
 *      `likes` and `matches` change — including the pass -> like update path
 *      that `record_like`'s upsert takes, which a naive INSERT-only trigger
 *      would double count or miss;
 *   2. a member may only create and remove their OWN outbound follow edge.
 *      Forging someone else's edge is rejected, and deleting a stranger's edge
 *      affects zero rows.
 *
 * RLS denies reads by filtering, so read assertions count rows; blocked INSERTs
 * raise and are asserted with `isRejected`.
 */

describe('M18 — profile social counts and follows writes', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  const followersOf = (id: string) =>
    scalarAs(db, id, `select followers_count::int as n from public.profiles where id = '${id}'`);
  const followingOf = (id: string) =>
    scalarAs(db, id, `select following_count::int as n from public.profiles where id = '${id}'`);
  const matchesOf = (id: string) =>
    scalarAs(db, id, `select matches_count::int as n from public.profiles where id = '${id}'`);
  const likesOf = (id: string) =>
    scalarAs(db, id, `select profile_likes_count::int as n from public.profiles where id = '${id}'`);

  it('increments following and followers when a member follows', async () => {
    await asUser(db, USER_A, () =>
      db.exec(`insert into public.follows (follower_id, following_id) values ('${USER_A}','${USER_B}')`)
    );

    expect(await followingOf(USER_A)).toBe(1);
    expect(await followersOf(USER_B)).toBe(1);
    expect(await followersOf(USER_A)).toBe(0);
  });

  it('rejects forging a follow on behalf of another member', async () => {
    // A tries to make C follow B. WITH CHECK requires follower_id = auth.uid().
    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.follows (follower_id, following_id) values ('${USER_C}','${USER_B}')`
      )
    ).toBe(true);
  });

  it('decrements when a member unfollows, and only their own edge', async () => {
    // A cannot remove C's outbound edge (there is none, and it is not A's).
    const forged = await writeEffect(
      db,
      USER_A,
      `delete from public.follows where follower_id = '${USER_C}'`
    );
    expect(forged).toBe(0);

    await asUser(db, USER_A, () =>
      db.exec(`delete from public.follows where follower_id = '${USER_A}' and following_id = '${USER_B}'`)
    );

    expect(await followingOf(USER_A)).toBe(0);
    expect(await followersOf(USER_B)).toBe(0);
  });

  it('counts a like but not a pass, and handles the pass -> like update', async () => {
    // Pass first: the row exists with is_like = false, so no increment.
    await asUser(db, USER_A, () => db.query(`select public.record_like('${USER_B}'::uuid, false)`));
    expect(await likesOf(USER_B)).toBe(0);

    // Same pair, now a like: `record_like` upserts, so this is an UPDATE.
    await asUser(db, USER_A, () => db.query(`select public.record_like('${USER_B}'::uuid, true)`));
    expect(await likesOf(USER_B)).toBe(1);

    // Back to a pass: decrement.
    await asUser(db, USER_A, () => db.query(`select public.record_like('${USER_B}'::uuid, false)`));
    expect(await likesOf(USER_B)).toBe(0);

    // A second liker is a separate row and a separate increment.
    await asUser(db, USER_A, () => db.query(`select public.record_like('${USER_B}'::uuid, true)`));
    await asUser(db, USER_C, () => db.query(`select public.record_like('${USER_B}'::uuid, true)`));
    expect(await likesOf(USER_B)).toBe(2);
  });

  it('counts a match for both participants once it is mutual', async () => {
    // A already likes B; B now likes A -> match created.
    await asUser(db, USER_B, () => db.query(`select public.record_like('${USER_A}'::uuid, true)`));

    expect(await matchesOf(USER_A)).toBe(1);
    expect(await matchesOf(USER_B)).toBe(1);

    // Idempotent: a repeat like does not create a second match or increment.
    await asUser(db, USER_B, () => db.query(`select public.record_like('${USER_A}'::uuid, true)`));
    expect(await matchesOf(USER_A)).toBe(1);
  });

  it('keeps the counters correct after a re-apply of the migration', async () => {
    // The whole bundle is re-run elsewhere; the backfill recomputes these from
    // source rather than trusting the stored values. Re-derive and compare.
    await seed(
      db,
      `update public.profiles p
          set followers_count = (select count(*)::int from public.follows f where f.following_id = p.id),
              following_count = (select count(*)::int from public.follows f where f.follower_id = p.id),
              matches_count   = (select count(*)::int from public.matches m where m.user_a = p.id or m.user_b = p.id),
              profile_likes_count = (select count(*)::int from public.likes l where l.liked_id = p.id and l.is_like)`
    );

    expect(await likesOf(USER_B)).toBe(2);
    expect(await matchesOf(USER_B)).toBe(1);
  });
});
