import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  USER_A,
  USER_B,
  USER_C,
  affectedRows,
  createTestDb,
  isRejected,
  queryAs,
  seed,
} from './harness';

/**
 * The profile save path versus M15's column-level birth_date revoke.
 *
 * An `INSERT ... ON CONFLICT DO UPDATE` whose update list names `birth_date`
 * needs SELECT on that column, so it fails even for the owner. Update-or-insert
 * does not. This suite pins both halves of that contract so a future "simplify
 * it back to an upsert" cannot silently break onboarding again.
 */
describe('profile save — upsert permission boundary', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it('rejects the upsert shape that names birth_date', async () => {
    const rejected = await isRejected(
      db,
      USER_A,
      `insert into public.profiles (id, display_name, birth_date, religion)
       values ('${USER_A}', 'Ada', '1998-05-04', 'Hindu')
       on conflict (id) do update
         set display_name = excluded.display_name,
             birth_date   = excluded.birth_date,
             religion     = excluded.religion`
    );

    expect(rejected).toBe(true);
  });

  it('allows a plain owner update including birth_date and religion', async () => {
    const rows = await queryAs<{ id: string }>(
      db,
      USER_A,
      `update public.profiles
          set birth_date = '1998-05-04',
              religion   = 'Hindu'
        where id = '${USER_A}'
        returning id`
    );

    expect(rows).toHaveLength(1);

    const stored = await queryAs<{ religion: string | null }>(
      db,
      USER_A,
      `select religion from public.profiles where id = '${USER_A}'`
    );
    expect(stored[0]?.religion).toBe('Hindu');
  });

  it('allows a plain owner insert when the profile row does not exist yet', async () => {
    await seed(db, `delete from public.profiles where id = '${USER_C}'`);

    const rows = await queryAs<{ id: string }>(
      db,
      USER_C,
      `insert into public.profiles (id, display_name, birth_date, religion)
       values ('${USER_C}', 'Cy', '1996-02-03', 'Buddhist')
       returning id`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(USER_C);
  });

  it('still filters another member out of an owner-scoped update', async () => {
    const changed = await affectedRows(
      db,
      USER_A,
      `update public.profiles set religion = 'Atheist' where id = '${USER_B}'`
    );

    expect(changed).toBe(0);
  });
});
