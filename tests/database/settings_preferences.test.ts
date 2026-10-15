import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  anonReadCount,
  createTestDb,
  isRejected,
  queryAs,
  scalarAs,
  writeEffect,
} from './harness';

/**
 * M20 — the storage behind Settings: notification preferences, privacy
 * controls, and the closed set of profile visibilities.
 *
 * The properties under test are the ones the client cannot be trusted with:
 *   1. the column defaults match `DEFAULT_*_PREFERENCES` in `src/lib/settings.ts`,
 *   2. `profile_visibility` only accepts the three documented values,
 *   3. a member can read and write their own row and no one else's, and
 *   4. an anonymous caller reads zero rows.
 */

interface PrefRow {
  notify_new_matches: boolean;
  notify_messages: boolean;
  notify_likes: boolean;
  notify_moments: boolean;
  notify_push: boolean;
  notify_email: boolean;
  show_online_status: boolean;
  hide_distance: boolean;
  profile_visibility: string;
}

const SELECT_ALL = `
  select notify_new_matches, notify_messages, notify_likes, notify_moments,
         notify_push, notify_email, show_online_status, hide_distance,
         profile_visibility
  from public.user_preferences
`;

describe('settings preferences (M20)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('gives a member the documented defaults', async () => {
    const rows = await queryAs<PrefRow>(db, USER_A, `${SELECT_ALL} where user_id = '${USER_A}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      notify_new_matches: true,
      notify_messages: true,
      notify_likes: true,
      notify_moments: true,
      notify_push: true,
      notify_email: false,
      show_online_status: true,
      hide_distance: false,
      profile_visibility: 'public',
    });
  });

  it('rejects a visibility outside the closed set', async () => {
    expect(
      await isRejected(
        db,
        USER_A,
        `update public.user_preferences set profile_visibility = 'friends' where user_id = '${USER_A}'`
      )
    ).toBe(true);
  });

  it('accepts each documented visibility and lets the member write their own row', async () => {
    const changed = await writeEffect(
      db,
      USER_A,
      `update public.user_preferences
         set profile_visibility = 'matches', hide_distance = true, notify_email = true
       where user_id = '${USER_A}'`
    );
    expect(changed).toBe(1);

    const rows = await queryAs<PrefRow>(db, USER_A, `${SELECT_ALL} where user_id = '${USER_A}'`);
    expect(rows[0].profile_visibility).toBe('matches');
    expect(rows[0].hide_distance).toBe(true);
    expect(rows[0].notify_email).toBe(true);
  });

  it('does not let a member read another member’s preferences', async () => {
    const count = await scalarAs(
      db,
      USER_A,
      `select count(*)::int as n from public.user_preferences where user_id = '${USER_B}'`
    );
    expect(count).toBe(0);
  });

  it('exposes no rows to an anonymous caller', async () => {
    const count = await anonReadCount(db, `select count(*)::int as n from public.user_preferences`);
    expect(count).toBe(0);
  });
});
