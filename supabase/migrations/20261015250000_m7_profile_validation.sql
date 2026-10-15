-- =============================================================================
-- M7 · Full profile management — database-side validation guards
-- =============================================================================
-- WHY: the onboarding wizard validates on the client, and the client is not a
-- security boundary. Everything it checks must also be true in the database, or
-- a crafted request bypasses it.
--
-- The three guards that matter for a dating product for adults:
--   * an adult age (RISK_REGISTER R-05),
--   * a real display name -- a blank profile is unusable to everyone who sees it,
--   * a closed set of declared intentions, because the recommendation engine
--     scores on it and an unknown value can never be satisfied by anyone.
--
-- WHY `NOT VALID`
--   Each constraint is added with `NOT VALID`. PostgreSQL then enforces it for
--   every new or updated row immediately, but does NOT abort the migration on
--   rows that already violate it. On a live table that humans have edited by
--   hand, that is the difference between a migration that applies and one that
--   does not. `validate constraint` can be run later, deliberately, once the
--   existing rows are cleaned.
--
-- SAFE TO RE-RUN: guarded by `pg_constraint` lookups.
-- =============================================================================

do $$
begin
  -- Age 18 or over. The client must reject an under-18 date of birth outright;
  -- this is the backstop that survives a crafted request.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_age_adult' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_age_adult check (age is null or age >= 18) not valid;
    raise notice 'M7: added profiles_age_adult (not valid)';
  end if;

  -- A display name that is actually a name: present, trimmed, bounded.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_display_name_shape' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_display_name_shape
      check (
        display_name is null
        or (char_length(btrim(display_name)) between 1 and 60)
      ) not valid;
    raise notice 'M7: added profiles_display_name_shape (not valid)';
  end if;

  -- Intention is a closed set: the scoring engine must be able to reason about
  -- every value it can encounter.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_intention_set' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_intention_set
      check (intention is null or intention in ('friendship','dating','both')) not valid;
    raise notice 'M7: added profiles_intention_set (not valid)';
  end if;

  -- A bio is free text, but not unbounded: it is rendered in list views.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_len
      check (bio is null or char_length(bio) <= 1000) not valid;
    raise notice 'M7: added profiles_bio_len (not valid)';
  end if;
end $$;

comment on constraint profiles_age_adult on public.profiles is
  'Members must be 18+. Backstop for the client-side date-of-birth gate (CONSTITUTION Article 1).';

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  conname        as constraint_name,
  convalidated   as validated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname in (
    'profiles_age_adult',
    'profiles_display_name_shape',
    'profiles_intention_set',
    'profiles_bio_len'
  )
order by conname;
