-- =============================================================================
-- Presence sessions, multi-device presence, and auth/session tracking
-- =============================================================================
-- WHY
--   Current presence is user-level (last_seen_at on profiles). The requirements
--   need per-device/session presence, so a user can be online on one device
--   but not others, and remain online as long as ANY active session exists.
--   Also need better control over heartbeat intervals and cleanup.
--
-- WHAT
--   1. Create presence_sessions table to track individual device/browser sessions
--   2. Add RPCs for session management (start, heartbeat, end)
--   3. Update online status calculation to consider any active session
--   4. Add indexes for efficient queries
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Presence sessions table
-- ---------------------------------------------------------------------------
create table if not exists public.presence_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  device_type text check (device_type in ('web', 'mobile', 'tablet', 'unknown')),
  user_agent text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, session_id)
);

comment on table public.presence_sessions is
  'Per-device/browser session presence tracking. User is online if any session is active and not expired.';
comment on column public.presence_sessions.session_id is
  'Client-generated session identifier for this browser/tab/device session';
comment on column public.presence_sessions.expires_at is
  'Session expires if heartbeat not received by this time';

-- Indexes
create index if not exists presence_sessions_user_id_idx on public.presence_sessions (user_id);
create index if not exists presence_sessions_expires_at_idx on public.presence_sessions (expires_at);
create index if not exists presence_sessions_active_idx on public.presence_sessions (is_active, expires_at) where is_active = true;

-- RLS
alter table public.presence_sessions enable row level security;

drop policy if exists presence_sessions_select_own on public.presence_sessions;
create policy presence_sessions_select_own
  on public.presence_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists presence_sessions_insert_own on public.presence_sessions;
create policy presence_sessions_insert_own
  on public.presence_sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists presence_sessions_update_own on public.presence_sessions;
create policy presence_sessions_update_own
  on public.presence_sessions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists presence_sessions_delete_own on public.presence_sessions;
create policy presence_sessions_delete_own
  on public.presence_sessions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. RPCs for presence session management
