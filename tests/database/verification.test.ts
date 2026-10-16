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
  isRejected,
  queryAs,
  scalarAs,
  seed,
  systemicCount,
  writeEffect,
} from './harness';

/**
 * M24 — authenticity verification and strict photo onboarding.
 *
 * Proven from the database, because the browser is never trusted:
 *
 *   * a member can read only their own verification row,
 *   * a member cannot write a verification at all (only the hidden RPC can),
 *   * the RPCs refuse without the server secret,
 *   * a member cannot verify somebody else,
 *   * `onboarding_completed = true` on the member's OWN write is REFUSED until
 *     face + voice + (>=4 gallery, >=1 avatar) photo checks are all complete,
 *   * the avatar and every gallery photo being saved must themselves have passed,
 *   * operator/backfill writes (no session) and pre-existing onboarded members
 *     are unaffected.
 */

const SECRET = 'verification-test-secret';

const FACE_REF = 'data:image/jpeg;base64,AAA-selfie';
const GALLERY = [1, 2, 3, 4].map((n) => `data:image/jpeg;base64,gallery-${n}`);
const AVATAR = 'data:image/jpeg;base64,avatar-1';

/** Records a face pass for `user` through the secret-gated RPC. */
function recordFace(db: PGlite, user: string, passed = true) {
  return asUser(db, user, () =>
    db.query(
      `select public.record_verification('${SECRET}', '${user}'::uuid, 'face', ${passed}, 'Woman', 'openai-compatible', 'gpt-4o-mini', 0.99, '${FACE_REF}', null)`
    )
  );
}

function recordVoice(db: PGlite, user: string, passed = true) {
  return asUser(db, user, () =>
    db.query(
      `select public.record_verification('${SECRET}', '${user}'::uuid, 'voice', ${passed}, null, null, null, null, null, 190.5)`
    )
  );
}

function recordPhoto(
  db: PGlite,
  user: string,
  url: string,
  role: 'gallery' | 'avatar',
  passed = true
) {
  return asUser(db, user, () =>
    db.query(
      `select public.record_photo_check(
         p_secret => '${SECRET}', p_user_id => '${user}'::uuid, p_photo_url => '${url}',
         p_role => '${role}', p_human => true, p_gender_match => true, p_passed => ${passed},
         p_provider => 'openai-compatible', p_model => 'gpt-4o-mini', p_score => 0.97,
         p_reasons => '[]'::jsonb)`
    )
  );
}

/** Runs face + voice + four gallery + one avatar checks for `user`. */
async function fullyVerify(db: PGlite, user: string) {
  await recordFace(db, user);
  await recordVoice(db, user);
  for (const url of GALLERY) await recordPhoto(db, user, url, 'gallery');
  await recordPhoto(db, user, AVATAR, 'avatar');
}

describe('M24 — verification records are private and read-only to members', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.moderation_secrets set worker_secret = '${SECRET}'`);
  });

  it('creates both tables', async () => {
    const rows = await db.query<{ n: number }>(`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public'
        and table_name in ('profile_verifications','profile_photo_checks')
    `);
    expect(rows.rows[0]?.n).toBe(2);
  });

  it('lets no anonymous caller read a verification row', async () => {
    await fullyVerify(db, USER_A);
    expect(
      await anonReadCount(db, `select count(*)::int as n from public.profile_verifications`)
    ).toBe(0);
    expect(
      await anonReadCount(db, `select count(*)::int as n from public.profile_photo_checks`)
    ).toBe(0);
  });

  it('lets a member read only their own verification row', async () => {
    // USER_A has one; USER_B must see zero rows.
    expect(
      await scalarAs(db, USER_A, `select count(*)::int as n from public.profile_verifications`)
    ).toBe(1);
    expect(
      await scalarAs(db, USER_B, `select count(*)::int as n from public.profile_verifications`)
    ).toBe(0);
  });

  it('refuses a member writing their own verification directly', async () => {
    const changed = await writeEffect(
      db,
      USER_B,
      `insert into public.profile_verifications (user_id, face_verified) values ('${USER_B}', true)`
    );
    expect(changed).toBe(0);
  });

  it('refuses a member awarding themselves a photo check directly', async () => {
    const changed = await writeEffect(
      db,
      USER_B,
      `insert into public.profile_photo_checks (user_id, photo_hash, role) values ('${USER_B}', 'deadbeef', 'avatar')`
    );
    expect(changed).toBe(0);
  });
});

describe('M24 — the secret-gated RPCs', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.moderation_secrets set worker_secret = '${SECRET}'`);
  });

  it('refuses without the shared secret', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(
          `select public.record_verification('wrong', '${USER_A}'::uuid, 'face', true)`
        )
      )
    ).rejects.toThrow();
  });

  it('refuses to verify another member', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(
          `select public.record_verification('${SECRET}', '${USER_B}'::uuid, 'face', true, 'Woman', null, null, null, '${FACE_REF}', null)`
        )
      )
    ).rejects.toThrow();
  });

  it('records a face pass and clears it on a later failure', async () => {
    await recordFace(db, USER_A, true);
    let state = await queryAs<{ face_verified: boolean }>(
      db,
      USER_A,
      `select face_verified from public.profile_verifications where user_id = '${USER_A}'`
    );
    expect(state[0]?.face_verified).toBe(true);

    await recordFace(db, USER_A, false);
    state = await queryAs<{ face_verified: boolean }>(
      db,
      USER_A,
      `select face_verified from public.profile_verifications where user_id = '${USER_A}'`
    );
    expect(state[0]?.face_verified).toBe(false);
  });

  it('only marks photo_verified once 4 gallery and 1 avatar have passed', async () => {
    await fullyVerify(db, USER_B);
    // Drop one gallery pass and re-run the others: still incomplete.
    await recordPhoto(db, USER_B, GALLERY[0], 'gallery', false);
    const photos = await queryAs<{ photo_verified: boolean }>(
      db,
      USER_B,
      `select photo_verified from public.profile_verifications where user_id = '${USER_B}'`
    );
    expect(photos[0]?.photo_verified).toBe(false);

    await recordPhoto(db, USER_B, GALLERY[0], 'gallery', true);
    const again = await queryAs<{ photo_verified: boolean }>(
      db,
      USER_B,
      `select photo_verified from public.profile_verifications where user_id = '${USER_B}'`
    );
    expect(again[0]?.photo_verified).toBe(true);
  });
});

