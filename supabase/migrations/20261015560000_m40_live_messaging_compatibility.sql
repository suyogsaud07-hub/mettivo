-- =============================================================================
-- M40 · Live messaging compatibility and relationship repair
-- =============================================================================
-- WHY
--   The live `matches` table is the conversation container, but it uses
--   `user_a_id` / `user_b_id` while the repository still writes and reads the
--   legacy nullable `user_a` / `user_b` columns. The deployed inbox RPCs also
--   query a `conversations` table and `messages.conversation_id`, neither of
--   which exists.
--
-- WHAT
--   * Make the canonical participant columns authoritative and keep the legacy
--     columns synchronized for older callers.
--   * Add explicit relationship/request state to `matches`.
--   * Repair the inbox, send-state, request, participation, notification and
--     counter paths against the live shape.
--   * Enforce Mettivo's messaging rules: any eligible member may ask to chat,
--     mutual follows chat directly, only opposite-gender mutual follows become
--     romantic matches, and non-mutual requests are capped at three messages.
--
-- SAFE TO RE-RUN: additive columns, guarded constraints/indexes, and replaceable
-- functions/triggers. Existing messages, media, receipts and blocks are kept.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canonical participant columns and relationship state
-- ---------------------------------------------------------------------------
alter table public.matches add column if not exists user_a_id uuid;
alter table public.matches add column if not exists user_b_id uuid;
alter table public.matches add column if not exists status text not null default 'pending';

alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status in ('pending', 'accepted', 'blocked', 'closed'));

alter table public.matches add column if not exists kind text;
alter table public.matches add column if not exists request_status text;
alter table public.matches add column if not exists requested_by uuid
  references auth.users(id) on delete set null;
alter table public.matches add column if not exists requested_at timestamptz;
alter table public.matches add column if not exists responded_at timestamptz;
alter table public.matches add column if not exists updated_at timestamptz;

-- Backfill in both directions before normalizing the pair ordering. If one side
-- has data, the other side is derivable; a genuine disagreement is a deployment
-- error and must stop the migration rather than silently pick a winner.
update public.matches
   set user_a_id = coalesce(user_a_id, user_a),
       user_b_id = coalesce(user_b_id, user_b),
       user_a    = coalesce(user_a, user_a_id),
       user_b    = coalesce(user_b, user_b_id)
 where user_a_id is null
    or user_b_id is null
    or user_a is null
    or user_b is null;

do $$
begin
  if exists (
    select 1 from public.matches
    where user_a_id is null or user_b_id is null
       or user_a is null or user_b is null
  ) then
    raise exception
      'M40 preflight: matches rows have missing participant columns';
  end if;

  if exists (
    select 1
    from public.matches
    where least(user_a, user_b) <> least(user_a_id, user_b_id)
       or greatest(user_a, user_b) <> greatest(user_a_id, user_b_id)
  ) then
    raise exception
      'M40 preflight: legacy and canonical match participants disagree';
  end if;

  if exists (
    select 1
    from public.matches
    group by least(user_a_id, user_b_id), greatest(user_a_id, user_b_id)
    having count(*) > 1
  ) then
    raise exception
      'M40 preflight: duplicate/reverse match rows exist; consolidate them before applying';
  end if;
end $$;

update public.matches
   set user_a_id = least(user_a_id, user_b_id),
       user_b_id = greatest(user_a_id, user_b_id),
       user_a    = least(user_a_id, user_b_id),
       user_b    = greatest(user_a_id, user_b_id)
 where user_a_id > user_b_id
    or user_a is distinct from least(user_a_id, user_b_id)
    or user_b is distinct from greatest(user_a_id, user_b_id);

alter table public.matches alter column user_a_id set not null;
alter table public.matches alter column user_b_id set not null;
alter table public.matches alter column user_a    set not null;
alter table public.matches alter column user_b    set not null;

create index if not exists matches_user_a_id_idx
  on public.matches (user_a_id);
