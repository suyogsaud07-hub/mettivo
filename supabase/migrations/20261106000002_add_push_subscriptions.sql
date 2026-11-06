-- Stores Web Push subscriptions so the server can notify members of new
-- messages, likes, matches, etc. One row per (user, device/browser).
create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Index for fast lookup of a user's subscriptions when sending a push.
create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions(user_id);

-- RLS: a member can only manage their own push subscriptions.
alter table public.push_subscriptions enable row level security;

DROP POLICY IF EXISTS "push_subscriptions_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_own"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_insert_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_insert_own"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subscriptions_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_delete_own"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);