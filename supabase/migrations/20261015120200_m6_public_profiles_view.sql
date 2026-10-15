-- =============================================================================
-- M6 · Step 3 of 3 — Safe public projection of profiles (no birth_date)
-- =============================================================================
-- WHY: `profiles` now allows any signed-in user to read rows (discovery needs
-- it), but a `select *` still exposes birth_date, politics and religion to every
-- other member. This view is the allow-listed projection that public surfaces
-- should read from.
--
-- COLUMN ALLOW-LIST, NOT `SELECT *`.
--   Every column below was verified to exist on the live table. Anything added
--   to `profiles` in future is NOT exposed here until it is deliberately added —
--   new columns are private by default, which is the correct default.
--
-- DELIBERATELY EXCLUDED:
--   birth_date  -> exact dates of birth enable identity theft and are never
--                  needed to render a profile. Display the derived `age` instead.
--   followers / following / friends (raw arrays) and their *_count denormalised
--                  duplicates -> not needed by any public surface today.
--
-- NOTE ON RIGHTS: this view is created without `security_invoker`, so it reads
-- with the view owner's rights and is therefore *not* filtered by the RLS policy
-- on `profiles`. Row filtering is intentional (a discovery feed must see other
-- members); the protection here is column-level, and access is restricted to the
-- `authenticated` role with `anon` explicitly revoked.
--
-- SAFE TO RE-RUN: `create or replace view`.
-- =============================================================================

create or replace view public.public_profiles as
select
  id,
  display_name,
  age,
  gender,
  city,
  country,
  avatar_url,
  photos,
  bio,
  intention,
  looking_for,
  hobbies,
  pets,
  personality,
  religion,
  politics,
  drinking,
  smoking,
  interests,
  prompts,
  is_online,
  is_verified,
  onboarding_completed,
  updated_at
from public.profiles;

comment on view public.public_profiles is
  'Allow-listed public projection of profiles. Excludes birth_date and other private fields. Read this from discovery-style surfaces instead of public.profiles.';

-- Only signed-in members may read the projection.
grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- =============================================================================
-- FOLLOW-UP (tracked, requires a UI change — do NOT apply until then)
-- -----------------------------------------------------------------------------
-- Once src/app/profile/dashboard/page.tsx stops formatting `birth_date` and
-- renders the stored `age` column instead, the exact date of birth can be
-- removed from the API surface entirely:
--
--   revoke select (birth_date) on public.profiles from authenticated, anon;
--
-- That statement is intentionally commented out: the dashboard still reads
-- birth_date for the current user, so revoking it now would break that page.
--
-- Similarly, point discovery at this view (`from('public_profiles')`) instead of
-- `from('profiles')` with `select('*')` to guarantee private columns never leave
-- the database. That edit belongs to the discovery/matching milestone.
-- =============================================================================
