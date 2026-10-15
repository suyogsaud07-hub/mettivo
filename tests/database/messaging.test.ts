import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  anonReadCount,
  asAnon,
  asUser,
  createTestDb,
  scalarAs,
  seed,
} from './harness';

/**
 * M11 — real-time one-to-one messaging.
 *
 * The security assertions here are the important ones. The M6 RLS baseline
 * installed `auth.uid() is not null` as the SELECT policy on `messages`, so
 * every signed-in member could read every private conversation; the M6 tests
 * only checked ANONYMOUS access and could not see it. These tests check the
 * case that was missing: a member authenticated as somebody else.
 */

describe('M11 — messaging privacy and unread state', () => {
  let db: PGlite;
  let matchAb = '';
  let matchCd = '';

  /** Mutually matches two members and returns the match id. */
  async function pair(a: string, b: string): Promise<string> {
    await asUser(db, a, () => db.query(`select public.record_like('${b}'::uuid, true)`));
    await asUser(db, b, () => db.query(`select public.record_like('${a}'::uuid, true)`));
    const result = await db.query<{ id: string }>(
      `select id from public.matches
        where user_a = least('${a}'::uuid,'${b}'::uuid)
          and user_b = greatest('${a}'::uuid,'${b}'::uuid)`
    );
    return result.rows[0]?.id ?? '';
  }

  beforeAll(async () => {
    db = await createTestDb();
    matchAb = await pair(USER_A, USER_B);
    matchCd = await pair(USER_C, USER_D);

    // A real conversation in each pair.
    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchAb}','${USER_A}','hi B')`
      )
    );
    await asUser(db, USER_D, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchCd}','${USER_D}','private to CD')`
      )
    );
  });

  it('never lets an uninvolved member read a conversation', async () => {
    // C is a legitimate signed-in member, just not part of the A-B thread.
    const leaked = await scalarAs(
      db,
      USER_C,
      `select count(*)::int as n from public.messages where match_id = '${matchAb}'`
    );
    expect(leaked, 'USER_C must not read the A-B conversation').toBe(0);

    // ...and symmetrically.
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.messages where match_id = '${matchCd}'`
      )
    ).toBe(0);
  });

  it('lets participants read their own conversation', async () => {
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.messages where match_id = '${matchAb}'`
      )
    ).toBe(1);
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.messages where match_id = '${matchAb}'`
      )
    ).toBe(1);
  });

  it('reads zero messages as an anonymous caller', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.messages`)).toBe(0);
  });

  it('refuses to write into a conversation the sender is not part of', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchAb}','${USER_C}','butting in')`
        )
      )
    ).rejects.toThrow(/not part of this conversation/i);
  });

  it('refuses to forge a message as another member', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.exec(
          `insert into public.messages (match_id, sender_id, content)
           values ('${matchCd}','${USER_A}','forged')`
        )
      )
    ).rejects.toThrow();
  });

  it('keeps the follow graph out of every member’s reach', async () => {
    await seed(
      db,
      `insert into public.follows (follower_id, following_id)
       values ('${USER_A}','${USER_B}') on conflict do nothing`
    );

    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.follows
          where follower_id = '${USER_A}' and following_id = '${USER_B}'`
      ),
      'the follower sees their own edge'
    ).toBe(1);

    expect(
      await scalarAs(
        db,
        USER_C,
        `select count(*)::int as n from public.follows
          where follower_id = '${USER_A}' and following_id = '${USER_B}'`
      ),
      'an uninvolved member must not see the edge'
    ).toBe(0);
  });

  it('counts unread messages only for the recipient', async () => {
    const unreadFor = async (userId: string, matchId: string) => {
      const rows = await asUser(db, userId, async () => {
        const r = await db.query<{ match_id: string; unread: number }>(
          `select match_id, unread from public.unread_counts()`
        );
        return r.rows;
      });
      return rows.find((row) => row.match_id === matchId)?.unread ?? 0;
    };

    // A sent the only message in A-B, so B has one unread and A has none.
    expect(await unreadFor(USER_B, matchAb)).toBe(1);
    expect(await unreadFor(USER_A, matchAb)).toBe(0);

    // A member sees counts only for their own conversations.
    const cRows = await asUser(db, USER_C, async () => {
      const r = await db.query<{ match_id: string }>(`select match_id from public.unread_counts()`);
      return r.rows.map((row) => row.match_id);
    });
    expect(cRows).not.toContain(matchAb);
    expect(cRows).toContain(matchCd);
  });

  it('clears the badge with mark_conversation_read, and refuses non-participants', async () => {
    const ts = await asUser(db, USER_B, async () => {
      const r = await db.query<{ ts: string }>(
        `select public.mark_conversation_read('${matchAb}'::uuid) as ts`
      );
      return r.rows[0].ts;
    });
    expect(ts).toBeTruthy();

    const unread = await asUser(db, USER_B, async () => {
      const r = await db.query<{ unread: number }>(
        `select unread from public.unread_counts() where match_id = '${matchAb}'::uuid`
      );
      return r.rows[0]?.unread ?? -1;
    });
    expect(unread).toBe(0);

    // C is not in the A-B conversation.
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.mark_conversation_read('${matchAb}'::uuid)`)
      )
    ).rejects.toThrow(/not a participant/i);
  });

  it('keeps read state owner-scoped', async () => {
    // B marked A-B read; A must not be able to read B's read-state row.
    expect(
      await scalarAs(
        db,
        USER_A,
        `select count(*)::int as n from public.match_read_state where user_id = '${USER_B}'`
      )
    ).toBe(0);
    expect(
      await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.match_read_state where user_id = '${USER_B}'`
      )
    ).toBeGreaterThan(0);
  });

  it('refuses the messaging RPCs to anonymous callers', async () => {
    await expect(
      asAnon(db, () => db.query(`select public.mark_conversation_read('${matchAb}'::uuid)`))
    ).rejects.toThrow();
    await expect(asAnon(db, () => db.query(`select * from public.unread_counts()`))).rejects.toThrow();
  });
});
