-- =============================================================================
-- M12 · Server-side blocking and unmatching
-- =============================================================================
-- WHY: `blocked_users` rows were stored but consulted only by the report page
-- and the chat room's own UI. Nothing in the database stopped a blocked member
-- from liking, matching, appearing in discovery, or sending a message. A block
-- the user cannot rely on is worse than no block button at all.
--
-- DESIGN
--   * One source of truth: `public.is_blocked_pair(a, b)`. SECURITY DEFINER so
--     it can read `blocked_users` no matter how tightly that table's SELECT
--     policy is scoped -- policies and the helper must not be able to disagree.
--   * Effect is SYMMETRIC: a block by either side severs the pair.
--   * Enforced at the database, in four places, because the browser is not
--     trusted and there is no application server:
--       1. `record_like()`      -> raises
--       2. `discover_profiles()`-> excludes the pair entirely
--       3. a BEFORE INSERT trigger on `messages` -> raises
--       4. `matches` / `likes` are cleared on block, so a stale match cannot be
--          used to keep reading or messaging
--   * `blocked_users.SELECT` is tightened from "any signed-in member" (the M6
--     baseline expression) to "a member involved in the block": who has blocked
--     whom is a social graph, not public data. This was RISK_REGISTER R-06.
--
-- DEPENDS ON: M4 (constraints/indexes), M10 (likes/matches), M14 (is_moderator).
-- SAFE TO RE-RUN: idempotent; functions are `create or replace`, policies are
-- dropped before creation, seeds use `on conflict do nothing`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. is_blocked_pair() — the single source of truth
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.blocked_users bu
    where (bu.blocker_id = a and bu.blocked_user_id = b)
       or (bu.blocker_id = b and bu.blocked_user_id = a)
  );
$$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

comment on function public.is_blocked_pair(uuid, uuid) is
  'True when either member has blocked the other. Symmetric. SECURITY DEFINER so policy scoping can never change its answer.';

-- ---------------------------------------------------------------------------
-- 2. Tighten blocked_users.SELECT
-- ---------------------------------------------------------------------------
-- The M6 baseline installed `blocked_users_select_authenticated` with
-- `auth.uid() is not null`, which let ANY signed-in member enumerate the whole
-- block graph. M6 only ever installs a baseline when a table has zero policies,
-- so it is replaced here by an explicit, tighter policy.
drop policy if exists "blocked_users_select_authenticated" on public.blocked_users;

drop policy if exists "blocked_users_select_involved" on public.blocked_users;
create policy "blocked_users_select_involved"
  on public.blocked_users for select to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_user_id);

-- ---------------------------------------------------------------------------
-- 3. Block / unblock / unmatch RPCs
-- ---------------------------------------------------------------------------
-- Blocking also clears the match and both like decisions, so the severed pair
-- cannot keep a conversation alive or silently re-match.
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

  -- Sever the match and both decisions.
  delete from public.matches m
  where m.user_a = least(me, p_target)
    and m.user_b = greatest(me, p_target);
  get diagnostics removed_match = row_count;

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

create or replace function public.unblock_member(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  removed integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target is null then
    raise exception 'p_target is required' using errcode = '22023';
  end if;

  -- Only the blocker may undo their own block: an unblock is not a way for the
  -- blocked member to force contact.
  delete from public.blocked_users bu
  where bu.blocker_id = me and bu.blocked_user_id = p_target;
  get diagnostics removed = row_count;

  return jsonb_build_object('unblocked', removed > 0, 'other_user_id', p_target);
end;
$$;

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

  -- Clear both decisions. Keeping them would let a single re-like recreate the
  -- match instantly, which is not what "unmatch" means to a member.
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

revoke all on function public.block_member(uuid)   from public, anon;
revoke all on function public.unblock_member(uuid) from public, anon;
revoke all on function public.unmatch_member(uuid) from public, anon;
grant execute on function public.block_member(uuid)   to authenticated;
grant execute on function public.unblock_member(uuid) to authenticated;
grant execute on function public.unmatch_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_like() — refuse a blocked pair
-- ---------------------------------------------------------------------------
-- Redefined from M10 with the guard added. Signature is unchanged so the
-- existing client call keeps working.
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

  -- M12: a block severs the pair in both directions, including likes.
  if public.is_blocked_pair(me, target_user) then
    raise exception 'You cannot interact with this member.' using errcode = '42501';
  end if;

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

-- ---------------------------------------------------------------------------
-- 5. Message delivery — refuse a blocked pair
-- ---------------------------------------------------------------------------
create or replace function public.reject_blocked_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  select case when m.user_a = new.sender_id then m.user_b else m.user_a end
    into recipient
  from public.matches m
  where m.id::text = new.match_id
  limit 1;

  if recipient is not null and public.is_blocked_pair(new.sender_id, recipient) then
    raise exception 'You cannot message this member.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists reject_blocked_message_trg on public.messages;
create trigger reject_blocked_message_trg
  before insert on public.messages
  for each row execute function public.reject_blocked_message();

-- ---------------------------------------------------------------------------
-- 6. discover_profiles() — the only supported discovery read path
-- ---------------------------------------------------------------------------
-- RLS cannot do this job. `public_profiles` is a view *without*
-- `security_invoker`, so it reads with the owner's rights and is not filtered by
-- the policy on `profiles`; a blocked member would still appear. Filtering has
-- to happen somewhere the caller cannot influence, and PostgreSQL RLS cannot
-- express "not exists a blocking pair" without a policy that reads another
-- table (which then needs its own access).
--
-- This function is that filter. It returns an ALLOW-LISTED column set -- no
-- birth_date, no moderation columns -- and excludes:
--   * the caller,
--   * anyone not onboarded,
--   * suspended members (RISK_REGISTER R-07 / PRD FR-D4),
--   * blocked and blocking members (symmetric),
--   * anyone the caller has already liked or passed,
--   * anyone already matched with the caller.
create or replace function public.discover_profiles(
  p_min_age     integer default 18,
  p_max_age     integer default 99,
  p_genders     text[]  default null,
  p_limit       integer default 50,
  p_online_only boolean default false
)
returns table (
  id           uuid,
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
  personality  text[],
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
    p.id, p.display_name, p.age, p.gender, p.city, p.country,
    p.avatar_url, p.photos, p.bio, p.intention, p.looking_for,
    p.hobbies, p.pets, p.personality, p.interests, p.prompts,
    p.is_online, p.is_verified
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
  'Allow-listed discovery feed. Excludes the caller, non-onboarded and suspended members, blocked pairs, and anyone already decided or matched.';

-- ---------------------------------------------------------------------------
-- 7. Posture report
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_blocked_pair', 'block_member', 'unblock_member', 'unmatch_member',
    'record_like', 'reject_blocked_message', 'discover_profiles'
  )
order by p.proname;
