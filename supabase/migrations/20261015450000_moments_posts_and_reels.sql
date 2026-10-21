-- =============================================================================
-- Moments — Posts and Reels, saves, downloads, and moderation gating
-- =============================================================================
-- WHY
--   Moments shipped as a single feed with one media item, a client-only 10s
--   video cap, no way to save a post, and no distinction between an Instagram
--   style photo/video post and a TikTok style vertical Reel. Nothing in the
--   database stopped a client from inserting an over-length video, a Reel with
--   ten photos, or a post the author had marked "approved" themselves.
--
-- WHAT
--   1. `moments.content_kind` ('post' | 'reel') with a 120s server-side ceiling
--      for Reels (a CHECK constraint, so a forged client insert is rejected).
--   2. A per-post media ceiling of 10 (Reels are exactly one video), replacing
--      the old 4 item cap. There is no account-wide photo cap in the schema —
--      the only 5-item limit was the archive capacity, which is untouched.
--   3. `moments.allow_downloads` (safe default off) and `can_download_moment()`
--      plus `get_moment_download_url()` so the download action is a server
--      decision, not a hidden button.
--   4. `moments.moderation_status` gating: only `approved` content appears in
--      the feed, and authors cannot promote their own content to approved.
--   5. `moment_saves` — private per-member saves with owner-only RLS.
--   6. Rebuilt `moment_feed` / `moment_archive` views carrying the new columns
--      and a per-caller `saved_by_me` flag; blocking is now honoured.
--   7. Indexes for the kind/moderation/cursor query patterns.
--
-- MODERATION
--   `moderation_settings.moments_require_review` (default false) decides whether
--   a new post starts `pending` (fail-closed) or `approved`. Regardless of the
--   setting, the existing AI media scan can demote a moment to `rejected` when
--   it flags the first image, and `admin_set_moment_moderation()` lets a
--   moderator approve or reject. Video frame sampling is NOT implemented here;
--   see the header note on limitation in docs/ARCHITECTURE.md.
--
-- SAFE TO RE-RUN: columns are guarded, constraints are dropped before being
-- re-added, functions are replaced, and views are dropped and recreated.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Content kind, duration, downloads, moderation status
-- ---------------------------------------------------------------------------
alter table public.moments add column if not exists content_kind text;
update public.moments set content_kind = 'post' where content_kind is null;
alter table public.moments alter column content_kind set default 'post';
alter table public.moments alter column content_kind set not null;

alter table public.moments add column if not exists duration_seconds numeric;
alter table public.moments add column if not exists allow_downloads boolean;
-- Existing content was already published with no download grant; opt in later.
update public.moments set allow_downloads = false where allow_downloads is null;
alter table public.moments alter column allow_downloads set default false;
alter table public.moments alter column allow_downloads set not null;

-- Existing content was visible before moderation gating existed: keep it.
alter table public.moments add column if not exists moderation_status text;
update public.moments set moderation_status = 'approved' where moderation_status is null;
alter table public.moments alter column moderation_status set default 'pending';
alter table public.moments alter column moderation_status set not null;

alter table public.moments add column if not exists moderation_reviewed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Constraints (reels are one short video, posts hold up to 10 items)
-- ---------------------------------------------------------------------------
alter table public.moments drop constraint if exists moments_media_max;
alter table public.moments add constraint moments_media_max
  check (array_length(media, 1) is null or array_length(media, 1) <= 10);

alter table public.moments drop constraint if exists moments_content_kind_chk;
alter table public.moments add constraint moments_content_kind_chk
  check (content_kind in ('post', 'reel'));

-- A Reel is exactly one video and must declare a duration of at most 120s.
alter table public.moments drop constraint if exists moments_reel_shape_chk;
alter table public.moments add constraint moments_reel_shape_chk
  check (
    content_kind <> 'reel'
    or (
      media_type = 'video'
      and coalesce(array_length(media, 1), 0) = 1
      and duration_seconds is not null
      and duration_seconds > 0
      and duration_seconds <= 120
    )
  );

-- An ordinary post video may be longer than a Reel, but still bounded.
alter table public.moments drop constraint if exists moments_duration_chk;
alter table public.moments add constraint moments_duration_chk
  check (
    duration_seconds is null
    or (duration_seconds > 0 and duration_seconds <= case when content_kind = 'reel' then 120 else 600 end)
  );

alter table public.moments drop constraint if exists moments_moderation_status_chk;
alter table public.moments add constraint moments_moderation_status_chk
  check (moderation_status in ('pending', 'approved', 'rejected', 'failed_review'));

