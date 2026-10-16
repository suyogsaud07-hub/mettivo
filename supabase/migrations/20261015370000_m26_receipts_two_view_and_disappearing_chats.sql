-- =============================================================================
-- M26 · Delivery/seen receipts, strict 2-view media, 24-hour disappearing chats
-- =============================================================================
-- Builds on M11 (messaging) and M25 (disappearing chat media) and adds the three
-- things a modern messenger is judged on:
--
--   1. DELIVERY + SEEN RECEIPTS. `messages.delivered_at`/`seen_at` record the
--      OTHER participant's receipt of a 1:1 message. They are stamped by
--      SECURITY DEFINER functions that resolve the recipient from the match, so
--      a member can only ever acknowledge messages addressed to them.
--
--   2. STRICT 2-VIEW MEDIA. M25 shipped a boolean `view_once`. M26 replaces it
--      with a counted `view_limit`/`view_count`, and rewrites the redeem RPC so
--      the SECOND recipient open permanently exhausts the item. The ledger row
--      survives as an audit trail (it is what the ban pipeline reads), but the
--      message is hidden from both members once exhausted.
--
--   3. 24-HOUR DISAPPEARING CHATS. A per-conversation `chat_settings` row can
--      set `disappear_after_seconds`. The `messages` SELECT policy then hides
--      anything older than that window, and `purge_expired_chat_content()`
--      actually deletes it. Neither client nor server trusts the client clock:
--      `now()` decides.
--
-- The bytes still live in the private `chat-media` bucket; only its readability
-- predicate changes, and that is decided from data.
--
-- SAFE TO RE-RUN: idempotent (`if not exists`, `create or replace`, explicit
-- `drop ... if exists` before each create).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Receipt columns on `messages`
-- ---------------------------------------------------------------------------
-- These describe the RECIPIENT's state, not the sender's: a row is "delivered"
-- when the other member's device has fetched it and "seen" when their thread was
-- open and scrolled to it. Null means "not yet", which is exactly how the UI
-- tells a single tick from a double tick.
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists seen_at      timestamptz;

-- The receipt sweep only ever looks at rows still missing a receipt.
create index if not exists messages_pending_receipt_idx
  on public.messages (match_id, created_at)
  where seen_at is null;

-- ---------------------------------------------------------------------------
-- 2. Counted views on `chat_media`
-- ---------------------------------------------------------------------------
-- `view_once` is kept for backward compatibility (and because it is a useful
-- audit flag) but is no longer read by any policy or RPC. `view_count` is
-- incremented by `redeem_chat_media()`; `view_limit` is what the send RPC sets.
alter table public.chat_media add column if not exists view_limit integer not null default 2;
alter table public.chat_media add column if not exists view_count integer not null default 0;

-- Rows written before this migration defaulted to a single view.
update public.chat_media
   set view_limit = 1
 where view_once = true
   and view_limit = 2;

-- ---------------------------------------------------------------------------
-- 3. chat_settings — one row per conversation
-- ---------------------------------------------------------------------------
-- `disappear_after_seconds` is null when normal (non-disappearing) chat is on.
-- The CHECK clamps any value to a sane window so a client cannot ask for a
-- one-second or decade-long retention.
create table if not exists public.chat_settings (
  match_id                uuid primary key references public.matches(id) on delete cascade,
  disappear_after_seconds integer
    check (disappear_after_seconds is null
           or (disappear_after_seconds >= 60 and disappear_after_seconds <= 604800)),
  updated_by              uuid references auth.users(id) on delete set null,
  updated_at              timestamptz not null default now()
);

-- The M4 audit fails any unindexed foreign key; the primary key covers match_id.
create index if not exists chat_settings_updated_by_idx
  on public.chat_settings (updated_by);

alter table public.chat_settings enable row level security;

-- Participants may read their own conversation's setting. There is no write
-- policy: only `set_disappearing_messages()` (SECURITY DEFINER) writes.
drop policy if exists "chat_settings_select_participant" on public.chat_settings;
create policy "chat_settings_select_participant"
  on public.chat_settings for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = chat_settings.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

