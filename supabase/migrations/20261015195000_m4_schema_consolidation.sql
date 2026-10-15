-- =============================================================================
-- M4 · Supabase schema consolidation
-- =============================================================================
-- WHY: `reports` and `blocked_users` were originally created by the legacy,
-- non-executable `migrations/reports_blocked_users.sql`. That file cannot run on
-- a clean database (0/22 statements): it calls `uuid_generate_v4()` without
-- creating the `uuid-ossp` extension, and it uses `FOR INSERT ... USING`, which
-- PostgreSQL rejects -- an INSERT policy may only carry `WITH CHECK`.
--
-- The tables exist on the live project (created by hand), so they also carry
-- whatever constraints a human remembered to add. This migration makes the
-- STRUCTURE authoritative and reproducible:
--
--   * the tables exist, with `gen_random_uuid()` defaults;
--   * the integrity constraints are present (uniqueness, self-reference, FKs);
--   * every foreign key is backed by an index (unindexed FKs make cascading
--     deletes and joins on the erasure path slow, and RLS checks slower still);
--   * nothing here depends on an extension.
--
-- This file deliberately does NOT touch policies: M6 installed the RLS baseline
-- and M12 owns blocking enforcement. Mixing structure and policy in one
-- migration is how the original file became unrunnable.
--
-- SAFE TO RE-RUN: every statement is guarded. PostgreSQL has no
-- `add constraint if not exists`, so constraints are added inside `do` blocks
-- that check `pg_constraint` first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables — create if a project is missing them entirely
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  reason           text not null,
  details          text,
  status           text not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.blocked_users (
  id              uuid primary key default gen_random_uuid(),
  blocker_id      uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Columns — backfill anything a hand-made table is missing
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists details    text;
alter table public.reports add column if not exists status     text not null default 'pending';
alter table public.reports add column if not exists created_at timestamptz not null default now();
alter table public.reports add column if not exists updated_at timestamptz not null default now();

alter table public.blocked_users add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 3. De-duplication before constraining
-- ---------------------------------------------------------------------------
-- A live table created by hand has had no constraint to stop duplicates. Adding
-- one would abort the migration on real data, so the duplicates are removed
-- first. `ctid` keeps the physically first row of each group, which is the
-- oldest: for reports that is the original report.
delete from public.reports f
using public.reports g
where f.ctid > g.ctid
  and f.reporter_id = g.reporter_id
  and f.reported_user_id = g.reported_user_id;

delete from public.blocked_users f
using public.blocked_users g
where f.ctid > g.ctid
  and f.blocker_id = g.blocker_id
  and f.blocked_user_id = g.blocked_user_id;

delete from public.follows f
using public.follows g
where f.ctid > g.ctid
  and f.follower_id = g.follower_id
  and f.following_id = g.following_id;

-- ---------------------------------------------------------------------------
-- 4. Constraints
-- ---------------------------------------------------------------------------
-- `add constraint` has no IF NOT EXISTS form, so each is guarded by a lookup on
-- pg_constraint. The constraint name is the guard AND the stable identity.

do $$
begin
  -- `follows` was created without any key at all: duplicate follows were
  -- possible and the row had no identity, so RLS and cascades had nothing to
  -- anchor to. The natural key is the pair itself, which also keeps a
  -- self-follow legal (the notification trigger already suppresses that case).
  if to_regclass('public.follows') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.follows'::regclass and contype = 'p'
     ) then
    alter table public.follows
      add constraint follows_pkey primary key (follower_id, following_id);
    raise notice 'M4: added follows_pkey';
  end if;

  -- One report per (reporter, reported) pair: reporting is not a scoreboard.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reporter_reported_key'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reporter_reported_key unique (reporter_id, reported_user_id);
    raise notice 'M4: added reports_reporter_reported_key';
  end if;

  -- Report status is a closed set. Enforced in the database so a client cannot
  -- invent a status and disappear from the moderator queue.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_status_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_status_check
      check (status in ('pending', 'reviewed', 'dismissed', 'actioned'));
    raise notice 'M4: added reports_status_check';
  end if;

  -- Nobody reports themselves.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_no_self_report'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_no_self_report check (reporter_id <> reported_user_id);
    raise notice 'M4: added reports_no_self_report';
  end if;

  -- One block per (blocker, blocked) pair.
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocker_blocked_key'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocker_blocked_key unique (blocker_id, blocked_user_id);
    raise notice 'M4: added blocked_users_blocker_blocked_key';
  end if;

  -- Nobody blocks themselves.
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_no_self_block'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_no_self_block check (blocker_id <> blocked_user_id);
    raise notice 'M4: added blocked_users_no_self_block';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Foreign keys