-- ---------------------------------------------------------------------------
create or replace function public.start_presence_session(
  p_session_id text,
  p_device_type text default 'web',
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_session_uuid uuid;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Upsert the session
  insert into public.presence_sessions (user_id, session_id, device_type, user_agent, is_active, last_seen_at, expires_at, updated_at)
  values (me, p_session_id, p_device_type, p_user_agent, true, now(), now() + interval '60 seconds', now())
  on conflict (user_id, session_id)
  do update set
    is_active = true,
    last_seen_at = now(),
    expires_at = now() + interval '60 seconds',
    updated_at = now(),
    device_type = coalesce(excluded.device_type, presence_sessions.device_type),
    user_agent = coalesce(excluded.user_agent, presence_sessions.user_agent)
  returning id into v_session_uuid;

  -- Also update profiles.last_seen_at for backward compatibility
  update public.profiles
  set is_online = true,
      last_seen_at = now()
  where id = me;

  return v_session_uuid;
end;
$$;

revoke all on function public.start_presence_session(text, text, text) from public, anon;
grant execute on function public.start_presence_session(text, text, text) to authenticated;

create or replace function public.heartbeat_presence_session(p_session_id text)
returns void
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

  update public.presence_sessions
  set last_seen_at = now(),
      expires_at = now() + interval '60 seconds',
      is_active = true,
      updated_at = now()
  where user_id = me and session_id = p_session_id;

  -- Also update profiles.last_seen_at for backward compatibility
  update public.profiles
  set is_online = true,
      last_seen_at = now()
  where id = me;
end;
$$;

revoke all on function public.heartbeat_presence_session(text) from public, anon;
grant execute on function public.heartbeat_presence_session(text) to authenticated;

create or replace function public.end_presence_session(p_session_id text)
returns void
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

  update public.presence_sessions
  set is_active = false,
      updated_at = now()
  where user_id = me and session_id = p_session_id;
end;
$$;

revoke all on function public.end_presence_session(text) from public, anon;
grant execute on function public.end_presence_session(text) to authenticated;

create or replace function public.cleanup_expired_presence_sessions()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.presence_sessions
  set is_active = false
  where is_active = true and expires_at < now();
end;
$$;

revoke all on function public.cleanup_expired_presence_sessions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helper to check if user has any active session
-- ---------------------------------------------------------------------------
create or replace function public.user_is_online(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  has_active boolean;
begin
  -- Check presence sessions only (authoritative source)
  select exists(
    select 1 from public.presence_sessions
    where user_id = p_user_id
      and is_active = true
      and expires_at > now()
  ) into has_active;
  
  return has_active;
end;
$$;

revoke all on function public.user_is_online(uuid) from public, anon;
grant execute on function public.user_is_online(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Update touch_presence to also update sessions if possible
-- ---------------------------------------------------------------------------
create or replace function public.touch_presence()
returns void
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

  update public.profiles
  set is_online = true,
      last_seen_at = now()
  where id = me;
      
  -- Also try to update any active sessions
  update public.presence_sessions
  set last_seen_at = now(),
      expires_at = now() + interval '60 seconds',
      updated_at = now()
  where user_id = me and is_active = true;
end;
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

comment on function public.touch_presence() is
  'Refreshes the signed-in member''s presence. Updates both legacy profile presence and session-based presence.';


-- ---------------------------------------------------------------------------
-- 5. Update public_profiles to use session-based presence
-- ---------------------------------------------------------------------------
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  p.id,
  p.first_name,
  p.last_name,
  p.has_last_name,
  p.username,
  p.display_name,
  p.age,
  p.gender,
  p.city,
  p.country,
  p.avatar_url,
  p.photos,
  p.bio,
  p.intention,
  p.looking_for,
  p.hobbies,
  p.pets,
  p.mbti,
  p.religion,
  p.drinking,
  p.smoking,
  p.interests,
  p.prompts,
  case
    when coalesce(pref.show_online_status, true) = false then false
    when exists (
      select 1 from public.presence_sessions ps 
      where ps.user_id = p.id 
        and ps.is_active = true 
        and ps.expires_at > now()
    ) then true
    when p.last_seen_at is not null
      then p.last_seen_at >= now() - interval '2 minutes'
    else coalesce(p.is_online, false)
  end as is_online,
  p.is_verified,
  p.onboarding_completed,
  p.updated_at,
  p.followers_count,
  p.following_count,
  p.matches_count,
  p.profile_likes_count
from public.profiles p
left join public.user_preferences pref on pref.user_id = p.id;

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

comment on view public.public_profiles is
  'Public-safe projection of profiles. Online status derived from active sessions or recent heartbeat; respects show_online_status.';


-- ---------------------------------------------------------------------------
-- 6. Update discover_profiles to use session-based presence
-- ---------------------------------------------------------------------------
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean);
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[]);

create function public.discover_profiles(
  p_min_age     integer default 18,
  p_max_age     integer default 99,
  p_genders     text[]  default null,
  p_limit       integer default 50,
  p_online_only boolean default false,
  p_exclude_ids uuid[]  default '{}'
)
returns table (
  id           uuid,
  first_name   text,
  last_name    text,
  username     text,
  display_name text,
  age          integer,
  gender       text,
  city         text,
  country      text,
  avatar_url   text,
  photos       text[],
  bio          text,
  intention    text,
  looking_for  text[],
  hobbies      text[],
  pets         text[],
  mbti         text,
  interests    text[],
  prompts      jsonb,
  is_online    boolean,
  is_verified  boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id, p.first_name, p.last_name, p.username, p.display_name,
    p.age, p.gender, p.city, p.country, p.avatar_url, p.photos, p.bio,
    p.intention, p.looking_for, p.hobbies, p.pets, p.mbti, p.interests,
    p.prompts,
    case
      when coalesce(pref.show_online_status, true) = false then false
      when exists (
        select 1 from public.presence_sessions ps 
        where ps.user_id = p.id 
          and ps.is_active = true 
          and ps.expires_at > now()
      ) then true
      when p.last_seen_at is not null
        then p.last_seen_at >= now() - interval '2 minutes'
      else coalesce(p.is_online, false)
    end as is_online,
    p.is_verified
  from public.profiles p
  left join public.user_preferences pref on pref.user_id = p.id
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.onboarding_completed
    and coalesce(p.is_suspended, false) = false
    and coalesce(pref.profile_visibility, 'public') = 'public'
    and p.age between coalesce(p_min_age, 18) and coalesce(p_max_age, 99)
    and (p_genders is null or p.gender = any (p_genders))
    and (
      coalesce(p_online_only, false) = false
      or (case
            when coalesce(pref.show_online_status, true) = false then false
            when exists (
              select 1 from public.presence_sessions ps 
              where ps.user_id = p.id 
                and ps.is_active = true 
                and ps.expires_at > now()
            ) then true
            when p.last_seen_at is not null
              then p.last_seen_at >= now() - interval '2 minutes'
            else coalesce(p.is_online, false)
          end)
    )
    and not public.is_blocked_pair(auth.uid(), p.id)
    and not (p.id = any (coalesce(p_exclude_ids, '{}'::uuid[])))
    and not exists (
      select 1 from public.likes l
      where l.liker_id = auth.uid() and l.liked_id = p.id
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a = auth.uid() and m.user_b = p.id)
         or (m.user_a = p.id and m.user_b = auth.uid())
    )
  order by
    case
      when coalesce(pref.show_online_status, true) = false then false
      when exists (
        select 1 from public.presence_sessions ps 
        where ps.user_id = p.id 
          and ps.is_active = true 
          and ps.expires_at > now()
      ) then true
      when p.last_seen_at is not null
        then p.last_seen_at >= now() - interval '2 minutes'
      else coalesce(p.is_online, false)
    end desc,
    p.updated_at desc nulls last,
    p.id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[]) from public, anon;
