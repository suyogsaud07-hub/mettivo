-- =============================================================================
-- M49 · Allow audio in send_chat_media + chat_media ledger
-- =============================================================================
-- WHY
--   The `send_chat_media()` RPC rejects any `p_media_type` outside
--   `('image', 'video')`, so voice notes (media_type = 'audio') fail with a
--   400 / 22023 error. The `chat_media` table carries the same narrow CHECK
--   constraint, so even if the RPC were relaxed the insert would still fail.
--   This migration adds 'audio' to both the RPC validation and the table
--   constraint so voice notes can be stored and retrieved like any other media.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- 1. Allow 'audio' in the chat_media ledger CHECK constraint.
do $$
begin
  if to_regclass('public.chat_media') is not null then
    alter table public.chat_media
      drop constraint if exists chat_media_media_type_check;

    alter table public.chat_media
      add constraint chat_media_media_type_check
      check (media_type in ('image', 'video', 'audio'));
  end if;
end $$;

-- 2. Relax send_chat_media() so it accepts 'audio' alongside 'image'/'video'.
create or replace function public.send_chat_media(
  p_match_id     uuid,
  p_storage_path text,
  p_media_type   text    default 'image',
  p_view_limit   integer default 2,
  p_ttl_seconds  integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  msg_id     uuid;
  media_id   uuid;
  ttl        integer;
  vlimit     integer;
  expires    timestamptz;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.chat_media_participant(p_match_id, me) then
    raise exception 'You are not part of this conversation' using errcode = '42501';
  end if;
  if public.is_chat_restricted(me) then
    raise exception 'Your account is paused and you cannot send media right now.' using errcode = '42501';
  end if;
  if p_media_type not in ('image','video','audio') then
    raise exception 'Invalid media type: %', p_media_type using errcode = '22023';
  end if;
  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'Missing media path' using errcode = '22023';
  end if;

  -- Clamp the lifetime: at least a minute, at most a week.
  ttl := greatest(60, least(coalesce(p_ttl_seconds, 86400), 604800));
  -- Every item is a strict 2-view by default; the range keeps a hostile client
  -- from asking for "unlimited" (0) or a thousand views.
  vlimit  := greatest(1, least(coalesce(p_view_limit, 2), 5));
  expires := now() + make_interval(secs => ttl);

  insert into public.messages (match_id, sender_id, content)
  values (p_match_id, me, '')
  returning id into msg_id;

  insert into public.chat_media
    (message_id, match_id, sender_id, storage_path, media_type, view_limit, expires_at)
  values
    (msg_id, p_match_id, me, p_storage_path, p_media_type, vlimit, expires)
  returning id into media_id;

  return jsonb_build_object(
    'media_id', media_id,
    'message_id', msg_id,
    'view_limit', vlimit,
    'expires_at', expires
  );
end;
$$;

revoke all on function public.send_chat_media(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.send_chat_media(uuid, text, text, integer, integer) to authenticated;

comment on function public.send_chat_media(uuid, text, text, integer, integer) is
  'Writes a media message row and a chat_media ledger row in one transaction. Accepts image, video, or audio. Enforces sender/match participation and rate limits server-side.';
