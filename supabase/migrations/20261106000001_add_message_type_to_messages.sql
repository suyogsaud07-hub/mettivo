-- Adds `message_type` to `public.messages` so call logs (video / audio) can be
-- stored and rendered alongside ordinary text messages. Idempotent: safe to run
-- on deployments where the column already exists.
alter table if exists public.messages
  add column if not exists message_type text;

-- Constrain to the supported kinds once the column is present.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_message_type_check'
  ) then
    alter table public.messages
      add constraint messages_message_type_check
      check (message_type in ('text', 'audio', 'video_call', 'audio_call'));
  end if;
end $$;

-- Backfill any existing rows as ordinary text messages.
update public.messages set message_type = 'text' where message_type is null;

-- Index for rendering call logs within a thread.
create index if not exists idx_messages_match_type_created
  on public.messages(match_id, message_type, created_at);