-- ---------------------------------------------------------------------------
-- 3. Indexes for kind / moderation / cursor queries
-- ---------------------------------------------------------------------------
create index if not exists moments_kind_created_idx
  on public.moments (content_kind, created_at desc, id desc)
  where archived_at is null;

create index if not exists moments_kind_moderation_idx
  on public.moments (content_kind, moderation_status, created_at desc)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- 4. Saves — private per-member bookmarks
-- ---------------------------------------------------------------------------
create table if not exists public.moment_saves (
  moment_id  uuid not null references public.moments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index if not exists moment_saves_user_idx
  on public.moment_saves (user_id, created_at desc);

alter table public.moment_saves enable row level security;

drop policy if exists "moment_saves_select_own" on public.moment_saves;
create policy "moment_saves_select_own"
  on public.moment_saves for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "moment_saves_insert_own" on public.moment_saves;
create policy "moment_saves_insert_own"
  on public.moment_saves for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "moment_saves_delete_own" on public.moment_saves;
create policy "moment_saves_delete_own"
  on public.moment_saves for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.moment_saves from anon;
grant select, insert, delete on public.moment_saves to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Content moderation policy + gating
-- ---------------------------------------------------------------------------
alter table public.moderation_settings
  add column if not exists moments_require_review boolean not null default false;

comment on column public.moderation_settings.moments_require_review is
  'When true, new Moments start pending and stay out of every feed until an AI scan or moderator approves them. When false, new Moments are approved on insert and can still be demoted by a flagged AI scan.';

-- Authors must not choose their own moderation status. The status is computed
-- on insert and only a moderator/a SECURITY DEFINER action may change it. Like
-- the existing `protect_moderation_columns()` guard, a transaction-local GUC
-- (`mettivo.moderation_action`) marks a legitimate server-side change.
create or replace function public.guard_moment_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  require_review boolean := false;
  server_action boolean := coalesce(current_setting('mettivo.moderation_action', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if server_action then
      return new;
    end if;

    select coalesce(ms.moments_require_review, false)
      into require_review
      from public.moderation_settings ms
      where ms.id;
    require_review := coalesce(require_review, false);

    new.moderation_status := case when require_review then 'pending' else 'approved' end;
    return new;
  end if;

  -- UPDATE
  if new.moderation_status is distinct from old.moderation_status and not server_action then
    raise exception 'moderation_status is controlled by Mettivo' using errcode = '42501';
  end if;

  if new.moderation_status is distinct from old.moderation_status then
    new.moderation_reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists moments_guard_moderation_insert_trg on public.moments;
create trigger moments_guard_moderation_insert_trg
  before insert on public.moments
  for each row execute function public.guard_moment_moderation();

drop trigger if exists moments_guard_moderation_update_trg on public.moments;
create trigger moments_guard_moderation_update_trg
  before update on public.moments
  for each row execute function public.guard_moment_moderation();

-- A flagged AI scan of a Moment's image (M21 enqueues `profile_photo` scans
-- using `media[1]`) demotes the post so it leaves every feed. Unflagged scans
-- are left alone: approval is the default, not a promotion.
create or replace function public.apply_moment_scan_verdict()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done'
     and new.content_type = 'profile_photo'
     and new.flagged is true
     and new.content_url is not null then
    perform set_config('mettivo.moderation_action', 'on', true);
    update public.moments
      set moderation_status = 'rejected',
          moderation_reviewed_at = now()
      where media[1] = new.content_url
        and moderation_status <> 'rejected';
  end if;
  return new;
end;
$$;

drop trigger if exists moderation_ai_scans_moment_verdict_trg on public.moderation_ai_scans;
create trigger moderation_ai_scans_moment_verdict_trg
  after update of status on public.moderation_ai_scans
  for each row execute function public.apply_moment_scan_verdict();

-- Moderator-only manual review.
create or replace function public.admin_set_moment_moderation(
  p_moment_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_moderator() then
    raise exception 'Moderator role required' using errcode = '42501';
  end if;

  if p_status not in ('pending', 'approved', 'rejected', 'failed_review') then
    raise exception 'Unknown moderation status' using errcode = '22023';
  end if;

  perform set_config('mettivo.moderation_action', 'on', true);

  update public.moments
    set moderation_status = p_status,
        moderation_reviewed_at = now()
    where id = p_moment_id;

  return found;
end;
$$;

revoke all on function public.admin_set_moment_moderation(uuid, text) from public, anon;
grant execute on function public.admin_set_moment_moderation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Download authorization
-- ---------------------------------------------------------------------------
-- The authority is the server: `can_download_moment()` re-checks ownership,
-- visibility, moderation and the creator's switch every time. `get_..._url()`
-- returns the storage location only for an authorised caller.
create or replace function public.can_download_moment(p_moment_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m       public.moments%rowtype;
  me      uuid := auth.uid();
begin
  if me is null then
    return false;
  end if;

  select * into m from public.moments where id = p_moment_id;
  if not found then
    return false;
  end if;

  -- The author may always fetch their own original.
  if m.author_id = me then
    return true;
  end if;

  if m.moderation_status <> 'approved' then
    return false;
  end if;

  if not public.can_view_moment(m.author_id, m.visibility) then
    return false;
  end if;

  if public.is_blocked_pair(me, m.author_id) then
    return false;
  end if;

  return m.allow_downloads;
end;
$$;

revoke all on function public.can_download_moment(uuid) from public, anon;
grant execute on function public.can_download_moment(uuid) to authenticated;

-- Returns the media URL for an authorised download. When the storage schema is
-- present this prefers a short-lived signed URL; because the legacy
-- `moment-media` bucket is public-read, that is a courtesy, not DRM. Full
-- byte-level enforcement needs the bucket flipped private (documented in
-- docs/ARCHITECTURE.md).
create or replace function public.get_moment_download_url(p_moment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  m     public.moments%rowtype;
  url   text;
  path  text;
begin
  if not public.can_download_moment(p_moment_id) then
    raise exception 'Download not permitted' using errcode = '42501';
  end if;

  select * into m from public.moments where id = p_moment_id;
  url := m.media[1];
  if url is null then
    return null;
  end if;

  -- Best effort: if storage is modelled and the bucket is private, mint a
  -- short-lived signed URL. Failures fall back to the stored URL.
  begin
    if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
      path := split_part(url, '/object/public/moment-media/', 2);
      if path <> '' and path <> url then
        select (storage.create_signed_url('moment-media', path, 300)).signed_url
          into url;
      end if;
    end if;
  exception when others then
    -- keep the stored URL
    null;
  end;

  return url;
end;
$$;

revoke all on function public.get_moment_download_url(uuid) from public, anon;
grant execute on function public.get_moment_download_url(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Rebuild the feed and archive views with the new columns
-- ---------------------------------------------------------------------------
-- Views cannot gain columns via CREATE OR REPLACE, so both are dropped and
-- recreated. The visibility + moderation predicate stays in the view because it
-- is an owner-rights view that bypasses base-table RLS.
drop view if exists public.moment_feed;
create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.content_kind,
  m.duration_seconds,
  m.allow_downloads,
  m.moderation_status,
  m.tags,
  m.shares,
  m.views_count,
  m.visibility,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(s.save_count, 0)     as save_count,
  coalesce(me.liked, false)     as liked_by_me,
  coalesce(sv.saved, false)     as saved_by_me
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
  select moment_id, count(*)::int as save_count
  from public.moment_saves group by moment_id
) s on s.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
left join (
  select moment_id, true as saved
  from public.moment_saves where user_id = auth.uid()
) sv on sv.moment_id = m.id
where m.archived_at is null
  and public.can_view_moment(m.author_id, m.visibility)
  and not public.is_blocked_pair(auth.uid(), m.author_id)
  -- Authors see their own pending content; nobody else sees unapproved content.
  and (m.moderation_status = 'approved' or m.author_id = auth.uid());

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

drop view if exists public.moment_archive;
create view public.moment_archive as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.content_kind,
  m.duration_seconds,
  m.allow_downloads,
  m.moderation_status,
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
  coalesce(s.save_count, 0)     as save_count,
  coalesce(me.liked, false)     as liked_by_me,
  coalesce(sv.saved, false)     as saved_by_me
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
  select moment_id, count(*)::int as save_count
  from public.moment_saves group by moment_id
) s on s.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
left join (
  select moment_id, true as saved
  from public.moment_saves where user_id = auth.uid()
) sv on sv.moment_id = m.id
where m.archived_at is not null
  and m.author_id = auth.uid();

grant select on public.moment_archive to authenticated;
revoke all on public.moment_archive from anon;

comment on column public.moments.content_kind is
  'post (photo / carousel / ordinary video) or reel (single vertical video, <= 120s).';
comment on column public.moments.duration_seconds is
  'Client-declared media duration. Enforced by a CHECK (reel <= 120s, post <= 600s); independent byte-level probing requires a media provider.';
comment on column public.moments.allow_downloads is
  'Creator-controlled: when false, get_moment_download_url() refuses every viewer except the author.';
comment on column public.moments.moderation_status is
  'pending | approved | rejected | failed_review. Only approved content appears to other members; the author always sees their own.';
comment on table public.moment_saves is
  'Private per-member saves. RLS exposes a row only to its owner; the moment_feed view adds save_count and saved_by_me.';
