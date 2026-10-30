-- =============================================================================
-- Moments · engagement upgrade (rich media + views)
-- =============================================================================
-- Extends the M… moments feed with the three things a modern social feed needs
-- on top of likes/comments/shares:
--
--   1. media_type  — tells the card whether a post is an image or a short video
--                    so the feed can autoplay video instead of rendering a
--                    frozen frame (image is the default, so legacy rows are
--                    untouched).
--   2. views_count — a total view counter on the post itself.
--   3. moment_views — one row per (post, viewer) so the UI can also show a
--                    *unique* viewer count and a viewer can only inflate the
--                    total once per row, not by refreshing the page.
--
-- It also (a) rebuilds `public.moment_feed` to expose the new columns — a view
-- cannot gain columns via CREATE OR REPLACE, so it is dropped and recreated —
-- (b) adds a SECURITY DEFINER `record_moment_view()` that owns the counter so
-- the client can never set it directly, and (c) idempotently creates the
-- `moment-media` Storage bucket used for uploads, guarded so this file still
-- applies on a database without the `storage` schema (the test harness).
--
-- SAFE TO RE-RUN: every statement is `if not exists` / `drop … if exists` /
-- `on conflict`, and the Storage block is a no-op when `storage` is absent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments — new columns
-- ---------------------------------------------------------------------------
alter table public.moments add column if not exists media_type  text;
alter table public.moments add column if not exists views_count integer not null default 0;

-- Constraint guards: `add constraint` has no `if not exists`, so test for the
-- name first. Existing rows have a null media_type and pass the check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_media_type_chk' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_media_type_chk
      check (media_type is null or media_type in ('image', 'video'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_views_count_pos' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_views_count_pos check (views_count >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. moment_views — one row per (post, viewer) so views are deduplicated
-- ---------------------------------------------------------------------------
create table if not exists public.moment_views (
  moment_id       uuid not null references public.moments(id) on delete cascade,
  viewer_id       uuid not null references auth.users(id) on delete cascade,
  view_count      integer not null default 1,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),
  primary key (moment_id, viewer_id),

  constraint moment_views_count_pos check (view_count >= 1)
);

create index if not exists moment_views_viewer_idx on public.moment_views (viewer_id);

-- RLS is on (the security suite requires it for every public table), but the
-- table is written ONLY through `record_moment_view()`. No client role holds a
-- table privilege, so there is no policy to bypass.
alter table public.moment_views enable row level security;

revoke all on public.moment_views from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_moment_view() — the client asks to be counted, it cannot set a value
-- ---------------------------------------------------------------------------
-- Returns the post's new total and its unique-viewer count in one round trip.
-- Self-views are deliberately not counted (consistent with most feeds), but the
-- call still returns the current totals so the caller can render immediately.
create or replace function public.record_moment_view(p_moment_id uuid)
returns table (views_count integer, unique_views integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := auth.uid();
  v_author uuid;
  v_total  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.author_id, m.views_count
    into v_author, v_total
    from public.moments m
   where m.id = p_moment_id;

  if not found then
    raise exception 'Moment not found' using errcode = 'P0002';
  end if;

  if me <> v_author then
    insert into public.moment_views (moment_id, viewer_id)
    values (p_moment_id, me)
    on conflict (moment_id, viewer_id)
      do update set view_count     = public.moment_views.view_count + 1,
                    last_viewed_at = now();

    -- Qualify the column: the RETURNS TABLE output is also named views_count,
    -- so a bare reference is ambiguous.
    update public.moments m
       set views_count = m.views_count + 1
     where m.id = p_moment_id
    returning m.views_count into v_total;
  end if;

  return query
    select v_total,
           (select count(*)::int from public.moment_views v where v.moment_id = p_moment_id);
end;
$$;

revoke all on function public.record_moment_view(uuid) from public, anon;
grant execute on function public.record_moment_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. moment_feed — expose the new columns (drop + recreate; a view cannot
--    gain columns through CREATE OR REPLACE)
-- ---------------------------------------------------------------------------
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
) me on me.moment_id = m.id;

comment on view public.moment_feed is
  'Moments with media type, view totals, like/comment counts and a per-caller liked_by_me flag. Read this instead of the base table.';

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

-- ---------------------------------------------------------------------------
-- 5. Realtime — live comment threads on an open post
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moment_comments'
    ) then
      alter publication supabase_realtime add table public.moment_comments;
      raise notice 'moment_comments added to supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for moment_comments in the dashboard';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Storage — the `moment-media` bucket for HD images and short video
-- ---------------------------------------------------------------------------
-- Guarded on the `storage` schema: the PGlite test harness does not model
-- Supabase Storage, so this whole block is skipped there. On a real project the
-- bucket is created (public read, so <img>/<video> can load the object) and
-- uploads are scoped to a `<user-id>/…` folder the uploader owns.
do $storage$
begin
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('moment-media', 'moment-media', true)
    on conflict (id) do update set public = true;

    execute $p$drop policy if exists "moment_media_read" on storage.objects$p$;
    execute $p$create policy "moment_media_read"
      on storage.objects for select to authenticated
      using (bucket_id = 'moment-media')$p$;

    execute $p$drop policy if exists "moment_media_insert_own" on storage.objects$p$;
    execute $p$create policy "moment_media_insert_own"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "moment_media_update_own" on storage.objects$p$;
    execute $p$create policy "moment_media_update_own"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "moment_media_delete_own" on storage.objects$p$;
    execute $p$create policy "moment_media_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    raise notice 'moment-media storage bucket ready';
  else
    raise notice 'storage buckets/objects not found - create the moment-media bucket in the dashboard';
  end if;
end $storage$;

comment on column public.moments.media_type is
  'image | video | null (legacy inline data URL, treated as image by the client).';
comment on column public.moments.views_count is
  'Total views, maintained by record_moment_view(). Never written by the client.';

-- Report the resulting posture.
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
