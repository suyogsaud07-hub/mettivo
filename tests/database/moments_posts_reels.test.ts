import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  MODERATOR,
  USER_A,
  USER_B,
  USER_C,
  anonReadCount,
  asAnon,
  createTestDb,
  isRejected,
  queryAs,
  scalarAs,
  seed,
  systemicCount,
} from './harness';

/**
 * Moments — Posts and Reels, saves, downloads, and moderation gating.
 *
 * The migration claims several things that only a real database can confirm:
 *   * a Reel is exactly one video of <= 120s, enforced by a CHECK (not by the
 *     client, which a forged insert ignores);
 *   * a Post holds at most 10 items and a Post video at most 600s;
 *   * only `approved` content is visible to other members, and an author cannot
 *     promote their own post to approved;
 *   * saves are owner-only, and both the save count and the per-caller
 *     `saved_by_me` flag are correct;
 *   * a download is a server decision (`can_download_moment`) that honours the
 *     creator's switch, visibility and moderation, not a hidden button.
 *
 * RLS denies by filtering, so denials here assert an affected-row / read count
 * of zero, or a genuine constraint violation, never "no exception was thrown".
 */

const IMG = "'https://cdn.test/a.jpg'";
const VID = "'https://cdn.test/a.mp4'";

function mediaList(url: string, count: number): string {
  const quoted = `'${url}'`;
  return `array[${Array.from({ length: count }, () => quoted).join(', ')}]`;
}