create index if not exists matches_user_b_id_idx
  on public.matches (user_b_id);
create unique index if not exists matches_user_a_id_user_b_id_key
  on public.matches (user_a_id, user_b_id);
create unique index if not exists matches_unordered_pair_key
  on public.matches (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id));

-- A single BEFORE trigger keeps both column families identical for every future
-- write, including writes made by older SECURITY DEFINER functions.
create or replace function public.sync_match_participants()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  a uuid;
  b uuid;
begin
  if new.user_a_id is not null and new.user_b_id is not null then
    a := new.user_a_id;
    b := new.user_b_id;
  elsif new.user_a is not null and new.user_b is not null then
    a := new.user_a;
    b := new.user_b;
  else
    raise exception 'A match requires two participants' using errcode = '23514';
  end if;

  if new.user_a is not null and new.user_b is not null
     and (least(new.user_a, new.user_b) <> least(a, b)
          or greatest(new.user_a, new.user_b) <> greatest(a, b)) then
    raise exception 'Match participant columns disagree' using errcode = '23514';
  end if;

  if a = b then
    raise exception 'A match requires two different participants' using errcode = '23514';
  end if;

  new.user_a_id := least(a, b);
  new.user_b_id := greatest(a, b);
  new.user_a    := new.user_a_id;
  new.user_b    := new.user_b_id;
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists matches_sync_participants_trg on public.matches;
create trigger matches_sync_participants_trg
  before insert or update on public.matches
  for each row execute function public.sync_match_participants();

-- ---------------------------------------------------------------------------
-- 2. Classify existing rows without inventing a romantic relationship
-- ---------------------------------------------------------------------------
-- M38 defaulted every existing row to a match. On the live data some rows are
-- same-gender chats, legacy like-based rows, or conversations whose request was
-- already accepted. Classify from observable facts instead.
drop trigger if exists notify_on_match_trg on public.matches;
drop trigger if exists matches_sync_counts_trg on public.matches;

update public.matches
   set updated_at = coalesce(updated_at, created_at, now())
 where updated_at is null;

alter table public.matches alter column updated_at set default now();
alter table public.matches alter column updated_at set not null;

with facts as (
  select
    m.id,
    public.pair_should_match(m.user_a_id, m.user_b_id) as should_match,
    (
      exists (
        select 1 from public.follows f
        where f.follower_id = m.user_a_id and f.following_id = m.user_b_id
      )
      and exists (
        select 1 from public.follows f
        where f.follower_id = m.user_b_id and f.following_id = m.user_a_id
      )
    ) as mutual,
    coalesce(msg.message_count, 0) as message_count,
    coalesce(msg.sender_count, 0) as sender_count,
    first_msg.first_sender,
    msg.first_at,
    first_reply.responded_at
  from public.matches m
  left join lateral (
    select
      count(*)::int as message_count,
      count(distinct sender_id)::int as sender_count,
      min(created_at) as first_at
    from public.messages msg
    where msg.match_id::text = m.id::text
  ) msg on true
  left join lateral (
    select msg.sender_id as first_sender
    from public.messages msg
    where msg.match_id::text = m.id::text
    order by msg.created_at, msg.id
    limit 1
  ) first_msg on true
  left join lateral (
    select min(msg.created_at) as responded_at
    from public.messages msg
    where msg.match_id::text = m.id::text
      and msg.sender_id is distinct from first_msg.first_sender
  ) first_reply on true
)
update public.matches m
   set kind = case
         when f.should_match then 'match'
         when f.mutual then 'mutual_follow'
         when f.message_count > 0 then 'request'
         else 'closed'
       end,
       request_status = case
         when f.should_match or f.mutual then 'not_applicable'
         when f.message_count > 0 and f.sender_count >= 2 then 'accepted'
         when f.message_count > 0 then 'pending'
         else 'not_applicable'
       end,
       requested_by = case
         when f.should_match or f.mutual or f.message_count = 0 then null
         else f.first_sender
       end,
       requested_at = case
         when f.should_match or f.mutual or f.message_count = 0 then null
         else f.first_at
       end,
       responded_at = case
         when f.message_count > 0 and f.sender_count >= 2 then f.responded_at
         else null
       end,
       updated_at = now()
  from facts f
 where m.id = f.id
   and (
     m.kind is null
     or m.request_status is null
     or (m.kind = 'match' and not f.should_match)
   );

