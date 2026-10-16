import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  USER_D,
  anonReadCount,
  asUser,
  createTestDb,
  scalarAs,
} from './harness';

/**
 * M26 — delivery/seen receipts and 24-hour disappearing chats.
 *
 * Receipts are written only by SECURITY DEFINER functions that derive the
 * recipient from the match, so a member cannot acknowledge somebody else's
 * messages. The disappearing window is enforced by the `messages` SELECT policy
 * (which Realtime honours too) and by a purge function; `now()` decides, not the
 * client's clock.
 */

describe('M26 — receipts and disappearing chats', () => {
  let db: PGlite;
  let matchAb = '';
  let matchCd = '';

  async function pair(a: string, b: string): Promise<string> {
    await asUser(db, a, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${a}','${b}') on conflict do nothing`
      )
    );
    await asUser(db, b, () =>
      db.exec(
        `insert into public.follows (follower_id, following_id)
         values ('${b}','${a}') on conflict do nothing`
      )
    );
    const result = await db.query<{ id: string }>(
      `select id from public.matches
        where user_a = least('${a}'::uuid,'${b}'::uuid)
          and user_b = greatest('${a}'::uuid,'${b}'::uuid)`
    );
    return result.rows[0]?.id ?? '';
  }

  const messageId = (matchId: string, content: string) =>
    db
      .query<{ id: string }>(
        `select id from public.messages where match_id = '${matchId}' and content = '${content}'`
      )
      .then((res) => res.rows[0]?.id ?? '');

  beforeAll(async () => {
    db = await createTestDb();
    matchAb = await pair(USER_A, USER_B);
    matchCd = await pair(USER_C, USER_D);

    await asUser(db, USER_A, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchAb}','${USER_A}','from A to B')`
      )
    );
  });

  it('stamps delivery on received messages only', async () => {
    const id = await messageId(matchAb, 'from A to B');

    // The sender acknowledging their own thread changes nothing.
    const senderAck = await asUser(db, USER_A, () =>
      db
        .query<{ n: number }>(
          `select public.mark_messages_delivered('${matchAb}'::uuid) as n`
        )
        .then((res) => res.rows[0].n)
    );
    expect(senderAck).toBe(0);

    // The recipient's acknowledgement lands on A's message.
    const recipientAck = await asUser(db, USER_B, () =>
      db
        .query<{ n: number }>(
          `select public.mark_messages_delivered('${matchAb}'::uuid) as n`
        )
        .then((res) => res.rows[0].n)
    );
    expect(recipientAck).toBe(1);

    const row = await db.query<{ delivered_at: string | null; seen_at: string | null }>(
      `select delivered_at, seen_at from public.messages where id = '${id}'`
    );
    expect(row.rows[0].delivered_at).toBeTruthy();
    expect(row.rows[0].seen_at).toBeNull();
  });

  it('stamps seen when the thread is read, and never on the reader own message', async () => {
    const incoming = await messageId(matchAb, 'from A to B');

    await asUser(db, USER_B, () =>
      db.query(`select public.mark_conversation_read('${matchAb}'::uuid)`)
    );

    const seen = await db.query<{ delivered_at: string | null; seen_at: string | null }>(
      `select delivered_at, seen_at from public.messages where id = '${incoming}'`
    );
    expect(seen.rows[0].seen_at).toBeTruthy();
    expect(seen.rows[0].delivered_at).toBeTruthy();

    // A message B itself sent is not marked seen by B's own read.
    await asUser(db, USER_B, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchAb}','${USER_B}','from B to A')`
      )
    );
    const outgoing = await messageId(matchAb, 'from B to A');
    await asUser(db, USER_B, () =>
      db.query(`select public.mark_conversation_read('${matchAb}'::uuid)`)
    );
    const own = await db.query<{ seen_at: string | null }>(
      `select seen_at from public.messages where id = '${outgoing}'`
    );
    expect(own.rows[0].seen_at).toBeNull();
  });

  it('refuses to acknowledge a conversation you are not in', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.mark_messages_delivered('${matchAb}'::uuid)`)
      )
    ).rejects.toThrow(/not a participant/i);

    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.mark_conversation_read('${matchAb}'::uuid)`)
      )
    ).rejects.toThrow(/not a participant/i);
  });

  it('keeps the disappearing setting private to the two participants', async () => {
    const result = await asUser(db, USER_A, () =>
      db
        .query<{ r: { disappear_after_seconds: number | null } }>(
          `select public.set_disappearing_messages('${matchAb}'::uuid, 86400) as r`
        )
        .then((res) => res.rows[0].r)
    );
    expect(result.disappear_after_seconds).toBe(86400);

    const own = await scalarAs(
      db,
      USER_B,
      `select count(*)::int as n from public.chat_settings where match_id = '${matchAb}'`
    );
    const stranger = await scalarAs(
      db,
      USER_C,
      `select count(*)::int as n from public.chat_settings where match_id = '${matchAb}'`
    );
    const anon = await anonReadCount(db, `select count(*)::int as n from public.chat_settings`);
    expect(own).toBe(1);
    expect(stranger).toBe(0);
    expect(anon).toBe(0);

    // Only a participant may change it.
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.set_disappearing_messages('${matchAb}'::uuid, 60)`)
      )
    ).rejects.toThrow(/not a participant/i);

    // Turning it back off stores null.
    const off = await asUser(db, USER_A, () =>
      db
        .query<{ r: { disappear_after_seconds: number | null } }>(
          `select public.set_disappearing_messages('${matchAb}'::uuid, 0) as r`
        )
        .then((res) => res.rows[0].r)
    );
    expect(off.disappear_after_seconds).toBeNull();
  });

  it('hides messages past the window from RLS reads and purges them', async () => {
    // A dedicated conversation so other fixtures never interfere.
    await asUser(db, USER_C, () =>
      db.query(`select public.set_disappearing_messages('${matchCd}'::uuid, 60)`)
    );

    await asUser(db, USER_C, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content, created_at)
         values ('${matchCd}','${USER_C}','old and gone', now() - interval '5 minutes')`
      )
    );
    await asUser(db, USER_C, () =>
      db.exec(
        `insert into public.messages (match_id, sender_id, content)
         values ('${matchCd}','${USER_C}','still here')`
      )
    );

    // The recipient sees only the fresh message: RLS filters the expired one.
    const visible = await scalarAs(
      db,
      USER_D,
      `select count(*)::int as n from public.messages
        where match_id = '${matchCd}' and content = 'old and gone'`
    );
    const fresh = await scalarAs(
      db,
      USER_D,
      `select count(*)::int as n from public.messages
        where match_id = '${matchCd}' and content = 'still here'`
    );
    expect(visible).toBe(0);
    expect(fresh).toBe(1);

    // Purge removes the aged-out row for good.
    const removed = await asUser(db, USER_D, () =>
      db
        .query<{ n: number }>(`select public.purge_expired_chat_content() as n`)
        .then((res) => res.rows[0].n)
    );
    expect(removed).toBeGreaterThanOrEqual(1);

    const gone = await db.query<{ n: number }>(
      `select count(*)::int as n from public.messages where content = 'old and gone'`
    );
    expect(gone.rows[0].n).toBe(0);
  });
});
