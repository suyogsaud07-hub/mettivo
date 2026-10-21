import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { USER_A, USER_B, asAnon, asUser, createTestDb } from './harness';

describe('elite profile identity', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('normalizes the split identity and derives display_name', async () => {
    await db.exec(`
      update public.profiles
      set first_name = '  Sujata ',
          last_name = ' Saud ',
          has_last_name = true,
          username = ' @Sujata_1 '
      where id = '${USER_A}'
    `);

    const result = await db.query<{
      first_name: string;
      last_name: string;
      username: string;
      display_name: string;
    }>(
      `select first_name, last_name, username, display_name
       from public.profiles where id = '${USER_A}'`
    );

    expect(result.rows[0]).toEqual({
      first_name: 'Sujata',
      last_name: 'Saud',
      username: 'sujata_1',
      display_name: 'Sujata Saud',
    });
  });

  it('drops the last name when the member says they do not have one', async () => {
    await db.exec(`
      update public.profiles
      set has_last_name = false, last_name = 'Still Here'
      where id = '${USER_A}'
    `);

    const result = await db.query<{ last_name: string | null; display_name: string }>(
      `select last_name, display_name from public.profiles where id = '${USER_A}'`
    );
    expect(result.rows[0]).toEqual({ last_name: null, display_name: 'Sujata' });
  });

  it('refuses has_last_name=true with no last name', async () => {
    await expect(
      db.exec(`
        update public.profiles
        set has_last_name = true, last_name = null
        where id = '${USER_A}'
      `)
    ).rejects.toThrow(/profiles_last_name_required/);
  });

  it('enforces username uniqueness case-insensitively', async () => {
    await expect(
      db.exec(`
        update public.profiles
        set username = 'SUJATA_1'
        where id = '${USER_B}'
      `)
    ).rejects.toThrow(/profiles_username_unique/);
  });

  it('refuses spaces, dots, hyphens and handles outside the length bounds', async () => {
    for (const username of ['bad name', 'bad.name', 'bad-name', 'ab', 'a'.repeat(31)]) {
      await expect(
        db.exec(`
          update public.profiles
          set username = '${username}'
          where id = '${USER_B}'
        `),
        username
      ).rejects.toThrow(/profiles_username_shape/);
    }
  });

  it('answers availability without exposing a profile row', async () => {
    const taken = await asUser(db, USER_B, async () => {
      const result = await db.query<{ available: boolean }>(
        `select public.check_username_available('@Sujata_1') as available`
      );
      return result.rows[0].available;
    });
    const free = await asUser(db, USER_B, async () => {
      const result = await db.query<{ available: boolean }>(
        `select public.check_username_available('brand_new') as available`
      );
      return result.rows[0].available;
    });
    const own = await asUser(db, USER_A, async () => {
      const result = await db.query<{ available: boolean }>(
        `select public.check_username_available('@SUJATA_1') as available`
      );
      return result.rows[0].available;
    });

    expect(taken).toBe(false);
    expect(free).toBe(true);
    expect(own).toBe(true);
  });

  it('does not let an anonymous caller use the availability oracle', async () => {
    await expect(
      asAnon(db, async () =>
        db.query(`select public.check_username_available('brand_new') as available`)
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('publishes identity and MBTI, never Politics or legacy personality', async () => {
    const result = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'public_profiles'
    `);
    const columns = result.rows.map((row) => row.column_name);

    expect(columns).toEqual(
      expect.arrayContaining([
        'first_name',
        'last_name',
        'has_last_name',
        'username',
        'mbti',
      ])
    );
    expect(columns).not.toContain('politics');
    expect(columns).not.toContain('personality');
  });
});
