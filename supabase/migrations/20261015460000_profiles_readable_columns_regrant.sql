-- =============================================================================
-- Fix · Re-grant SELECT on every readable `profiles` column to authenticated
-- =============================================================================
-- WHY
--   `profiles` is protected by COLUMN-LEVEL SELECT grants, not a table-wide one.
--   `20261015260000_m15_revoke_birth_date.sql` had to work that way: because
--   Supabase grants table-wide SELECT by default, and a column-level REVOKE
--   cannot subtract from a table-wide GRANT, the only form that hides
--   `birth_date` is
--
--       revoke select on public.profiles from anon, authenticated;
--       grant  select (<allowed columns>) on public.profiles to authenticated;
--
--   M15 built that column list from the catalogue AT THE MOMENT IT RAN, so a
--   column added by any LATER migration is unreadable to `authenticated` until
--   someone grants it explicitly. Two later migrations added columns and did not
--   re-grant:
--
--       * 20261015430000_elite_profile_identity.sql
--             first_name, last_name, has_last_name, username
--       * 20261015440000_people_follow_presence.sql
--             last_seen_at
--
--   The dashboard reads the member's own row with an explicit allow-list that
--   names the four identity columns (`PROFILE_CORE_COLUMNS` in
--   `src/app/profile/dashboard/page.tsx`), so EVERY dashboard load failed with
--
--       HTTP 403  code 42501  "permission denied for table profiles"
--
--   even though the member owns the row and RLS allows it. The dashboard's
--   core-fallback path only rescues a MISSING column (`42703`), not a missing
--   privilege, so the page showed a load error instead of the profile.
--
-- WHAT THIS DOES
--   Re-grants column-level SELECT to `authenticated` for every current column of
--   `public.profiles` EXCEPT a small explicit deny-list of genuinely private
--   fields, and gives `anon` nothing back. Enumerating from the catalogue means
--   any column that was previously missed (here: the five above, plus anything
--   else added after M15 without a grant) is fixed in one pass, and re-running is
--   a no-op.
--
-- THE DENY-LIST (kept private deliberately)
--   * birth_date   — CONSTITUTION.md Art. 1.4; readable only via my_birth_date().
--   * banned_until — M29; readable only via my_ban_status().
--   * ban_reason   — M29; readable only via my_ban_status().
--   Everything else is already readable by any signed-in member under RLS, which
--   is what discovery, the dashboard and the wizard rely on.
--
-- WHAT THIS DOES NOT CHANGE
--   * RLS is untouched; it remains the authorisation boundary for which ROWS a
--     member may read. This only restores the COLUMN privileges.
--   * `anon` still has no SELECT at all on `profiles` (structural denial).
--   * `public_profiles` is a definer view and is unaffected.
--
-- SAFE TO RE-RUN: idempotent (revoke + grant).
-- =============================================================================

do $$
declare
  private_columns constant text[] := array['birth_date', 'banned_until', 'ban_reason'];
  readable_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> all (private_columns);

  if readable_columns is null then
    raise exception 're-grant: could not enumerate columns of public.profiles';
  end if;

  -- Drop the table-wide grant first; without it the column grants are cosmetic
  -- and the private deny-list would not actually hide anything.
  execute 'revoke select on public.profiles from anon, authenticated';

  execute format('grant select (%s) on public.profiles to authenticated', readable_columns);

  -- `anon` gets NOTHING back, matching M15: anonymous reads are denied
  -- structurally, not merely filtered by RLS.
  execute 'revoke select on public.profiles from anon';

  raise notice 're-grant: % readable profile columns granted to authenticated',
    array_length(string_to_array(readable_columns, ','), 1);
end $$;

-- ---------------------------------------------------------------------------
-- Posture report: the private columns must have no SELECT for anon/authenticated
-- ---------------------------------------------------------------------------
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in ('birth_date', 'banned_until', 'ban_reason')
  and privilege_type = 'SELECT'
order by grantee, column_name;
