-- =============================================================================
-- M6 · Step 2 of 3 — Ensure RLS is enabled on every personal-data table
-- =============================================================================
-- WHY: RLS must be ON for every table holding personal data. A table with RLS
-- disabled is fully exposed through the public anon key.
--
-- ---------------------------------------------------------------------------
-- IMPORTANT — why this file installs more than a SELECT policy
-- ---------------------------------------------------------------------------
-- The first version of this migration enabled RLS and, for any table with no
-- policies, installed a SELECT-ONLY baseline. That silently made `messages` and
-- `follows` READ-ONLY: with RLS on and no INSERT policy, PostgreSQL rejects every
-- insert, so the chat and follow features were dead on a fresh database. The
-- test suite (tests/database/migrations.test.ts) caught this.
--
-- A baseline now covers the operations each table actually needs, scoped to the
-- caller, and it is still only installed when a table has ZERO policies so that
-- no existing, deliberately-tuned policy is ever weakened.
--
-- `matches` is deliberately absent: it does not exist yet at this point in the
-- migration order, and the M10 migration installs its participant policy.
-- ---------------------------------------------------------------------------

do $$
declare
  spec           record;
  has_policies   boolean;
  rls_on         boolean;
begin
  for spec in
    select * from (values
      -- table,           select expression,                                              insert check,                delete using
      ('profiles',        'auth.uid() is not null',
                          'auth.uid() = id',
                          'auth.uid() = id'),
      ('messages',        'auth.uid() is not null',
                          'auth.uid() = sender_id',
                          null::text),
      ('follows',         'auth.uid() is not null',
                          'auth.uid() = follower_id',
                          'auth.uid() = follower_id'),
      ('blocked_users',   'auth.uid() is not null',
                          'auth.uid() = blocker_id',
                          'auth.uid() = blocker_id'),
      ('reports',         'auth.uid() = reporter_id or auth.uid() = reported_user_id',
                          'auth.uid() = reporter_id',
                          null::text)
    ) as t(tbl, select_expr, insert_expr, delete_expr)
  loop
    -- Skip tables that do not exist yet.
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = spec.tbl and c.relkind = 'r'
    ) then
      raise notice 'M6: public.% does not exist yet - skipped', spec.tbl;
      continue;
    end if;

    -- Already-enabled RLS is fine; this only ever turns it on.
    select c.relrowsecurity into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = spec.tbl;

    if rls_on is distinct from true then
      execute format('alter table public.%I enable row level security', spec.tbl);
      raise notice 'M6: RLS ENABLED on public.%', spec.tbl;
    end if;

    select count(*) > 0 into has_policies
    from pg_policies
    where schemaname = 'public' and tablename = spec.tbl;

    if has_policies then
      raise notice 'M6: public.% already has policies - left untouched', spec.tbl;
      continue;
    end if;

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      spec.tbl || '_select_authenticated', spec.tbl, spec.select_expr
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      spec.tbl || '_insert_own', spec.tbl, spec.insert_expr
    );

    if spec.delete_expr is not null then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (%s)',
        spec.tbl || '_delete_own', spec.tbl, spec.delete_expr
      );
    end if;

    raise notice 'M6: installed baseline policies on public.% (had none)', spec.tbl;
  end loop;
end $$;

-- Report the resulting posture so the SQL editor output doubles as evidence.
select
  c.relname                              as table_name,
  c.relrowsecurity                       as rls_enabled,
  count(p.policyname)                    as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
       on p.schemaname = 'public'
      and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','messages','follows','matches','reports','blocked_users')
group by c.relname, c.relrowsecurity
order by c.relname;