grant select on public.chat_settings to authenticated;
revoke all on public.chat_settings from anon;

-- ---------------------------------------------------------------------------
-- 4. Expiry helpers (declared BEFORE the policy that calls them)
-- ---------------------------------------------------------------------------
-- `messages.match_id` is `uuid` on the live project and `text` in the harness,
-- so the parameter is `text` and every caller casts; a one-sided comparison
-- would fail CREATE POLICY type-checking on one of the two shapes.
create or replace function public.chat_disappear_seconds(p_match_id text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cs.disappear_after_seconds
  from public.chat_settings cs
  where cs.match_id::text = p_match_id;
$$;

-- Is a message still inside the conversation's retention window? A conversation
-- with no setting (or a null setting) keeps everything.
create or replace function public.message_is_alive(p_match_id text, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select cs.disappear_after_seconds
       from public.chat_settings cs
      where cs.match_id::text = p_match_id),
    0
  ) = 0
  or p_created_at > now() - make_interval(
       secs => (select cs.disappear_after_seconds
                  from public.chat_settings cs
                 where cs.match_id::text = p_match_id)
     );
$$;

revoke all on function public.chat_disappear_seconds(text) from public, anon;
revoke all on function public.message_is_alive(text, timestamptz) from public, anon;
grant execute on function public.chat_disappear_seconds(text) to authenticated;
grant execute on function public.message_is_alive(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. messages SELECT policy — participants, and not past its expiry
-- ---------------------------------------------------------------------------
-- The M25 read path is preserved exactly; the only addition is the retention
-- gate. Because Realtime evaluates this same policy, an expired message is not
-- pushed to a live client either.
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id::text = messages.match_id::text
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
    and public.message_is_alive(messages.match_id::text, messages.created_at)
  );

-- ---------------------------------------------------------------------------
-- 6. chat_media readability — counted views, not a boolean
-- ---------------------------------------------------------------------------
-- The sender may always read their own object. The recipient may read while the
-- item is fresh (views remaining) or during a short grace window after a redeem
-- stamped `viewed_at` — that grace is what lets the bytes actually download on
-- the final permitted open. Once exhausted, the object is unreadable even if a
-- client still knows the path.
create or replace function public.chat_media_can_read_storage(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chat_media cm
    where cm.storage_path = p_name
      and public.chat_media_participant(cm.match_id, auth.uid())
      and (
        cm.sender_id = auth.uid()
        or (
          cm.expires_at > now()
          and (
            cm.view_count < cm.view_limit
            or cm.viewed_at > now() - interval '2 minutes'
          )
        )
      )
  );
$$;

