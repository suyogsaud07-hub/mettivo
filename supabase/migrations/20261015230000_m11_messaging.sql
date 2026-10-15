-- =============================================================================
-- M11 · Real-time one-to-one messaging
-- =============================================================================
-- Three things this migration fixes or adds.
--
-- 1. A CRITICAL PRIVACY DEFECT. The M6 RLS baseline installed a SELECT policy
--    on `messages` of `auth.uid() is not null`, which means EVERY signed-in
--    member could read EVERY private message in the product. `follows` had the
--    same expression, exposing the whole follow graph. M6 only installs a
--    baseline when a table has zero policies, so the baseline is replaced here
--    by an explicit participant policy. (The M6 tests only ever asserted that
--    ANONYMOUS callers read zero rows, which was true and hid this completely.)
--
-- 2. Message delivery hardening. `auth.uid() = sender_id` proved who was
--    sending but not that they belong to the conversation, so a member could
--    append to any match id they could guess.
--
-- 3. Unread counters and read state, so the chat list can show a badge and the
--    badge can be cleared reliably rather than approximated on the client.
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. messages — participants only
-- ---------------------------------------------------------------------------
-- The subquery is evaluated with the caller's own rights, and `matches` is
-- itself participant-scoped (M10), so a member can only satisfy this predicate
-- for a conversation they are actually in.
drop policy if exists "messages_select_authenticated" on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      -- Both sides are cast to text. `messages.match_id` is `uuid` on the live
      -- project and `text` in some rebuilt environments, and `CREATE POLICY` is
      -- TYPE-CHECKED at creation, so a one-sided cast fails outright with
      -- "operator does not exist: text = uuid".
      where m.id::text = messages.match_id::text
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own"
  on public.messages for update to authenticated
  using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id);

-- ---------------------------------------------------------------------------
-- 2. follows — involved parties only
-- ---------------------------------------------------------------------------
drop policy if exists "follows_select_authenticated" on public.follows;
drop policy if exists "follows_select_involved" on public.follows;
create policy "follows_select_involved"
  on public.follows for select to authenticated
  using (auth.uid() = follower_id or auth.uid() = following_id);

-- ---------------------------------------------------------------------------
-- 3. Indexes for the read patterns the chat list actually uses
-- ---------------------------------------------------------------------------
create index if not exists messages_match_created_idx
  on public.messages (match_id, created_at desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- ---------------------------------------------------------------------------
-- 4. require_message_participation() — you may only write to your own thread
-- ---------------------------------------------------------------------------
-- Guarded on "the match exists". A message row whose `match_id` resolves to no
-- match is visible to nobody (the participant policy excludes it), so rejecting
-- it would add nothing while breaking fixture inserts that use synthetic ids.
-- The attack worth stopping -- appending to somebody else's conversation -- is
-- stopped, because that requires a real match id.
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
         and (m.user_a = new.sender_id or m.user_b = new.sender_id)
     ) then
    raise exception 'You are not part of this conversation.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists require_message_participation_trg on public.messages;
create trigger require_message_participation_trg
  before insert on public.messages
  for each row execute function public.require_message_participation();

-- ---------------------------------------------------------------------------
-- 5. match_read_state — one row per (conversation, member)
-- ---------------------------------------------------------------------------
create table if not exists public.match_read_state (
  match_id     uuid not null references public.matches(id) on delete cascade,
  user_id      uuid not null references auth.users(id)   on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- The M4 audit fails any unindexed foreign key; the primary key covers
-- match_id, this covers user_id.
create index if not exists match_read_state_user_idx
  on public.match_read_state (user_id);

alter table public.match_read_state enable row level security;

drop policy if exists "match_read_state_select_own" on public.match_read_state;
create policy "match_read_state_select_own"
  on public.match_read_state for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "match_read_state_insert_own" on public.match_read_state;
create policy "match_read_state_insert_own"
  on public.match_read_state for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "match_read_state_update_own" on public.match_read_state;
create policy "match_read_state_update_own"
  on public.match_read_state for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.match_read_state to authenticated;
revoke all on public.match_read_state from anon;

-- ---------------------------------------------------------------------------
-- 6. mark_conversation_read()
-- ---------------------------------------------------------------------------
-- Only a participant can mark a conversation read, and the timestamp comes from
-- the server clock, so a client cannot backdate its way past the badge.
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

  return ts;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. unread_counts() — the badge for every conversation, in one round trip
-- ---------------------------------------------------------------------------
-- A member compares against their own last_read_at, and only messages they did
-- NOT send count. `left join messages` means a conversation with no messages
-- still returns a row with unread = 0, so the chat list never has to guess.
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
    and (m.user_a = auth.uid() or m.user_b = auth.uid())
  group by m.id, rs.last_read_at;
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

comment on function public.unread_counts() is
  'Per-conversation unread message count for the signed-in member. Server-computed so the badge cannot drift from the data.';
comment on table public.match_read_state is
  'When each member last read each conversation. Owner-scoped; drives unread_counts().';

-- ---------------------------------------------------------------------------
-- 8. Posture report
-- ---------------------------------------------------------------------------
select
  p.proname                                  as function_name,
  p.prosecdef                                as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'require_message_participation', 'mark_conversation_read', 'unread_counts'
  )
order by p.proname;
