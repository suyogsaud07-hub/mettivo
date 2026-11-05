-- =============================================================================
-- Pre-M33 · Canonical match participant columns
-- =============================================================================
-- M33 references `matches.user_a_id` / `matches.user_b_id`, but M40 is the
-- migration that adds them. A clean bootstrap therefore failed at M33 with
-- "column m.user_a_id does not exist", before M40 could run.
--
-- This additive migration creates the columns earlier. It deliberately does not
-- add NOT NULL or backfill: M40 remains the authority that reconciles the
-- legacy and canonical columns, validates existing rows, and adds the final
-- constraints. On a database where M33/M40 already ran this is a no-op.
-- =============================================================================

alter table public.matches add column if not exists user_a_id uuid;
alter table public.matches add column if not exists user_b_id uuid;

comment on column public.matches.user_a_id is
  'Canonical first participant. Added early so M33 can run before M40 reconciles and constrains it.';
comment on column public.matches.user_b_id is
  'Canonical second participant. Added early so M33 can run before M40 reconciles and constrains it.';