-- ---------------------------------------------------------------------------
-- A live table created by hand may have plain `uuid` columns with no referential
-- integrity at all, which would let a report point at a deleted account and
-- silently break the erasure cascade (CONSTITUTION Article 1, M15).

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reporter_id_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reporter_id_fkey
      foreign key (reporter_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added reports_reporter_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reported_user_id_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reported_user_id_fkey
      foreign key (reported_user_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added reports_reported_user_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocker_id_fkey'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocker_id_fkey
      foreign key (blocker_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added blocked_users_blocker_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocked_user_id_fkey'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocked_user_id_fkey
      foreign key (blocked_user_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added blocked_users_blocked_user_id_fkey';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
-- Scanned `create index` for the whole schema turned up four unindexed foreign
-- keys and one unindexed join column. Each is written as a `do` block with a
-- `to_regclass` guard, so this file still applies on a project that has only
-- run part of the migration set.
--
-- (The M4 audit is `tests/database/schema.test.ts` — it fails if any future
-- migration adds an unindexed foreign key.)

do $$
begin
  -- `matches` has a unique index on (user_a, user_b), which covers lookups by
  -- user_a only. The participant policy also matches on user_b.
  if to_regclass('public.matches') is not null then
    execute 'create index if not exists matches_user_b_idx on public.matches (user_b)';
  end if;

  -- Notifications are read by recipient; the actor join in the UI had no index.
  if to_regclass('public.notifications') is not null then
    execute 'create index if not exists notifications_actor_idx on public.notifications (actor_id)';
  end if;

  -- Comment authors are joined for display.
  if to_regclass('public.moment_comments') is not null then
    execute 'create index if not exists moment_comments_author_idx on public.moment_comments (author_id)';
  end if;

  -- `granted_by` is `on delete set null`, so every account deletion scans this
  -- unindexed column.
  if to_regclass('public.user_roles') is not null then
    execute 'create index if not exists user_roles_granted_by_idx on public.user_roles (granted_by)';
  end if;

  -- `follows` gained a composite primary key above, which covers follower_id.
  -- The reverse direction (followers of X) is still unindexed.
  if to_regclass('public.follows') is not null then
    execute 'create index if not exists follows_following_id_idx on public.follows (following_id)';
  end if;
end $$;

-- The moderator queue reads `status` + `created_at`; the reporter's own list
-- reads `reporter_id` newest-first. Both were missing an index that matches the
-- actual access pattern.
create index if not exists reports_reporter_idx
  on public.reports (reporter_id, created_at desc);
create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id);
create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);
create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

create index if not exists blocked_users_blocker_idx
  on public.blocked_users (blocker_id);
create index if not exists blocked_users_blocked_user_idx
  on public.blocked_users (blocked_user_id);
create index if not exists blocked_users_created_at_idx
  on public.blocked_users (created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Documentation
-- ---------------------------------------------------------------------------
comment on table public.reports is
  'Reports of a member for violating community guidelines. Triage is moderator-only (M14).';
comment on column public.reports.reason is
  'Why the report was filed: harassment, fake_profile, inappropriate, underage, other.';
comment on column public.reports.status is
  'Triage state: pending -> reviewed | dismissed | actioned.';
comment on table public.blocked_users is
  'Block relationships between members. Effect is symmetric: neither member may see or message the other (M12).';

-- ---------------------------------------------------------------------------
-- 8. Posture report — the SQL editor output doubles as evidence.
-- ---------------------------------------------------------------------------
select
  c.relname                                        as table_name,
  c.relrowsecurity                                 as rls_enabled,
  (select count(*) from pg_constraint k
    where k.conrelid = c.oid)                      as constraint_count,
  (select count(*) from pg_index i
    where i.indrelid = c.oid)                      as index_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('reports', 'blocked_users')
order by c.relname;
