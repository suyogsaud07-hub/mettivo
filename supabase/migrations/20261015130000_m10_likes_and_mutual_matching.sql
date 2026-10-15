-- =============================================================================
-- M10 · Discovery and mutual matching
-- =============================================================================
-- Adds the `likes` table (like / pass), normalises `matches`, and installs a
-- single race-safe entry point for recording a like and creating a match.
--
-- WHY A DATABASE FUNCTION
--   A "read partner's like, then insert a match" flow implemented in the browser
--   races: if both users like each other at the same moment, each client can read
--   before the other has written, and the match is never created. Doing it in one
--   transaction removes the race entirely.
--
-- WHY MATCHES HAVE NO INSERT POLICY
--   Deliberately omitted. Matches can only be created by `record_like`, which is
--   SECURITY DEFINER. Clients therefore cannot forge a match with someone who
--   never liked them back.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. likes — one row per (liker, target) pair, is_like=false means "pass"
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  id         uuid        primary key default gen_random_uuid(),
  liker_id   uuid        not null references auth.users(id) on delete cascade,
  liked_id   uuid        not null references auth.users(id) on delete cascade,
  is_like    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (liker_id, liked_id),
  constraint likes_no_self_like check (liker_id <> liked_id)
);

create index if not exists likes_liker_id_idx on public.likes (liker_id);
create index if not exists likes_liked_id_like_idx on public.likes (liked_id) where is_like;

alter table public.likes enable row level security;

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert to authenticated
  with check (auth.uid() = liker_id);          -- WITH CHECK, never USING

drop policy if exists "likes_select_involved" on public.likes;
create policy "likes_select_involved"
  on public.likes for select to authenticated
  using (auth.uid() = liker_id or auth.uid() = liked_id);

drop policy if exists "likes_update_own" on public.likes;
create policy "likes_update_own"
  on public.likes for update to authenticated
  using (auth.uid() = liker_id)
  with check (auth.uid() = liker_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own"
  on public.likes for delete to authenticated
  using (auth.uid() = liker_id);

-- ---------------------------------------------------------------------------
-- 2. matches — normalise to a canonical, order-independent pair
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id         uuid        primary key default gen_random_uuid(),
  user_a     uuid        not null references auth.users(id) on delete cascade,
  user_b     uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Add columns an older `matches` table may be missing. `if not exists` makes
-- this a no-op on a table that already has them.
alter table public.matches add column if not exists user_a     uuid;
alter table public.matches add column if not exists user_b     uuid;
alter table public.matches add column if not exists created_at timestamptz not null default now();

-- Exactly one row per pair, whichever direction the like came from.
create unique index if not exists matches_user_pair_key
  on public.matches (user_a, user_b);

alter table public.matches enable row level security;

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- No INSERT/UPDATE/DELETE policy on purpose: only `record_like` may write.

-- ---------------------------------------------------------------------------
-- 3. record_like — atomic like/pass + mutual match creation
-- ---------------------------------------------------------------------------
-- Returns: { liked, matched, match_id, matched_user_id }
-- Raises SQLSTATE 28000 when the caller has no session, 22023 on bad input.
-- ---------------------------------------------------------------------------
create or replace function public.record_like(
  target_user   uuid,
  is_like_value boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me           uuid := auth.uid();
  reciprocal   boolean := false;
  new_match_id uuid;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if target_user is null then
    raise exception 'target_user is required' using errcode = '22023';
  end if;

  if target_user = me then
    raise exception 'You cannot like yourself' using errcode = '22023';
  end if;

  -- Idempotent: re-liking the same person updates rather than erroring.
  insert into public.likes (liker_id, liked_id, is_like)
  values (me, target_user, is_like_value)
  on conflict (liker_id, liked_id)
    do update set is_like = excluded.is_like, updated_at = now();

  if not is_like_value then
    return jsonb_build_object(
      'liked', true, 'matched', false, 'match_id', null, 'matched_user_id', null
    );
  end if;

  select exists (
    select 1
    from public.likes l
    where l.liker_id = target_user
      and l.liked_id = me
      and l.is_like
  ) into reciprocal;

  if not reciprocal then
    return jsonb_build_object(
      'liked', true, 'matched', false, 'match_id', null, 'matched_user_id', null
    );
  end if;

  -- Canonical ordering keeps the unique index meaningful in both directions.
  -- `do nothing` + `select` is used rather than `do update ... returning`
  -- because RETURNING yields no row when the conflict is skipped.
  insert into public.matches (user_a, user_b)
  values (least(me, target_user), greatest(me, target_user))
  on conflict (user_a, user_b) do nothing;

  select m.id into new_match_id
  from public.matches m
  where m.user_a = least(me, target_user)
    and m.user_b = greatest(me, target_user);

  return jsonb_build_object(
    'liked', true,
    'matched', true,
    'match_id', new_match_id,
    'matched_user_id', target_user
  );
end;
$$;

revoke all on function public.record_like(uuid, boolean) from public, anon;
grant execute on function public.record_like(uuid, boolean) to authenticated;

-- Table-level privileges, stated explicitly rather than relying on Supabase's
-- default privileges, so this migration is self-sufficient on any project.
-- RLS is layered on top of these grants and remains the real gate.
grant select, insert, update, delete on public.likes to authenticated;
grant select on public.matches to authenticated;

revoke all on public.likes from anon;
revoke all on public.matches from anon;

comment on function public.record_like(uuid, boolean) is
  'Records a like/pass and creates a match when the interest is mutual. SECURITY DEFINER so clients cannot forge matches.';
comment on table public.likes is
  'Like/pass decisions. RLS: users read only their own outgoing and incoming rows.';
comment on table public.matches is
  'Mutual matches, stored as a canonically ordered unordered pair. Written only by record_like().';

-- Report the resulting posture.
select
  c.relname                    as table_name,
  c.relrowsecurity             as rls_enabled,
  count(p.policyname)          as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('likes','matches')
group by c.relname, c.relrowsecurity
order by c.relname;
