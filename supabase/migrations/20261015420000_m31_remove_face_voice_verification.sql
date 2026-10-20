-- =============================================================================
-- M31 — Remove face and voice verification
-- =============================================================================
-- WHY
--   The product no longer performs face, voice or AI photo verification. The
--   onboarding wizard now accepts a profile picture and four gallery photos
--   without a biometric check.
--
--   Removing the UI alone is not enough: the M24 trigger is the real gate and
--   would keep refusing `onboarding_completed = true` for every unverified
--   member. This migration removes that enforcement and retires the
--   secret-gated writer RPCs and the status reader.
--
-- DATA SAFETY
--   `profile_verifications` and `profile_photo_checks` are NOT dropped. Their
--   contents are historical records and may be needed for audit or rollback.
--   They remain RLS-protected and owner-readable, but no application code writes
--   them after this migration. `profiles.is_verified` is likewise retained; it
--   is simply no longer updated by the application.
--
-- SAFE TO RE-RUN: every statement is `drop ... if exists`, so a second run is a
-- no-op.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove the onboarding gate first: the trigger depends on the function.
-- ---------------------------------------------------------------------------
drop trigger if exists enforce_verification_before_onboarding_trg on public.profiles;
drop function if exists public.enforce_verification_before_onboarding();

-- ---------------------------------------------------------------------------
-- 2. Retire the secret-gated verdict writers and the status reader.
-- ---------------------------------------------------------------------------
drop function if exists public.record_verification(
  text, uuid, text, boolean, text, text, text, numeric, text, numeric
);

drop function if exists public.record_photo_check(
  text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb
);

drop function if exists public.get_my_verification();

-- ---------------------------------------------------------------------------
-- 3. Mark the retained audit tables as historical.
-- ---------------------------------------------------------------------------
comment on table public.profile_verifications is
  'Historical M24 authenticity records retained for audit. Face/voice verification was removed in M31; the application no longer reads or writes this table.';

comment on table public.profile_photo_checks is
  'Historical M24 photo-verdict records retained for audit. Photo verification was removed in M31; the application no longer reads or writes this table.';

-- ---------------------------------------------------------------------------
-- 4. Posture report
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'M31 removed face/voice verification trigger and RPCs; historical tables retained';
end;
$$;
