-- =============================================================================
-- Migration: push notification event triggers
-- =============================================================================
-- Sends Web Push notifications when a member receives a new like, follow, or
-- message. Uses pg_net (available by default on Supabase) to POST to
-- /api/push/send, authenticated with the shared PUSH_SERVER_SECRET.
--
-- SECURITY:
--   - The shared secret is read from the PostgreSQL custom setting
--     `push.server_secret`, which the deployment must configure separately
--     (e.g. `ALTER DATABASE <db> SET push.server_secret = '<secret>'`). It is
--     NEVER written into this migration file.
--   - Trigger functions run SECURITY DEFINER so they can read push_subscriptions
--     (RLS-restricted to the owner) and call the push API.
--   - Triggers are fire-and-forget: a push delivery failure never aborts the
--     originating INSERT (like / follow / message).
--   - Only INSERT events are handled. No duplicate triggers are created.
--
-- Required server-side env (NOT in this file):
--   PUSH_SERVER_SECRET   shared secret matched by /api/push/send
--   VAPID_PRIVATE_KEY    base64 VAPID private key (server-side only)
--   VAPID_EMAIL          VAPID contact mailto
--
-- =============================================================================

-- pg_net provides asynchronous-ish HTTP from SQL (available by default on Supabase).
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Trigger function: new LIKE -> notify the liked member
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secret text := current_setting('push.server_secret', true);
  payload jsonb;
begin
  -- Only actual likes (is_like = true) generate a notification.
  if not new.is_like then
    return new;
  end if;

  -- Defensive: never notify the actor themselves.
  if new.liker_id = new.liked_id then
    return new;
  end if;

  payload := jsonb_build_object(
    'event_type', 'like',
    'recipient_id', new.liked_id,
    'actor_id', new.liker_id,
    'title', 'New Like on METTIVO',
    'body', 'Someone is interested in your profile.',
    'url', '/notifications',
    'tag', 'mettivo-like'
  );

  -- Fire and forget: a push failure must not abort the like insert.
  begin
    perform net.http_post(
      'https://mettivo-dating.vercel.app/api/push/send',
      array[
        'Content-Type: application/json',
        'Authorization: Bearer ' || coalesce(secret, '')
      ],
      payload
    );
  exception when others then
    -- Log and swallow so the like is never blocked by push delivery.
    raise notice 'push notify_on_like failed: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_on_like() from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Trigger function: new FOLLOW -> notify the followed member
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secret text := current_setting('push.server_secret', true);
  payload jsonb;
begin
  -- Defensive: never notify the actor themselves.
  if new.follower_id = new.following_id then
    return new;
  end if;

  payload := jsonb_build_object(
    'event_type', 'follow',
    'recipient_id', new.following_id,
    'actor_id', new.follower_id,
    'title', 'New Follower',
    'body', 'Someone just followed you on METTIVO.',
    'url', '/notifications',
    'tag', 'mettivo-follow'
  );

  begin
    perform net.http_post(
      'https://mettivo-dating.vercel.app/api/push/send',
      array[
        'Content-Type: application/json',
        'Authorization: Bearer ' || coalesce(secret, '')
      ],
      payload
    );
  exception when others then
    raise notice 'push notify_on_follow failed: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_on_follow() from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Trigger function: new MESSAGE -> notify the match recipient (not sender)
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secret text := current_setting('push.server_secret', true);
  recipient_id uuid;
  payload jsonb;
begin
  -- Resolve the recipient: the other participant in the match.
  select case
    when m.user_a = new.sender_id then m.user_b
    when m.user_b = new.sender_id then m.user_a
    else null
  end into recipient_id
  from public.matches m
  where m.id = new.match_id;

  if recipient_id is null then
    return new;
  end if;

  -- Defensive: never notify the actor themselves.
  if recipient_id = new.sender_id then
    return new;
  end if;

  payload := jsonb_build_object(
    'event_type', 'message',
    'recipient_id', recipient_id,
    'actor_id', new.sender_id,
    'title', 'New Message',
    'body', 'You have a new message.',
    'url', '/chat/' || new.match_id,
    'tag', 'mettivo-message'
  );

  begin
    perform net.http_post(
      'https://mettivo-dating.vercel.app/api/push/send',
      array[
        'Content-Type: application/json',
        'Authorization: Bearer ' || coalesce(secret, '')
      ],
      payload
    );
  exception when others then
    raise notice 'push notify_on_message failed: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_on_message() from public, anon;

-- ---------------------------------------------------------------------------
-- 4. Attach triggers (only INSERT). Idempotent: drop-if-exists first.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_notify_on_like on public.likes;
create trigger trg_notify_on_like
  after insert on public.likes
  for each row
  execute function public.notify_on_like();

drop trigger if exists trg_notify_on_follow on public.follows;
create trigger trg_notify_on_follow
  after insert on public.follows
  for each row
  execute function public.notify_on_follow();

drop trigger if exists trg_notify_on_message on public.messages;
create trigger trg_notify_on_message
  after insert on public.messages
  for each row
  execute function public.notify_on_message();

-- ---------------------------------------------------------------------------
-- 5. Posture report
-- ---------------------------------------------------------------------------
select
  tgname        as trigger_name,
  tgrelid::regclass as table_name,
  tgtype        as trigger_type
from pg_trigger
where tgname in ('trg_notify_on_like','trg_notify_on_follow','trg_notify_on_message')
order by tgname;

comment on function public.notify_on_like() is
  'Push notification trigger for new likes. Reads push.server_secret (set by deployment, not in this file).';
comment on function public.notify_on_follow() is
  'Push notification trigger for new follows.';
comment on function public.notify_on_message() is
  'Push notification trigger for new messages. Resolves recipient from public.matches.';
