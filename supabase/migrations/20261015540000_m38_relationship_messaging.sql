-- =============================================================================
-- M38 · Relationship-aware messaging
-- =============================================================================
-- WHY
--   A match row is also the conversation container, but the product needs three
--   different relationships on top of it:
--
--   * a reciprocal, eligible cross-gender follow is a romantic MATCH;
--   * a reciprocal follow that is not match-eligible may still chat;
--   * a one-way follow may start a MESSAGE REQUEST with a three-message cap
--     until the recipient accepts or rejects it.
--
--   M34's two-message cap keyed off "the other person has replied", so a request
--   could not be explicitly accepted or rejected. This migration keeps the
--   existing `matches` row as the conversation id (messages, media, receipts and
--   archives all reference it), and adds the relationship state to that row.
--
-- SECURITY
--   `matches` still has no client INSERT/UPDATE policy. Request creation and
--   acceptance go through participant-checking SECURITY DEFINER RPCs. The
--   three-message cap remains a BEFORE INSERT trigger so a modified client
--   cannot bypass it.
--
-- SAFE TO RE-RUN: additive column guards, replaceable functions, and
-- `drop ... if exists` before triggers/functions that change return type.
-- DEPENDS ON: M10 (matches), M11 (messages), M23 (pair_should_match),
--             M26 (expiry helpers), M33 (sync_match_for_pair), M34 (inbox).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Relationship state on the conversation row
-- ---------------------------------------------------------------------------
alter table public.matches add column if not exists kind text;
alter table public.matches add column if not exists request_status text;
alter table public.matches add column if not exists requested_by uuid references auth.users(id) on delete set null;
alter table public.matches add column if not exists requested_at timestamptz;
alter table public.matches add column if not exists responded_at timestamptz;
alter table public.matches add column if not exists updated_at timestamptz not null default now();

update public.matches
   set kind = coalesce(kind, 'match'),
       request_status = coalesce(request_status, 'not_applicable'),
       updated_at = coalesce(updated_at, created_at, now());

