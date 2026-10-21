import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asAnon, asUser, createTestDb, seed } from './harness';

/**
 * `profiles` is read through column-level SELECT grants, not a table-wide one.
 *
 * M15 (20261015260000) revoked the table-wide SELECT and re-granted only the
 * columns that existed at that moment, so a column added by a LATER migration is
 * unreadable to `authenticated` until it is granted explicitly. The elite
 * identity migration (20261015430000) added `first_name`, `last_name`,
 * `has_last_name` and `username` without that grant, so the dashboard's explicit
 * allow-list (`PROFILE_CORE_COLUMNS` in
 * `src/app/profile/dashboard/page.tsx`) failed with
 * `42501 permission denied for table profiles` on every load.
 *
 * These tests exercise the reads as the `authenticated` role, which is what the
 * browser actually sends. Earlier identity tests read as the table owner and so
 * never crossed this boundary.
 */
describe('profiles column-level SELECT privileges', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
    await seed(
      db,
      `update public.profiles
         set first_name = 'Ada', last_name = 'Lovelace',
             has_last_name = true, username = 'ada'
       where id = '${USER_A}'`
    );
  });

  it('lets a member read the split identity columns of another member', async () => {
    const rows = await asUser(db, USER_B, async () => {
      const result = await db.query<{
        first_name: string | null;
        last_name: string | null;
        has_last_name: boolean;
        username: string | null;
      }>(
        `select first_name, last_name, has_last_name, username
           from public.profiles where id = '${USER_A}'`
      );
      return result.rows;
    });

    expect(rows).toEqual([
      {
        first_name: 'Ada',
        last_name: 'Lovelace',
        has_last_name: true,
        username: 'ada',
      },
    ]);
  });

  it('lets a member read every column in the dashboard core allow-list', async () => {
    // Mirrors PROFILE_CORE_COLUMNS in src/app/profile/dashboard/page.tsx. If a
    // column here is not granted, the whole dashboard load 42501s.
    const rows = await asUser(db, USER_A, async () => {
      const result = await db.query(
        `select id, first_name, last_name, has_last_name, username, display_name,
                age, gender, city, country, avatar_url, photos, bio, intention,
                looking_for, hobbies, pets, mbti, religion, drinking, smoking
           from public.profiles where id = '${USER_A}'`
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });

  it('granted the elite identity columns to authenticated, not to anon', async () => {
    const result = await db.query<{ grantee: string; column_name: string }>(`
      select grantee, column_name
      from information_schema.column_privileges
      where table_schema = 'public'
        and table_name = 'profiles'
        and privilege_type = 'SELECT'
        and column_name in ('first_name', 'last_name', 'has_last_name', 'username')
      order by grantee, column_name
    `);

    const grants = result.rows.map((row) => `${row.grantee}:${row.column_name}`);
    expect(grants).toContain('authenticated:first_name');
    expect(grants).toContain('authenticated:last_name');
    expect(grants).toContain('authenticated:has_last_name');
    expect(grants).toContain('authenticated:username');
    expect(grants.some((grant) => grant.startsWith('anon:'))).toBe(false);
  });

  it('still refuses private columns, even for the member’s own row', async () => {
    await expect(
      asUser(db, USER_A, () =>
        db.query(`select birth_date from public.profiles where id = '${USER_A}'`)
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('still refuses an anonymous caller the identity columns', async () => {
    await expect(
      asAnon(db, () =>
        db.query(`select username from public.profiles where id = '${USER_A}'`)
      )
    ).rejects.toThrow(/permission denied/i);
  });
});
