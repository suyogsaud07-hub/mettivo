-- =============================================================================
-- M45 · Pinned messages
-- =============================================================================
-- Lets members pin messages in a conversation they participate in. Pins are
-- per-user (each member can pin their own set of messages) so clearing or
-- unpinning one member's pin never affects another's.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

create table if not exists public.pinned_messages (
  id        uuid        primary key default gen_random_uuid(),
  match_id  uuid        not null references public.matches(id) on delete cascade,
  message_id uuid       not null references public.messages(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  unique (match_id, message_id, user_id)
);

create index if not exists pinned_messages_match_idx
  on public.pinned_messages(match_id, created_at desc);
create index if not exists pinned_messages_user_idx
  on public.pinned_messages(user_id);

alter table public.pinned_messages enable row level security;

-- Any participant may read pins on messages in their conversation.
drop policy if exists "pinned_messages_select_participant" on public.pinned_messages;
create policy "pinned_messages_select_participant"
  on public.pinned_messages for select to authenticated
  using (
    exists (
      select 1
      from public.messages msg
      join public.matches m on m.id::text = msg.match_id::text
      where msg.id = pinned_messages.message_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- A member may only insert their own pin.
drop policy if exists "pinned_messages_insert_own" on public.pinned_messages;
create policy "pinned_messages_insert_own"
  on public.pinned_messages for insert to authenticated
  with check (auth.uid() = user_id);

-- A member may only delete their own pin.
drop policy if exists "pinned_messages_delete_own" on public.pinned_messages;
create policy "pinned_messages_delete_own"
  on public.pinned_messages for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.pinned_messages to authenticated;
revoke all on public.pinned_messages from anon;

comment on table public.pinned_messages is
  'One pin per (match, message, user). RLS scopes reads to participants and writes to the pinner.';
