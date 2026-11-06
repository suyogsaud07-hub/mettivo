-- M47 · Chat message interactions
-- Adds edit state and authenticated RPCs for per-member deletion and pinning.
-- Safe to re-run.

alter table public.messages
  add column if not exists is_edited boolean not null default false;

comment on column public.messages.is_edited is
  'True after the sender edits a text message.';

create or replace function public.delete_message_for_me(p_message_id uuid)
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
  if public.is_restricted(me) then
    raise exception 'Your account is read-only and cannot delete messages.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.messages msg
    join public.matches m on m.id::text = msg.match_id::text
    where msg.id = p_message_id
      and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Message not found or not a conversation participant' using errcode = '42501';
  end if;

  insert into public.message_deletions (message_id, user_id)
  values (p_message_id, me)
  on conflict (message_id, user_id) do nothing;

  return true;
end
$$;

revoke all on function public.delete_message_for_me(uuid) from public, anon;
grant execute on function public.delete_message_for_me(uuid) to authenticated;

create or replace function public.pin_message(p_match_id uuid, p_message_id uuid)
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
    select 1
    from public.messages msg
    join public.matches m on m.id::text = msg.match_id::text
    where msg.id = p_message_id
      and msg.match_id::text = p_match_id::text
      and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Message not found or not a conversation participant' using errcode = '42501';
  end if;

  insert into public.pinned_messages (match_id, message_id, user_id)
  values (p_match_id, p_message_id, me)
  on conflict (match_id, message_id, user_id) do nothing;

  return true;
end
$$;

revoke all on function public.pin_message(uuid, uuid) from public, anon;
grant execute on function public.pin_message(uuid, uuid) to authenticated;

create or replace function public.unpin_message(p_match_id uuid, p_message_id uuid)
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
    select 1
    from public.messages msg
    join public.matches m on m.id::text = msg.match_id::text
    where msg.id = p_message_id
      and msg.match_id::text = p_match_id::text
      and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Message not found or not a conversation participant' using errcode = '42501';
  end if;

  delete from public.pinned_messages
  where match_id = p_match_id
    and message_id = p_message_id
    and user_id = me;

  return true;
end
$$;

revoke all on function public.unpin_message(uuid, uuid) from public, anon;
grant execute on function public.unpin_message(uuid, uuid) to authenticated;
