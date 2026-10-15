-- =============================================================================
-- M14 · Admin panel and abuse controls
-- =============================================================================
-- Adds: moderator roles, an append-only moderation audit log, account
-- suspension, and server-side rate limiting / spam controls.
--
-- DESIGN PRINCIPLE
--   Every control here is enforced in the database, not the UI. The browser
--   talks to PostgREST directly, so anything the client enforces can be bypassed
--   with curl. Triggers and SECURITY DEFINER functions apply to every write
--   path, including direct REST calls.
--
--   * Suspension and rate limiting are BEFORE INSERT triggers -> unbypassable.
--   * Moderation columns on `profiles` are guarded by a BEFORE UPDATE trigger,
--     because the existing `profiles_update_own` policy would otherwise let a
--     suspended user simply clear their own flag.
--   * Moderator-only actions are SECURITY DEFINER functions that verify the
--     caller's role themselves and append to the audit log.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Roles — kept in a SEPARATE table, never a column on `profiles`
-- ---------------------------------------------------------------------------
-- If the role lived on `profiles`, the `profiles_update_own` policy would let
-- any user promote themselves to moderator.
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user'
             constraint user_roles_role_check check (role in ('user','moderator','admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);

alter table public.user_roles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. is_moderator() — the single source of truth for moderation access
--    Defined BEFORE any policy references it. It reads `user_roles`, so the
--    table above must already exist; the policy that calls it comes next.
-- ---------------------------------------------------------------------------
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role in ('moderator','admin')
  );
$$;

revoke all on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- Only now can the helper be referenced from a policy.
drop policy if exists "user_roles_select_own_or_moderator" on public.user_roles;
create policy "user_roles_select_own_or_moderator"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id or public.is_moderator());

-- No INSERT/UPDATE/DELETE policy: roles are granted by an administrator running
-- SQL, or by a future SECURITY DEFINER promotion function. Clients cannot
-- escalate their own privileges.

-- ---------------------------------------------------------------------------
-- 3. Suspension columns on `profiles`
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_suspended       boolean not null default false;
alter table public.profiles add column if not exists suspended_at       timestamptz;
alter table public.profiles add column if not exists suspension_reason  text;

-- ---------------------------------------------------------------------------
-- 4. Audit log — append-only moderation trail
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor_id         uuid references auth.users(id) on delete set null,
  action           text not null,
  target_user_id   uuid,
  target_report_id uuid,
  details          jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx      on public.admin_audit_log (actor_id);

alter table public.admin_audit_log enable row level security;

drop policy if exists "audit_log_moderators_read" on public.admin_audit_log;
create policy "audit_log_moderators_read"
  on public.admin_audit_log for select to authenticated
  using (public.is_moderator());

-- Writes happen only inside SECURITY DEFINER functions, so no INSERT policy.

-- ---------------------------------------------------------------------------
-- 5. Rate-limit counters — O(1) fixed-window counters, no unbounded log
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_counters (
  user_id      uuid not null references auth.users(id) on delete cascade,
  action       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (user_id, action, window_start)
);

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

-- RLS enabled with NO policies = clients cannot read or write this table at
-- all. Only the SECURITY DEFINER trigger below touches it.
alter table public.rate_limit_counters enable row level security;

-- ---------------------------------------------------------------------------
-- 6. Rate limits per action
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limit_rules (
  action          text primary key,
  max_events      integer not null check (max_events > 0),
  window_seconds  integer not null check (window_seconds > 0),
  description     text
);

insert into public.rate_limit_rules (action, max_events, window_seconds, description) values
  ('messages', 30,   60,   'Messages per minute'),
  ('likes',    200,  3600, 'Like/pass decisions per hour'),
  ('reports',  10,   86400,'Reports per day')
on conflict (action) do update
  set max_events     = excluded.max_events,
      window_seconds = excluded.window_seconds,
      description    = excluded.description;

alter table public.rate_limit_rules enable row level security;

drop policy if exists "rate_limit_rules_readable" on public.rate_limit_rules;
create policy "rate_limit_rules_readable"
  on public.rate_limit_rules for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 7. enforce_abuse_controls() — suspension + rate limiting on every insert
-- ---------------------------------------------------------------------------
create or replace function public.enforce_abuse_controls()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor        uuid := auth.uid();
  rule         record;
  bucket       timestamptz;
  new_count    integer;
begin
  -- No session (backend / service_role migration work): nothing to enforce.
  if actor is null then
    return new;
  end if;

  -- (a) Suspended accounts may not write anything.
  if exists (
    select 1 from public.profiles p
    where p.id = actor and p.is_suspended
  ) then
    raise exception 'Your account is suspended and cannot post.'
      using errcode = '42501';
  end if;

  -- (b) Rate limiting, only for actions that have a configured rule.
  select * into rule from public.rate_limit_rules r where r.action = tg_table_name;

  if found then
    -- Fixed window aligned to the clock so concurrent inserts share a bucket.
    bucket := to_timestamp(
      floor(extract(epoch from now()) / rule.window_seconds) * rule.window_seconds
    );

    insert into public.rate_limit_counters (user_id, action, window_start, count)
    values (actor, tg_table_name, bucket, 1)
    on conflict (user_id, action, window_start)
      do update set count = public.rate_limit_counters.count + 1
    returning count into new_count;

    if new_count > rule.max_events then
      raise exception 'Rate limit exceeded for %. Try again shortly.', tg_table_name
        using errcode = '53400';
    end if;
  end if;

  return new;
