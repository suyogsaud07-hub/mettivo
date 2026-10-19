-- =============================================================================
-- M29 · Subbu bans — real, enforced, time-boxed account bans
-- =============================================================================
-- WHY
--   The Subbu companion could previously only *say* "you are banned". There was
--   no ban column, and the API/front-end never consulted one — so the warning
--   was roleplay. This migration gives the bot a real ban that the chat API
--   enforces before it talks to the model, and that the chat UI renders on load.
--
-- WHAT THIS DOES
--   1. profiles.banned_until / ban_reason (NULL = not banned).
--   2. Extends M14's `protect_moderation_columns()` to the ban columns, so a
--      member can neither clear nor shorten their own ban.
--   3. `apply_self_ban(days, reason)` — the ONLY writer. It is SECURITY DEFINER
--      and derives the subject from `auth.uid()`. It accepts NO user id, so a
--      prompt-injected model or a malicious caller can never ban somebody else.
--   4. `my_ban_status()` — the caller's own ban only, for the API, proxy and UI.
--
-- PRIVACY
--   The new columns are deliberately NOT granted to `authenticated`. The ban is
--   read through `my_ban_status()`, so one member cannot read another's ban
--   state (and `select *` on profiles cannot expose it).
--
-- SAFE TO RE-RUN: idempotent (add column if not exists / create or replace).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The ban itself
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason   text;

comment on column public.profiles.banned_until is
  'End of a Subbu-issued account ban. NULL or in the past = not banned.';
comment on column public.profiles.ban_reason is
  'Machine token describing a Subbu ban (e.g. verbal_harassment, explicit_image).';

create index if not exists profiles_banned_until_idx
  on public.profiles (banned_until)
  where banned_until is not null;

-- ---------------------------------------------------------------------------
-- 2. Guard the ban columns exactly like the suspension columns
-- ---------------------------------------------------------------------------
-- Replaces the M21 body with one that also compares the ban fields. The
-- transaction-local `mettivo.moderation_action` flag is how the SECURITY DEFINER
-- writer below is allowed through; a client cannot set it in the RPC's
-- transaction.
create or replace function public.protect_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_moderator()
     or auth.uid() is null
     or coalesce(current_setting('mettivo.moderation_action', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_suspended, false)
       or new.suspended_at is not null
       or new.suspension_reason is not null
       or new.banned_until is not null
       or new.ban_reason is not null then
      raise exception 'Not allowed to set moderation fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_suspended       is distinct from old.is_suspended
     or new.suspended_at       is distinct from old.suspended_at
     or new.suspension_reason  is distinct from old.suspension_reason
     or new.banned_until       is distinct from old.banned_until
     or new.ban_reason         is distinct from old.ban_reason then
    raise exception 'Not allowed to change moderation fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The single writer — always the caller
-- ---------------------------------------------------------------------------
create or replace function public.apply_self_ban(
  p_duration_days integer,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me        uuid := auth.uid();
  reason    text := left(coalesce(nullif(trim(p_reason), ''), 'community_guidelines'), 120);
  base      timestamptz;
  new_until timestamptz;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- 2 days (text) and 30 days (explicit image) are the product tiers; the range
  -- guard stops a caller from self-applying an absurd window.
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 30 then
    raise exception 'Invalid ban duration' using errcode = '22023';
  end if;

  -- Never shorten an existing ban: start from the later of now and the current
  -- end, then add the new window.
  select greatest(now(), coalesce(p.banned_until, now()))
    into base
  from public.profiles p
  where p.id = me;

  if base is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  new_until := base + make_interval(days => p_duration_days);

  perform set_config('mettivo.moderation_action', 'on', true);
  update public.profiles
     set banned_until = new_until,
         ban_reason   = reason
   where id = me;
  perform set_config('mettivo.moderation_action', 'off', true);

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'user.subbu_banned', me,
          jsonb_build_object('days', p_duration_days, 'reason', reason, 'banned_until', new_until));

  return jsonb_build_object('ok', true, 'banned_until', new_until, 'reason', reason);
end;
$$;

revoke all on function public.apply_self_ban(integer, text) from public, anon;
grant execute on function public.apply_self_ban(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The caller's own ban only
-- ---------------------------------------------------------------------------
create or replace function public.my_ban_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'banned',       coalesce(p.banned_until > now(), false),
    'banned_until', p.banned_until,
    'ban_reason',   p.ban_reason
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.my_ban_status() from public, anon;
grant execute on function public.my_ban_status() to authenticated;

commit;
