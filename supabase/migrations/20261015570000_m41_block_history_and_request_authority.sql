-- =============================================================================
-- M41 · Preserve blocked conversations and harden message-request authority
-- =============================================================================
-- WHY
--   M40 moved messaging onto the canonical `matches` row and introduced
--   `kind='closed'` for retained history, but two write paths still bypass it:
--
--   * `block_member()` deletes the match, which cascades `chat_media`,
--     `chat_settings`, receipts and the archive. The runbook expects a blocked
--     conversation with history to be retained as `closed`.
--   * A legacy `kind='request'` row can have a null or non-participant
--     `requested_by`. `respond_to_conversation_request()` compares that value to
--     the caller, so `null = me` is false and either participant could accept.
--
-- WHAT
--   * Repair malformed pending/accepted request rows from their first valid
--     message sender, close them if no valid requester can be derived, or delete
--     an empty pending row that has no history.
--   * Make the accept/reject RPC reject malformed request authority explicitly.
--   * Align the send-state projection with the same rule.
--   * Redefine `block_member()` to close a conversation with history instead of
--     deleting it, preserving every message and media ledger row.
--   * Keep notification failures from rolling back the message/match write.
--
-- SAFE TO RE-RUN: guarded data repair, `create or replace` functions, and no
-- destructive table/column changes. Existing history is retained.
-- DEPENDS ON: M38 (request state), M40 (canonical messaging repair).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Repair request rows whose authority cannot be proven
-- ---------------------------------------------------------------------------
do $$
declare
  request_row   record;
  first_sender  uuid;
  first_sent_at timestamptz;
  has_messages  boolean;
begin
  for request_row in
    select
      m.id,
      m.user_a_id,
      m.user_b_id,
      m.request_status,
      m.requested_by
    from public.matches m
    where m.kind = 'request'
      and m.request_status in ('pending', 'accepted')
      and (
        (
          m.request_status = 'pending'
          and (
            m.requested_by is null
            or m.requested_by not in (m.user_a_id, m.user_b_id)
          )
        )
        or (
          m.requested_by is not null
          and m.requested_by not in (m.user_a_id, m.user_b_id)
        )
      )
  loop
    select msg.sender_id, msg.created_at
      into first_sender, first_sent_at
    from public.messages msg
    where msg.match_id::text = request_row.id::text
      and msg.sender_id in (request_row.user_a_id, request_row.user_b_id)
    order by msg.created_at, msg.id
    limit 1;

    select exists (
      select 1
      from public.messages msg
      where msg.match_id::text = request_row.id::text
    ) into has_messages;

    if first_sender is not null then
      update public.matches
         set requested_by = first_sender,
             requested_at = coalesce(requested_at, first_sent_at, now()),
             updated_at = now()
       where id = request_row.id;
    elsif request_row.request_status = 'pending' and has_messages then
      -- History exists but no participant ever sent it. Retain the row as
      -- closed rather than deleting the only container for that history.
      update public.matches
         set kind = 'closed',
             request_status = 'not_applicable',
             status = 'closed',
             requested_by = null,
             requested_at = null,
             responded_at = null,
             updated_at = now()
       where id = request_row.id;
    elsif request_row.request_status = 'pending' then
      -- No history and no provable requester: the row cannot become a valid
      -- request. Removing it is the only safe repair.
      delete from public.matches where id = request_row.id;
    else
      -- Accepted rows remain usable by both participants even when the original
      -- requester was lost. Clear the untrustworthy attribution.
      update public.matches
         set requested_by = null,
             updated_at = now()
       where id = request_row.id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Recipient-only accept/reject, with explicit request authority
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
  if conn.requested_by is null
     or conn.requested_by not in (conn.user_a_id, conn.user_b_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 3. Send-state cannot advertise a composer action the trigger will reject
-- ---------------------------------------------------------------------------
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
      case when m.user_a_id = me.uid then m.user_b_id else m.user_a_id end
        as other_user_id,
      public.is_blocked_pair(m.user_a_id, m.user_b_id) as is_blocked,
      coalesce(m.requested_by in (m.user_a_id, m.user_b_id), false)
        as request_author_valid
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
      and participant.request_author_valid
      and participant.requested_by <> (select uid from me)) as is_request,
    coalesce(participant.requested_by = (select uid from me), false) as requested_by_me,
    (participant.kind = 'request'
      and participant.request_status = 'pending'
      and participant.request_author_valid
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
          participant.request_author_valid
          and (
            participant.requested_by <> (select uid from me)
            or coalesce(stats.sent_count, 0) < 3
          )
      else false
    end as can_send,
    (coalesce(stats.received_count, 0) > 0) as other_has_replied
  from participant
  left join stats on true;
$$;

revoke all on function public.conversation_send_state(uuid) from public, anon;
grant execute on function public.conversation_send_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Block closes a conversation with history instead of deleting it
-- ---------------------------------------------------------------------------
create or replace function public.block_member(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me            uuid := auth.uid();
  lo            uuid;
  hi            uuid;
  affected_rows integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null then
    raise exception 'p_target is required' using errcode = '22023';
  end if;
  if p_target = me then
    raise exception 'You cannot block yourself' using errcode = '22023';
  end if;

  lo := least(me, p_target);
  hi := greatest(me, p_target);

  perform pg_advisory_xact_lock(hashtext(lo::text || ':' || hi::text));

  insert into public.blocked_users (blocker_id, blocked_user_id)
  values (me, p_target)
  on conflict (blocker_id, blocked_user_id) do nothing;

  -- Count only conversations that were still usable before the block. A closed
  -- row is already unavailable and is not counted a second time.
  select count(*)::int into affected_rows
  from public.matches m
  where m.user_a_id = lo
    and m.user_b_id = hi
    and m.kind <> 'closed';

  -- M23: remove the follow edges so the pair is fully disconnected. The follow
  -- trigger also reconciles the match; the explicit call below covers a match
  -- that survived without any follow edge.
  delete from public.follows f
  where (f.follower_id = me and f.following_id = p_target)
     or (f.follower_id = p_target and f.following_id = me);

  perform public.sync_match_for_pair(lo, hi);

  delete from public.likes l
  where (l.liker_id = me and l.liked_id = p_target)
     or (l.liker_id = p_target and l.liked_id = me);

  return jsonb_build_object(
    'blocked', true,
    'other_user_id', p_target,
    'matches_removed', affected_rows
  );
end;
$$;

revoke all on function public.block_member(uuid) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;

comment on function public.block_member(uuid) is
  'Blocks a pair, removes follows/likes and leaves a conversation with history as kind=closed. An empty conversation is deleted.';

-- ---------------------------------------------------------------------------
-- 5. A notification failure must not roll back the member's write
-- ---------------------------------------------------------------------------
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
    select case when m.user_a_id = new.sender_id then m.user_b_id else m.user_a_id end
      into recipient
    from public.matches m
    where m.id::text = new.match_id::text
    limit 1;

    if recipient is not null and recipient <> new.sender_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (recipient, new.sender_id, 'message', new.match_id::uuid);
    end if;
  exception when others then
    -- Notifications are best-effort; the message itself is already authorised.
    null;
  end;

  return new;
end;
$$;

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
    values (new.user_a_id, new.user_b_id, 'match', new.id),
           (new.user_b_id, new.user_a_id, 'match', new.id);
  exception when others then
    -- A missed match notification must not make the match impossible to create.
    null;
  end;

  return new;
end;
$$;
