-- =============================================================================
-- Job and Education profile columns
-- =============================================================================
-- WHY: the MORE ABOUT ME card on the profile dashboard displays Job and
-- Education. The `profiles` table already carries `education` and `profession`
-- from the onboarding wizard, but this migration adds the canonical
-- `job_title` and `education_level` columns so the dashboard and completeness
-- calculation have a single consistent source of truth.
--
-- PRIVACY: these are personal fields. They are NOT added to `public_profiles`,
-- so they stay owner-readable only under existing RLS.
--
-- SAFE TO RE-RUN: every statement is idempotent (`add column if not exists`).
-- Existing profile records are preserved; no columns are dropped or renamed.
-- =============================================================================

alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists education_level text;

comment on column public.profiles.job_title is
  'The member\'s job title, shown on the profile and used for completeness.';
comment on column public.profiles.education_level is
  'The member\'s education level, shown on the profile and used for completeness.';

-- Report the resulting posture.
select count(*) as job_education_columns_present
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in ('job_title', 'education_level');
