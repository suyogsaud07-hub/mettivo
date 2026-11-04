-- =============================================================================
-- M44 · Secure ten-minute unsend
-- =============================================================================
-- Adds a SECURITY DEFINER RPC that lets a message sender physically delete their
-- own message from the shared `messages` table, but only within ten minutes of
-- sending. The database independently enforces sender ownership and the time
-- limit; the frontend may never bypass this check.
--
-- A bare DELETE policy on `messages` is intentionally NOT added: RLS on the
-- table is SELECT/UPDATE only, and deletion is mediated exclusively by this RPC.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

create or replace function public.unsend_message(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me        uuid := auth.uid();
  sender    uuid;
  created   timestamptz;
  is_part   boolean;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Load the target message once, capturing sender and sent time.
  select msg.sender_id, msg.created_at
    into sender, created
    from public.messages msg
   where msg.id = p_message_id;

  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  -- Only the sender may unsend.
  if sender <> me then
    raise exception 'You can only unsend your own messages' using errcode = '42501';
  end if;

  -- Ten-minute window (exactly ten minutes is not allowed).
  if created <= now() - interval '10 minutes' then
    raise exception 'Messages older than ten minutes cannot be unsent' using errcode = '42501';
  end if;

  -- The caller must be a participant in the conversation.
  select exists (
    select 1
    from public.matches m
    where m.id::text = (
      select msg2.match_id::text from public.messages msg2 where msg2.id = p_message_id
    )
      and (m.user_a = me or m.user_b = me)
  ) into is_part;

  if not is_part then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  delete from public.messages where id = p_message_id;
  return true;
end
$$;

revoke all on function public.unsend_message(uuid) from public, anon;
grant execute on function public.unsend_message(uuid) to authenticated;

comment on function public.unsend_message(uuid) is
  'Lets the sender physically delete their own message within ten minutes of sending. Enforces ownership and the time limit server-side.';
