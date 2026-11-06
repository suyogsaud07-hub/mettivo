-- =============================================================================
-- Expand messages_message_type_check to support all message kinds
-- =============================================================================
-- WHY
--   The existing constraint only permits text, audio, video_call, audio_call.
--   Voice notes, images, video messages, call logs and system messages all need
--   distinct message_type values. Adding image, video, call, and system lets the
--   frontend persist every supported message kind without constraint violations.
--
-- SAFE TO RE-RUN: uses ALTER CONSTRAINT via DROP + ADD, guarded by
-- DROP CONSTRAINT IF EXISTS.
--
-- SECURITY
--   No RLS changes. The constraint is a data-integrity boundary only; it does not
--   affect who can read or write rows.
-- =============================================================================

do $$
begin
  -- Remove the old constraint if present (idempotent).
  alter table public.messages
    drop constraint if exists messages_message_type_check;

  -- Re-add with the complete set of permitted values.
  alter table public.messages
    add constraint messages_message_type_check
    check (
      message_type in (
        'text',
        'image',
        'video',
        'audio',
        'call',
        'system'
      )
    );
end $$;
