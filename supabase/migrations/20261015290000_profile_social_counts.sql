-- =============================================================================
-- M18 · Profile social counts — followers, following, matches and profile likes
-- =============================================================================
-- WHY: the profile surfaces (own dashboard and the public profile) show four
-- counters under the member's name: Matches, Following, Followers and Profile
-- Likes. `follows` and `likes` are the source of truth, but RLS only lets a
-- member read the rows they are *part of*:
--
--   * `follows_select_involved`  -> you can count your own followers/following
--                                    but not a stranger's,
--   * `likes_select_involved`    -> you can count likes you received or sent,
--                                    but not a third party's.
--
-- A public profile therefore cannot derive those numbers with a client query.
-- They are denormalised onto `profiles` and kept correct by triggers, which
-- also avoids N correlated subqueries per discovery row.
--
-- SECURITY DEFINER on the trigger functions is deliberate: the counter must be
-- maintained no matter who wrote the underlying `follows` / `likes` / `matches`
-- row. Under RLS the writer usually cannot UPDATE the *other* member's profile
-- row, so an invoker-rights trigger would silently fail to increment.
--
-- ALSO IN THIS MIGRATION
--   * `follows` gains INSERT/DELETE policies scoped to the follower. Until now
--     the table was read-only under RLS ("no INSERT policy"), so every
--     follow/unfollow action in the UI silently changed zero rows.
--   * `public_profiles` is extended with the four counters, which is the only
--     reason the earlier "not needed by any public surface" exclusion no longer
--     holds.
--
-- SAFE TO RE-RUN: columns are added with `if not exists`, triggers are dropped
-- before creation, the backfill is a pure function of the source tables, and
-- the view is `create or replace`d.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Counter columns on profiles
-- ---------------------------------------------------------------------------
-- `not null default 0` so the columns are immediately usable and never null in
-- arithmetic. Idempotent: a second run is a no-op.
alter table public.profiles add column if not exists followers_count     integer not null default 0;
alter table public.profiles add column if not exists following_count     integer not null default 0;
alter table public.profiles add column if not exists matches_count       integer not null default 0;
alter table public.profiles add column if not exists profile_likes_count integer not null default 0;

comment on column public.profiles.followers_count is
  'Members who follow this member. Maintained by sync_follow_counts(). Denormalised so a public profile can show it under RLS.';
comment on column public.profiles.following_count is
  'Members this member follows. Maintained by sync_follow_counts().';
comment on column public.profiles.matches_count is
  'Mutual matches involving this member. Maintained by sync_match_counts().';
comment on column public.profiles.profile_likes_count is
  'Distinct likes received (is_like = true, not passes). Maintained by sync_profile_like_counts().';

-- M15 dropped the table-wide SELECT on `profiles` and re-granted only the
-- columns that existed then, so every column added later (these four) must be
-- granted explicitly or "select followers_count" fails with
-- "permission denied for table profiles" while the row itself is readable.
grant select (followers_count, following_count, matches_count, profile_likes_count)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the source-of-truth tables
-- ---------------------------------------------------------------------------
-- Runs as the migration owner (auth.uid() is null), so the moderation guard on
-- `profiles` lets the write through. Recomputing from scratch keeps the values
-- correct even if a previous partial run left them stale.
update public.profiles p
set followers_count = (
      select count(*)::int from public.follows f where f.following_id = p.id
    ),
    following_count = (
      select count(*)::int from public.follows f where f.follower_id = p.id
    ),
    matches_count = (
      select count(*)::int from public.matches m
      where m.user_a = p.id or m.user_b = p.id
    ),
    profile_likes_count = (
      select count(*)::int from public.likes l
      where l.liked_id = p.id and l.is_like
    );

-- ---------------------------------------------------------------------------
-- 3. follows — a member may follow and unfollow, but only as themselves
-- ---------------------------------------------------------------------------
-- The existing posture was SELECT-only ("READ-ONLY"), which is why the Follow
-- buttons elsewhere in the app appeared to work but changed nothing. These add
-- the smallest write surface: you own the outbound edge and nothing else.
--
-- A self-follow stays *legal at the schema level*, matching the M4 decision;
-- the notification trigger already suppresses the self-notification, and the
-- UI never offers it.
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert to authenticated
  with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