describe('M24 — onboarding cannot be published unverified', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.moderation_secrets set worker_secret = '${SECRET}'`);
  });

  it('refuses the member flipping onboarding_completed with no verification', async () => {
    const rejected = await isRejected(
      db,
      USER_A,
      `update public.profiles set onboarding_completed = true where id = '${USER_A}'`
    );
    expect(rejected).toBe(true);
  });

  it('still refuses while only face and voice are done', async () => {
    await recordFace(db, USER_A);
    await recordVoice(db, USER_A);
    const rejected = await isRejected(
      db,
      USER_A,
      `update public.profiles set onboarding_completed = true where id = '${USER_A}'`
    );
    expect(rejected).toBe(true);
  });

  it('refuses when a saved gallery photo was never checked', async () => {
    await fullyVerify(db, USER_A);
    // Save an extra, unchecked photo alongside the four verified ones.
    const unchecked = `data:image/jpeg;base64,${GALLERY[0]}` + ',unchecked';
    const rejected = await isRejected(
      db,
      USER_A,
      `update public.profiles
          set onboarding_completed = true,
              avatar_url = '${AVATAR}',
              photos = array['${GALLERY[0]}','${GALLERY[1]}','${GALLERY[2]}','${unchecked}']
        where id = '${USER_A}'`
    );
    expect(rejected).toBe(true);
  });

  it('allows publishing once verification is complete and every photo passed', async () => {
    await asUser(db, USER_A, () =>
      db.exec(
        `update public.profiles
            set onboarding_completed = true,
                avatar_url = '${AVATAR}',
                photos = array['${GALLERY[0]}','${GALLERY[1]}','${GALLERY[2]}','${GALLERY[3]}']
          where id = '${USER_A}'`
      )
    );

    const done = await systemicCount(
      db,
      `select count(*)::int as n from public.profiles where id = '${USER_A}' and onboarding_completed`
    );
    expect(done).toBe(1);

    const verified = await systemicCount(
      db,
      `select count(*)::int as n from public.profiles where id = '${USER_A}' and is_verified`
    );
    expect(verified).toBe(1);
  });

  it('does not disturb an operator/backfill write with no session', async () => {
    // USER_C has no verification; a backend write may still complete onboarding.
    await seed(
      db,
      `update public.profiles set onboarding_completed = true where id = '${USER_C}'`
    );
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.profiles where id = '${USER_C}' and onboarding_completed`
      )
    ).toBe(1);
  });

  it('lets an already-onboarded member keep editing without re-verifying', async () => {
    // USER_C is now onboarding_completed = true with no verification at all.
    // A subsequent member edit that re-sends the flag must not be blocked.
    await asUser(db, USER_C, () =>
      db.exec(
        `update public.profiles set onboarding_completed = true, bio = 'hello' where id = '${USER_C}'`
      )
    );
    expect(
      await systemicCount(
        db,
        `select count(*)::int as n from public.profiles where id = '${USER_C}' and bio = 'hello'`
      )
    ).toBe(1);
  });
});

describe('M24 — get_my_verification', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
    await seed(db, `update public.moderation_secrets set worker_secret = '${SECRET}'`);
  });

  it('reports the member’s own status and never someone else’s', async () => {
    await fullyVerify(db, USER_D);
    const mine = await queryAs<{ status: { complete: boolean } }>(
      db,
      USER_D,
      `select public.get_my_verification() as status`
    );
    expect(mine[0]?.status.complete).toBe(true);

    const theirs = await queryAs<{ status: { complete: boolean } }>(
      db,
      USER_A,
      `select public.get_my_verification() as status`
    );
    expect(theirs[0]?.status.complete).toBe(false);
  });
});