alter table public.matches alter column kind set default 'match';
alter table public.matches alter column kind set not null;
alter table public.matches alter column request_status set default 'not_applicable';
alter table public.matches alter column request_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_kind_check'
  ) then
    alter table public.matches
      add constraint matches_kind_check
      check (kind in ('match', 'mutual_follow', 'request', 'closed'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'matches_request_status_check'
  ) then
    alter table public.matches
      add constraint matches_request_status_check
      check (request_status in ('not_applicable', 'pending', 'accepted', 'rejected'));
  end if;
end $$;

create index if not exists matches_kind_idx on public.matches (kind);
create index if not exists matches_requested_by_idx on public.matches (requested_by)
  where requested_by is not null;

comment on column public.matches.kind is
  'match = romantic cross-gender mutual follow; mutual_follow = chat-enabled reciprocal follow; request = one-way message request; closed = retained history without chat access.';
comment on column public.matches.request_status is
  'Only meaningful when kind = request. A rejected request remains as a tombstone so it cannot silently reopen.';

-- ---------------------------------------------------------------------------
-- 2. One state vocabulary shared by the RPCs and the client
-- ---------------------------------------------------------------------------
create or replace function public.connection_relationship_state(
  p_kind text,
  p_request_status text,
  p_blocked boolean
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_blocked, false) then 'BLOCKED'
    when p_kind = 'match' then 'MATCHED'
    when p_kind = 'mutual_follow' then 'MUTUAL_FOLLOW_CHAT'
    when p_kind = 'request' and p_request_status = 'pending' then 'MESSAGE_REQUEST_PENDING'
    when p_kind = 'request' and p_request_status = 'accepted' then 'MESSAGE_REQUEST_ACCEPTED'
    else 'UNAVAILABLE'
  end;
$$;

revoke all on function public.connection_relationship_state(text, text, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reconcile follow changes without losing chat history
-- ---------------------------------------------------------------------------
create or replace function public.sync_match_for_pair(a uuid, b uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lo uuid;
  hi uuid;
  conn public.matches%rowtype;
  mutual boolean := false;
  one_way boolean := false;
  keeps_request boolean := false;
  has_messages boolean := false;
begin
  if a is null or b is null or a = b then
    return;
  end if;

  lo := least(a, b);
  hi := greatest(a, b);

  perform pg_advisory_xact_lock(hashtext(lo::text || ':' || hi::text));

  select * into conn
  from public.matches m
  where m.user_a = lo and m.user_b = hi;

  if public.is_blocked_pair(lo, hi) then
    if conn.id is null then
      return;
    end if;

    select exists (
      select 1 from public.messages msg where msg.match_id::text = conn.id::text
    ) into has_messages;

    if has_messages then
      update public.matches
         set kind = 'closed',
             request_status = 'not_applicable',
             updated_at = now()
       where id = conn.id;
    else
      delete from public.matches where id = conn.id;
    end if;
    return;
  end if;

  if public.pair_should_match(lo, hi) then
    insert into public.matches (
      user_a, user_b, kind, request_status, requested_by, requested_at, responded_at
    )
    values (lo, hi, 'match', 'not_applicable', null, null, null)
    on conflict (user_a, user_b) do update
      set kind = 'match',
          request_status = 'not_applicable',
          requested_by = null,
          requested_at = null,
          responded_at = null,
          updated_at = now();
    return;
  end if;

  if conn.id is null then
    return;
  end if;

  mutual := exists (
    select 1 from public.follows f
    where f.follower_id = lo and f.following_id = hi
  ) and exists (
    select 1 from public.follows f
    where f.follower_id = hi and f.following_id = lo
  );

  if mutual then
    update public.matches
       set kind = 'mutual_follow',
           request_status = 'not_applicable',
           requested_by = null,
           requested_at = null,
           responded_at = null,
           updated_at = now()
     where id = conn.id;
    return;
  end if;

  -- A rejection is a tombstone: it must not be deleted (which would allow a new
  -- request) or upgraded by a later one-way follow. A new mutual follow is
  -- consent for the separate mutual-follow chat handled above.
  if conn.kind = 'request' and conn.request_status = 'rejected' then
    return;
  end if;

  one_way := exists (
    select 1 from public.follows f
    where (f.follower_id = lo and f.following_id = hi)
       or (f.follower_id = hi and f.following_id = lo)
  );

  if one_way and conn.kind = 'request' and conn.request_status = 'pending'
     and conn.requested_by in (lo, hi) then
    keeps_request := exists (
      select 1 from public.follows f
      where f.follower_id = conn.requested_by
        and f.following_id = case when conn.requested_by = lo then hi else lo end
    );
    if keeps_request then
      return;
    end if;
  end if;

  if one_way then
    select exists (
      select 1 from public.messages msg where msg.match_id::text = conn.id::text
    ) into has_messages;

    if has_messages then
      update public.matches
         set kind = 'closed',
             request_status = 'not_applicable',
             updated_at = now()
       where id = conn.id;
    else
      delete from public.matches where id = conn.id;
    end if;
    return;
  end if;

  select exists (
    select 1 from public.messages msg where msg.match_id::text = conn.id::text
  ) into has_messages;

  if has_messages then
    update public.matches
       set kind = 'closed',
           request_status = 'not_applicable',
           updated_at = now()
     where id = conn.id;
  else
    delete from public.matches where id = conn.id;
  end if;
end;
$$;

revoke all on function public.sync_match_for_pair(uuid, uuid) from public, anon, authenticated;

comment on function public.sync_match_for_pair(uuid, uuid) is
  'Reconciles a canonical pair: romantic match, chat-enabled mutual follow, retained closed history, or no row. Internal trigger helper.';

-- ---------------------------------------------------------------------------
-- 4. Count only romantic matches
-- ---------------------------------------------------------------------------
create or replace function public.sync_match_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'match' then
      update public.profiles
        set matches_count = matches_count + 1
        where id in (new.user_a, new.user_b);
    end if;
  elsif tg_op = 'DELETE' then
    if old.kind = 'match' then
      update public.profiles
        set matches_count = greatest(matches_count - 1, 0)
        where id in (old.user_a, old.user_b);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.kind = 'match' and new.kind <> 'match' then
      update public.profiles
        set matches_count = greatest(matches_count - 1, 0)
        where id in (old.user_a, old.user_b);
    elsif old.kind <> 'match' and new.kind = 'match' then
      update public.profiles
        set matches_count = matches_count + 1
        where id in (new.user_a, new.user_b);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists matches_sync_counts_trg on public.matches;
create trigger matches_sync_counts_trg
  after insert or update of kind or delete on public.matches
  for each row execute function public.sync_match_counts();

-- ---------------------------------------------------------------------------
-- 5. Notify only when a romantic match is created or upgraded
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind <> 'match' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.kind = 'match' then
    return new;
  end if;

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
  after insert or update of kind on public.matches
  for each row execute function public.notify_on_match();

-- ---------------------------------------------------------------------------
-- 6. Start a conversation: match, mutual-follow chat, or message request
-- ---------------------------------------------------------------------------
drop function if exists public.start_conversation(uuid);
create function public.start_conversation(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  lo uuid;
  hi uuid;
  conn public.matches%rowtype;
  target_available boolean := false;
  is_mutual boolean := false;
  blocked boolean := false;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null or p_target = me then
    raise exception 'Choose another member to message.' using errcode = '22023';
  end if;

  lo := least(me, p_target);
  hi := greatest(me, p_target);

  select exists (
    select 1 from public.profiles p
    where p.id = p_target
      and coalesce(p.onboarding_completed, false)
      and not coalesce(p.is_suspended, false)
      and (p.banned_until is null or p.banned_until <= now())
  ) into target_available;

  if not target_available then
    raise exception 'This member is unavailable.' using errcode = '42501';
  end if;

  select public.is_blocked_pair(lo, hi) into blocked;
  if blocked then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  perform public.sync_match_for_pair(lo, hi);

  select * into conn
  from public.matches m
  where m.user_a = lo and m.user_b = hi;

  if conn.id is null then
    if not exists (
      select 1 from public.follows f
      where f.follower_id = me and f.following_id = p_target
    ) then
      raise exception 'Follow this member before sending a message request.'
        using errcode = '42501';
    end if;

    is_mutual := exists (
      select 1 from public.follows f
      where f.follower_id = p_target and f.following_id = me
    );

    if is_mutual then
      insert into public.matches (
        user_a, user_b, kind, request_status, requested_by, requested_at, responded_at
      )
      values (lo, hi, 'mutual_follow', 'not_applicable', null, null, null)
      on conflict (user_a, user_b) do nothing;
    else
      insert into public.matches (
        user_a, user_b, kind, request_status, requested_by, requested_at, responded_at
      )
      values (lo, hi, 'request', 'pending', me, now(), null)
      on conflict (user_a, user_b) do nothing;
    end if;

    select * into conn
    from public.matches m
    where m.user_a = lo and m.user_b = hi;
  end if;

  if conn.id is null then
    raise exception 'The conversation could not be started.' using errcode = '42501';
  end if;

  if conn.kind = 'closed'
     or (conn.kind = 'request' and conn.request_status = 'rejected') then
    raise exception 'This conversation is no longer available.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'conversation_id', conn.id,
    'relationship_state', public.connection_relationship_state(conn.kind, conn.request_status, false),
    'request_status', conn.request_status,
    'requested_by_me', coalesce(conn.requested_by = me, false)
  );
end;
$$;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

comment on function public.start_conversation(uuid) is
  'Idempotently opens the connection row for the signed-in member and a target. Creates a pending request only for a one-way follow.';

-- ---------------------------------------------------------------------------
-- 7. Accept or reject a pending request
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_conversation_request(
  p_match_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conn public.matches%rowtype;
  next_status text;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_match_id::text || ':request'));

  select * into conn from public.matches m where m.id = p_match_id;
  if conn.id is null or (conn.user_a <> me and conn.user_b <> me) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if public.is_blocked_pair(conn.user_a, conn.user_b) then
    raise exception 'This conversation is unavailable.' using errcode = '42501';
  end if;
  if conn.kind <> 'request' then
    raise exception 'This conversation is not a message request.' using errcode = '22023';
  end if;
  if conn.requested_by = me then
    raise exception 'Only the recipient can respond to this request.' using errcode = '42501';
  end if;
  if conn.request_status = 'accepted' then
    return jsonb_build_object(
      'conversation_id', conn.id,
      'relationship_state', 'MESSAGE_REQUEST_ACCEPTED',
      'request_status', 'accepted'
    );
  end if;
  if conn.request_status = 'rejected' then
    raise exception 'This request has already been declined.' using errcode = '22023';
  end if;
  if conn.request_status <> 'pending' then
    raise exception 'This conversation is not awaiting a response.' using errcode = '22023';
  end if;

  next_status := case when coalesce(p_accept, false) then 'accepted' else 'rejected' end;

  update public.matches
     set request_status = next_status,
         responded_at = now(),
         updated_at = now()
   where id = conn.id;

  return jsonb_build_object(
    'conversation_id', conn.id,
    'relationship_state', public.connection_relationship_state('request', next_status, false),
    'request_status', next_status
  );
end;
$$;

revoke all on function public.respond_to_conversation_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_conversation_request(uuid, boolean) to authenticated;

comment on function public.respond_to_conversation_request(uuid, boolean) is
  'Recipient-only accept/reject for a pending message request. Acceptance unlocks unlimited replies; rejection is permanent.';

-- ---------------------------------------------------------------------------
-- 8. Three-message cap while a request is pending
-- ---------------------------------------------------------------------------
create or replace function public.enforce_message_request_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  other_user uuid;
  conn_kind text;
  conn_status text;
  requester uuid;
  sent_count integer := 0;
begin
  select case
           when m.user_a = new.sender_id then m.user_b
           when m.user_b = new.sender_id then m.user_a
           else null
         end,
         m.kind,
         m.request_status,
         m.requested_by
    into other_user, conn_kind, conn_status, requester
  from public.matches m
  where m.id::text = new.match_id::text
  limit 1;

  -- Synthetic fixture ids are still governed by the M11 participation trigger.
  if other_user is null then
    return new;
  end if;

  if public.is_blocked_pair(new.sender_id, other_user) then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  if conn_kind in ('match', 'mutual_follow') then
    return new;
  end if;

  if conn_kind <> 'request' then
    raise exception 'This conversation is no longer available.' using errcode = '42501';
  end if;

  if conn_status = 'accepted' then
    return new;
  end if;

  if conn_status = 'rejected' then
    raise exception 'This message request was declined.' using errcode = '42501';
  end if;

  if conn_status <> 'pending' then
    raise exception 'This conversation is no longer available.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.match_id::text || ':request'));

  if requester = new.sender_id then
    if not exists (
      select 1 from public.follows f
      where f.follower_id = new.sender_id and f.following_id = other_user
    ) then
      raise exception 'Follow this member to keep this message request open.'
        using errcode = '42501';
    end if;

    select count(*)::int into sent_count
    from public.messages msg
    where msg.match_id::text = new.match_id::text
      and msg.sender_id = new.sender_id;

    if sent_count >= 3 then
      raise exception
        'You can send three messages until this member accepts your request.'
        using errcode = '42501';
    end if;
  else
    -- The recipient replying is an acceptance in the same transaction.
    update public.matches
       set request_status = 'accepted',
           responded_at = now(),
           updated_at = now()
     where id::text = new.match_id::text;
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
  'Caps a pending-request sender at three messages. A recipient reply auto-accepts and lifts the cap.';

-- ---------------------------------------------------------------------------
-- 9. Send-state projection for the thread
-- ---------------------------------------------------------------------------
drop function if exists public.conversation_send_state(uuid);

create or replace function public.conversation_send_state(p_match_id uuid)
returns table (
  relationship_state text,
  request_status     text,
  is_request         boolean,
  requested_by_me    boolean,
  can_respond        boolean,
  sent_count         integer,
  send_limit         integer,
  can_send           boolean,
  other_has_replied  boolean
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
      m.kind,
      m.request_status,
      m.requested_by,
      case when m.user_a = me.uid then m.user_b else m.user_a end as other_user_id,
      public.is_blocked_pair(m.user_a, m.user_b) as is_blocked
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
    public.connection_relationship_state(
      participant.kind, participant.request_status, participant.is_blocked
    ) as relationship_state,
    participant.request_status,
    (participant.kind = 'request' and participant.request_status = 'pending'
      and participant.requested_by <> (select uid from me)) as is_request,
    coalesce(participant.requested_by = (select uid from me), false) as requested_by_me,
    (participant.kind = 'request' and participant.request_status = 'pending'
      and participant.requested_by <> (select uid from me)
      and not participant.is_blocked) as can_respond,
    coalesce(stats.sent_count, 0) as sent_count,
    3 as send_limit,
    case
      when participant.is_blocked then false
      when participant.kind in ('match', 'mutual_follow') then true
      when participant.kind = 'request' and participant.request_status = 'accepted' then true
      when participant.kind = 'request' and participant.request_status = 'pending'
        then participant.requested_by <> (select uid from me)
             or coalesce(stats.sent_count, 0) < 3
      else false
    end as can_send,
    (coalesce(stats.received_count, 0) > 0) as other_has_replied
  from participant
  left join stats on true;
$$;

revoke all on function public.conversation_send_state(uuid) from public, anon;
grant execute on function public.conversation_send_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Inbox projection with request direction
-- ---------------------------------------------------------------------------
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
  is_online       boolean,
  relationship_state text,
  request_status  text,
  requested_by_me boolean
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
      m.kind,
      m.request_status,
      m.requested_by,
      public.is_blocked_pair(m.user_a, m.user_b) as is_blocked,
      case when m.user_a = me.uid then m.user_b else m.user_a end as other_user_id
    from public.matches m, me
    where me.uid is not null
      and (m.user_a = me.uid or m.user_b = me.uid)
      and not (m.kind = 'closed')
      and not (m.kind = 'request' and m.request_status = 'rejected')
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
    (mine.kind = 'request' and mine.request_status = 'pending'
      and mine.requested_by <> (select uid from me)) as is_request,
    coalesce(
      case
        when coalesce(pref.show_online_status, true) = false then false
        when p.last_seen_at is not null
          then p.last_seen_at >= now() - interval '2 minutes'
        else coalesce(p.is_online, false)
      end,
      false
    ) as is_online,
    public.connection_relationship_state(mine.kind, mine.request_status, mine.is_blocked)
      as relationship_state,
    mine.request_status,
    coalesce(mine.requested_by = (select uid from me), false) as requested_by_me
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
  'Inbox rows for the signed-in member with relationship state, request direction, last visible message, unread count, archive state and privacy-aware online state.';

-- ---------------------------------------------------------------------------
-- 11. Repair existing counters after the kind column arrives
-- ---------------------------------------------------------------------------
update public.profiles p
   set matches_count = (
     select count(*)::int
     from public.matches m
     where m.kind = 'match'
       and (m.user_a = p.id or m.user_b = p.id)
   );