grant select, insert, delete on public.follows to authenticated;

-- NOTE: `anon` keeps its table privileges (the Supabase default) and is denied
-- purely by RLS — there is no policy for the `anon` role, so every read and
-- write is filtered to zero. Revoking the grant would move the denial out of
-- RLS and make the "anonymous reads zero rows" security assertion vacuous.

-- ---------------------------------------------------------------------------
-- 4. sync_follow_counts() — followers of the target, following of the actor
-- ---------------------------------------------------------------------------
create or replace function public.sync_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set following_count = following_count + 1
      where id = new.follower_id;
    update public.profiles
      set followers_count = followers_count + 1
      where id = new.following_id;
  elsif tg_op = 'DELETE' then
    update public.profiles
      set following_count = greatest(following_count - 1, 0)
      where id = old.follower_id;
    update public.profiles
      set followers_count = greatest(followers_count - 1, 0)
      where id = old.following_id;
  end if;

  return null;
end;
$$;

drop trigger if exists follows_sync_counts_trg on public.follows;
create trigger follows_sync_counts_trg
  after insert or delete on public.follows
  for each row execute function public.sync_follow_counts();

-- ---------------------------------------------------------------------------
-- 5. sync_profile_like_counts() — likes received, passes excluded
-- ---------------------------------------------------------------------------
-- `record_like` upserts, so a pass -> like transition fires UPDATE, not INSERT.
-- All three operations are handled or a re-like would double count.
create or replace function public.sync_profile_like_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_like then
      update public.profiles
        set profile_likes_count = profile_likes_count + 1
        where id = new.liked_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_like and not old.is_like then
      update public.profiles
        set profile_likes_count = profile_likes_count + 1
        where id = new.liked_id;
    elsif old.is_like and not new.is_like then
      update public.profiles
        set profile_likes_count = greatest(profile_likes_count - 1, 0)
        where id = old.liked_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.is_like then
      update public.profiles
        set profile_likes_count = greatest(profile_likes_count - 1, 0)
        where id = old.liked_id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists likes_sync_profile_counts_trg on public.likes;
create trigger likes_sync_profile_counts_trg
  after insert or update or delete on public.likes
  for each row execute function public.sync_profile_like_counts();

-- ---------------------------------------------------------------------------
-- 6. sync_match_counts() — both participants on a new/mutual match
-- ---------------------------------------------------------------------------
create or replace function public.sync_match_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set matches_count = matches_count + 1
      where id in (new.user_a, new.user_b);
  elsif tg_op = 'DELETE' then
    update public.profiles
      set matches_count = greatest(matches_count - 1, 0)
      where id in (old.user_a, old.user_b);
  end if;

  return null;
end;
$$;

drop trigger if exists matches_sync_counts_trg on public.matches;
create trigger matches_sync_counts_trg
  after insert or delete on public.matches
  for each row execute function public.sync_match_counts();

-- ---------------------------------------------------------------------------
-- 7. public_profiles — expose the four counters
-- ---------------------------------------------------------------------------
-- Recreated with the counters appended to the allow-list. The view is DROPPED
-- and recreated rather than `create or replace`d: `create or replace view` may
-- only append columns, so once a deployment has a view whose column order was
-- produced by an older `public_profiles` definition it can refuse the replace.
-- Dropping first makes this step idempotent against any prior shape — the same
-- reason the M6 definition does it. Nothing depends on the view structurally.
--
-- Still excluded: birth_date, and the raw `followers`/`following`/`friends`
-- arrays (the aggregate counts are all any surface needs).
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  id,
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
  personality,
  religion,
  politics,
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
  'Allow-listed public projection of profiles. Excludes birth_date and other private fields. Includes the aggregate social counters so a public profile can render them under RLS.';

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  c.relname      as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('follows', 'likes', 'matches')
group by c.relname, c.relrowsecurity
order by c.relname;
