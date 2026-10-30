-- =============================================================================
-- M0 · Base schema for a genuinely empty project
-- =============================================================================
-- The migration set was written against a project that already had five
-- pre-migration tables: profiles, messages, follows, reports and blocked_users.
-- That made a clean bootstrap fail at M6 (`relation "public.profiles" does not
-- exist`) and silently skipped M6's baseline policies for the other tables.
--
-- This migration reconstructs only the pre-migration columns and constraints,
-- derived from the production schema dump minus every column a later migration
-- owns. Later migrations remain responsible for their own additions.
--
-- RLS is enabled here with no policies: a partially-applied database fails
-- closed. M6 installs the first policies.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

create table if not exists public.profiles (
  id                   uuid        primary key references auth.users(id) on delete cascade,
  updated_at           timestamptz not null default timezone('utc', now()),
  display_name         text        not null,
  age                  integer     not null,
  city                 text        default 'Kathmandu',
  intention            text        not null,
  bio                  text,
  interests            text[]      default '{}'::text[],
  is_verified          boolean     default false,
  birth_date           date,
  gender               text,
  looking_for          text[],
  country              text,
  drinking             text,
  smoking              text,
  avatar_url           text,
  pets                 text[],
  religion             text,
  politics             text,
  hobbies              text[],
  photos               text[],
  onboarding_completed boolean     default false,
  prompts              jsonb       default '[]'::jsonb,
  personality          text[]      default '{}'::text[],
  friends_count        integer     default 0,
  followers            integer     default 0,
  following            integer     default 0,
  friends              integer     default 0,
  is_online            boolean     default true,
  constraint profiles_age_check check (age >= 18)
);

create table if not exists public.follows (
  id           uuid        primary key default gen_random_uuid(),
  follower_id  uuid        references public.profiles(id) on delete cascade,
  following_id uuid        references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default timezone('utc', now()),
  constraint follows_follower_id_following_id_key unique (follower_id, following_id)
);

create table if not exists public.messages (
  id         uuid        primary key default gen_random_uuid(),
  match_id   uuid        not null,
  sender_id  uuid        not null references public.profiles(id) on delete cascade,
  content    text        not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.reports (
  id               uuid        primary key default gen_random_uuid(),
  reporter_id      uuid        not null,
  reported_user_id uuid        not null,
  reason           text        not null,
  details          text,
  status           text        default 'pending',
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create table if not exists public.blocked_users (
  id              uuid        primary key default gen_random_uuid(),
  blocker_id      uuid        not null,
  blocked_user_id uuid        not null,
  created_at      timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.blocked_users enable row level security;
