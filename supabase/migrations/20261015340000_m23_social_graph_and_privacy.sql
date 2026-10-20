-- =============================================================================
-- M23 · Social graph matches and list privacy
-- =============================================================================
-- WHY THIS MIGRATION EXISTS
--   Four related gaps in the social graph, all of which let a member see or do
--   more than the product allows:
--
--   1. NOTIFICATIONS BODY. `notifications.body` was added later (M21) but the
--      column only exists on deployments that ran M21. Any surface that selects
--      the notification list then fails at runtime on a DB that is behind. This
--      migration makes the column part of the guaranteed base shape.
--
--   2. MATCHES CAME FROM LIKES, NOT FOLLOWS. `record_like()` matched ANY two
--      members who liked each other. The product rule is that a match is a
--      cross-gender connection formed ONLY by a mutual follow: a Female follows
--      a Male AND the Male follows the Female back. Likes record interest, they
--      no longer create a match, and same-gender pairs never match at all.
--
--   3. FOLLOWING DID NOT CREATE A MATCH. Follows previously only produced a
--      notification; they never touched `matches`, so two members could be
--      following each other with no match and no way to message.
--
--   4. LISTS HAD NO PRIVACY BOUNDARY. `follows`/`matches` are hidden by RLS
--      from third parties, but there was no supported way to read a member's
--      FOLLOWERS. The list surfaces were self-only by accident, not by design.
--      This adds an explicit read path: Followers are viewable, Following and
--      Matches are private (OWNER-ONLY). The numeric counts already live on
--      `public_profiles` and stay visible.
--
-- DESIGN
--   * ONE predicate decides a match: `public.pair_should_match(a, b)`.
--       - either side has blocked the other          -> never,
--       - not a Woman/Female <-> Man/Male pair        -> never,
--       - not following each other in both directions -> never,
--       - otherwise                                    -> match.
--   * `record_like()` no longer touches `matches` at all. A like is recorded and
--     notifies; it never escalates.
--   * A new AFTER INSERT OR DELETE trigger on `follows` mirrors the edge: a
--     reciprocal cross-gender follow creates the canonical match row; an
--     unfollow removes it again.
--   * `unmatch_member()` and `block_member()` also clear the follow edges, so a
--     severed connection cannot survive as a stale mutual follow.
--   * Matches are STILL only ever written by SECURITY DEFINER functions. No
--     INSERT policy is added to `matches`.
--   * The list RPCs return ALLOW-LISTED columns only (no birth_date, no
--     moderation fields) and pin `search_path`.
--
-- SAFE TO RE-RUN: idempotent (guards, `if not exists`, `create or replace`,
-- `drop ... if exists`). DEPENDS ON: M4 (follows PK), M10 (likes/matches),
-- M12 (is_blocked_pair, record_like, block/unmatch), M18 (profile counts),
-- notifications.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notifications.body — guarantee the column exists
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists body text;

-- Re-assert the closed type set including the M21 moderation 'warning' row, so
-- a deployment that skipped M21 still accepts it.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('follow','like','match','message','visitor','report','warning'));

-- ---------------------------------------------------------------------------
-- 2. is_cross_gender() — the product's definition of a valid match pair
-- ---------------------------------------------------------------------------
-- Only a Woman/Female <-> Man/Male pair can match. Nonbinary and unset genders
-- never do. SECURITY DEFINER so the answer cannot be changed by the tight
-- SELECT policy on `profiles`.
create or replace function public.is_cross_gender(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles pa
    join public.profiles pb on pb.id = b
    where pa.id = a
      and (
        (lower(pa.gender) in ('woman','female') and lower(pb.gender) in ('man','male'))
        or
        (lower(pa.gender) in ('man','male') and lower(pb.gender) in ('woman','female'))
      )
  );
$$;

revoke all on function public.is_cross_gender(uuid, uuid) from public, anon, authenticated;

comment on function public.is_cross_gender(uuid, uuid) is
  'True when the two members form a Woman/Female <-> Man/Male pair. The only pairs eligible to match. Internal helper; not callable by clients.';

