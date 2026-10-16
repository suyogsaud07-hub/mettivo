-- M11 follow-up — make one-to-one chat actually live, and fix the reply link.
--
-- Two production defects this corrects:
--
--   1. `public.messages` was never added to the `supabase_realtime` publication.
--      The `/chat/<matchId>` screen subscribes to `postgres_changes` INSERTs on
--      `messages`, and it neither appends locally nor refetches after a send, so
--      with no publication the subscription delivered NOTHING: neither the
--      partner's reply nor the member's own just-sent bubble appeared until a
--      manual reload. Every other realtime surface (notifications, moments,
--      moment_comments) was already added; `messages` was simply missed.
--
--   2. `notify_on_message()` stored the MESSAGE id in `notifications.entity_id`,
--      while `actionForNotification()` navigates to `/chat/<entity_id>` — a match
--      route. The "Reply" button therefore opened `/chat/<message-id>`, which
--      RLS filters to nothing, i.e. an empty thread. The trigger now stores the
--      MATCH id, and existing message notifications are repointed.
--
-- Idempotent: a guarded publication add, a `create or replace` function, and a
-- backfill that only touches rows still holding a message id. Safe to re-run.

-- 1. Stream message INSERTs to the browser.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
      raise notice 'messages added to supabase_realtime';
    else
      raise notice 'messages already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for messages in the dashboard';
  end if;
end $$;

-- 2. A message notification points at the CONVERSATION, not the message.
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
      -- entity_id is the match id so `/chat/<entity_id>` is a real thread.
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (recipient, new.sender_id, 'message', new.match_id::uuid);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

-- 3. Repoint existing message notifications that still hold a message id.
update public.notifications n
set entity_id = m.match_id::uuid
from public.messages m
where n.type = 'message'
  and n.entity_id = m.id
  and n.entity_id is distinct from m.match_id::uuid;
