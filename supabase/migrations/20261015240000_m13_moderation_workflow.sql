-- =============================================================================
-- M13 · Reporting and moderation workflow
-- =============================================================================
-- WHY: a report is only useful if a moderator can act on what the REPORTER saw,
-- at the time they saw it. Today the reporter's `details` text is the only
-- context, and the reported profile can be edited (or deleted) between the
-- report and the triage, which turns "they threatened me" into an unresolvable
-- dispute.
--
-- This migration adds:
--   * an immutable-ish EVIDENCE SNAPSHOT taken inside the insert, so triage sees
--     the profile as it was at report time;
--   * a moderator-only TRIAGE QUEUE in one round trip;
--   * a moderator-only RESOLVE path that records who decided what and when, and
--     leaves an audit entry;
--   * a notification back to the reporter, which the M16 trigger already sends
--     when a report becomes 'actioned'.
--
-- PRIVACY: the snapshot deliberately excludes `birth_date` and the moderation
-- columns. A moderator needs to identify the reported member, not to accumulate
-- more personal data about them.
--
-- DEPENDS ON: M4 (constraints/indexes), M14 (is_moderator, admin_audit_log),
--             M16 (report notification trigger).
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Triage columns on reports
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists evidence        jsonb;
alter table public.reports add column if not exists resolution_note text;
alter table public.reports add column if not exists resolved_by     uuid
  references auth.users(id) on delete set null;
alter table public.reports add column if not exists resolved_at     timestamptz;

-- The M4 audit fails any unindexed foreign key.
create index if not exists reports_resolved_by_idx on public.reports (resolved_by);

-- The moderator queue filters on status and orders oldest-first; M4 already
-- added reports_status_created_idx, this one matches the queue's actual order.
create index if not exists reports_queue_idx
  on public.reports (status, created_at asc);

-- ---------------------------------------------------------------------------
-- 2. Evidence snapshot
-- ---------------------------------------------------------------------------
-- Runs BEFORE INSERT so the snapshot is part of the same transaction as the
-- report: there is no window in which a member can edit their profile between
-- the report being filed and the snapshot being taken.
--
-- If the reported profile is already gone, the trigger still records the
-- report rather than failing it -- losing a report to protect a snapshot would
-- be exactly backwards.
create or replace function public.snapshot_report_evidence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if new.evidence is not null then
    return new;
  end if;

  select jsonb_build_object(
           'captured_at', now(),
           'reason', new.reason,
           'reported_profile', jsonb_build_object(
             'display_name', p.display_name,
             'age',          p.age,
             'gender',       p.gender,
             'city',         p.city,
             'country',      p.country,
             'avatar_url',   p.avatar_url,
             'bio',          p.bio,
             'is_online',    p.is_online,
             'onboarding_completed', p.onboarding_completed
           )
         )
    into snapshot
  from public.profiles p
  where p.id = new.reported_user_id;

  new.evidence := coalesce(
    snapshot,
    jsonb_build_object('captured_at', now(), 'reason', new.reason, 'reported_profile', null)
  );

  return new;
end;
$$;

drop trigger if exists snapshot_report_evidence_trg on public.reports;
create trigger snapshot_report_evidence_trg
  before insert on public.reports
  for each row execute function public.snapshot_report_evidence();

-- ---------------------------------------------------------------------------
-- 3. admin_report_queue() — the moderator's worklist
-- ---------------------------------------------------------------------------
create or replace function public.admin_report_queue(
  p_status text    default 'pending',
  p_limit  integer default 50
)
returns table (
  report_id        uuid,
  report_status    text,
  reason           text,
  details          text,
  created_at       timestamptz,
  updated_at       timestamptz,
  reporter_id      uuid,
  reporter_name    text,
  reported_id      uuid,
  reported_name    text,
  reported_avatar  text,
  evidence         jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  if p_status is not null and p_status not in
     ('pending','reviewed','dismissed','actioned') then
    raise exception 'Invalid status filter: %', p_status using errcode = '22023';
  end if;

  return query
  select
    r.id,
    r.status,
    r.reason,
    r.details,
    r.created_at,
    r.updated_at,
    r.reporter_id,
    reporter.display_name,
    r.reported_user_id,
    reported.display_name,
    reported.avatar_url,
    r.evidence
  from public.reports r
  left join public.profiles reporter on reporter.id = r.reporter_id
  left join public.profiles reported on reported.id = r.reported_user_id
  where p_status is null or r.status = p_status
  order by r.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.admin_report_queue(text, integer) from public, anon;
grant execute on function public.admin_report_queue(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_resolve_report() — record the decision, not just the new status
-- ---------------------------------------------------------------------------
-- `admin_set_report_status` (M14) already exists and only sets the status. This
-- adds the reasoning and the actor, which is what makes a moderation decision
-- reviewable later.
create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status    text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  updated integer := 0;
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  if p_status not in ('pending','reviewed','dismissed','actioned') then
    raise exception 'Invalid status: %', p_status using errcode = '22023';
  end if;

  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Resolution note is too long' using errcode = '22023';
  end if;

  update public.reports
     set status          = p_status,
         resolution_note = p_note,
         resolved_by     = me,
         resolved_at     = case when p_status = 'pending' then null else now() end,
         updated_at      = now()
   where id = p_report_id;

  get diagnostics updated = row_count;

  if updated = 0 then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_report_id, details)
  values (
    me,
    'report.resolved',
    p_report_id,
    jsonb_build_object('status', p_status, 'note', p_note)
  );

  return jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'status', p_status,
    'notified_reporter', p_status = 'actioned'
  );
end;
$$;

revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;

comment on column public.reports.evidence is
  'Snapshot of the reported profile at report time (no birth_date). Captured by snapshot_report_evidence().';
comment on function public.admin_resolve_report(uuid, text, text) is
  'Moderator-only triage decision: sets status, note, actor and timestamp, and writes an audit entry.';

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
  and p.proname in ('snapshot_report_evidence', 'admin_report_queue', 'admin_resolve_report')
order by p.proname;
