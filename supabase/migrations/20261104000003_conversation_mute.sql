-- =============================================================================
-- M43 · Conversation mute
-- =============================================================================
-- Lets a member mute notifications for a single conversation. Muting is
-- owner-scoped: it never prevents delivery, never alters the other participant's
-- preferences, and is persisted server-side so it survives a refresh.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

create table if not exists public.conversation_mute (
  match_id  uuid not null references public.matches(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  muted_at  timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists conversation_mute_user_idx
  on public.conversation_mute(user_id);

alter table public.conversation_mute enable row level security;

drop policy if exists "conversation_mute_select_own" on public.conversation_mute;
create policy "conversation_mute_select_own"
  on public.conversation_mute for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "conversation_mute_insert_own" on public.conversation_mute;
create policy "conversation_mute_insert_own"
  on public.conversation_mute for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "conversation_mute_delete_own" on public.conversation_mute;
create policy "conversation_mute_delete_own"
  on public.conversation_mute for delete to authenticated
  using (auth.uid() = user_id);

-- Writes go through a participant-checking RPC so a member cannot mute a
-- conversation they are not part of.
revoke all on public.conversation_mute from anon, authenticated;
grant select on public.conversation_mute to authenticated;

comment on table public.conversation_mute is
  'Per-member mute flag for a conversation. A member can mute only their own view; the other participant is unaffected.';

-- RPC to toggle mute with participation enforced server-side.
create or replace function public.set_conversation_mute(
  p_match_id uuid,
  p_muted    boolean
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
    select 1
    from public.matches m
    where m.id = p_match_id
      and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  if p_muted then
    insert into public.conversation_mute (match_id, user_id, muted_at)
    values (p_match_id, me, now())
    on conflict (match_id, user_id) do nothing;
    return true;
  else
    delete from public.conversation_mute
    where match_id = p_match_id and user_id = me;
    return false;
  end if;
end
$$;

revoke all on function public.set_conversation_mute(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_mute(uuid, boolean) to authenticated;

comment on function public.set_conversation_mute(uuid, boolean) is
  'Toggles the signed-in member''s mute flag on a conversation they participate in.';
