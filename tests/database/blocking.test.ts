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
  scalarAs,
  seed,
} from './harness';

/**
 * M12 — server-side blocking and unmatching.
 *
 * The product claim is "blocking works". These tests prove it adversarially,
 * from the database's point of view, because the browser is not trusted and
 * there is no application server:
 *
 *   * a block severs the pair in BOTH directions,
 *   * `record_like` refuses,
 *   * message delivery refuses,
 *   * discovery never returns either member to the other,
 *   * the block graph itself is not world-readable,
 *   * unblocking restores contact; unmatching clears both decisions.
 *
 * RLS denies by filtering rows, so read assertions count rows rather than
 * expecting an exception. Blocked INSERTs are the exception and do raise.
 */

describe('M12 — server-side blocking and unmatching', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();

    // Discovery only returns members who finished onboarding.
    await seed(
      db,
      `update public.profiles
          set onboarding_completed = true,
              age = 25,
              is_online = true
        where id in ('${USER_A}','${USER_B}','${USER_C}','${USER_D}')`
    );
    await seed(
      db,
      `update public.profiles set gender = 'Woman' where id = '${USER_A}'`
    );
    await seed(
      db,
      `update public.profiles set gender = 'Woman' where id = '${USER_C}'`
    );
    await seed(
      db,
      `update public.profiles set gender = 'Man' where id in ('${USER_B}','${USER_D}')`
    );
  });

  /** Makes A and B mutually matched (reciprocal follow) and returns the match id. */
  async function createMatch(): Promise<string> {
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_A}','${USER_B}') on conflict do nothing`
      )
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_B}','${USER_A}') on conflict do nothing`
      )
    );
    const result = await db.query<{ id: string }>(
      `select id from public.matches
        where user_a = least('${USER_A}'::uuid,'${USER_B}'::uuid)
          and user_b = greatest('${USER_A}'::uuid,'${USER_B}'::uuid)`
    );
    return result.rows[0]?.id ?? '';
  }

  it('reports a block symmetrically', async () => {
    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_D}'::uuid)`));

    const forward = await asUser(db, USER_A, () =>
      db.query<{ blocked: boolean }>(
        `select public.is_blocked_pair('${USER_A}'::uuid,'${USER_D}'::uuid) as blocked`
      )
    );
    const reverse = await asUser(db, USER_D, () =>
      db.query<{ blocked: boolean }>(
        `select public.is_blocked_pair('${USER_D}'::uuid,'${USER_A}'::uuid) as blocked`
      )
    );

    expect(forward.rows[0].blocked).toBe(true);
    expect(reverse.rows[0].blocked).toBe(true);
  });

  it('lets only an involved member read a block row', async () => {
    // Who has blocked whom is a social graph, not public data. The M6 baseline
    // expression (`auth.uid() is not null`) exposed every row to every member.
    const involved = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.blocked_users
        where blocker_id = '${USER_A}' and blocked_user_id = '${USER_D}'`
    );
    const uninvolved = await scalarAs(
      db,
      USER_C,
      `select count(*)::int as n from public.blocked_users
        where blocker_id = '${USER_A}' and blocked_user_id = '${USER_D}'`
    );

    expect(involved).toBe(1);
    expect(uninvolved).toBe(0);
  });

  it('refuses a like in both directions once blocked', async () => {
    await expect(
      asUser(db, USER_A, () => db.query(`select public.record_like('${USER_D}'::uuid, true)`))
    ).rejects.toThrow(/cannot interact/i);

    await expect(
      asUser(db, USER_D, () => db.query(`select public.record_like('${USER_A}'::uuid, true)`))
    ).rejects.toThrow(/cannot interact/i);
  });

  it('severs an existing match and both decisions when blocking', async () => {
    const matchId = await createMatch();
    expect(matchId).not.toBe('');

    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_B}'::uuid)`));

    const remaining = await db.query<{ n: number }>(
      `select count(*)::int as n from public.matches
        where user_a = least('${USER_A}'::uuid,'${USER_B}'::uuid)
          and user_b = greatest('${USER_A}'::uuid,'${USER_B}'::uuid)`
    );
    const decisions = await db.query<{ n: number }>(
      `select count(*)::int as n from public.likes
        where (liker_id = '${USER_A}' and liked_id = '${USER_B}')
           or (liker_id = '${USER_B}' and liked_id = '${USER_A}')`
    );

    expect(remaining.rows[0].n).toBe(0);
    expect(decisions.rows[0].n).toBe(0);
  });

  it('refuses message delivery to a blocked pair', async () => {
    // Build a match, then insert the block directly so the match row survives,
    // isolating the message trigger from block_member's cleanup.
    await asUser(db, USER_C, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_C}','${USER_B}') on conflict do nothing`
      )
    );
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${USER_B}','${USER_C}') on conflict do nothing`
      )
    );

    const result = await db.query<{ id: string }>(
      `select id from public.matches
        where user_a = least('${USER_C}'::uuid,'${USER_B}'::uuid)
          and user_b = greatest('${USER_C}'::uuid,'${USER_B}'::uuid)`
    );
    const matchId = result.rows[0].id;

    await seed(
      db,
      `insert into public.blocked_users (blocker_id, blocked_user_id)
       values ('${USER_B}','${USER_C}') on conflict do nothing`
    );

    await expect(
      asUser(db, USER_C, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchId}','${USER_C}','hello?')`
        )
      )
    ).rejects.toThrow(/cannot message this member/i);

    // The other direction is severed too.
    await expect(
      asUser(db, USER_B, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchId}','${USER_B}','hi')`
        )
      )
    ).rejects.toThrow(/cannot message this member/i);
  });

  it('never returns a blocked, suspended, decided or matched member to discovery', async () => {
    // Clean slate: earlier cases left blocks and decisions behind.
    await seed(db, `delete from public.likes`);
    await seed(db, `delete from public.matches`);
    await seed(db, `delete from public.blocked_users`);

    const idsFor = async (userId: string) => {
      const rows = await asUser(db, userId, async () => {
        const r = await db.query<{ id: string }>(
          `select id from public.discover_profiles(18, 99, null, 50)`
        );
        return r.rows.map((row) => row.id);
      });
      return rows;
    };

    // Baseline: A does not see itself, and sees the other onboarded members.
    const baseline = await idsFor(USER_A);
    expect(baseline).not.toContain(USER_A);
    expect(baseline).toContain(USER_C);

    // Already decided (liked or passed) -> gone.
    await asUser(db, USER_A, () => db.query(`select public.record_like('${USER_C}'::uuid, false)`));
    expect(await idsFor(USER_A)).not.toContain(USER_C);

    // Matched -> gone from discovery.
    await seed(db, `delete from public.likes`);
    await createMatch(); // A <-> B
    expect(await idsFor(USER_A)).not.toContain(USER_B);

    // Suspended -> gone, and never returned to anyone.
    await seed(db, `delete from public.matches`);
    await seed(db, `delete from public.likes`);
    await seed(
      db,
      `update public.profiles
          set is_suspended = true, suspended_at = now()
        where id = '${USER_D}'`
    );
    expect(await idsFor(USER_A)).not.toContain(USER_D);

    // Blocked -> gone in both directions.
    await seed(db, `delete from public.blocked_users`);
    await seed(db, `update public.profiles set is_suspended = false where id = '${USER_D}'`);
    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_B}'::uuid)`));
    expect(await idsFor(USER_A)).not.toContain(USER_B);
    expect(await idsFor(USER_B)).not.toContain(USER_A);
  });

  it('restores contact after an unblock', async () => {
    await seed(db, `delete from public.blocked_users`);
    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_B}'::uuid)`));
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.blocked_users
        where blocker_id = '${USER_A}' and blocked_user_id = '${USER_B}'`)
    ).toBe(1);

    const unblocked = await asUser(db, USER_A, async () => {
      const r = await db.query<{ unblocked: boolean }>(
        `select (public.unblock_member('${USER_B}'::uuid) ->> 'unblocked')::boolean as unblocked`
      );
      return r.rows[0].unblocked;
    });
    expect(unblocked).toBe(true);
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.blocked_users
        where blocker_id = '${USER_A}' and blocked_user_id = '${USER_B}'`)
    ).toBe(0);

    // A can like again.
    await expect(
      asUser(db, USER_A, () => db.query(`select public.record_like('${USER_B}'::uuid, true)`))
    ).resolves.toBeDefined();
  });

  it('lets the blocked member unsubscribe but not the blocked one force contact', async () => {
    await seed(db, `delete from public.likes`);
    await seed(db, `delete from public.blocked_users`);

    // A blocks B.
    await asUser(db, USER_A, () => db.query(`select public.block_member('${USER_B}'::uuid)`));

    // B is blocked, not the blocker: their own unblock call must not remove A's block.
    const attempt = await asUser(db, USER_B, async () => {
      const r = await db.query<{ unblocked: boolean }>(
        `select (public.unblock_member('${USER_A}'::uuid) ->> 'unblocked')::boolean as unblocked`
      );
      return r.rows[0].unblocked;
    });
    expect(attempt).toBe(false);
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.blocked_users
        where blocker_id = '${USER_A}' and blocked_user_id = '${USER_B}'`)
    ).toBe(1);

    // A can still undo their own block.
    expect(
      await asUser(db, USER_A, async () => {
        const r = await db.query<{ unblocked: boolean }>(
          `select (public.unblock_member('${USER_B}'::uuid) ->> 'unblocked')::boolean as unblocked`
        );
        return r.rows[0].unblocked;
      })
    ).toBe(true);
  });

  it('clears the match and both decisions on unmatch, and is idempotent', async () => {
    await seed(db, `delete from public.likes`);
    await seed(db, `delete from public.matches`);
    await seed(db, `delete from public.blocked_users`);

    const matchId = await createMatch();
    expect(matchId).not.toBe('');

    const first = await asUser(db, USER_A, async () => {
      const r = await db.query<{ unmatched: boolean }>(
        `select (public.unmatch_member('${USER_B}'::uuid) ->> 'unmatched')::boolean as unmatched`
      );
      return r.rows[0].unmatched;
    });
    expect(first).toBe(true);

    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.likes
        where (liker_id = '${USER_A}' and liked_id = '${USER_B}')
           or (liker_id = '${USER_B}' and liked_id = '${USER_A}')`)
    ).toBe(0);

    // Calling it again is a no-op, not an error.
    const second = await asUser(db, USER_A, async () => {
      const r = await db.query<{ unmatched: boolean }>(
        `select (public.unmatch_member('${USER_B}'::uuid) ->> 'unmatched')::boolean as unmatched`
      );
      return r.rows[0].unmatched;
    });
    expect(second).toBe(false);
  });

  it('refuses every blocking RPC to an anonymous caller', async () => {
    for (const statement of [
      `select public.block_member('${USER_A}'::uuid)`,
      `select public.unblock_member('${USER_A}'::uuid)`,
      `select public.unmatch_member('${USER_A}'::uuid)`,
      `select public.is_blocked_pair('${USER_A}'::uuid,'${USER_B}'::uuid)`,
      `select * from public.discover_profiles()`,
    ]) {
      await expect(
        asAnon(db, () => db.query(statement)),
        `anon should not run: ${statement}`
      ).rejects.toThrow();
    }
  });
});
