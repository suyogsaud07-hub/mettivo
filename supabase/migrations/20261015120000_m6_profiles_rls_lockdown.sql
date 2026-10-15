-- =============================================================================
-- M6 · Step 1 of 3 — Lock down public.profiles
-- =============================================================================
-- WHY: an unauthenticated request carrying only the public anon key could read
-- real profile rows, including birth_date, city, politics, religion, photos and
-- is_online. With no application server, RLS is the ONLY authorisation boundary,
-- so this was a live data leak.
--
-- WHAT THIS DOES
--   1. Enables RLS on public.profiles.
--   2. Removes EVERY existing policy on the table, whatever it is called, so a
--      permissive `public`/`anon` policy cannot silently survive.
--   3. Recreates a minimal, explicit policy set:
--        SELECT  -> any signed-in user (discovery needs to browse profiles)
--        INSERT  -> owner only            (WITH CHECK, never USING)
--        UPDATE  -> owner only
--        DELETE  -> owner only
--
-- SAFE TO RE-RUN: the policy drop is dynamic and unconditional, so applying this
-- file twice converges on exactly the same state.
--
-- VERIFY AFTER APPLYING:  ./scripts/verify-rls.sh   (profiles must report 0 rows)
-- =============================================================================

begin;

alter table public.profiles enable row level security;

-- Remove every existing policy on profiles (names are unknown, so enumerate).
do $$
declare
  pol record;
  dropped integer := 0;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', pol.policyname);
    dropped := dropped + 1;
    raise notice 'M6: dropped existing policy % on public.profiles', pol.policyname;
  end loop;

  if dropped = 0 then
    raise notice 'M6: no existing policies on public.profiles';
  end if;
end $$;

-- A signed-in user may browse profiles. Anonymous callers match no policy and
-- therefore receive zero rows (PostgreSQL default-deny once RLS is enabled).
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() is not null);

-- Owners may create their own profile row (first-time onboarding).
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Owners may edit their own profile. USING gates which row is targeted;
-- WITH CHECK gates the resulting row, so `id` cannot be reassigned to another user.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Owners may delete their own profile (required by M15 account deletion).
create policy "profiles_delete_own"
  on public.profiles
  for delete
  to authenticated
  using (auth.uid() = id);

comment on table public.profiles is
  'User profiles. RLS: authenticated users may read; only the owner may write.';

commit;