-- ---------------------------------------------------------------------------
-- 3. pair_should_match() — the single source of truth for a match
-- ---------------------------------------------------------------------------
-- A match exists exactly when the pair is a Woman/Female <-> Man/Male couple who
-- follow each other and neither has blocked the other. FOLLOWS ONLY: likes are
-- deliberately not consulted.
create or replace function public.pair_should_match(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    a <> b
    and not public.is_blocked_pair(a, b)
    and public.is_cross_gender(a, b)
    and exists (
      select 1 from public.follows f1
      where f1.follower_id = a and f1.following_id = b
    )
    and exists (
      select 1 from public.follows f2
      where f2.follower_id = b and f2.following_id = a
    );
$$;

revoke all on function public.pair_should_match(uuid, uuid) from public, anon, authenticated;

comment on function public.pair_should_match(uuid, uuid) is
  'True when a match should exist: cross-gender, not blocked, and following each other. Follows only; likes never match. Internal helper; not callable by clients.';

-- ---------------------------------------------------------------------------
-- 4. record_like() — record interest only; never create a match
-- ---------------------------------------------------------------------------
-- Redefined from M12. A like/pass is stored (and drives its notification and the
-- profile-likes counter), but matching now belongs exclusively to mutual
-- cross-gender follows. The return shape is unchanged for client compatibility;
-- `matched` is always false here.
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
  me uuid := auth.uid();
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

  -- M12: a block severs the pair in both directions, including likes.
  if public.is_blocked_pair(me, target_user) then
    raise exception 'You cannot interact with this member.' using errcode = '42501';
  end if;

  insert into public.likes (liker_id, liked_id, is_like)
  values (me, target_user, is_like_value)
  on conflict (liker_id, liked_id)
    do update set is_like = excluded.is_like, updated_at = now();

  -- M23: matching is follow-only. A mutual like is recorded but never becomes a
  -- match; `matched` stays false so the UI never claims a connection it lacks.
  return jsonb_build_object(
    'liked', true, 'matched', false, 'match_id', null, 'matched_user_id', null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. follows -> matches: a reciprocal cross-gender follow is a match
-- ---------------------------------------------------------------------------
-- The product rule: a Woman/Female follows a Man/Male AND the Man/Male follows
-- the Woman/Female back. The mirrored edge is the match. Unfollowing either side
-- tears the match back down, because matching is follows-only.
--
-- Generation must never break the follow that caused it, so the body is wrapped
-- in an exception block that returns the row unchanged on any failure.
create or replace function public.sync_follow_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a uuid;
  b uuid;
begin
  begin
    if tg_op = 'INSERT' then
      if new.follower_id = new.following_id then
        return new;
      end if;

      if not public.is_cross_gender(new.follower_id, new.following_id) then
        return new;
      end if;

      if public.is_blocked_pair(new.follower_id, new.following_id) then
        return new;
      end if;

      if exists (
        select 1 from public.follows f
        where f.follower_id = new.following_id
          and f.following_id = new.follower_id
      ) then
        insert into public.matches (user_a, user_b)
        values (least(new.follower_id, new.following_id),
                greatest(new.follower_id, new.following_id))
        on conflict (user_a, user_b) do nothing;
      end if;

      return new;
    end if;

    -- DELETE: keep the match when the pair is still connected, else remove it.
    a := least(old.follower_id, old.following_id);
    b := greatest(old.follower_id, old.following_id);

    if not public.pair_should_match(a, b) then
      delete from public.matches m
      where m.user_a = a and m.user_b = b;
    end if;

    return old;
  exception when others then
    return coalesce(new, old);
  end;
end;
$$;

drop trigger if exists follows_sync_match_trg on public.follows;
create trigger follows_sync_match_trg
  after insert or delete on public.follows
  for each row execute function public.sync_follow_match();

-- ---------------------------------------------------------------------------
-- 6. Severing a connection clears the follow edges too
-- ---------------------------------------------------------------------------
-- Now that a match IS a mutual follow, `unmatch_member` and `block_member` must
-- remove the follow edges as well. Otherwise the match row would be gone while
-- the mutual follow remained, and the connection would silently reappear the
-- next time either edge was toggled.
create or replace function public.unmatch_member(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me            uuid := auth.uid();
  removed_match integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null then
    raise exception 'p_target is required' using errcode = '22023';
  end if;
  if p_target = me then
    raise exception 'You cannot unmatch yourself' using errcode = '22023';
  end if;

  delete from public.matches m
  where m.user_a = least(me, p_target)
    and m.user_b = greatest(me, p_target);
  get diagnostics removed_match = row_count;

  -- M23: sever the mutual follow so the match cannot silently re-form.
  delete from public.follows f
  where (f.follower_id = me and f.following_id = p_target)
     or (f.follower_id = p_target and f.following_id = me);

  delete from public.likes l
  where (l.liker_id = me and l.liked_id = p_target)
     or (l.liker_id = p_target and l.liked_id = me);

  return jsonb_build_object(
    'unmatched', removed_match > 0,
    'other_user_id', p_target,
    'matches_removed', removed_match
  );
end;
$$;

create or replace function public.block_member(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me           uuid := auth.uid();
  removed_match integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null then
    raise exception 'p_target is required' using errcode = '22023';
  end if;
  if p_target = me then
    raise exception 'You cannot block yourself' using errcode = '22023';
  end if;

  insert into public.blocked_users (blocker_id, blocked_user_id)
  values (me, p_target)
  on conflict (blocker_id, blocked_user_id) do nothing;

  delete from public.matches m
  where m.user_a = least(me, p_target)
    and m.user_b = greatest(me, p_target);
  get diagnostics removed_match = row_count;

  -- M23: remove the follow edges so the pair is fully disconnected.
  delete from public.follows f
  where (f.follower_id = me and f.following_id = p_target)
     or (f.follower_id = p_target and f.following_id = me);

  delete from public.likes l
  where (l.liker_id = me and l.liked_id = p_target)
     or (l.liker_id = p_target and l.liked_id = me);

  return jsonb_build_object(
    'blocked', true,
    'other_user_id', p_target,
    'matches_removed', removed_match
  );
end;
$$;

-- `create or replace` preserves an existing ACL, but re-state these so M23 is
-- self-sufficient if ever applied to a database that had not run M10/M12.
revoke all on function public.record_like(uuid, boolean) from public, anon;
grant execute on function public.record_like(uuid, boolean) to authenticated;
revoke all on function public.unmatch_member(uuid) from public, anon;
grant execute on function public.unmatch_member(uuid) to authenticated;
revoke all on function public.block_member(uuid) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. List privacy — followers are viewable, following is owner-only
-- ---------------------------------------------------------------------------
-- The read path below only matters if the underlying table is actually gated.
-- `scripts/verify-rls.sh` found the live `follows` table answering anonymous
-- callers, so RLS and the involved-only SELECT policy are re-asserted here
-- idempotently. A correct deployment is a no-op.
alter table public.follows enable row level security;

drop policy if exists "follows_select_authenticated" on public.follows;
drop policy if exists "follows_select_involved" on public.follows;
create policy "follows_select_involved"
  on public.follows for select to authenticated
  using (auth.uid() = follower_id or auth.uid() = following_id);

-- Both functions return an ALLOW-LISTED column set (never birth_date, never a
-- moderation field) and derive the acting member from auth.uid(), not from an
-- argument, so a caller cannot read on another member's behalf.
drop function if exists public.list_followers(uuid);

create or replace function public.list_followers(p_user uuid)
returns table (
  id                uuid,
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
  'Follower list for any member. Allow-listed columns only. Visible to any authenticated caller.';

-- `list_following` mirrors it but is OWNER-ONLY: a non-owner call raises 42501
-- rather than returning an empty list, so the privacy rule is explicit.
drop function if exists public.list_following(uuid);

create or replace function public.list_following(p_user uuid)
returns table (
  id                uuid,
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
  p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_cross_gender', 'pair_should_match', 'record_like',
    'sync_follow_match', 'unmatch_member', 'block_member',
    'list_followers', 'list_following'
  )
order by p.proname;
