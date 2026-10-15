-- =============================================================================
-- Moments · real activity feed
-- =============================================================================
-- Gives the owner's Moments navigation button (MobileNav -> /moments) a real
-- backend: posts, likes, comments, shares, an aggregated feed view, Realtime,
-- and automatic reuse of the M14 abuse controls (suspension + rate limiting).
--
-- TABLES
--   moments          one row per post (caption + media array + tags + shares)
--   moment_likes     who liked which post   (PK prevents double-liking)
--   moment_comments  threaded-free comments on a post
--
-- FEED VIEW
--   public.moment_feed returns each post already joined with like_count,
--   comment_count and a per-caller liked_by_me flag, so the client makes ONE
--   request instead of four and cannot miscount.
--
-- SAFE TO RE-RUN: idempotent. Statements that depend on M14 are guarded, so this
-- file also applies cleanly on a project where M14 has not been run yet.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments
-- ---------------------------------------------------------------------------
create table if not exists public.moments (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users(id) on delete cascade,
  caption     text,
  media       text[] not null default '{}',
  tags        text[] not null default '{}',
  shares      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint moments_caption_len check (caption is null or char_length(caption) <= 2000),
  constraint moments_media_max   check (array_length(media, 1) is null or array_length(media, 1) <= 4),
  constraint moments_tags_max    check (array_length(tags, 1) is null or array_length(tags, 1) <= 6),
  constraint moments_shares_pos  check (shares >= 0)
);

create index if not exists moments_created_idx on public.moments (created_at desc);
create index if not exists moments_author_idx  on public.moments (author_id);

-- ---------------------------------------------------------------------------
-- 2. moment_likes — composite PK makes double-liking impossible
-- ---------------------------------------------------------------------------
create table if not exists public.moment_likes (
  moment_id  uuid not null references public.moments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index if not exists moment_likes_user_idx on public.moment_likes (user_id);

-- ---------------------------------------------------------------------------
-- 3. moment_comments
-- ---------------------------------------------------------------------------
create table if not exists public.moment_comments (
  id         uuid primary key default gen_random_uuid(),
  moment_id  uuid not null references public.moments(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint moment_comments_body_len check (char_length(body) between 1 and 1000)
);

create index if not exists moment_comments_moment_idx on public.moment_comments (moment_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.moments         enable row level security;
alter table public.moment_likes    enable row level security;
alter table public.moment_comments enable row level security;

-- Feed is visible to every signed-in member, never to anonymous callers.
drop policy if exists "moments_select_authenticated" on public.moments;
create policy "moments_select_authenticated"
  on public.moments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moments_insert_own" on public.moments;
create policy "moments_insert_own"
  on public.moments for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "moments_update_own" on public.moments;
create policy "moments_update_own"
  on public.moments for update to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "moments_delete_own" on public.moments;
create policy "moments_delete_own"
  on public.moments for delete to authenticated
  using (auth.uid() = author_id);

-- Likes: everyone can see them (needed for counts), only the owner can add/remove.
drop policy if exists "moment_likes_select_all" on public.moment_likes;
create policy "moment_likes_select_all"
  on public.moment_likes for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moment_likes_insert_own" on public.moment_likes;
create policy "moment_likes_insert_own"
  on public.moment_likes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "moment_likes_delete_own" on public.moment_likes;
create policy "moment_likes_delete_own"
  on public.moment_likes for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "moment_comments_select_all" on public.moment_comments;
create policy "moment_comments_select_all"
  on public.moment_comments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moment_comments_insert_own" on public.moment_comments;
create policy "moment_comments_insert_own"
  on public.moment_comments for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "moment_comments_delete_own" on public.moment_comments;
create policy "moment_comments_delete_own"
  on public.moment_comments for delete to authenticated
  using (auth.uid() = author_id);

grant select, insert, update, delete on public.moments         to authenticated;
grant select, insert, delete         on public.moment_likes    to authenticated;
grant select, insert, delete         on public.moment_comments to authenticated;

revoke all on public.moments         from anon;
revoke all on public.moment_likes    from anon;
revoke all on public.moment_comments from anon;

-- ---------------------------------------------------------------------------
-- 5. moment_feed — one request, correct counts
-- ---------------------------------------------------------------------------
-- NOTE ON RIGHTS: this view is created with the owner's rights (the PostgreSQL
-- default), so it is NOT filtered by the RLS policies above. That is safe today
-- because `moments_select_authenticated` already grants every signed-in member
-- read access to every post, so the view exposes nothing extra. If that policy
-- is ever tightened to a subset of posts, this view MUST be revisited (for
-- example by setting `security_invoker = true` on PostgreSQL 15+).
-- ---------------------------------------------------------------------------
drop view if exists public.moment_feed;

create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.tags,
  m.shares,
  m.created_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
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
  'Moments with aggregated like/comment counts and a per-caller liked_by_me flag. Read this instead of the base table.';

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

-- ---------------------------------------------------------------------------
-- 6. share_moment() — server-side counter (the client cannot simply set it)
-- ---------------------------------------------------------------------------
create or replace function public.share_moment(p_moment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_shares integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.moments
     set shares = shares + 1, updated_at = now()
   where id = p_moment_id
  returning shares into new_shares;

  if new_shares is null then
    raise exception 'Moment not found' using errcode = 'P0002';
  end if;

  return new_shares;
end;
$$;

revoke all on function public.share_moment(uuid) from public, anon;
grant execute on function public.share_moment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reuse the M14 abuse controls (suspension + rate limiting) for Moments
-- ---------------------------------------------------------------------------
do $$
begin
  -- Only if M14 has been applied.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_abuse_controls'
  ) then
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'rate_limit_rules' and c.relkind = 'r'
    ) then
      insert into public.rate_limit_rules (action, max_events, window_seconds, description)
      values ('moments', 10, 3600, 'Moments posted per hour')
      on conflict (action) do update
        set max_events     = excluded.max_events,
            window_seconds = excluded.window_seconds,
            description    = excluded.description;
    end if;

    drop trigger if exists enforce_abuse_controls_moments on public.moments;
    create trigger enforce_abuse_controls_moments
      before insert on public.moments
      for each row execute function public.enforce_abuse_controls();

    raise notice 'Moments wired into M14 abuse controls';
  else
    raise notice 'M14 abuse controls not installed - skipping (run the M14 migration for suspension + rate limiting)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Realtime — new moments appear without a refresh
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moments'
    ) then
      alter publication supabase_realtime add table public.moments;
      raise notice 'moments added to supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for moments in the dashboard';
  end if;
end $$;

comment on table public.moments is
  'Moments feed posts. RLS: readable by any signed-in member, writable only by the author.';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('moments','moment_likes','moment_comments')
group by c.relname, c.relrowsecurity
order by c.relname;
