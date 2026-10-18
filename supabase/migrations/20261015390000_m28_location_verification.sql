-- =============================================================================
-- M28 · Profile location verification
-- =============================================================================
-- Adds two owner-scoped columns to `profiles` that power the "where are you?"
-- prompt (see src/hooks/useLocationVerification.ts):
--
--   current_location     the last city/country the member confirmed, as text
--   last_location_check  when the member last confirmed (or dismissed) it
--
-- The client re-checks every 5 days, so `last_location_check` is an
-- acknowledgement timestamp ("I have seen this and it is current"), not an
-- audit trail that must be append-only.
--
-- WHY THESE COLUMNS NEED AN EXPLICIT GRANT
--   M15 (20261015260000) dropped the table-wide SELECT on `profiles` and
--   re-granted only the columns that existed *then*, computed from the
--   catalogue at the moment M15 ran. A column added afterwards is therefore NOT
--   readable — this migration must grant it, or the client's
--   `select current_location, last_location_check` fails with a permission
--   error. (On a full replay M15 recomputes its list and covers them too; the
--   grant here is what makes an *incremental* apply correct.)
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`, bare `grant`).
-- No new table, so no new RLS policy is needed: `profiles_update_own` (M6)
-- already scopes every write to `auth.uid() = id`, and these two columns are
-- owner-only data that no public projection reads.
-- =============================================================================

alter table public.profiles
  add column if not exists current_location text;

alter table public.profiles
  add column if not exists last_location_check timestamptz;

comment on column public.profiles.current_location is
  'Last city/country the member confirmed, e.g. "Kathmandu, Nepal". Free text, owner-written; never shown on a public projection.';

comment on column public.profiles.last_location_check is
  'When the member last confirmed or dismissed the location prompt. Drives the 5-day re-check.';

-- The owner reads their own row through the same authenticated role as every
-- other profile column (M6 select policy → M15 column grant).
grant select (current_location, last_location_check)
  on public.profiles to authenticated;

-- Writes still require ownership via `profiles_update_own`; granting the
-- columns keeps this usable even if a later migration drops the table-wide
-- UPDATE, without widening who may write them.
grant update (current_location, last_location_check)
  on public.profiles to authenticated;

-- `anon` was stripped of profile SELECT entirely by M15 and never had a write
-- policy; state that explicitly for these columns too.
revoke all (current_location, last_location_check)
  on public.profiles from anon;
