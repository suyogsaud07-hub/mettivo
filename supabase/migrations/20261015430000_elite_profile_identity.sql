-- =============================================================================
-- Elite Profile System Upgrade — names, usernames and canonical MBTI
-- =============================================================================
-- WHY
--   A profile used to collect one free-text `display_name`, and personality was
--   split between the canonical `mbti` code and a legacy `personality` tag
--   array. This migration adds the split identity model (first name, last name,
--   explicit no-last-name, unique username) without rebuilding or dropping the
--   existing profiles table, and makes `mbti` the single personality value on
--   public surfaces.
--
-- LEGACY SAFETY
--   Existing members keep their current `display_name` and all historical data.
--   `first_name`, `last_name` and `username` are nullable for legacy rows; no
--   name is fabricated and no handle is silently assigned. The UI asks the
--   member to complete the new identity on their next profile edit. The
--   `personality` and `politics` columns are retained in the table (existing
--   data is preserved) but removed from every public projection below.
--
-- SECURITY
--   Username availability is the only new read surface. It is a SECURITY DEFINER
--   function that returns a boolean and never returns a profile row, so it
--   cannot be used to enumerate anyone's private fields.
--
-- SAFE TO RE-RUN: every object is created conditionally or replaced.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Identity columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists first_name    text;
alter table public.profiles add column if not exists last_name     text;
alter table public.profiles add column if not exists has_last_name boolean not null default false;
alter table public.profiles add column if not exists username      text;

comment on column public.profiles.first_name is
  'Given name. Null on legacy rows created before the split identity model; never fabricated.';
comment on column public.profiles.last_name is
  'Family name. Null when has_last_name is false, including for legacy rows.';
comment on column public.profiles.has_last_name is
  'Explicit member choice. When false, last_name is not rendered or stored as a literal label.';
comment on column public.profiles.username is
  'Canonical lowercase handle without a leading @. Unique case-insensitively; null only for legacy rows.';

-- The old display-name constraint capped the combined name at 60. First and
-- last names each allow 40, so the derived name can reach 81. Existing rows all
-- satisfy the new bound; `not valid` keeps a hand-edited legacy row from
-- aborting the migration.
alter table public.profiles drop constraint if exists profiles_display_name_shape;
alter table public.profiles
  add constraint profiles_display_name_shape
  check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 81
  ) not valid;

-- ---------------------------------------------------------------------------
-- 2. Username normalization and shape
-- ---------------------------------------------------------------------------
create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_username is null then null
    when left(btrim(p_username), 1) = '@'
      then lower(substr(btrim(p_username), 2))
    else lower(btrim(p_username))
  end;
$$;

