-- =============================================================================
-- Notifications · realtime backend
-- =============================================================================
-- Gives the owner's Notifications navigation button (MobileNav -> /notifications)
-- a real backend: a `notifications` table, RLS, automatic generation from the
-- events that already happen in the app, and Realtime publication so the list
-- updates live.
--
-- KEY SAFETY PROPERTY
--   Notification generation must NEVER break the action that caused it. Every
--   trigger body is wrapped in an exception block that swallows errors and
--   returns NEW, so a failure to notify can never roll back a like, a message,
--   a follow or a match.
--
-- WHERE NOTIFICATIONS COME FROM (existing app events)
--   likes    insert  -> "liked you"
--   matches  insert  -> "it's a match" (both directions)
--   messages insert  -> "sent you a message" (recipient of the match)
--   follows  insert  -> "started following you"
--   reports  update  -> status changed to 'actioned', tells the reporter
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notifications table
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  -- Recipient. Cascades on account deletion (M15).
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Who caused it. Cascades too, so a deleted member leaves no orphan rows.
  actor_id   uuid references auth.users(id) on delete cascade,
  type       text not null
             constraint notifications_type_check
             check (type in ('follow','like','match','message','visitor','report')),
  -- Match id, message id, report id... depending on type.
  entity_id  uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_no_self_actor check (actor_id is null or actor_id <> user_id)
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS — a member sees and manages only their own notifications
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- No INSERT policy: rows are created only by the SECURITY DEFINER triggers
-- below, so a client cannot fabricate a notification for another member.

grant select, update, delete on public.notifications to authenticated;
revoke all on public.notifications from anon;

-- ---------------------------------------------------------------------------
-- 3. Generation triggers
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.is_like and new.liker_id <> new.liked_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.liked_id, new.liker_id, 'like', new.id);
    end if;
  exception when others then
    -- Never block the like itself.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_like_trg on public.likes;
create trigger notify_on_like_trg
  after insert on public.likes
  for each row execute function public.notify_on_like();

create or replace function public.notify_on_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.notifications (user_id, actor_id, type, entity_id)
    values (new.user_a, new.user_b, 'match', new.id),
           (new.user_b, new.user_a, 'match', new.id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_match_trg on public.matches;
create trigger notify_on_match_trg
  after insert on public.matches
  for each row execute function public.notify_on_match();

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  begin
    -- `messages.match_id` is text while `matches.id` is uuid, so compare as text.
    -- A malformed value simply matches nothing and yields no notification.
    select case when m.user_a = new.sender_id then m.user_b else m.user_a end
      into recipient
    from public.matches m
    -- Both sides cast to text: `messages.match_id` is `uuid` on the live project
    -- and `text` in some rebuilt environments. A one-sided cast raises
    -- "operator does not exist: text = uuid" the first time a message is sent.
    where m.id::text = new.match_id::text
    limit 1;

    if recipient is not null and recipient <> new.sender_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (recipient, new.sender_id, 'message', new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_message_trg on public.messages;
create trigger notify_on_message_trg
  after insert on public.messages
  for each row execute function public.notify_on_message();

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.follower_id <> new.following_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.following_id, new.follower_id, 'follow', null);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_follow_trg on public.follows;
create trigger notify_on_follow_trg
  after insert on public.follows
  for each row execute function public.notify_on_follow();

create or replace function public.notify_on_report_actioned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.status = 'actioned' and (old.status is distinct from 'actioned') then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.reporter_id, null, 'report', new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_report_actioned_trg on public.reports;
create trigger notify_on_report_actioned_trg
  after update on public.reports
  for each row execute function public.notify_on_report_actioned();

-- ---------------------------------------------------------------------------
-- 4. Realtime — stream inserts to the signed-in member
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
      raise notice 'notifications added to supabase_realtime';
    else
      raise notice 'notifications already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for notifications in the dashboard';
  end if;
end $$;

comment on table public.notifications is
  'Per-member notification feed. Rows are generated by SECURITY DEFINER triggers; clients may only read, mark read and delete their own.';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'notifications'
group by c.relname, c.relrowsecurity;
