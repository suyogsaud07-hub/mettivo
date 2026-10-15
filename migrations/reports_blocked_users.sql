-- ⛔ DO NOT APPLY — THIS FILE IS NOT EXECUTABLE AND IS SUPERSEDED.
--
-- It fails on a clean database (0 of 22 statements succeed): it calls
-- `uuid_generate_v4()` without creating the `uuid-ossp` extension, and it uses
-- `FOR INSERT ... USING`, which PostgreSQL rejects — an INSERT policy may only
-- carry `WITH CHECK`.
--
-- The authoritative, idempotent, tested equivalents now live in
--   supabase/migrations/20261015195000_m4_schema_consolidation.sql   (structure)
--   supabase/migrations/20261015120000_m6_profiles_rls_lockdown.sql  (RLS)
-- Apply those instead. This file is retained only until the M4 legacy-directory
-- cleanup removes it.

-- Reports and Blocked Users tables for Mettivo dating app
-- Run this SQL in your Supabase dashboard to create the necessary tables

-- Create reports table
create table public.reports (
  id uuid default uuid_generate_v4() primary key,
  reporter_id uuid references auth.users(id) not null,
  reported_user_id uuid references auth.users(id) not null,
  reason text not null,
  details text,
  status text check (status in ('pending', 'reviewed', 'dismissed', 'actioned')) default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  -- Prevent duplicate reports from same reporter to same user
  unique(reporter_id, reported_user_id)
);

-- Enable Row Level Security on reports
alter table public.reports enable row level security;

-- Create policies for reports
-- Users can only insert reports (report others)
create policy "Users can insert their own reports"
  on public.reports for insert
  using (auth.uid() = reporter_id);

-- Users can only view reports they made or received
create policy "Users can view their own reports"
  on public.reports for select
  using (auth.uid() = reporter_id or auth.uid() = reported_user_id);

-- Only allow updates to status and details (moderator-like functionality)
create policy "Users can update report status and details"
  on public.reports for update
  using (auth.uid() = reporter_id or auth.uid() = reported_user_id)
  with check (status in ('pending', 'reviewed', 'dismissed', 'actioned'));

-- Create blocked_users table
create table public.blocked_users (
  id uuid default uuid_generate_v4() primary key,
  blocker_id uuid references auth.users(id) not null,
  blocked_user_id uuid references auth.users(id) not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,

  -- Prevent duplicate blocks
  unique(blocker_id, blocked_user_id),

  -- Prevent self-blocking
  check (blocker_id != blocked_user_id)
);

-- Enable Row Level Security on blocked_users
alter table public.blocked_users enable row level security;

-- Create policies for blocked_users
-- Users can only insert their own blocks
create policy "Users can insert their own blocks"
  on public.blocked_users for insert
  using (auth.uid() = blocker_id);

-- Users can only view their own blocks (who they blocked or who blocked them)
create policy "Users can view their own blocks"
  on public.blocked_users for select
  using (auth.uid() = blocker_id or auth.uid() = blocked_user_id);

-- Users can delete their own blocks (unblock)
create policy "Users can delete their own blocks"
  on public.blocked_users for delete
  using (auth.uid() = blocker_id);

-- Create indexes for better performance
create index idx_reports_reporter_id on public.reports(reporter_id);
create index idx_reports_reported_user_id on public.reports(reported_user_id);
create index idx_reports_status on public.reports(status);
create index idx_reports_created_at on public.reports(created_at);

create index idx_blocked_users_blocker_id on public.blocked_users(blocker_id);
create index idx_blocked_users_blocked_user_id on public.blocked_users(blocked_user_id);
create index idx_blocked_users_created_at on public.blocked_users(created_at);

-- Add helpful comments
comment on table public.reports is 'Reports of users for violating community guidelines';
comment on table public.blocked_users is 'Records of which users have blocked which other users';
comment on column public.reports.reason is 'Reason for reporting (harassment, fake_profile, inappropriate, underage, other)';
comment on column public.reports.status is 'Current status of the report';
comment on table public.blocked_users is 'Block relationships between users';