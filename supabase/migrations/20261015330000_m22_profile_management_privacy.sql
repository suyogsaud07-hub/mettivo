-- =============================================================================
-- M22 · Profile management, archiving and post-level privacy
-- =============================================================================
-- Gives the profile surface a Facebook-style management layer on top of the
-- existing Moments feed:
--
--   1. per-post privacy tiers   (only_me | matches | public)
--   2. an archive              (hidden from the profile + feed, capped at
--                               5 photo posts and 2 video posts per member)
--   3. author-only management  (edit caption, delete, archive, restore)
--
-- WHERE THE AUTHORISATION LIVES
--   There is no application server. The ONLY boundary is RLS + the two
--   `SECURITY DEFINER` functions that write the archive, which re-check
--   ownership explicitly. A browser-supplied id is never trusted.
--
-- THE TWO PRIVACY BUGS THIS CLOSES
--   Before this file, `moments_select_authenticated` let EVERY signed-in member
--   read EVERY post, and `moment_feed` is an owner-rights view (its comment
--   already warned it must be revisited "if that policy is ever tightened to a
--   subset of posts"). Tightening the base policy alone would have been a false
--   fix: the view would still hand out every row. So BOTH are updated here — the
--   RLS policy AND the view predicate — plus a second view for the archive.
--
-- SAFE TO RE-RUN: every statement is `add column if not exists` /
-- `drop … if exists` / name-guarded `add constraint`, and both views are dropped
-- and recreated (a view cannot gain columns via CREATE OR REPLACE).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments — privacy tier + archive column
-- ---------------------------------------------------------------------------
alter table public.moments add column if not exists visibility text not null default 'public';
alter table public.moments add column if not exists archived_at timestamptz;

-- `add constraint` has no `if not exists`; test the catalogue first.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_visibility_chk' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_visibility_chk
      check (visibility in ('only_me', 'matches', 'public'));
  end if;
end $$;

-- The feed only ever reads active posts, the archive only archived ones, so both
-- get a partial index keyed on the author.
create index if not exists moments_author_active_idx
  on public.moments (author_id, created_at desc)
  where archived_at is null;

create index if not exists moments_author_archived_idx
  on public.moments (author_id, archived_at desc)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- 1b. profiles.status — the optional headline shown under the member's name
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists status text;

-- M15 dropped the table-wide SELECT grant and re-granted the columns that
-- existed THEN, so a column added later is not readable until it is named here.
grant select (status) on public.profiles to authenticated;

comment on column public.profiles.status is
  'Optional short headline (M22 profile status). Readable by any signed-in member; editable only by the owner through the profiles update policy.';

-- ---------------------------------------------------------------------------
-- 2. can_view_moment() — the single visibility rule, in one place
-- ---------------------------------------------------------------------------
-- PL/pgSQL (not SQL) so the body is resolved lazily and the function still
-- creates on a database where a dependency has not been applied yet.
--
-- SECURITY DEFINER so the follow/match lookups do not depend on the viewer's own
-- grants on `follows`/`matches`. `auth.uid()` still reads the REQUESTER's JWT
-- claim (it is a GUC, not the DB role), so the caller identity is correct.
create or replace function public.can_view_moment(p_author uuid, p_visibility text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  visible boolean := false;
begin
  if me is null then
    return false;
  end if;

  -- The author always sees their own post (archived filtering is separate).
  if p_author = me then
    return true;
  end if;

  if p_visibility = 'public' then
    return true;
  end if;

  if p_visibility = 'matches' then
    -- "Followers / matches": a member who follows the author, or a mutual match.
    select
      exists (
        select 1 from public.follows f
        where f.follower_id = me and f.following_id = p_author
      )
      or exists (
        select 1 from public.matches m
        where (m.user_a = me and m.user_b = p_author)
           or (m.user_b = me and m.user_a = p_author)
      )
    into visible;
    return visible;
  end if;

  -- 'only_me' (and any unknown value) is never visible to a non-author.
  return false;
end;
$$;

comment on function public.can_view_moment(uuid, text) is
  'True when the caller may see a moment of the given visibility tier. SECURITY DEFINER so follow/match checks do not depend on the caller''s grants.';

revoke all on function public.can_view_moment(uuid, text) from public, anon;
grant execute on function public.can_view_moment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS — replace the blanket "everyone reads everything" select policy
-- ---------------------------------------------------------------------------
drop policy if exists "moments_select_authenticated" on public.moments;
drop policy if exists "moments_select_visible" on public.moments;
create policy "moments_select_visible"
  on public.moments for select to authenticated
  using (
    auth.uid() = author_id
    or (archived_at is null and public.can_view_moment(author_id, visibility))
  );

-- Insert / update / delete policies from the base moments migration are
-- unchanged: only the author may write, and the author already passes the select
-- policy for their own rows.

-- ---------------------------------------------------------------------------
-- 4. Archive capacity — 5 photo posts and 2 video posts, hard-enforced
-- ---------------------------------------------------------------------------
-- A BEFORE trigger, not a CHECK, because the limit is "at most N archived rows
-- per author", which depends on the other rows. SECURITY DEFINER so the count is
-- taken over ALL of the author's archived rows regardless of the caller's RLS.
create or replace function public.enforce_archive_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_video boolean;
  cap      integer;
  used     integer;
begin
  -- Nothing to enforce while the row is active.
  if new.archived_at is null then
    return new;
  end if;

  -- Re-saving an already-archived row must not consume a second slot.
  if tg_op = 'UPDATE' and old.archived_at is not null then
    return new;
  end if;

  -- A 'video' post is media_type = 'video'; everything else (including the
  -- legacy null) counts against the photo cap.
  is_video := new.media_type = 'video';
  cap      := case when is_video then 2 else 5 end;

  select count(*)::int into used
  from public.moments m
  where m.author_id = new.author_id
    and m.id <> new.id
    and m.archived_at is not null
    and (
      (is_video and m.media_type = 'video')
      or (not is_video and coalesce(m.media_type, 'image') <> 'video')
    );

  if used >= cap then
    raise exception 'archive_limit:%', case when is_video then 'video' else 'photo' end
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists moments_archive_capacity on public.moments;
create trigger moments_archive_capacity
  before insert or update of archived_at on public.moments
  for each row execute function public.enforce_archive_capacity();

-- ---------------------------------------------------------------------------
-- 5. Archive / restore — the only sanctioned writers of `archived_at`
-- ---------------------------------------------------------------------------
-- Both are SECURITY DEFINER so the ownership check is explicit (`author_id = me`)
-- rather than delegated to a policy the browser could be tricked out of.

create or replace function public.archive_moment(p_moment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me    uuid := auth.uid();
  moved boolean;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.moments
     set archived_at = now(), updated_at = now()
   where id = p_moment_id and author_id = me and archived_at is null
  returning true into moved;

  -- The capacity trigger raises `archive_limit:*` before this returns false.
  return coalesce(moved, false);
end;
$$;

create or replace function public.restore_moment(p_moment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid := auth.uid();
  moved  boolean;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Restoring puts the post back on the profile AND the Moments feed, so it
  -- returns to the public tier.
  update public.moments
     set archived_at = null, visibility = 'public', updated_at = now()
   where id = p_moment_id and author_id = me and archived_at is not null
  returning true into moved;

  return coalesce(moved, false);
end;
$$;

revoke all on function public.archive_moment(uuid) from public, anon;
revoke all on function public.restore_moment(uuid) from public, anon;
grant execute on function public.archive_moment(uuid) to authenticated;
grant execute on function public.restore_moment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Archive usage — one round trip for the dashboard's capacity meter
-- ---------------------------------------------------------------------------
create or replace function public.moment_archive_counts()
returns table (
  photo_count  integer,
  video_count  integer,
  photo_limit  integer,
  video_limit  integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
    select
      (select count(*)::int from public.moments m
        where m.author_id = me and m.archived_at is not null
          and coalesce(m.media_type, 'image') <> 'video'),
      (select count(*)::int from public.moments m
        where m.author_id = me and m.archived_at is not null
          and m.media_type = 'video'),
      5,
      2;
end;
$$;

revoke all on function public.moment_archive_counts() from public, anon;
grant execute on function public.moment_archive_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. moment_feed — rebuilt with visibility + archived filtering
-- ---------------------------------------------------------------------------
-- Owner-rights view: the base-table RLS does NOT apply inside it, so the
-- predicate is repeated here. `can_view_moment` already returns true for the
-- author, and archived rows are excluded for everyone (the author reads them
-- from `moment_archive` instead).
drop view if exists public.moment_feed;

create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.tags,
  m.shares,
  m.views_count,
  m.visibility,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as unique_views
  from public.moment_views group by moment_id
) v on v.moment_id = m.id
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
where m.archived_at is null
  and public.can_view_moment(m.author_id, m.visibility);

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

comment on view public.moment_feed is
  'Active moments the caller may see (respects visibility tier, hides archived), with media type, view totals, like/comment counts and a per-caller liked_by_me flag.';

-- ---------------------------------------------------------------------------
-- 8. moment_archive — the author's own archived posts
-- ---------------------------------------------------------------------------
-- Owner-rights view filtered to the caller, so a member can only ever read their
-- own archive.
drop view if exists public.moment_archive;

create view public.moment_archive as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.tags,
  m.shares,
  m.views_count,
  m.visibility,
  m.archived_at,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as unique_views
  from public.moment_views group by moment_id
) v on v.moment_id = m.id
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
where m.archived_at is not null
  and m.author_id = auth.uid();

grant select on public.moment_archive to authenticated;
revoke all on public.moment_archive from anon;

comment on view public.moment_archive is
  'The signed-in member''s own archived posts (never visible to anyone else), with the same engagement columns as moment_feed.';

comment on column public.moments.visibility is
  'Post privacy tier: only_me (author only), matches (followers/matches), public (everyone signed in).';
comment on column public.moments.archived_at is
  'Null while the post is on the profile; a timestamp once archived (hidden from the profile and feed, capped at 5 photos / 2 videos).';

-- ---------------------------------------------------------------------------
-- 9. Report the resulting posture
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('moments', 'moment_likes', 'moment_comments', 'moment_views')
group by c.relname, c.relrowsecurity
order by c.relname;