comment on function public.normalize_username(text) is
  'Canonical username: trims, strips one optional leading @ and lowercases. Never stores the @.';

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_shape' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_shape
      check (
        username is null
        or (
          username = public.normalize_username(username)
          and username ~ '^[a-z0-9_]{3,30}$'
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_first_name_shape' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_first_name_shape
      check (
        first_name is null
        or char_length(btrim(first_name)) between 1 and 40
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_last_name_shape' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_last_name_shape
      check (
        last_name is null
        or char_length(btrim(last_name)) between 1 and 40
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_last_name_required' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_last_name_required
      check (
        has_last_name = false
        or (last_name is not null and char_length(btrim(last_name)) > 0)
      ) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Keep display_name, username and the no-last-name rule in sync
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.username := public.normalize_username(new.username);
  new.first_name := nullif(btrim(new.first_name), '');
  new.last_name := nullif(btrim(new.last_name), '');

  if new.has_last_name = false then
    new.last_name := null;
  end if;

  -- Only rebuild the public name when the member has supplied a first name.
  -- Legacy rows that update an unrelated field keep their existing display_name.
  if new.first_name is not null then
    new.display_name := new.first_name
      || case
           when new.has_last_name and new.last_name is not null
             then ' ' || new.last_name
           else ''
         end;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_identity on public.profiles;
create trigger profiles_sync_identity
  before insert or update of first_name, last_name, has_last_name, username
  on public.profiles
  for each row execute function public.sync_profile_identity();

-- ---------------------------------------------------------------------------
-- 4. Username availability — real backend check, minimal disclosure
-- ---------------------------------------------------------------------------
create or replace function public.check_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null then false
    when public.normalize_username(p_username) !~ '^[a-z0-9_]{3,30}$' then false
    else not exists (
      select 1
      from public.profiles p
      where p.username = public.normalize_username(p_username)
        and p.id <> auth.uid()
    )
  end;
$$;

revoke all on function public.check_username_available(text) from public, anon;
grant execute on function public.check_username_available(text) to authenticated;

comment on function public.check_username_available(text) is
  'Boolean-only username availability for the signed-in member. Excludes the caller so their current handle is not reported as taken.';

-- ---------------------------------------------------------------------------
-- 5. Public projection: add identity + canonical MBTI, remove Politics
-- ---------------------------------------------------------------------------
-- Rebuilt with DROP (not CREATE OR REPLACE) for the same reason as earlier
-- migrations: the column order changed, and a replace can refuse an old shape.
-- `politics` and `personality` are deliberately absent. The underlying columns
-- and their historical data remain on `profiles`.
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  id,
  first_name,
  last_name,
  has_last_name,
  username,
  display_name,
  age,
  gender,
  city,
  country,
  avatar_url,
  photos,
  bio,
  intention,
  looking_for,
  hobbies,
  pets,
  mbti,
  religion,
  drinking,
  smoking,
  interests,
  prompts,
  is_online,
  is_verified,
  onboarding_completed,
  updated_at,
  followers_count,
  following_count,
  matches_count,
  profile_likes_count
from public.profiles;

comment on view public.public_profiles is
  'Allow-listed public projection of profiles. Excludes birth_date, politics and the legacy personality tags; Personality is exposed only as the canonical mbti code.';

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- ---------------------------------------------------------------------------
-- 6. Discovery RPC: identity + MBTI, no Politics or legacy personality tags
-- ---------------------------------------------------------------------------
-- The return type changes, so the function must be dropped rather than replaced.
drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean);

create function public.discover_profiles(
  p_min_age     integer default 18,
  p_max_age     integer default 99,
  p_genders     text[]  default null,
  p_limit       integer default 50,
  p_online_only boolean default false
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
    p.prompts, p.is_online, p.is_verified
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.onboarding_completed
    and coalesce(p.is_suspended, false) = false
    and p.age between coalesce(p_min_age, 18) and coalesce(p_max_age, 99)
    and (p_genders is null or p.gender = any (p_genders))
    and (coalesce(p_online_only, false) = false or p.is_online)
    and not public.is_blocked_pair(auth.uid(), p.id)
    and not exists (
      select 1 from public.likes l
      where l.liker_id = auth.uid() and l.liked_id = p.id
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a = auth.uid() and m.user_b = p.id)
         or (m.user_a = p.id and m.user_b = auth.uid())
    )
  order by p.is_online desc, p.updated_at desc nulls last, p.id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.discover_profiles(integer, integer, text[], integer, boolean) from public, anon;
grant execute on function public.discover_profiles(integer, integer, text[], integer, boolean) to authenticated;

comment on function public.discover_profiles(integer, integer, text[], integer, boolean) is
  'Allow-listed discovery feed with split identity and canonical mbti. Excludes the caller, non-onboarded and suspended members, blocked pairs, and anyone already decided or matched.';

-- ---------------------------------------------------------------------------
-- 7. Follow lists: include the public handle, never private fields
-- ---------------------------------------------------------------------------
drop function if exists public.list_followers(uuid);

create function public.list_followers(p_user uuid)
returns table (
  id                uuid,
  first_name        text,
  last_name         text,
  username          text,
  display_name      text,
  age               integer,
  gender            text,
  city              text,
  country           text,
  avatar_url        text,
  is_followed_by_me boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    p.username,
    p.display_name,
    p.age,
    p.gender,
    p.city,
    p.country,
    p.avatar_url,
    exists (
      select 1 from public.follows mine
      where mine.follower_id = auth.uid() and mine.following_id = p.id
    ) as is_followed_by_me
  from public.follows f
  join public.profiles p on p.id = f.follower_id
  where f.following_id = p_user
    and auth.uid() is not null
  order by p.id
  limit 500;
$$;

revoke all on function public.list_followers(uuid) from public, anon;
grant execute on function public.list_followers(uuid) to authenticated;

comment on function public.list_followers(uuid) is
  'Follower list for any member. Allow-listed columns only, including the public username. Visible to any authenticated caller.';

drop function if exists public.list_following(uuid);

create function public.list_following(p_user uuid)
returns table (
  id                uuid,
  first_name        text,
  last_name         text,
  username          text,
  display_name      text,
  age               integer,
  gender            text,
  city              text,
  country           text,
  avatar_url        text,
  is_followed_by_me boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if auth.uid() <> p_user then
    raise exception 'This list is private' using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.first_name,
      p.last_name,
      p.username,
      p.display_name,
      p.age,
      p.gender,
      p.city,
      p.country,
      p.avatar_url,
      true as is_followed_by_me
    from public.follows f
    join public.profiles p on p.id = f.following_id
    where f.follower_id = p_user
    order by p.id
    limit 500;
end;
$$;

revoke all on function public.list_following(uuid) from public, anon;
grant execute on function public.list_following(uuid) to authenticated;

comment on function public.list_following(uuid) is
  'Following list, owner-only. Raises 42501 for any other caller rather than returning rows.';

-- ---------------------------------------------------------------------------
-- 8. Posture report
-- ---------------------------------------------------------------------------
select
  conname as constraint_name,
  convalidated as validated
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname in (
    'profiles_username_shape',
    'profiles_first_name_shape',
    'profiles_last_name_shape',
    'profiles_last_name_required',
    'profiles_display_name_shape'
  )
order by conname;
