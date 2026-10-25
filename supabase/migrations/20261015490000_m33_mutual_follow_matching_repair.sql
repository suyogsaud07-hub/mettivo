-- =============================================================================
-- M33 · Mutual-follow matching repair
-- =============================================================================
-- WHY
--   M23 made a match mean "a reciprocal, cross-gender follow that is not
--   blocked" and installed a trigger on `follows`. Three gaps remained:
--
--   1. A match was only reconciled when a follow row was inserted or deleted.
--      If two members already followed each other and one later corrected their
--      gender, no match was created (or an ineligible match was left behind).
--   2. Two simultaneous reciprocal follows could each miss the other's
--      uncommitted row, leaving a valid pair without a match.
--   3. Matches created by the old like-based rule survived on deployed
--      databases even though the product rule is follows-only.
--
-- WHAT
--   * ONE idempotent helper, `sync_match_for_pair(a, b)`, reconciles a pair.
--   * The follows trigger calls it under a transaction-scoped advisory lock, so
--     concurrent reciprocal follows serialize and the second one sees the first.
--   * A profile gender update reconciles every pair that profile belongs to.
--   * A one-time backfill removes matches that no longer satisfy
--     `pair_should_match()` and creates missing matches for existing mutual
--     follows.
--
-- SECURITY
--   The helper is SECURITY DEFINER and callable only by the triggers; clients
--   have no EXECUTE grant. Matches still have no INSERT policy. Identity is
--   never taken from an argument supplied by a browser.
--
-- SAFE TO RE-RUN: trigger/functions are replaced, and the backfill is a pure
-- function of `follows`, `profiles` and `blocked_users`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. One pair reconciler
-- ---------------------------------------------------------------------------
-- `pg_advisory_xact_lock` is transaction-scoped: the lock releases on commit or
-- rollback. Hashing the canonical pair means the two reciprocal INSERTs take the
-- same lock even though each trigger fires for a different row.
create or replace function public.sync_match_for_pair(a uuid, b uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lo uuid;
  hi uuid;
begin
  if a is null or b is null or a = b then
    return;
  end if;

  lo := least(a, b);
  hi := greatest(a, b);

  perform pg_advisory_xact_lock(hashtext(lo::text || ':' || hi::text));

  if public.pair_should_match(lo, hi) then
    insert into public.matches (user_a, user_b)
    values (lo, hi)
    on conflict (user_a, user_b) do nothing;
  else
    delete from public.matches m
    where m.user_a = lo and m.user_b = hi;
  end if;
end;
$$;

revoke all on function public.sync_match_for_pair(uuid, uuid) from public, anon, authenticated;

comment on function public.sync_match_for_pair(uuid, uuid) is
  'Reconciles the canonical match row for one pair. Internal trigger helper; not callable by clients.';

-- ---------------------------------------------------------------------------
-- 2. Follows trigger — INSERT, DELETE and UPDATE all reconcile
-- ---------------------------------------------------------------------------
-- The M23 function only handled INSERT/DELETE. Replacing it with a generic
-- wrapper also covers a PK-changing UPDATE, which is rare but must not leave the
-- old pair connected.
create or replace function public.sync_follow_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.sync_match_for_pair(old.follower_id, old.following_id);
    end if;

    if tg_op in ('INSERT', 'UPDATE') then
      perform public.sync_match_for_pair(new.follower_id, new.following_id);
    end if;
  exception when others then
    -- A match failure must never block the follow that caused it. The backfill
    -- in this migration (and the next follow) can repair any missed pair.
    null;
  end;

  return coalesce(new, old);
end;
$$;

drop trigger if exists follows_sync_match_trg on public.follows;
create trigger follows_sync_match_trg
  after insert or update or delete on public.follows
  for each row execute function public.sync_follow_match();

-- ---------------------------------------------------------------------------
-- 3. Profile gender changes reconcile every connected pair
-- ---------------------------------------------------------------------------
-- Gender is the product's only pair-eligibility attribute. When it changes, all
-- existing follows involving that member must be re-evaluated in BOTH directions:
-- an ineligible connection disappears and a now-eligible one appears.
create or replace function public.sync_profile_match_pairs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  edge record;
begin
  begin
    if new.gender is not distinct from old.gender then
      return new;
    end if;

    for edge in
      select f.follower_id, f.following_id
      from public.follows f
      where f.follower_id = new.id or f.following_id = new.id
    loop
      perform public.sync_match_for_pair(edge.follower_id, edge.following_id);
    end loop;
  exception when others then
    -- A profile save must not fail because a match could not be reconciled.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists profiles_sync_match_pairs_trg on public.profiles;
create trigger profiles_sync_match_pairs_trg
  after update of gender on public.profiles
  for each row execute function public.sync_profile_match_pairs();

-- ---------------------------------------------------------------------------
-- 4. Backfill deployed data
-- ---------------------------------------------------------------------------
-- Remove matches that violate the follows-only, cross-gender, unblocked rule.
-- This intentionally cleans up matches created by the old mutual-like rule.
delete from public.matches m
where not public.pair_should_match(m.user_a, m.user_b);

-- Create the matches that existing mutual follows should already have. The
-- canonical `least/greatest` pair and the unique index make this idempotent.
insert into public.matches (user_a, user_b)
select least(f1.follower_id, f1.following_id),
       greatest(f1.follower_id, f1.following_id)
from public.follows f1
join public.follows f2
  on f2.follower_id = f1.following_id
 and f2.following_id = f1.follower_id
where f1.follower_id < f1.following_id
  and public.pair_should_match(f1.follower_id, f1.following_id)
on conflict (user_a, user_b) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Posture report
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('sync_match_for_pair', 'sync_follow_match', 'sync_profile_match_pairs')
order by p.proname;