revoke all on function public.chat_media_can_read_storage(text) from public, anon;
grant execute on function public.chat_media_can_read_storage(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. send_chat_media() — now takes a view limit
-- ---------------------------------------------------------------------------
-- The M25 signature took a boolean. It is dropped rather than overloaded so
-- there is exactly one entry point and no ambiguity for a named-argument call.
drop function if exists public.send_chat_media(uuid, text, text, boolean, integer);

create or replace function public.send_chat_media(
  p_match_id     uuid,
  p_storage_path text,
  p_media_type   text    default 'image',
  p_view_limit   integer default 2,
  p_ttl_seconds  integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  msg_id     uuid;
  media_id   uuid;
  ttl        integer;
  vlimit     integer;
  expires    timestamptz;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.chat_media_participant(p_match_id, me) then
    raise exception 'You are not part of this conversation' using errcode = '42501';
  end if;
  if public.is_chat_restricted(me) then
    raise exception 'Your account is paused and you cannot send media right now.' using errcode = '42501';
  end if;
  if p_media_type not in ('image','video') then
    raise exception 'Invalid media type: %', p_media_type using errcode = '22023';
  end if;
  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'Missing media path' using errcode = '22023';
  end if;

  -- Clamp the lifetime: at least a minute, at most a week.
  ttl := greatest(60, least(coalesce(p_ttl_seconds, 86400), 604800));
  -- Every item is a strict 2-view by default; the range keeps a hostile client
  -- from asking for "unlimited" (0) or a thousand views.
  vlimit  := greatest(1, least(coalesce(p_view_limit, 2), 5));
  expires := now() + make_interval(secs => ttl);

  insert into public.messages (match_id, sender_id, content)
  values (p_match_id, me, '')
  returning id into msg_id;

  insert into public.chat_media
    (message_id, match_id, sender_id, storage_path, media_type, view_limit, expires_at)
  values
    (msg_id, p_match_id, me, p_storage_path, p_media_type, vlimit, expires)
  returning id into media_id;

  return jsonb_build_object(
    'media_id', media_id,
    'message_id', msg_id,
    'view_limit', vlimit,
    'expires_at', expires
  );
end;
$$;

revoke all on function public.send_chat_media(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.send_chat_media(uuid, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. redeem_chat_media() — counts a view and exhausts at the limit
-- ---------------------------------------------------------------------------
-- The recipient's open increments `view_count` and stamps `viewed_at`. The
-- sender's own redeem never counts, so they can preview the item they sent.
-- When `view_count` reaches `view_limit` the item reports `exhausted` and neither
-- member can open it again.
create or replace function public.redeem_chat_media(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  cm record;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into cm from public.chat_media where id = p_media_id;
  if not found then
    raise exception 'Media not found' using errcode = 'P0002';
  end if;
  if not public.chat_media_participant(cm.match_id, me) then
    raise exception 'You are not part of this conversation' using errcode = '42501';
  end if;

  if cm.expires_at <= now() then
    return jsonb_build_object('available', false, 'reason', 'expired');
  end if;

  -- The sender previews without spending the recipient's views.
  if cm.sender_id = me then
    return jsonb_build_object(
      'available', true,
      'storage_path', cm.storage_path,
      'media_type', cm.media_type,
      'view_limit', cm.view_limit,
      'view_count', cm.view_count,
      'remaining', greatest(cm.view_limit - cm.view_count, 0),
      'expires_at', cm.expires_at
    );
  end if;

  if cm.view_count >= cm.view_limit then
    return jsonb_build_object('available', false, 'reason', 'exhausted');
  end if;

  update public.chat_media
     set view_count = cm.view_count + 1,
         viewed_at  = now()
   where id = cm.id
  returning view_count into cm.view_count;

  return jsonb_build_object(
    'available', true,
    'storage_path', cm.storage_path,
    'media_type', cm.media_type,
    'view_limit', cm.view_limit,
    'view_count', cm.view_count,
    'remaining', greatest(cm.view_limit - cm.view_count, 0),
    'expires_at', cm.expires_at
  );
end;
$$;

revoke all on function public.redeem_chat_media(uuid) from public, anon;
grant execute on function public.redeem_chat_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. set_disappearing_messages() — the 24-hour toggle
-- ---------------------------------------------------------------------------
-- Only a participant may change it, and only to a value inside the CHECK window.
-- Passing null (or 0) disables disappearing mode.
create or replace function public.set_disappearing_messages(p_match_id uuid, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me    uuid := auth.uid();
  secs  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  secs := nullif(p_seconds, 0);
  if secs is not null then
    secs := greatest(60, least(secs, 604800));
  end if;

  insert into public.chat_settings (match_id, disappear_after_seconds, updated_by, updated_at)
  values (p_match_id, secs, me, now())
  on conflict (match_id) do update
    set disappear_after_seconds = excluded.disappear_after_seconds,
        updated_by              = excluded.updated_by,
        updated_at              = now();

  return jsonb_build_object('disappear_after_seconds', secs);
end;
$$;

revoke all on function public.set_disappearing_messages(uuid, integer) from public, anon;
grant execute on function public.set_disappearing_messages(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Receipts: mark_conversation_read() also stamps "seen"
-- ---------------------------------------------------------------------------
-- Opening the thread clears the badge (M11) AND acknowledges everything the
-- other member sent, in one round trip. The recipient is derived from the match,
-- never from an argument, so a member can only acknowledge messages sent TO them.
create or replace function public.mark_conversation_read(p_match_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  ts timestamptz := now();
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  insert into public.match_read_state (match_id, user_id, last_read_at)
  values (p_match_id, me, ts)
  on conflict (match_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  update public.messages
     set seen_at      = ts,
         delivered_at = coalesce(delivered_at, ts)
   where messages.match_id::text = p_match_id::text
     and messages.sender_id <> me
     and messages.seen_at is null;

  return ts;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- mark_messages_delivered() — the lighter acknowledgement, called as soon as the
-- recipient's device has the thread open (whether or not they have read it).
create or replace function public.mark_messages_delivered(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  n  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  update public.messages
     set delivered_at = now()
   where messages.match_id::text = p_match_id::text
     and messages.sender_id <> me
     and messages.delivered_at is null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_messages_delivered(uuid) from public, anon;
grant execute on function public.mark_messages_delivered(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. purge_expired_chat_content() — actually delete what has aged out
-- ---------------------------------------------------------------------------
-- RLS hides expired messages; this removes them for good (and their media ledger
-- rows for good measure). A member may only purge conversations they are in, and
-- only rows past that conversation's window.
create or replace function public.purge_expired_chat_content()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  removed integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  delete from public.chat_media cm
   where exists (
     select 1
     from public.messages m
     join public.chat_settings cs on cs.match_id::text = m.match_id::text
     join public.matches mt        on mt.id::text = m.match_id::text
     where cm.message_id = m.id
       and cs.disappear_after_seconds is not null
       and (mt.user_a = me or mt.user_b = me)
       and m.created_at < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  delete from public.messages m
   where exists (
     select 1
     from public.chat_settings cs
     join public.matches mt on mt.id::text = m.match_id::text
     where cs.match_id::text = m.match_id::text
       and cs.disappear_after_seconds is not null
       and (mt.user_a = me or mt.user_b = me)
       and m.created_at < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_chat_content() from public, anon;
grant execute on function public.purge_expired_chat_content() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Realtime — publish chat_media so an exhausted item vanishes live
-- ---------------------------------------------------------------------------
-- `messages` was already added by M11 and its publication publishes UPDATE, so
-- a receipt change reaches the sender. `chat_media` is new here.
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_media'
    ) then
      alter publication supabase_realtime add table public.chat_media;
      raise notice 'chat_media added to supabase_realtime';
    else
      raise notice 'chat_media already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for chat_media in the dashboard';
  end if;
end
$rt$;

-- ---------------------------------------------------------------------------
-- 13. Documentation for the next reader
-- ---------------------------------------------------------------------------
comment on column public.messages.delivered_at is
  'When the OTHER participant''s device fetched this message (M26 delivery receipt).';
comment on column public.messages.seen_at is
  'When the OTHER participant read this message with the thread open (M26 read receipt).';
comment on column public.chat_media.view_limit is
  'How many times the recipient may open this item (M26; default 2).';
comment on column public.chat_media.view_count is
  'Times the recipient has opened this item (M26). At view_limit the item is exhausted.';
comment on table public.chat_settings is
  'Per-conversation retention (M26). disappear_after_seconds non-null enables disappearing mode; written only by set_disappearing_messages().';
comment on function public.redeem_chat_media(uuid) is
  'Counts one recipient open of a chat media item and returns its path; refuses once view_count reaches view_limit (M26).';
comment on function public.mark_messages_delivered(uuid) is
  'Stamps delivered_at on unacknowledged messages the signed-in member received (M26).';
comment on function public.purge_expired_chat_content() is
  'Deletes messages (and their media ledger rows) past their conversation''s disappearing window (M26).';
