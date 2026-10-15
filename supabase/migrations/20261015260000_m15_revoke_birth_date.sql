-- =============================================================================
-- M15 · Make profiles.birth_date unreadable (column-level privileges)
-- =============================================================================
-- WHY: `CONSTITUTION.md` Article 1.4 — never expose a date of birth. It enables
-- identity theft and is not needed to render a profile; the derived `age` is.
--
-- Today, RLS on `profiles` lets ANY signed-in member read ANY other member's
-- row (`auth.uid() is not null`). That is deliberate for discovery, which is
-- exactly why the protection for this one column has to be column-level.
--
-- ---------------------------------------------------------------------------
-- IMPORTANT — the obvious approach does not work
-- ---------------------------------------------------------------------------
-- M15 originally recorded this statement, commented out, as the fix:
--
--     revoke select (birth_date) on public.profiles from authenticated, anon;
--
-- That is a NO-OP here, and shipping it would have produced a security control
-- that silently protected nothing. Verified empirically against PostgreSQL:
--
--     create role app_user; create table t (a int, b int);
--     grant select on t to app_user;
--     revoke select (b) on t from app_user;
--     -- as app_user:  select b from t  ->  ALLOWED
--
-- A table-level SELECT grant covers every column, and a column-level REVOKE
-- cannot subtract from it. Supabase grants table-level SELECT to `anon` and
-- `authenticated` by default, so the situation above is exactly ours.
--
-- The working pattern is to drop the table-wide grant and re-grant the columns
-- that ARE allowed:
--
--     revoke select on public.profiles from anon, authenticated;
--     grant  select (<everything except birth_date>) on public.profiles to ...;
--
-- which is what this migration does. The column list is generated from the
-- catalogue rather than hard-coded, so a column added by a later migration is
-- readable by default instead of silently locking the app out of it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT BREAK
-- ---------------------------------------------------------------------------
--   * `public_profiles` — a view without `security_invoker`, so it reads with
--     the OWNER's rights and is unaffected by grants to anon/authenticated. It
--     never selected birth_date anyway.
--   * `export_my_data()`, `delete_my_account()`, `discover_profiles()`,
--     `admin_report_queue()`, `snapshot_report_evidence()` and every trigger —
--     all SECURITY DEFINER, so they keep owner rights.
--   * A member's own data export still contains their date of birth, as
--     data-subject rights require (`export_my_data`).
--
-- ---------------------------------------------------------------------------
-- CLIENT CONTRACT
-- ---------------------------------------------------------------------------
-- `select *` on `profiles` AS ANON OR AUTHENTICATED now FAILS. Every client read
-- must name its columns. The two surfaces that read the member's own row (the
-- wizard and the dashboard) use explicit allow-lists, and the wizard gets its
-- date of birth from `my_birth_date()` below.
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. my_birth_date() — the owner-only escape hatch
-- ---------------------------------------------------------------------------
-- The wizard must still prefill the member's own date of birth after the column
-- is revoked from every role. This returns exactly one value, for exactly the
-- caller, and accepts no user id — so it cannot be pointed at anybody else.
create or replace function public.my_birth_date()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.birth_date
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.my_birth_date() from public, anon;
grant execute on function public.my_birth_date() to authenticated;

comment on function public.my_birth_date() is
  'The caller''s own date of birth only. Exists because profiles.birth_date is revoked at the column level for every role; derives identity from auth.uid() and accepts no user id.';

-- ---------------------------------------------------------------------------
-- 2. Revoke table-wide SELECT, then re-grant everything except birth_date
-- ---------------------------------------------------------------------------
do $$
declare
  readable_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> 'birth_date';

  if readable_columns is null then
    raise exception 'M15: could not enumerate columns of public.profiles';
  end if;

  -- The revoke is what makes the subsequent grant meaningful: without it the
  -- table-wide privilege would still cover birth_date.
  execute 'revoke select on public.profiles from anon, authenticated';

  -- Authenticated members keep full read access to every other column, which is
  -- what discovery, the dashboard and the wizard rely on.
  execute format('grant select (%s) on public.profiles to authenticated', readable_columns);

  -- `anon` gets NOTHING back. RLS already returns zero rows to an anonymous
  -- caller; this makes the denial structural rather than policy-dependent.
  execute 'revoke select on public.profiles from anon';

  raise notice 'M15: birth_date revoked; % other columns re-granted to authenticated', 
    array_length(string_to_array(readable_columns, ','), 1);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Posture report
-- ---------------------------------------------------------------------------
select
  grantee,
  privilege_type,
  column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name  = 'birth_date'
order by grantee, privilege_type;
