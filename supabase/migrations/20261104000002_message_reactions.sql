-- =============================================================================
-- M42 · Message reactions
-- =============================================================================
-- Adds a `message_reactions` table so members can react to messages with a
-- single emoji. One reaction per (message, user, emoji); changing an emoji or
-- removing a reaction is an upsert/delete on that same row.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

create table if not exists public.message_reactions (
  id        uuid        primary key default gen_random_uuid(),
  message_id uuid       not null references public.messages(id) on delete cascade,
  user_id    uuid       not null references auth.users(id) on delete cascade,
  emoji      text       not null check (length(trim(emoji)) > 0),
  created_at timestamptz not null default now(),

  unique (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions(message_id);
create index if not exists message_reactions_user_idx
  on public.message_reactions(user_id);

alter table public.message_reactions enable row level security;

-- Any participant in the conversation may read reactions on its messages.
drop policy if exists "message_reactions_select_participant" on public.message_reactions;
create policy "message_reactions_select_participant"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1
      from public.messages msg
      join public.matches m on m.id::text = msg.match_id::text
      where msg.id = message_reactions.message_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- A member may only insert their own reaction.
drop policy if exists "message_reactions_insert_own" on public.message_reactions;
create policy "message_reactions_insert_own"
  on public.message_reactions for insert to authenticated
  with check (auth.uid() = user_id);

-- A member may only delete their own reaction.
drop policy if exists "message_reactions_delete_own" on public.message_reactions;
create policy "message_reactions_delete_own"
  on public.message_reactions for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.message_reactions to authenticated;
revoke all on public.message_reactions from anon;

comment on table public.message_reactions is
  'One emoji reaction per (message, user, emoji). RLS scopes reads to conversation participants and writes to the reacting member.';

-- Realtime so reaction counts update live in the thread.
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'message_reactions'
    ) then
      alter publication supabase_realtime add table public.message_reactions;
      raise notice 'message_reactions added to supabase_realtime';
    else
      raise notice 'message_reactions already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for message_reactions in the dashboard';
  end if;
end
$rt$;
