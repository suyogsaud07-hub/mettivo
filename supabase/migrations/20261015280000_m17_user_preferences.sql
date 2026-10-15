-- =============================================================================
-- M17 · user_preferences — per-member translation settings
-- =============================================================================
-- Adds the storage behind Mettivo's on-demand chat translation:
-- `preferred_translation_language`, the language a member wants incoming
-- messages translated INTO. Translation itself is on-demand — nothing is
-- translated until the member taps the translate control on a message — so this
-- is a preference, not a job queue.
--
-- WHY A SEPARATE TABLE RATHER THAN A COLUMN ON `profiles`
--   `profiles` is the most audience-sensitive row in the product: it carries the
--   column-level `birth_date` revoke (20261015260000_m15_revoke_birth_date.sql)
--   and every column in it is either displayed on a public surface or carefully
--   excluded from one. UI preferences have a different blast radius and a
--   different read pattern (read once per chat screen, written from settings),
--   so they get their own table with their own policy rather than widening the
--   row that the public projections must reason about.
--
-- SAFE TO RE-RUN: idempotent. `create table if not exists`, `add column if not
-- exists`, `drop policy if exists` before every `create policy`, and the seed is
-- an `on conflict do nothing`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  preferred_translation_language varchar(10) not null default 'en',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- A language code, not free text: the value is interpolated into an upstream
  -- translation request, so an unconstrained string is an injection surface and
  -- a guaranteed upstream 400. Mirrors the allow-list in `src/lib/translation.ts`
  -- (`SUPPORTED_LANGUAGE_CODES` + `LANGUAGE_CODE_PATTERN`); the app copy produces
  -- the friendly message, this one is the boundary that cannot be bypassed.
  constraint user_preferences_language_format
    check (preferred_translation_language ~ '^[a-z]{2}(-[a-z]{2})?$')
);

comment on table public.user_preferences is
  'Per-member UI preferences. RLS: a member reads and writes only their own row.';
comment on column public.user_preferences.preferred_translation_language is
  'Language code incoming chat messages are translated into. Defaults to en.';

-- Idempotent for environments where an earlier build created the table without
-- the column.
alter table public.user_preferences
  add column if not exists preferred_translation_language varchar(10) not null default 'en';

-- ---------------------------------------------------------------------------
-- 2. updated_at maintenance
-- ---------------------------------------------------------------------------
-- Kept in the database so the timestamp cannot be forged or forgotten by a
-- client. This is the same trigger shape used by the rest of the schema.
create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_preferences_touch_updated_at on public.user_preferences;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_user_preferences_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed a row for every existing member
-- ---------------------------------------------------------------------------
-- `on conflict do nothing` so this never overwrites a preference a member has
-- already chosen. New members are handled on write: `savePreferredTranslation-
-- Language()` upserts, and the read path treats a missing row as the default.
insert into public.user_preferences (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- No personal data here, but the row is still member-scoped: another member
-- learning your translation language is a (small) disclosure and there is no
-- product reason to allow it. `auth.uid()` is the only source of identity.
alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences for insert to authenticated
  -- INSERT policies use WITH CHECK, never USING: PostgreSQL rejects USING here.
  with check (auth.uid() = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO delete policy. A member row is removed by account erasure
-- (`delete_my_account()` cascades from auth.users); the settings UI writes, it
-- does not delete, so exposing DELETE would only add a way to lose the row.

grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname = 'user_preferences'
group by c.relname, c.relrowsecurity;
