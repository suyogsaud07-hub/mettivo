-- =============================================================================
-- Onboarding wizard · profile columns
-- =============================================================================
-- WHY: the 15-step onboarding wizard (src/app/profile/edit/page.tsx) commits the
-- whole form in ONE upsert. Nine of the columns in that payload previously
-- existed only in the legacy `migrations/onboarding_wizard_columns.sql` file,
-- which is NOT part of this authoritative directory. A database rebuilt from
-- `supabase/migrations/` therefore had no `pronouns`, `mbti`, ... and the
-- wizard's save failed with PostgREST 400 "column does not exist" at step 15 --
-- the product could not complete onboarding at all.
--
-- This closes ARCHITECTURE.md "Known gaps" #3 and satisfies CONSTITUTION
-- Article 3.12: migrations in the repo must be executable on a clean database.
--
-- PRIVACY: these are personal fields. None of them is added to `public_profiles`
-- (see 20261015120200_m6_public_profiles_view.sql), so they stay owner-readable
-- only -- new columns are private by default.
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`). Re-running is a no-op.
-- =============================================================================

alter table public.profiles add column if not exists pronouns            text;
alter table public.profiles add column if not exists physical_attributes text[];
alter table public.profiles add column if not exists sexual_orientation  text;
alter table public.profiles add column if not exists mbti                text;
alter table public.profiles add column if not exists height              text;
alter table public.profiles add column if not exists exercise            text;
alter table public.profiles add column if not exists education           text;
alter table public.profiles add column if not exists profession          text;
alter table public.profiles add column if not exists languages_spoken    text[];

comment on table public.profiles is
  'User profiles, including the fields collected by the 15-step onboarding wizard.';

-- Report the resulting posture: this must print 9 after a successful run.
select count(*) as onboarding_wizard_columns_present
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in (
    'pronouns', 'physical_attributes', 'sexual_orientation', 'mbti',
    'height', 'exercise', 'education', 'profession', 'languages_spoken'
  );
