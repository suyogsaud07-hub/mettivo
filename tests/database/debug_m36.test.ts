import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBaseDb, applyMigrations, migrationFiles } from './harness';

it('debug m36', async () => {
  const db = await createBaseDb();
  await applyMigrations(db, migrationFiles().filter((f) => !f.includes('m36')));
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261015520000_m36_explore_more_discovery.sql'), 'utf8');
  const s5 = sql.indexOf('-- 5. Category acceptance');
  const s6 = sql.indexOf('-- 6. Counts');
  const s4 = sql.indexOf('-- 4. The single eligible set');
  const s5start = sql.lastIndexOf('-- ---------------------------------------------------------------------------', s5);
  const s6start = sql.lastIndexOf('-- ---------------------------------------------------------------------------', s6);
  const s4start = sql.lastIndexOf('-- ---------------------------------------------------------------------------', s4);
  await db.exec(sql.slice(0, s4start));
  const p1 = await db.query(`select to_regprocedure('public.explore_viewer_genders(uuid)') as f`);
  console.error('viewer', p1.rows);
  await db.exec(sql.slice(s4start, s5start));
  const p2 = await db.query(`select to_regprocedure('public.explore_eligible_profiles(integer,integer)') as f`);
  console.error('eligible', p2.rows);
  try { await db.exec(sql.slice(s5start, s6start)); } catch (e) { console.error('section5', String(e)); throw e; }
  const p3 = await db.query(`select to_regprocedure('public.explore_category_accepts(text,text[],text[],text[],text[])') as f`);
  console.error('accepts', p3.rows);
  const p4 = await db.query(`select proname, pg_get_function_identity_arguments(oid) as args from pg_proc where proname like 'explore_%' order by 1`);
  console.error('functions', p4.rows);
});