grant execute on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[]) to authenticated;

comment on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[]) is
  'Allow-listed discovery feed. Excludes already-decided/blocked/matched/non-public members, supports load-more exclusions, and ranks expiring online presence first.';


-- ---------------------------------------------------------------------------
-- 7. Cleanup function for expired sessions (can be called periodically)
-- ---------------------------------------------------------------------------
create or replace function public.prune_expired_presence()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.presence_sessions
  where expires_at < now() - interval '5 minutes';
  
  update public.presence_sessions
  set is_active = false
  where is_active = true and expires_at < now();
end;
$$;

revoke all on function public.prune_expired_presence() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Track last active visit for 7-day inactivity window
-- ---------------------------------------------------------------------------
create table if not exists public.user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null default now(),
  last_seen_ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_activity is
  'Tracks last active visit for 7-day inactivity window on web. Renewed on legitimate activity.';

alter table public.user_activity enable row level security;

drop policy if exists user_activity_select_own on public.user_activity;
create policy user_activity_select_own
  on public.user_activity
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_activity_insert_own on public.user_activity;
create policy user_activity_insert_own
  on public.user_activity
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_activity_update_own on public.user_activity;
create policy user_activity_update_own
  on public.user_activity
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_user_activity()
returns void
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

  insert into public.user_activity (user_id, last_active_at, updated_at)
  values (me, now(), now())
  on conflict (user_id)
  do update set
    last_active_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.touch_user_activity() from public, anon;
grant execute on function public.touch_user_activity() to authenticated;

create or replace function public.check_activity_validity(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := coalesce(p_user_id, auth.uid());
  last_active timestamptz;
begin
  if me is null then
    return false;
  end if;

  select last_active_at into last_active
  from public.user_activity
  where user_id = me;

  if last_active is null then
    return true; -- No record yet, allow (will be created on first activity)
  end if;

  -- Check if within 7 days of inactivity
  if last_active >= now() - interval '7 days' then
    return true;
  else
    return false;
  end if;
end;
$$;

revoke all on function public.check_activity_validity(uuid) from public, anon;
grant execute on function public.check_activity_validity(uuid) to authenticated;
