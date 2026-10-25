-- =============================================================================
-- M34 · Two-message requests and an inbox with archive + online contacts
-- =============================================================================
-- WHY
--   A new match had no pacing: one member could send an unlimited wall of text
--   before the other had replied. The inbox also had no way to separate an
--   unanswered approach from an active conversation, and no archive.
--
-- WHAT
--   1. A message sender may send at most TWO messages in a conversation until
--      the other participant replies. Once either side replies, the limit is
--      lifted for both. This is enforced by a BEFORE INSERT trigger, not by the
--      composer, so a modified client or direct PostgREST call cannot bypass it.
--   2. `conversation_archive` stores a per-member archive flag. RLS scopes every
--      row to its owner, and writes go through a participant-checking RPC.
--   3. `conversation_summaries()` returns the inbox projection in one request:
--      last visible message, unread count, request state, archive state and the
--      other participant's expiring online state.
--   4. `conversation_send_state()` lets the thread explain the limit before a
--      send is refused; the trigger remains the authority.
--
-- COMPATIBILITY
--   `messages.match_id` is `uuid` on the live project and `text` in some rebuilt
--   environments. Every comparison casts to text, exactly as M11/M26 require.
--
-- SAFE TO RE-RUN: table/column guards, `create or replace`, and explicit
-- `drop ... if exists` before policy/trigger creation.
-- DEPENDS ON: M11 (messages), M23 (matches), M26 (expiry helpers), M32
--             (existing notification/social tables are untouched).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Per-member conversation archive
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_archive (
  match_id    uuid not null references public.matches(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- The PK covers match_id; this covers the member lookup the inbox performs.
create index if not exists conversation_archive_user_idx
  on public.conversation_archive (user_id, archived_at desc);

alter table public.conversation_archive enable row level security;

drop policy if exists "conversation_archive_select_own" on public.conversation_archive;
create policy "conversation_archive_select_own"
  on public.conversation_archive for select to authenticated
  using (auth.uid() = user_id);

-- Writes go through `set_conversation_archived()`, which checks participation.
-- A client therefore gets SELECT-only and cannot invent a row for a match it is
-- not part of, even though the row would only affect its own inbox.
drop policy if exists "conversation_archive_insert_own" on public.conversation_archive;
drop policy if exists "conversation_archive_update_own" on public.conversation_archive;
drop policy if exists "conversation_archive_delete_own" on public.conversation_archive;

revoke all on public.conversation_archive from anon, authenticated;
grant select on public.conversation_archive to authenticated;

comment on table public.conversation_archive is
  'Owner-scoped archive flag for a match conversation. A member can archive only their own view; the other participant is unaffected.';

-- ---------------------------------------------------------------------------
-- 2. The two-message request limit
-- ---------------------------------------------------------------------------
-- "Request" here is the existing match conversation before the second member
-- has ever replied. Two is a hard cap per sender until that reply exists. The
-- advisory lock serializes simultaneous inserts from one sender so two racing
-- requests cannot both observe `sent_count = 0` and write a third message.
create or replace function public.enforce_message_request_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  other_user uuid;
  sent_count integer := 0;
  other_replied boolean := false;
begin
  select case
           when m.user_a = new.sender_id then m.user_b
           when m.user_b = new.sender_id then m.user_a
           else null
         end
    into other_user
  from public.matches m
  where m.id::text = new.match_id::text
  limit 1;

  -- No resolvable match: the M11 participation trigger is the relevant gate.
  -- Keeping this function permissive preserves fixture inserts with synthetic
  -- match ids while every real conversation is governed by the cap.
  if other_user is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(new.match_id::text || ':' || new.sender_id::text)
  );

  select exists (
    select 1
    from public.messages msg
    where msg.match_id::text = new.match_id::text
      and msg.sender_id = other_user
  ) into other_replied;

  if other_replied then
    return new;
  end if;

  select count(*)::int into sent_count
  from public.messages msg
  where msg.match_id::text = new.match_id::text
    and msg.sender_id = new.sender_id;

  if sent_count >= 2 then
    raise exception
      'You can send two messages until this member replies.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_request_limit_trg on public.messages;
create trigger enforce_message_request_limit_trg
  before insert on public.messages
  for each row execute function public.enforce_message_request_limit();

revoke all on function public.enforce_message_request_limit() from public, anon, authenticated;

comment on function public.enforce_message_request_limit() is
  'Caps a sender at two messages in a conversation until the other participant replies. Enforced for every INSERT path.';

-- ---------------------------------------------------------------------------
-- 3. Inbox projection
-- ---------------------------------------------------------------------------
-- Only the latest message still inside the conversation's retention window is
-- returned as "last". A request is an incoming conversation the caller has not
-- replied to yet; once the caller replies it moves to the main inbox. Archived
-- conversations remain in the archive until explicitly restored.
drop function if exists public.conversation_summaries();

create or replace function public.conversation_summaries()
returns table (
  match_id        uuid,
  other_user_id   uuid,
  other_display_name text,
  other_username  text,
  other_avatar_url text,
  last_message    text,
  last_message_at timestamptz,
  last_sender_id  uuid,
  last_message_is_mine boolean,
  unread_count    integer,
  is_archived     boolean,
  is_request      boolean,
  is_online       boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select auth.uid() as uid
  ),
  mine as (
    select
      m.id,
      m.created_at as match_created_at,
      case when m.user_a = me.uid then m.user_b else m.user_a end as other_user_id
    from public.matches m, me
    where me.uid is not null
      and (m.user_a = me.uid or m.user_b = me.uid)
  ),
  alive_messages as (
    select
      msg.id,
      msg.match_id,
      msg.sender_id,
      msg.content,
      msg.created_at
    from public.messages msg
    join mine on mine.id::text = msg.match_id::text
    where public.message_is_alive(msg.match_id::text, msg.created_at)
  ),
  last_message as (
    select distinct on (msg.match_id)
      msg.match_id::text as match_key,
      msg.content,
      msg.created_at,
      msg.sender_id
    from alive_messages msg
    order by msg.match_id, msg.created_at desc, msg.id desc
  ),
  counts as (
    select
      mine.id as match_id,
      count(msg.id) filter (
        where msg.sender_id = (select uid from me)
      )::int as my_count,
      count(msg.id) filter (
        where msg.sender_id = mine.other_user_id
      )::int as their_count
    from mine
    left join alive_messages msg on msg.match_id::text = mine.id::text
    group by mine.id, mine.other_user_id
  ),
  unread as (
    select
      mine.id as match_id,
      count(msg.id) filter (
        where msg.sender_id = mine.other_user_id
          and msg.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
      )::int as unread_count
    from mine
    left join public.match_read_state rs
      on rs.match_id = mine.id and rs.user_id = (select uid from me)
    left join alive_messages msg on msg.match_id::text = mine.id::text
    group by mine.id, mine.other_user_id, rs.last_read_at
  )
  select
    mine.id as match_id,
    mine.other_user_id,
    p.display_name as other_display_name,
    p.username as other_username,
    p.avatar_url as other_avatar_url,
    lm.content as last_message,
    lm.created_at as last_message_at,
    lm.sender_id as last_sender_id,
    coalesce(lm.sender_id = (select uid from me), false) as last_message_is_mine,
    coalesce(u.unread_count, 0) as unread_count,
    (ca.archived_at is not null) as is_archived,
    (coalesce(c.their_count, 0) > 0 and coalesce(c.my_count, 0) = 0) as is_request,
    coalesce(
      case
        when coalesce(pref.show_online_status, true) = false then false
        when p.last_seen_at is not null
          then p.last_seen_at >= now() - interval '2 minutes'
        else coalesce(p.is_online, false)
      end,
      false
    ) as is_online
  from mine
  left join last_message lm on lm.match_key = mine.id::text
  left join counts c on c.match_id = mine.id
  left join unread u on u.match_id = mine.id
  left join public.conversation_archive ca
    on ca.match_id = mine.id and ca.user_id = (select uid from me)
  left join public.profiles p on p.id = mine.other_user_id
  left join public.user_preferences pref on pref.user_id = mine.other_user_id
  order by coalesce(lm.created_at, mine.match_created_at) desc, mine.id;
$$;

revoke all on function public.conversation_summaries() from public, anon;
grant execute on function public.conversation_summaries() to authenticated;

comment on function public.conversation_summaries() is
  'Inbox rows for the signed-in member: last visible message, unread count, request/archive state and the other member''s privacy-aware online state.';

-- ---------------------------------------------------------------------------
-- 4. Send-state projection for the thread
-- ---------------------------------------------------------------------------
-- Returns no row for a non-participant. The trigger above is still the only
-- authority; this is explanatory UI state, never a permission decision.
drop function if exists public.conversation_send_state(uuid);

create or replace function public.conversation_send_state(p_match_id uuid)
returns table (
  is_request        boolean,
  sent_count        integer,
  send_limit        integer,
  can_send          boolean,
  other_has_replied boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select auth.uid() as uid
  ),
  participant as (
    select
      m.id,
      case when m.user_a = me.uid then m.user_b else m.user_a end as other_user_id
    from public.matches m, me
    where me.uid is not null
      and m.id = p_match_id
      and (m.user_a = me.uid or m.user_b = me.uid)
  ),
  stats as (
    select
      count(msg.id) filter (where msg.sender_id = (select uid from me))::int as sent_count,
      count(msg.id) filter (where msg.sender_id = participant.other_user_id)::int as received_count
    from participant
    left join public.messages msg on msg.match_id::text = participant.id::text
    group by participant.other_user_id
  )
  select
    (coalesce(stats.received_count, 0) > 0 and coalesce(stats.sent_count, 0) = 0) as is_request,
    coalesce(stats.sent_count, 0) as sent_count,
    2 as send_limit,
    (coalesce(stats.received_count, 0) > 0 or coalesce(stats.sent_count, 0) < 2) as can_send,
    (coalesce(stats.received_count, 0) > 0) as other_has_replied
  from participant
  left join stats on true;
$$;

revoke all on function public.conversation_send_state(uuid) from public, anon;
grant execute on function public.conversation_send_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Archive / restore RPC
-- ---------------------------------------------------------------------------
create or replace function public.set_conversation_archived(
  p_match_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
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

  if coalesce(p_archived, false) then
    insert into public.conversation_archive (match_id, user_id, archived_at)
    values (p_match_id, me, now())
    on conflict (match_id, user_id)
      do update set archived_at = excluded.archived_at;
  else
    delete from public.conversation_archive
    where match_id = p_match_id and user_id = me;
  end if;

  return coalesce(p_archived, false);
end;
$$;

revoke all on function public.set_conversation_archived(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_archived(uuid, boolean) to authenticated;

comment on function public.set_conversation_archived(uuid, boolean) is
  'Archives or restores one conversation for the signed-in participant only. The other member''s inbox is unaffected.';

-- ---------------------------------------------------------------------------
-- 6. Posture report
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'conversation_archive'
group by c.relname, c.relrowsecurity;
