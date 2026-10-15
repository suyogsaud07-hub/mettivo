-- =============================================================================
-- M15 · Privacy, deletion and legal readiness
-- =============================================================================
-- Adds the two data-subject rights a Nepali/global launch needs:
--   * erasure   -> delete_my_account()   (self-service, immediate)
--   * portability -> export_my_data()    (machine-readable JSON copy)
--
-- WHY SECURITY DEFINER
--   Deleting an auth user requires privileges the `authenticated` role does not
--   have. Both functions therefore run as their owner and derive identity only
--   from auth.uid() — a caller can never act on anyone else's data, because no
--   user id is accepted as a parameter.
--
-- WHY DEPENDENT ROWS ARE DELETED EXPLICITLY
--   It does not rely on every foreign key being declared ON DELETE CASCADE.
--   Explicit deletes are deterministic in any environment and make the order of
--   operations reviewable. An audit entry is written BEFORE anything is removed,
--   so the moderation trail retains a record that a deletion occurred.
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. export_my_data() — portability
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
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

  return jsonb_build_object(
    'exported_at', now(),
    'user_id', me,
    'profile', (
      select to_jsonb(p) from public.profiles p where p.id = me
    ),
    'likes_sent', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.likes l where l.liker_id = me
    ),
    'likes_received', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.likes l where l.liked_id = me
    ),
    'matches', (
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
      from public.matches m where m.user_a = me or m.user_b = me
    ),
    'messages_sent', (
      select coalesce(jsonb_agg(to_jsonb(msg)), '[]'::jsonb)
      from public.messages msg where msg.sender_id = me
    ),
    'reports_filed', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from public.reports r where r.reporter_id = me
    ),
    'blocks', (
      select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
      from public.blocked_users b where b.blocker_id = me or b.blocked_user_id = me
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. delete_my_account() — erasure
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me              uuid := auth.uid();
  n_profiles      integer := 0;
  n_messages      integer := 0;
  n_likes         integer := 0;
  n_matches       integer := 0;
  n_blocks        integer := 0;
  n_reports       integer := 0;
  n_follows       integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Record the intent first so the moderation trail survives the erasure.
  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'user.self_deleted', me, jsonb_build_object('requested_at', now()));

  -- Dependent rows first, in an order that cannot violate a foreign key.
  delete from public.messages      where sender_id = me;
  get diagnostics n_messages = row_count;

  delete from public.likes         where liker_id = me or liked_id = me;
  get diagnostics n_likes = row_count;

  delete from public.matches       where user_a = me or user_b = me;
  get diagnostics n_matches = row_count;

  delete from public.blocked_users where blocker_id = me or blocked_user_id = me;
  get diagnostics n_blocks = row_count;

  delete from public.follows       where follower_id = me or following_id = me;
  get diagnostics n_follows = row_count;

  -- Reports are removed in both directions: the references are NOT NULL FKs to
  -- auth.users, so they cannot outlive the account. The audit entry above is the
  -- lasting moderation record, and it has no such FK.
  delete from public.reports       where reporter_id = me or reported_user_id = me;
  get diagnostics n_reports = row_count;

  delete from public.profiles      where id = me;
  get diagnostics n_profiles = row_count;

  -- Finally the identity itself. This is what makes the erasure real rather
  -- than a soft-delete that leaves the login working.
  delete from auth.users where id = me;

  return jsonb_build_object(
    'ok', true,
    'deleted', jsonb_build_object(
      'profiles',      n_profiles,
      'messages',      n_messages,
      'likes',         n_likes,
      'matches',       n_matches,
      'blocks',        n_blocks,
      'follows',       n_follows,
      'reports',       n_reports
    )
  );
end;
$$;

revoke all on function public.export_my_data()    from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.export_my_data()    to authenticated;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.export_my_data() is
  'Returns a machine-readable copy of the caller''s own data (privacy portability).';
comment on function public.delete_my_account() is
  'Irreversibly erases the caller''s profile, activity and identity. Audited before deletion.';

-- ---------------------------------------------------------------------------
-- 3. Column-level hardening for birth_date — COMPLETED
-- ---------------------------------------------------------------------------
-- This section originally recorded the following as the correct end state, and
-- deliberately did not execute it:
--
--     revoke select (birth_date) on public.profiles from authenticated, anon;
--
-- Steps 1 and 2 of that plan are now done (every `select('*')` on `profiles`
-- was replaced with an explicit allow-list, and the dashboard renders `age`).
--
-- IMPORTANT CORRECTION: the statement above does not work anyway. A table-wide
-- SELECT grant covers every column, and a column-level REVOKE cannot subtract
-- from it — verified empirically. Shipping it would have produced a security
-- control that silently protected nothing.
--
-- The working form is a table-wide revoke followed by a column re-grant, and it
-- lives in its own migration so the sequencing is explicit:
--
--     20261015260000_m15_revoke_birth_date.sql
--
-- That migration also adds `my_birth_date()`, the owner-only accessor the
-- onboarding wizard uses to prefill the member's own date of birth.
-- ---------------------------------------------------------------------------

-- Report the resulting posture.
select
  p.proname                        as function_name,
  pg_get_function_result(p.oid)    as returns,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('export_my_data', 'delete_my_account')
order by p.proname;
