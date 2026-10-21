-- =============================================================================
-- People discovery, follow consistency and reliable presence
-- =============================================================================
-- WHY
--   `profiles.is_online` was a manually maintained boolean with no heartbeat.
--   A member who closed the app stayed "online" forever, so Discover's
--   `is_online desc` ordering and the People presence dot could not be trusted.
--
-- WHAT
--   1. `profiles.last_seen_at` records the last authenticated heartbeat.
--   2. `touch_presence()` is the only write path. It derives the member from
--      `auth.uid()` and is SECURITY DEFINER, so a client can refresh only its
--      own activity and cannot mark somebody else online.
--   3. The public projection and `discover_profiles()` derive online state from
--      an expiring window. A member with a heartbeat becomes offline
--      automatically after 2 minutes of silence; legacy rows with no heartbeat
--      fall back to the old boolean until their first heartbeat.
--   4. `user_preferences.show_online_status` is honoured everywhere presence is
--      read, and non-public profiles are excluded from discovery.
--
-- NOT CHANGED
--   Matching remains follows-only. A like/pass is interest, not a connection.
--   This migration only makes presence truthful and keeps the existing
--   allow-listed discovery shape.
--
-- SAFE TO RE-RUN: columns are guarded, functions are replaced, and every view is
-- recreated with its grants re-asserted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Presence column
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Last authenticated presence heartbeat. Online state expires two minutes after this timestamp.';

-- A heartbeat must be cheap; this partial index keeps the online-window reads
-- from scanning the whole member table on a busy deployment.
create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Heartbeat RPC
-- ---------------------------------------------------------------------------
-- The caller can only touch their own row: no target argument exists. The
-- function bypasses RLS only to write the presence columns, which the member is
-- allowed to change on their own row anyway; using the function keeps the write
-- shape small and auditable.
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
end;
$$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

comment on function public.touch_presence() is
  'Refreshes the signed-in member''s last_seen_at. Online is derived from a 2-minute window and expires without another heartbeat.';

-- ---------------------------------------------------------------------------
-- 3. Public projection with expiring online state
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

comment on view public.public_profiles is
  'Allow-listed public projection. Online state is derived from last_seen_at and expires after two minutes; private columns remain excluded.';

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- ---------------------------------------------------------------------------
-- 4. Discovery RPC: online-first against the derived state
-- ---------------------------------------------------------------------------
-- The extra `p_exclude_ids` argument supports safe "load more": the client
-- passes every id it has already shown, so a page cannot repeat a card even
-- when the eligible set shrinks between requests (for example after a like).
-- The previous five-argument signature is dropped first; callers that omit the
-- new defaulted argument still resolve to this one.
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
