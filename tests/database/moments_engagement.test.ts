import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  anonReadCount,
  asAnon,
  createTestDb,
  isRejected,
  queryAs,
  scalarAs,
} from './harness';

/**
 * The Moments engagement upgrade: media typing and the view counters.
 *
 * Two properties matter and both are easy to get subtly wrong:
 *   1. `record_moment_view()` keeps the total and the unique-viewer count in
 *      step, and never counts the author's own view;
 *   2. neither the counter nor the `moment_views` rows are reachable by an
 *      anonymous caller, and a member cannot forge a different viewer.
 */

interface ViewCounts {
  views_count: number;
  unique_views: number;
}

describe('moments engagement', () => {
  let db: PGlite;
  let postId: string;

  const recordView = (userId: string) =>
    queryAs<ViewCounts>(
      db,
      userId,
      `select views_count, unique_views from public.record_moment_view('${postId}'::uuid)`
    );

  beforeAll(async () => {
    db = await createTestDb();
    const rows = await queryAs<{ id: string }>(
      db,
      USER_A,
      `insert into public.moments (author_id, caption, media_type)
       values ('${USER_A}', 'hello', 'image') returning id`
    );
    postId = rows[0].id;
  });

  it('rejects an unknown media type', async () => {
    expect(
      await isRejected(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media_type)
         values ('${USER_A}', 'x', 'audio')`
      )
    ).toBe(true);
  });

  it('never counts the author viewing their own moment', async () => {
    const [counts] = await recordView(USER_A);
    expect(counts.views_count).toBe(0);
    expect(counts.unique_views).toBe(0);
  });

  it('counts a view for another member and de-duplicates unique viewers', async () => {
    const [first] = await recordView(USER_B);
    expect(first.views_count).toBe(1);
    expect(first.unique_views).toBe(1);

    // B viewing again raises the total but not the unique count.
    const [second] = await recordView(USER_B);
    expect(second.views_count).toBe(2);
    expect(second.unique_views).toBe(1);

    const [third] = await recordView(USER_C);
    expect(third.views_count).toBe(3);
    expect(third.unique_views).toBe(2);
  });

  it('surfaces the totals on the feed view', async () => {
    const row = await scalarAs(
      db,
      USER_A,
      `select views_count as n from public.moment_feed where id = '${postId}'`
    );
    expect(row).toBe(3);

    const unique = await scalarAs(
      db,
      USER_A,
      `select unique_views as n from public.moment_feed where id = '${postId}'`
    );
    expect(unique).toBe(2);
  });

  it('hides the view ledger from anonymous callers', async () => {
    expect(await anonReadCount(db, `select count(*)::int as n from public.moment_views`)).toBe(0);
  });

  it('refuses to count a view for an anonymous caller', async () => {
    await expect(
      asAnon(db, () => db.query(`select * from public.record_moment_view('${postId}'::uuid)`))
    ).rejects.toThrow();
  });
});
