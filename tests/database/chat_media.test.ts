import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  asUser,
  createTestDb,
  scalarAs,
} from './harness';

/**
 * M25/M26 — disappearing chat media.
 *
 * The bytes live in a private Storage bucket, so the security boundary is the
 * `chat_media` ledger plus the `chat_media_can_read_storage()` predicate the
 * bucket policy calls. These tests assert the DATABASE decides who may read,
 * when a 2-view item is exhausted, and when expiry kills it — regardless of what
 * the client claims.
 */

describe('M25/M26 — disappearing chat media', () => {
  let db: PGlite;
  let matchAb = '';

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

  const path = (p: string) => `${matchAb}/${p}`;

  const send = (
    sender: string,
    storagePath: string,
    viewLimit = 2,
    ttl = 86400
  ) =>
    asUser(db, sender, () =>
      db
        .query<{ r: { media_id: string; message_id: string; expires_at: string } }>(
          `select public.send_chat_media(
             p_match_id     => '${matchAb}'::uuid,
             p_storage_path => '${storagePath}',
             p_media_type   => 'image',
             p_view_limit   => ${viewLimit},
             p_ttl_seconds  => ${ttl}
           ) as r`
        )
        .then((res) => res.rows[0].r)
    );

  const canRead = (viewer: string | null, storagePath: string) =>
    asUser(db, viewer ?? USER_A, () =>
      db
        .query<{ r: boolean }>(
          `select public.chat_media_can_read_storage('${storagePath}') as r`
        )
        .then((res) => res.rows[0].r)
    );

  beforeAll(async () => {
    db = await createTestDb();
    matchAb = await pair(USER_A, USER_B);
  });

  it('writes a message row and a ledger row for the sender', async () => {
    const result = await send(USER_A, path(`${USER_A}/one.jpg`), 2);
    expect(result.media_id).toBeTruthy();
    expect(result.message_id).toBeTruthy();

    const rows = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.chat_media where message_id = '${result.message_id}'`
    );
    expect(rows).toBe(1);
  });

  it('refuses a non-participant and a paused account', async () => {
    await expect(
      asUser(db, USER_C, () =>
        db.query(
          `select public.send_chat_media(
             p_match_id => '${matchAb}'::uuid,
             p_storage_path => '${USER_C}/x.jpg'
           )`
        )
      )
    ).rejects.toThrow(/not part of this conversation/i);

    // Pause USER_A, then try to send.
    await db.exec(
      `insert into public.suspensions (user_id, category, ends_at)
       values ('${USER_A}','abuse_text', now() + interval '7 days')`
    );
    await expect(send(USER_A, path(`${USER_A}/blocked.jpg`), 2)).rejects.toThrow(
      /paused|suspended/i
    );
    await db.exec(`delete from public.suspensions where user_id = '${USER_A}'`);
  });

  it('lets only the two participants read the ledger', async () => {
    const sent = await send(USER_A, path(`${USER_A}/private.jpg`), 2);
    const own = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.chat_media where id = '${sent.media_id}'`
    );
    const peer = await scalarAs(
      db,
      USER_B,
      `select count(*)::int as n from public.chat_media where id = '${sent.media_id}'`
    );
    const stranger = await scalarAs(
      db,
      USER_C,
      `select count(*)::int as n from public.chat_media where id = '${sent.media_id}'`
    );
    expect(own).toBe(1);
    expect(peer).toBe(1);
    expect(stranger).toBe(0);

    // The storage predicate agrees: sender and recipient yes, stranger no.
    expect(await canRead(USER_A, path(`${USER_A}/private.jpg`))).toBe(true);
    expect(await canRead(USER_B, path(`${USER_A}/private.jpg`))).toBe(true);
    expect(await canRead(USER_C, path(`${USER_A}/private.jpg`))).toBe(false);
  });

  it('counts two recipient views and then exhausts the item', async () => {
    const sent = await send(USER_A, path(`${USER_A}/burn.jpg`), 2);

    const redeem = (viewer: string) =>
      asUser(db, viewer, () =>
        db
          .query<{ r: { available: boolean; storage_path: string; remaining: number } }>(
            `select public.redeem_chat_media('${sent.media_id}'::uuid) as r`
          )
          .then((res) => res.rows[0].r)
      );

    const first = await redeem(USER_B);
    expect(first.available).toBe(true);
    expect(first.storage_path).toBe(path(`${USER_A}/burn.jpg`));
    expect(first.remaining).toBe(1);

    // Still readable after the first view.
    expect(await canRead(USER_B, path(`${USER_A}/burn.jpg`))).toBe(true);

    const second = await redeem(USER_B);
    expect(second.available).toBe(true);
    expect(second.remaining).toBe(0);

    const row = await db.query<{ view_count: number; viewed_at: string | null }>(
      `select view_count, viewed_at from public.chat_media where id = '${sent.media_id}'`
    );
    expect(row.rows[0].view_count).toBe(2);
    expect(row.rows[0].viewed_at).toBeTruthy();

    // The third open is refused and the object is no longer readable once the
    // 2-minute download grace window (which starts at `viewed_at`) has passed.
    const third = await redeem(USER_B);
    expect(third.available).toBe(false);

    await db.exec(
      `update public.chat_media set viewed_at = now() - interval '3 minutes' where id = '${sent.media_id}'`
    );
    expect(await canRead(USER_B, path(`${USER_A}/burn.jpg`))).toBe(false);

    // The sender never spends their own item's views.
    const senderView = await send(USER_A, path(`${USER_A}/keep.jpg`), 2);
    await redeem(USER_A);
    const senderRow = await db.query<{ view_count: number; viewed_at: string | null }>(
      `select view_count, viewed_at from public.chat_media where id = '${senderView.media_id}'`
    );
    expect(senderRow.rows[0].view_count).toBe(0);
    expect(senderRow.rows[0].viewed_at).toBeNull();
  });

  it('makes an expired item unavailable and unreadable', async () => {
    const sent = await send(USER_A, path(`${USER_A}/old.jpg`), 2, 60);
    await db.exec(
      `update public.chat_media set expires_at = now() - interval '1 minute' where id = '${sent.media_id}'`
    );

    const redeem = await asUser(db, USER_B, () =>
      db
        .query<{ r: { available: boolean; reason: string } }>(
          `select public.redeem_chat_media('${sent.media_id}'::uuid) as r`
        )
        .then((res) => res.rows[0].r)
    );
    expect(redeem.available).toBe(false);
    expect(redeem.reason).toBe('expired');

    expect(await canRead(USER_B, path(`${USER_A}/old.jpg`))).toBe(false);
  });

  it('refuses to redeem media from a conversation you are not in', async () => {
    const sent = await send(USER_A, path(`${USER_A}/nope.jpg`), 2);
    await expect(
      asUser(db, USER_C, () =>
        db.query(`select public.redeem_chat_media('${sent.media_id}'::uuid)`)
      )
    ).rejects.toThrow(/not part of this conversation/i);
  });
});