end;
$$;

-- Attach to the write paths. `drop trigger if exists` first for re-runnability.
drop trigger if exists enforce_abuse_controls_messages on public.messages;
create trigger enforce_abuse_controls_messages
  before insert on public.messages
  for each row execute function public.enforce_abuse_controls();

drop trigger if exists enforce_abuse_controls_likes on public.likes;
create trigger enforce_abuse_controls_likes
  before insert on public.likes
  for each row execute function public.enforce_abuse_controls();

drop trigger if exists enforce_abuse_controls_reports on public.reports;
create trigger enforce_abuse_controls_reports
  before insert on public.reports
  for each row execute function public.enforce_abuse_controls();

-- ---------------------------------------------------------------------------
-- 8. Privilege guard — users must not be able to change moderation columns
-- ---------------------------------------------------------------------------
-- Without this, `profiles_update_own` lets a suspended user clear is_suspended.
-- ---------------------------------------------------------------------------
create or replace function public.protect_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Moderators and backend/service_role writes are allowed through.
  if public.is_moderator() or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_suspended, false)
       or new.suspended_at is not null
       or new.suspension_reason is not null then
      raise exception 'Not allowed to set moderation fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_suspended       is distinct from old.is_suspended
     or new.suspended_at       is distinct from old.suspended_at
     or new.suspension_reason  is distinct from old.suspension_reason then
    raise exception 'Not allowed to change moderation fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_moderation_columns_ins on public.profiles;
create trigger protect_moderation_columns_ins
  before insert on public.profiles
  for each row execute function public.protect_moderation_columns();

drop trigger if exists protect_moderation_columns_upd on public.profiles;
create trigger protect_moderation_columns_upd
  before update on public.profiles
  for each row execute function public.protect_moderation_columns();

-- ---------------------------------------------------------------------------
-- 9. Moderator-only RPCs (each verifies the role and writes an audit entry)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_report_status(
  p_report_id uuid,
  p_status    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated integer;
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  if p_status not in ('pending','reviewed','dismissed','actioned') then
    raise exception 'Invalid status: %', p_status using errcode = '22023';
  end if;

  update public.reports
     set status = p_status, updated_at = now()
   where id = p_report_id;

  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_report_id, details)
  values (auth.uid(), 'report.status_changed', p_report_id,
          jsonb_build_object('status', p_status));

  return jsonb_build_object('ok', true, 'report_id', p_report_id, 'status', p_status);
end;
$$;

create or replace function public.admin_suspend_user(
  p_target_user uuid,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  if p_target_user is null then
    raise exception 'p_target_user is required' using errcode = '22023';
  end if;

  if p_target_user = auth.uid() then
    raise exception 'You cannot suspend yourself' using errcode = '22023';
  end if;

  -- A moderator must not be able to suspend an administrator.
  if exists (
    select 1 from public.user_roles r
    where r.user_id = p_target_user and r.role = 'admin'
  ) and not exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.role = 'admin'
  ) then
    raise exception 'Only an admin can suspend an admin' using errcode = '42501';
  end if;

  update public.profiles
     set is_suspended      = true,
         suspended_at      = now(),
         suspension_reason = p_reason
   where id = p_target_user;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (auth.uid(), 'user.suspended', p_target_user,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'user_id', p_target_user, 'suspended', true);
end;
$$;

create or replace function public.admin_unsuspend_user(p_target_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  update public.profiles
     set is_suspended      = false,
         suspended_at      = null,
         suspension_reason = null
   where id = p_target_user;

  insert into public.admin_audit_log (actor_id, action, target_user_id)
  values (auth.uid(), 'user.unsuspended', p_target_user);

  return jsonb_build_object('ok', true, 'user_id', p_target_user, 'suspended', false);
end;
$$;

revoke all on function public.admin_set_report_status(uuid, text) from public, anon;
revoke all on function public.admin_suspend_user(uuid, text)      from public, anon;
revoke all on function public.admin_unsuspend_user(uuid)          from public, anon;

grant execute on function public.admin_set_report_status(uuid, text) to authenticated;
grant execute on function public.admin_suspend_user(uuid, text)      to authenticated;
grant execute on function public.admin_unsuspend_user(uuid)          to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Moderators may read every report (additive to the existing owner policy)
-- ---------------------------------------------------------------------------
drop policy if exists "reports_moderators_read_all" on public.reports;
create policy "reports_moderators_read_all"
  on public.reports for select to authenticated
  using (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 11. Table privileges
-- ---------------------------------------------------------------------------
grant select on public.user_roles          to authenticated;
grant select on public.admin_audit_log     to authenticated;
grant select on public.rate_limit_rules    to authenticated;

revoke all on public.rate_limit_counters from anon, authenticated;

comment on table public.user_roles is
  'Moderator/admin roles. Separate from profiles so users cannot self-promote.';
comment on table public.admin_audit_log is
  'Append-only moderation audit trail. Written only by SECURITY DEFINER functions.';
comment on function public.enforce_abuse_controls() is
  'BEFORE INSERT guard: blocks suspended accounts and applies per-action rate limits.';

-- ---------------------------------------------------------------------------
-- Report the resulting posture.
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('user_roles','admin_audit_log','rate_limit_counters','rate_limit_rules')
group by c.relname, c.relrowsecurity
order by c.relname;
