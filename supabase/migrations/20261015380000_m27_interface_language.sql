-- =============================================================================
-- M27 · interface language preference
-- =============================================================================
-- Adds `interface_language` to `user_preferences`: the UI language a member
-- chose in Settings, stored server-side so it follows them to a new device
-- instead of living only in that device's localStorage.
--
-- WHY A COLUMN HERE AND NOT ON `profiles`
--   `user_preferences` is already the member-scoped home for settings (M17/M20),
--   with owner-only RLS and an upsert-on-write client. A UI language is exactly
--   that kind of value, so it joins the row rather than widening `profiles`,
--   which every public projection has to reason about.
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`, and `drop constraint
-- if exists` before `add constraint`). No new table, so no new policy is needed:
-- the existing user_preferences RLS already scopes this column to its owner.
-- =============================================================================

alter table public.user_preferences
  add column if not exists interface_language varchar(10) not null default 'en';

-- Same shape as `user_preferences_language_format` (M17): the value indexes a
-- UI locale table, so an unconstrained string is both an injection surface and a
-- guaranteed "missing translation" fallback.
alter table public.user_preferences
  drop constraint if exists user_preferences_interface_language_format;
alter table public.user_preferences
  add constraint user_preferences_interface_language_format
  check (interface_language ~ '^[a-z]{2}(-[a-z]{2})?$');

comment on column public.user_preferences.interface_language is
  'The member''s chosen interface (UI) language. Defaults to en.';
