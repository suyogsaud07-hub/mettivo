-- =============================================================================
-- M51 · Re-grant column-level SELECT on public.profiles to authenticated
-- =============================================================================
-- WHY
--   M15 (`20261015260000_m15_revoke_birth_date.sql`) revoked the table-wide
--   SELECT grant on `public.profiles` from `authenticated` and re-granted
--   column-level SELECT only for columns that existed at that time. Every column
--   added by a later migration is unreadable to `authenticated` until someone
--   grants it explicitly, so the dashboard's `.select('id, first_name, ...')`
--   on the member's own row fails with
--
--       HTTP 403  code 42501  "permission denied for table profiles"
--
--   even though the member owns the row and RLS (`profiles_select_authenticated`,
--   `auth.uid() is not null`) already permits the read. RLS is the
--   authorisation boundary for *which rows*; column-level SELECT privilege is
--   the gate for *which columns*. This migration restores the column gate.
--
-- WHAT THIS DOES
--   1. Revokes any table-wide SELECT on `public.profiles` from `anon` and
--      `authenticated` (a table-wide grant would make column-level REVOKEs
--      cosmetic, so it must be dropped first).
--   2. Grants column-level SELECT on every current column of `public.profiles`
--      EXCEPT the private deny-list (`birth_date`, `banned_until`, `ban_reason`)
--      to `authenticated`.
--   3. Revokes all SELECT from `anon` (anonymous reads are denied structurally).
--
-- RLS IS UNTOUCHED: `profiles_select_authenticated` remains the row-level
-- authorisation policy. This migration only restores column privileges.
--
-- SAFE TO RE-RUN: idempotent (revoke + re-grant).
-- =============================================================================

do $$
declare
  private_columns constant text[] := array['birth_date', 'banned_until', 'ban_reason'];
  readable_columns text;
begin
  -- Enumerate every current column except the private deny-list, ordered by
  -- ordinal position so the grant list is stable across re-runs.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> all (private_columns);

  if readable_columns is null then
    raise exception 're-grant: could not enumerate columns of public.profiles';
  end if;

  -- Drop table-wide grant first; without it the column grants are cosmetic
  -- and the private deny-list would not actually hide anything.
  execute 'revoke select on public.profiles from anon, authenticated';

  -- Authenticated members keep read access to every readable column.
  execute format('grant select (%s) on public.profiles to authenticated', readable_columns);

  -- `anon` gets nothing back: structural denial, not policy-dependent.
  execute 'revoke select on public.profiles from anon';

  raise notice 're-grant: % readable profile columns granted to authenticated',
    array_length(string_to_array(readable_columns, ','), 1);
end $$;

-- Posture report: the private columns must have no SELECT for either role.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in ('birth_date', 'banned_until', 'ban_reason')
  and privilege_type = 'SELECT'
order by grantee, column_name;

-- Posture report: every readable column must have SELECT for authenticated.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name <> all (array['birth_date', 'banned_until', 'ban_reason'])
  and column_name not in (
    select column_name
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name   = 'profiles'
      and grantee = 'authenticated'
      and privilege_type = 'SELECT'
  )
order by column_name;
