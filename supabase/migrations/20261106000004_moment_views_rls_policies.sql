-- =============================================================================
-- M49 — Grant moment_views read/write access to authenticated users
-- =============================================================================
-- The `moment_views` table has RLS enabled but no policies and all table
-- privileges revoked from `authenticated`. The Moments feed reads aggregated
-- view counts through `record_moment_view()` (SECURITY DEFINER), but direct
-- SELECT/INSERT on `moment_views` from the client returns 403 because there is
-- no table privilege and no RLS policy.
--
-- This migration grants SELECT and INSERT to `authenticated` and adds row-level
-- security policies so a member can only read or insert their own view records
-- (viewer_id = auth.uid()), preventing scraping of other members' view history.
-- =============================================================================

-- Restore table-level privileges for authenticated users.
grant select on public.moment_views to authenticated;
grant insert on public.moment_views to authenticated;

-- SELECT: a member may read only their own view records.
drop policy if exists "members_read_own_moment_views" on public.moment_views;
create policy "members_read_own_moment_views"
  on public.moment_views
  for select
  to authenticated
  using (viewer_id = auth.uid());

-- INSERT: a member may record only their own views.
drop policy if exists "members_insert_own_moment_views" on public.moment_views;
create policy "members_insert_own_moment_views"
  on public.moment_views
  for insert
  to authenticated
  with check (viewer_id = auth.uid());

-- Posture report.
do $$
begin
  raise notice 'M49: moment_views RLS policies granted to authenticated';
end $$;
