-- =============================================================================
-- M52 · Re-grant column-level UPDATE on public.profiles to authenticated
-- =============================================================================
-- WHY
--   M15 (`20261015260000_m15_revoke_birth_date.sql`) revoked the table-wide
--   SELECT grant on `public.profiles` from `authenticated`, and the same table
--   revoked table-wide UPDATE. Every column added by a later migration
--   (e.g. `job_title`, `education_level`) is unwritable to `authenticated`
--   until someone grants it explicitly, so saving a profile fails with
--
--       HTTP 403  code 42501  "permission denied for table profiles"
--
--   even though the member owns the row and RLS (`profiles_update_authenticated`,
--   `auth.uid() = id`) already permits the update. RLS is the authorisation
--   boundary for *which rows*; column-level UPDATE privilege is the gate for
--   *which columns*. This migration restores the column gate.
--   Sensitive columns (`birth_date`, `banned_until`, `ban_reason`,
--   `is_suspended`, `confirmed_violation_count`) are explicitly excluded so
--   they stay unwritable to `authenticated`.
-- RLS IS UNTOUCHED: `profiles_update_authenticated` remains the row-level
-- authorisation policy. This migration only restores column privileges.
-- SAFE TO RE-RUN: idempotent (revoke + re-grant).
-- =============================================================================

do $$
declare
  sensitive_columns constant text[] := array[
    'birth_date',
    'banned_until',
    'ban_reason',
    'is_suspended',
    'confirmed_violation_count'
  ];
  writable_columns text;
begin
  -- Enumerate every current column except the sensitive deny-list, ordered by
  -- ordinal position so the grant list is stable across re-runs.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into writable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> all (sensitive_columns);

  if writable_columns is null then
    raise exception 're-grant: could not enumerate columns of public.profiles';
  end if;

  -- Drop table-wide UPDATE grant first; without it the column grants are cosmetic
  -- and the sensitive deny-list would not actually block writes.
  execute 'revoke update on public.profiles from authenticated';

  -- Authenticated members keep write access to every writable column.
  execute format('grant update (%s) on public.profiles to authenticated', writable_columns);

  raise notice 're-grant: % writable profile columns granted to authenticated',
    array_length(string_to_array(writable_columns, ','), 1);
end $$;

-- Posture report: the sensitive columns must have no UPDATE for authenticated.
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name = any (array['birth_date', 'banned_until', 'ban_reason', 'is_suspended', 'confirmed_violation_count'])
  and privilege_type = 'UPDATE'
order by grantee, column_name;

-- Posture report: every writable column must have UPDATE for authenticated.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name = any (array['birth_date', 'banned_until', 'ban_reason', 'is_suspended', 'confirmed_violation_count']) = false
  and column_name not in (
    select column_name
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name   = 'profiles'
      and grantee = 'authenticated'
      and privilege_type = 'UPDATE'
  )
order by column_name;