alter table public.matches alter column kind set default 'request';
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
create index if not exists messages_request_count_idx
  on public.messages (match_id, sender_id, created_at);

comment on column public.matches.kind is
  'match = opposite-gender mutual follow; mutual_follow = any other mutual-follow chat; request = non-mutual request; closed = retained history without chat access.';
comment on column public.matches.request_status is
  'Explicit request state. A match row existing is never proof that a request was accepted.';
comment on column public.matches.status is
  'Legacy live status column; relationship authority is kind + request_status.';

-- ---------------------------------------------------------------------------
-- 3. Relationship vocabulary
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
-- 4. Follow reconciliation against canonical participants
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
  has_messages boolean := false;
  mutual boolean := false;
begin
  if a is null or b is null or a = b then
    return;
  end if;

  lo := least(a, b);
  hi := greatest(a, b);

  perform pg_advisory_xact_lock(hashtext(lo::text || ':' || hi::text));

  select * into conn
  from public.matches m
  where m.user_a_id = lo and m.user_b_id = hi;

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
             status = 'closed',
             updated_at = now()
       where id = conn.id;
    else
      delete from public.matches where id = conn.id;
    end if;
    return;
  end if;

  if public.pair_should_match(lo, hi) then
    insert into public.matches (
      user_a, user_b, user_a_id, user_b_id, kind, request_status, status,
      requested_by, requested_at, responded_at
    )
    values (lo, hi, lo, hi, 'match', 'not_applicable', 'accepted', null, null, null)
    on conflict (user_a_id, user_b_id) do update
      set kind = 'match',
          request_status = 'not_applicable',
          status = 'accepted',
          requested_by = null,
          requested_at = null,
          responded_at = null,
          updated_at = now();
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
    insert into public.matches (
      user_a, user_b, user_a_id, user_b_id, kind, request_status, status,
      requested_by, requested_at, responded_at
    )
    values (lo, hi, lo, hi, 'mutual_follow', 'not_applicable', 'accepted', null, null, null)
    on conflict (user_a_id, user_b_id) do update
      set kind = 'mutual_follow',
          request_status = 'not_applicable',
          status = 'accepted',
          requested_by = null,
          requested_at = null,
          responded_at = null,
          updated_at = now();
    return;
  end if;

  if conn.id is null then
    return;
  end if;

  -- Accepted requests remain usable after a one-way follow disappears. Pending
  -- and rejected requests retain their explicit state.
  if conn.kind = 'request' then
    return;
  end if;

  if conn.kind in ('match', 'mutual_follow') then
    select exists (
      select 1 from public.messages msg where msg.match_id::text = conn.id::text
    ) into has_messages;

    if has_messages then
      update public.matches
         set kind = 'closed',
             request_status = 'not_applicable',
             status = 'closed',
             updated_at = now()
       where id = conn.id;
    else
      delete from public.matches where id = conn.id;
    end if;
  end if;
end;
$$;

revoke all on function public.sync_match_for_pair(uuid, uuid) from public, anon, authenticated;

