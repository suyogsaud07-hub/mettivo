-- LEGACY COPY — SUPERSEDED. Do not apply this file.
-- The authoritative, tested version now lives at
--   supabase/migrations/20261015190000_onboarding_wizard_columns.sql
-- and is applied in filename order with the rest of the migration set.
-- This copy is kept only until the M4 legacy-directory cleanup removes it.

-- Comprehensive migration for onboarding wizard fields in profiles table
-- Run this SQL in your Supabase dashboard SQL editor

alter table public.profiles add column if not exists height text;
alter table public.profiles add column if not exists pronouns text;
alter table public.profiles add column if not exists physical_attributes text[];
alter table public.profiles add column if not exists sexual_orientation text;
alter table public.profiles add column if not exists mbti text;
alter table public.profiles add column if not exists exercise text;
alter table public.profiles add column if not exists education text;
alter table public.profiles add column if not exists profession text;
alter table public.profiles add column if not exists languages_spoken text[];
alter table public.profiles add column if not exists bio text;

comment on table public.profiles is 'User profiles with 15-step onboarding wizard fields';