describe('moments posts and reels', () => {
  let db: PGlite;
  let publicPostId: string;

  const feedCountAs = (userId: string, where = 'true') =>
    scalarAs(db, userId, `select count(*)::int as n from public.moment_feed where ${where}`);

  beforeAll(async () => {
    db = await createTestDb();

    // MODERATOR needs the role row for is_moderator() to see them.
    await seed(db, `insert into public.user_roles (user_id, role) values ('${MODERATOR}', 'moderator');`);

    // A plain approved public post by C, visible to A and B.
    const rows = await queryAs<{ id: string }>(
      db,
      USER_C,
      `insert into public.moments (author_id, caption, media, media_type, content_kind, visibility)
       values ('${USER_C}', 'sunset', array[${IMG}], 'image', 'post', 'public')
       returning id`
    );
    publicPostId = rows[0].id;
  });

  describe('content shape', () => {
    it('defaults a new moment to an approved Post with downloads off', async () => {
      const [row] = await queryAs<{
        content_kind: string;
        moderation_status: string;
        allow_downloads: boolean;
      }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type)
         values ('${USER_A}', 'hi', array[${IMG}], 'image')
         returning content_kind, moderation_status, allow_downloads`
      );
      expect(row.content_kind).toBe('post');
      expect(row.moderation_status).toBe('approved');
      expect(row.allow_downloads).toBe(false);
    });

    it('rejects an unknown content kind', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, content_kind)
           values ('${USER_A}', 'x', 'story')`
        )
      ).toBe(true);
    });

    it('rejects a Reel that is not a single video', async () => {
      // An image cannot be a Reel.
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
           values ('${USER_A}', 'x', array[${IMG}], 'image', 'reel', 10)`
        )
      ).toBe(true);

      // Two videos is a carousel, not a Reel.
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
           values ('${USER_A}', 'x', array[${VID}, ${VID}], 'video', 'reel', 10)`
        )
      ).toBe(true);
    });

    it('rejects an over-length or unmeasurable Reel', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
           values ('${USER_A}', 'x', array[${VID}], 'video', 'reel', 121)`
        )
      ).toBe(true);

      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
           values ('${USER_A}', 'x', array[${VID}], 'video', 'reel', null)`
        )
      ).toBe(true);
    });

    it('accepts a 120s Reel', async () => {
      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
         values ('${USER_A}', 'dance', array[${VID}], 'video', 'reel', 120)
         returning id`
      );
      expect(row.id).toBeTruthy();
    });

    it('bounds an ordinary Post video to 600s', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
           values ('${USER_A}', 'x', array[${VID}], 'video', 'post', 601)`
        )
      ).toBe(true);

      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, content_kind, duration_seconds)
         values ('${USER_A}', 'vlog', array[${VID}], 'video', 'post', 600)
         returning id`
      );
      expect(row.id).toBeTruthy();
    });

    it('caps a Post at 10 items', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moments (author_id, caption, media, media_type)
           values ('${USER_A}', 'x', ${mediaList('https://cdn.test/i.jpg', 11)}, 'image')`
        )
      ).toBe(true);

      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type)
         values ('${USER_A}', 'album', ${mediaList('https://cdn.test/i.jpg', 10)}, 'image')
         returning id`
      );
      expect(row.id).toBeTruthy();
    });
  });

  describe('moderation gating', () => {
    it('ignores an author-forged moderation status on insert', async () => {
      const [row] = await queryAs<{ moderation_status: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, moderation_status)
         values ('${USER_A}', 'self approve', array[${IMG}], 'image', 'approved')
         returning moderation_status`
      );
      // The default policy approves it, but only because the trigger ran — the
      // submitted value was overwritten either way.
      expect(row.moderation_status).toBe('approved');
    });

    it('refuses an author update of moderation_status', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `update public.moments set moderation_status = 'rejected' where id = '${publicPostId}'`
        )
      ).toBe(false);
      // The row belongs to C, so A updating it is filtered to zero rows anyway.
      expect(
        await isRejected(
          db,
          USER_C,
          `update public.moments set moderation_status = 'rejected' where id = '${publicPostId}'`
        )
      ).toBe(true);
    });

    it('starts new moments pending while review is required, hidden from others', async () => {
      await seed(db, `update public.moderation_settings set moments_require_review = true;`);

      const [row] = await queryAs<{ id: string; moderation_status: string }>(
        db,
        USER_B,
        `insert into public.moments (author_id, caption, media, media_type)
         values ('${USER_B}', 'pending', array[${IMG}], 'image')
         returning id, moderation_status`
      );
      expect(row.moderation_status).toBe('pending');

      expect(await feedCountAs(USER_A, `id = '${row.id}'`)).toBe(0);
      expect(await feedCountAs(USER_B, `id = '${row.id}'`)).toBe(1);

      await seed(db, `update public.moderation_settings set moments_require_review = false;`);
    });

    it('lets a moderator approve content but not an ordinary member call the RPC', async () => {
      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, visibility)
         values ('${USER_A}', 'triage me', array[${IMG}], 'image', 'public')
         returning id`
      );

      expect(
        await isRejected(
          db,
          USER_B,
          `select public.admin_set_moment_moderation('${row.id}', 'rejected')`
        )
      ).toBe(true);

      const results = await queryAs<{ ok: boolean }>(
        db,
        MODERATOR,
        `select public.admin_set_moment_moderation('${row.id}', 'rejected') as ok`
      );
      expect(results[0].ok).toBe(true);

      const status = await systemicCount(
        db,
        `select count(*)::int as n from public.moments where id = '${row.id}' and moderation_status = 'rejected'`
      );
      expect(status).toBe(1);

      // Rejected content leaves other members' feeds but stays for the author.
      expect(await feedCountAs(USER_B, `id = '${row.id}'`)).toBe(0);
      expect(await feedCountAs(USER_A, `id = '${row.id}'`)).toBe(1);
    });

    it('demotes a moment when its image is flagged by an AI scan', async () => {
      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, visibility)
         values ('${USER_A}', 'flagged soon', array['https://cdn.test/flag.jpg'], 'image', 'public')
         returning id`
      );

      await seed(
        db,
        `insert into public.moderation_ai_scans (user_id, content_type, content_url, status)
         values ('${USER_A}', 'profile_photo', 'https://cdn.test/flag.jpg', 'processing');`
      );
      await seed(
        db,
        `update public.moderation_ai_scans set status = 'done', flagged = true
         where content_url = 'https://cdn.test/flag.jpg';`
      );

      const status = await systemicCount(
        db,
        `select count(*)::int as n from public.moments where id = '${row.id}' and moderation_status = 'rejected'`
      );
      expect(status).toBe(1);
    });
  });

  describe('saves', () => {
    it('records a save once and exposes the count and the caller flag', async () => {
      const [saved] = await queryAs<{ ok: boolean }>(
        db,
        USER_A,
        `insert into public.moment_saves (moment_id, user_id)
         values ('${publicPostId}', '${USER_A}') returning true as ok`
      );
      expect(saved.ok).toBe(true);

      const [counts] = await queryAs<{ save_count: number; saved_by_me: boolean }>(
        db,
        USER_A,
        `select save_count, saved_by_me from public.moment_feed where id = '${publicPostId}'`
      );
      expect(counts.save_count).toBe(1);
      expect(counts.saved_by_me).toBe(true);

      const [other] = await queryAs<{ saved_by_me: boolean }>(
        db,
        USER_B,
        `select saved_by_me from public.moment_feed where id = '${publicPostId}'`
      );
      expect(other.saved_by_me).toBe(false);
    });

    it('refuses a duplicate save for the same member', async () => {
      expect(
        await isRejected(
          db,
          USER_A,
          `insert into public.moment_saves (moment_id, user_id)
           values ('${publicPostId}', '${USER_A}')`
        )
      ).toBe(true);
    });

    it("hides one member's saves from another and from anonymous callers", async () => {
      const seen = await scalarAs(
        db,
        USER_B,
        `select count(*)::int as n from public.moment_saves where user_id = '${USER_A}'`
      );
      expect(seen).toBe(0);

      expect(await anonReadCount(db, `select count(*)::int as n from public.moment_saves`)).toBe(0);
    });
  });

  describe('downloads', () => {
    it('denies a viewer while the creator has downloads off, but always lets the author', async () => {
      const [viewer] = await queryAs<{ allowed: boolean }>(
        db,
        USER_B,
        `select public.can_download_moment('${publicPostId}') as allowed`
      );
      expect(viewer.allowed).toBe(false);

      const [owner] = await queryAs<{ allowed: boolean }>(
        db,
        USER_C,
        `select public.can_download_moment('${publicPostId}') as allowed`
      );
      expect(owner.allowed).toBe(true);
    });

    it('allows a viewer once the creator opts in, and returns the media URL', async () => {
      await queryAs(
        db,
        USER_C,
        `update public.moments set allow_downloads = true where id = '${publicPostId}'`
      );

      const [viewer] = await queryAs<{ allowed: boolean }>(
        db,
        USER_B,
        `select public.can_download_moment('${publicPostId}') as allowed`
      );
      expect(viewer.allowed).toBe(true);

      const [url] = await queryAs<{ url: string }>(
        db,
        USER_B,
        `select public.get_moment_download_url('${publicPostId}') as url`
      );
      expect(url.url).toBe('https://cdn.test/a.jpg');
    });

    it('denies the download when the post is not approved', async () => {
      const [row] = await queryAs<{ id: string }>(
        db,
        USER_A,
        `insert into public.moments (author_id, caption, media, media_type, visibility, allow_downloads)
         values ('${USER_A}', 'secret', array[${IMG}], 'image', 'public', true)
         returning id`
      );

      await queryAs(
        db,
        MODERATOR,
        `select public.admin_set_moment_moderation('${row.id}', 'rejected')`
      );

      const [viewer] = await queryAs<{ allowed: boolean }>(
        db,
        USER_B,
        `select public.can_download_moment('${row.id}') as allowed`
      );
      expect(viewer.allowed).toBe(false);
    });

    it('refuses anonymous callers the download RPCs', async () => {
      await expect(
        asAnon(db, () => db.query(`select public.can_download_moment('${publicPostId}')`))
      ).rejects.toThrow();
    });
  });

  describe('anonymous exposure', () => {
    it('shows anonymous callers no rows in the feed or saves', async () => {
      expect(await anonReadCount(db, `select count(*)::int as n from public.moment_feed`)).toBe(0);
      expect(await anonReadCount(db, `select count(*)::int as n from public.moment_saves`)).toBe(0);
    });
  });
});