create or replace function public.sync_follow_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_match_for_pair(old.follower_id, old.following_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_match_for_pair(new.follower_id, new.following_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists follows_sync_match_trg on public.follows;
create trigger follows_sync_match_trg
  after insert or update or delete on public.follows
  for each row execute function public.sync_follow_match();

create or replace function public.sync_profile_match_pairs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  edge record;
begin
  if new.gender is not distinct from old.gender then
    return new;
  end if;

  for edge in
    select f.follower_id, f.following_id
    from public.follows f
    where f.follower_id = new.id or f.following_id = new.id
  loop
    perform public.sync_match_for_pair(edge.follower_id, edge.following_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists profiles_sync_match_pairs_trg on public.profiles;
create trigger profiles_sync_match_pairs_trg
  after update of gender on public.profiles
  for each row execute function public.sync_profile_match_pairs();

-- ---------------------------------------------------------------------------
-- 5. Counts and notifications
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
        where id in (new.user_a_id, new.user_b_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.kind = 'match' then
      update public.profiles
        set matches_count = greatest(matches_count - 1, 0)
        where id in (old.user_a_id, old.user_b_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.kind = 'match' and new.kind <> 'match' then
      update public.profiles
        set matches_count = greatest(matches_count - 1, 0)
        where id in (old.user_a_id, old.user_b_id);
    elsif old.kind <> 'match' and new.kind = 'match' then
      update public.profiles
        set matches_count = matches_count + 1
        where id in (new.user_a_id, new.user_b_id);
    end if;
  end if;

  return null;
end;
$$;

create trigger matches_sync_counts_trg
  after insert or update of kind or delete on public.matches
  for each row execute function public.sync_match_counts();

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

  insert into public.notifications (user_id, actor_id, type, entity_id)
  values (new.user_a_id, new.user_b_id, 'match', new.id),
         (new.user_b_id, new.user_a_id, 'match', new.id);

  return new;
end;
$$;

create trigger notify_on_match_trg
  after insert or update of kind on public.matches
  for each row execute function public.notify_on_match();

update public.profiles p
   set matches_count = (
     select count(*)::int
     from public.matches m
     where m.kind = 'match'
       and (m.user_a_id = p.id or m.user_b_id = p.id)
   );

-- ---------------------------------------------------------------------------
-- 6. Start a conversation
-- ---------------------------------------------------------------------------
create or replace function public.start_conversation(p_target uuid)
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
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null or p_target = me then
    raise exception 'Choose another member to message.' using errcode = '22023';
  end if;

  if public.is_chat_restricted(me) then
    raise exception 'Your account is restricted and cannot start conversations.'
      using errcode = '42501';
  end if;

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

  if public.is_blocked_pair(me, p_target) then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  lo := least(me, p_target);
  hi := greatest(me, p_target);

  perform public.sync_match_for_pair(lo, hi);

  select * into conn
  from public.matches m
  where m.user_a_id = lo and m.user_b_id = hi;

  if conn.id is null then
    insert into public.matches (
      user_a, user_b, user_a_id, user_b_id, kind, request_status, status,
      requested_by, requested_at, responded_at
    )
    values (lo, hi, lo, hi, 'request', 'pending', 'pending', me, now(), null)
    on conflict (user_a_id, user_b_id) do nothing;

    select * into conn
    from public.matches m
    where m.user_a_id = lo and m.user_b_id = hi;
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
    'relationship_state',
      public.connection_relationship_state(conn.kind, conn.request_status, false),
    'request_status', conn.request_status,
    'requested_by_me', coalesce(conn.requested_by = me, false)
  );
end;
$$;

revoke all on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

comment on function public.start_conversation(uuid) is
  'Idempotently opens the conversation row for the caller and target. A non-mutual pair receives a pending three-message request; no follow is required.';

-- ---------------------------------------------------------------------------
-- 7. Recipient accept/reject
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
  if conn.id is null or (conn.user_a_id <> me and conn.user_b_id <> me) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if public.is_blocked_pair(conn.user_a_id, conn.user_b_id) then
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
      'request_status', 'accepted',
      'requested_by_me', false
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
         status = case
           when next_status = 'accepted' then 'accepted'
           else 'closed'
         end,
         responded_at = now(),
         updated_at = now()
   where id = conn.id;

  return jsonb_build_object(
    'conversation_id', conn.id,
    'relationship_state',
      public.connection_relationship_state('request', next_status, false),
    'request_status', next_status,
    'requested_by_me', false
  );
end;
$$;

revoke all on function public.respond_to_conversation_request(uuid, boolean)
  from public, anon;
grant execute on function public.respond_to_conversation_request(uuid, boolean)
  to authenticated;

comment on function public.respond_to_conversation_request(uuid, boolean) is
  'Recipient-only accept/reject for a pending request. Only this RPC (or a recipient reply, handled by the send trigger) changes request state.';

-- ---------------------------------------------------------------------------
-- 8. Three-message limit for a pending request
-- ---------------------------------------------------------------------------
create or replace function public.enforce_message_request_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conn public.matches%rowtype;
  other_user uuid;
  sent_count integer := 0;
begin
  select * into conn
  from public.matches m
  where m.id::text = new.match_id::text
  limit 1;

  if conn.id is null then
    return new;
  end if;

  other_user := case
    when conn.user_a_id = new.sender_id then conn.user_b_id
    when conn.user_b_id = new.sender_id then conn.user_a_id
    else null
  end;

  if other_user is null then
    raise exception 'You are not part of this conversation.' using errcode = '42501';
  end if;

  if public.is_blocked_pair(new.sender_id, other_user) then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  if conn.kind in ('match', 'mutual_follow') then
    return new;
  end if;

  if conn.kind <> 'request' then
    raise exception 'This conversation is no longer available.' using errcode = '42501';
  end if;

  if conn.request_status = 'accepted' then
    return new;
  end if;

  if conn.request_status = 'rejected' then
    raise exception 'This message request was declined.' using errcode = '42501';
  end if;

  if conn.request_status <> 'pending' or conn.requested_by is null then
    raise exception 'This conversation is no longer available.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.match_id::text || ':request'));

  if conn.requested_by = new.sender_id then
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
    update public.matches
       set request_status = 'accepted',
           status = 'accepted',
           responded_at = now(),
           updated_at = now()
     where id = conn.id;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_request_limit_trg on public.messages;
create trigger enforce_message_request_limit_trg
  before insert on public.messages
  for each row execute function public.enforce_message_request_limit();

revoke all on function public.enforce_message_request_limit()
  from public, anon, authenticated;

comment on function public.enforce_message_request_limit() is
  'Caps a pending request sender at three initial messages. A recipient reply explicitly accepts and lifts the cap.';

-- ---------------------------------------------------------------------------
-- 9. Participation and delivery triggers
-- ---------------------------------------------------------------------------
create or replace function public.require_message_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.matches m where m.id::text = new.match_id::text)
     and not exists (
       select 1 from public.matches m
       where m.id::text = new.match_id::text
         and (m.user_a_id = new.sender_id or m.user_b_id = new.sender_id)
     ) then
    raise exception 'You are not part of this conversation.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.reject_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  select case when m.user_a_id = new.sender_id then m.user_b_id else m.user_a_id end
    into recipient
  from public.matches m
  where m.id::text = new.match_id::text
  limit 1;

  if recipient is not null and public.is_blocked_pair(new.sender_id, recipient) then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  select case when m.user_a_id = new.sender_id then m.user_b_id else m.user_a_id end
    into recipient
  from public.matches m
  where m.id::text = new.match_id::text
  limit 1;

  if recipient is not null and recipient <> new.sender_id then
    insert into public.notifications (user_id, actor_id, type, entity_id)
    values (recipient, new.sender_id, 'message', new.match_id::uuid);
  end if;

  return new;
end;
$$;

-- Recreate the write guards so the repaired logic is active even if the live
-- project lost a trigger while keeping the function.
drop trigger if exists require_message_participation_trg on public.messages;
create trigger require_message_participation_trg
  before insert on public.messages
  for each row execute function public.require_message_participation();

drop trigger if exists reject_blocked_message_trg on public.messages;
create trigger reject_blocked_message_trg
  before insert on public.messages
  for each row execute function public.reject_blocked_message();

drop trigger if exists notify_on_message_trg on public.messages;
create trigger notify_on_message_trg
  after insert on public.messages
  for each row execute function public.notify_on_message();

-- ---------------------------------------------------------------------------
-- 10. Send-state projection
-- ---------------------------------------------------------------------------
drop function if exists public.conversation_send_state(uuid);

create function public.conversation_send_state(p_match_id uuid)
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
      case when m.user_a_id = me.uid then m.user_b_id else m.user_a_id end
        as other_user_id,
      public.is_blocked_pair(m.user_a_id, m.user_b_id) as is_blocked
    from public.matches m, me
    where me.uid is not null
      and m.id = p_match_id
      and (m.user_a_id = me.uid or m.user_b_id = me.uid)
  ),
  stats as (
    select
      count(msg.id) filter (
        where msg.sender_id = (select uid from me)
      )::int as sent_count,
      count(msg.id) filter (
        where msg.sender_id = participant.other_user_id
      )::int as received_count
    from participant
    left join public.messages msg on msg.match_id::text = participant.id::text
    group by participant.other_user_id
  )
  select
    public.connection_relationship_state(
      participant.kind, participant.request_status, participant.is_blocked
    ) as relationship_state,
    participant.request_status,
    (participant.kind = 'request'
      and participant.request_status = 'pending'
      and participant.requested_by <> (select uid from me)) as is_request,
    coalesce(participant.requested_by = (select uid from me), false) as requested_by_me,
    (participant.kind = 'request'
      and participant.request_status = 'pending'
      and participant.requested_by <> (select uid from me)
      and not participant.is_blocked) as can_respond,
    coalesce(stats.sent_count, 0) as sent_count,
    3 as send_limit,
    case
      when participant.is_blocked then false
      when participant.kind in ('match', 'mutual_follow') then true
      when participant.kind = 'request'
        and participant.request_status = 'accepted' then true
      when participant.kind = 'request'
        and participant.request_status = 'pending' then
          participant.requested_by <> (select uid from me)
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
-- 11. Inbox projection without a conversations table
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_archive (
  match_id    uuid not null references public.matches(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists conversation_archive_user_idx
  on public.conversation_archive (user_id, archived_at desc);

alter table public.conversation_archive enable row level security;

drop policy if exists "conversation_archive_select_own" on public.conversation_archive;
create policy "conversation_archive_select_own"
  on public.conversation_archive for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.conversation_archive from anon, authenticated;
grant select on public.conversation_archive to authenticated;

drop function if exists public.conversation_summaries();

create function public.conversation_summaries()
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
      public.is_blocked_pair(m.user_a_id, m.user_b_id) as is_blocked,
      case when m.user_a_id = me.uid then m.user_b_id else m.user_a_id end
        as other_user_id
    from public.matches m, me
    where me.uid is not null
      and (m.user_a_id = me.uid or m.user_b_id = me.uid)
      and m.kind <> 'closed'
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
    where not exists (
      select 1
      from public.chat_settings cs
      where cs.match_id::text = msg.match_id::text
        and cs.disappear_after_seconds is not null
        and msg.created_at
          < now() - make_interval(secs => cs.disappear_after_seconds)
    )
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
    (mine.kind = 'request'
      and mine.request_status = 'pending'
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
    public.connection_relationship_state(
      mine.kind, mine.request_status, mine.is_blocked
    ) as relationship_state,
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
  'Inbox rows for the signed-in member, using matches.id as the conversation id and explicit request state from match columns.';

-- ---------------------------------------------------------------------------
-- 12. Remaining participant checks
-- ---------------------------------------------------------------------------
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
    where m.id = p_match_id and (m.user_a_id = me or m.user_b_id = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  insert into public.match_read_state (match_id, user_id, last_read_at)
  values (p_match_id, me, ts)
  on conflict (match_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  update public.messages
     set seen_at = ts,
         delivered_at = coalesce(delivered_at, ts)
   where messages.match_id::text = p_match_id::text
     and messages.sender_id <> me
     and messages.seen_at is null;

  return ts;
end;
$$;

create or replace function public.mark_messages_delivered(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  n integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a_id = me or m.user_b_id = me)
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

create or replace function public.unread_counts()
returns table (match_id uuid, unread integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id as match_id,
    count(msg.id) filter (
      where msg.sender_id <> auth.uid()
        and msg.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
    )::integer as unread
  from public.matches m
  left join public.match_read_state rs
    on rs.match_id = m.id and rs.user_id = auth.uid()
  left join public.messages msg
    on msg.match_id::text = m.id::text
  where auth.uid() is not null
    and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    and m.kind <> 'closed'
    and not (m.kind = 'request' and m.request_status = 'rejected')
  group by m.id, rs.last_read_at;
$$;

create or replace function public.chat_media_participant(p_match uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.matches m
    where m.id = p_match
      and (m.user_a_id = p_user or m.user_b_id = p_user)
  );
$$;

create or replace function public.set_disappearing_messages(
  p_match_id uuid,
  p_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  secs integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a_id = me or m.user_b_id = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  secs := nullif(p_seconds, 0);
  if secs is not null then
    secs := greatest(60, least(secs, 604800));
  end if;

  insert into public.chat_settings (
    match_id, disappear_after_seconds, updated_by, updated_at
  )
  values (p_match_id, secs, me, now())
  on conflict (match_id) do update
    set disappear_after_seconds = excluded.disappear_after_seconds,
        updated_by = excluded.updated_by,
        updated_at = now();

  return jsonb_build_object('disappear_after_seconds', secs);
end;
$$;

create or replace function public.purge_expired_chat_content()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  removed integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  delete from public.chat_media cm
   where exists (
     select 1
     from public.messages msg
     join public.chat_settings cs on cs.match_id::text = msg.match_id::text
     join public.matches m on m.id::text = msg.match_id::text
     where cm.message_id = msg.id
       and cs.disappear_after_seconds is not null
       and (m.user_a_id = me or m.user_b_id = me)
       and msg.created_at
         < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  delete from public.messages msg
   where exists (
     select 1
     from public.chat_settings cs
     join public.matches m on m.id::text = msg.match_id::text
     where cs.match_id::text = msg.match_id::text
       and cs.disappear_after_seconds is not null
       and (m.user_a_id = me or m.user_b_id = me)
       and msg.created_at
         < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

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
    where m.id = p_match_id and (m.user_a_id = me or m.user_b_id = me)
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

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
revoke all on function public.mark_messages_delivered(uuid) from public, anon;
grant execute on function public.mark_messages_delivered(uuid) to authenticated;
revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;
revoke all on function public.chat_media_participant(uuid, uuid) from public, anon;
grant execute on function public.chat_media_participant(uuid, uuid) to authenticated;
revoke all on function public.set_disappearing_messages(uuid, integer)
  from public, anon;
grant execute on function public.set_disappearing_messages(uuid, integer)
  to authenticated;
revoke all on function public.purge_expired_chat_content() from public, anon;
grant execute on function public.purge_expired_chat_content() to authenticated;
revoke all on function public.set_conversation_archived(uuid, boolean)
  from public, anon;
grant execute on function public.set_conversation_archived(uuid, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Participant-scoped RLS against canonical columns
-- ---------------------------------------------------------------------------
drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select to authenticated
  using (auth.uid() = user_a_id or auth.uid() = user_b_id);

drop policy if exists "messages_select_authenticated" on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      where m.id::text = messages.match_id::text
        and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    )
    and public.message_is_alive(messages.match_id::text, messages.created_at)
  );

drop policy if exists "chat_settings_select_participant" on public.chat_settings;
create policy "chat_settings_select_participant"
  on public.chat_settings for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = chat_settings.match_id
        and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 14. Posture report
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'start_conversation',
    'conversation_summaries',
    'conversation_send_state',
    'enforce_message_request_limit',
    'sync_match_for_pair'
  )
order by p.proname;
