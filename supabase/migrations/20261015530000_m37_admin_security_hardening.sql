-- =============================================================================
-- M37 · Administrative control center security hardening
-- =============================================================================
-- WHY
--   M32 built the admin console on SECURITY DEFINER RPCs, but three client
--   table privileges still let a staff member bypass those RPCs:
--     * `admin_settings` was directly SELECTable, so an admin bearer token could
--       read the Stripe webhook secret that also authenticates the payment-event
--       writer.
--     * `payment_events` was directly SELECTable by finance, including the raw
--       `payload` column that M32 explicitly intended to keep admin-only.
--     * `admin_audit_log` still carried M14's moderator SELECT policy, so a
--       moderator could read the whole audit trail directly even though
--       `audit.view` is admin-only.
--
--   The same pass closes two staff-safety holes:
--     * A moderator could suspend, warn, or moderation-action another staff
--       member (including a super admin) through the older moderation RPCs.
--     * Two concurrent `admin_set_role()` calls could each observe two admins
--       and both demote one, leaving zero super admins.
--
-- WHAT
--   * Revoke every client DML privilege from admin tables and re-grant only the
--     reads the product actually needs. `admin_settings` becomes RPC-only and
--     `payment_events.payload` is not granted to any client role.
--   * Make audit-log reads admin-only, and role reads self-or-admin.
--   * Add one internal staff predicate and use it in every account-enforcement
--     path. Automated moderation silently skips staff; a moderator gets an
--     explicit error; a super admin may still act.
--   * Serialise role changes with a transaction advisory lock before counting
--     the last super admin.
--   * Add indexes used by user-detail audit lookups and report-target counts.
--
-- NOT CHANGED
--   No payment provider is selected or changed here. The existing provider
--   column and webhook contract are untouched.
--
-- SAFE TO RE-RUN: `create or replace`, `drop policy if exists`, idempotent
-- index creation and repeatable grants/revokes.
-- DEPENDS ON: M13, M14, M21, M25, M32, M35.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Internal staff predicate
-- ---------------------------------------------------------------------------
-- Not executable by any client role. The SECURITY DEFINER functions below run
-- as the owner and can still call it.
create or replace function public.is_staff_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user_id is not null and exists (
    select 1
    from public.user_roles r
    where r.user_id = p_user_id
      and r.role <> 'user'
  );
$$;

revoke all on function public.is_staff_user(uuid) from public, anon, authenticated;

comment on function public.is_staff_user(uuid) is
  'Internal predicate: true when the target holds a staff role. Not executable by client roles.';

-- ---------------------------------------------------------------------------
-- 2. Admin table privileges — least privilege, no direct secret or payload read
-- ---------------------------------------------------------------------------
alter table public.user_roles            enable row level security;
alter table public.admin_audit_log       enable row level security;
alter table public.admin_settings        enable row level security;
alter table public.subscription_plans    enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.payment_events        enable row level security;
alter table public.notification_campaigns enable row level security;

-- Start from zero for both client roles. Supabase default privileges can grant
-- INSERT/UPDATE/DELETE (and, on some projects, TRUNCATE) to `authenticated`
-- even where RLS has no write policy; revoking makes the intent explicit.
revoke all on public.user_roles             from anon, authenticated;
revoke all on public.admin_audit_log        from anon, authenticated;
revoke all on public.admin_settings         from anon, authenticated;
revoke all on public.subscription_plans     from anon, authenticated;
revoke all on public.subscriptions          from anon, authenticated;
revoke all on public.payment_events         from anon, authenticated;
revoke all on public.notification_campaigns from anon, authenticated;

grant select on public.user_roles             to authenticated;
grant select on public.admin_audit_log        to authenticated;
-- Deliberately no SELECT on admin_settings. `admin_settings_get()` is the only
-- read path and it masks the webhook secret as `{ configured: boolean }`.
grant select on public.subscription_plans     to authenticated;
grant select on public.subscriptions          to authenticated;
grant select on public.notification_campaigns to authenticated;

-- Payment metadata is staff-readable only with `payments.view`, but `payload`
-- must never leave PostgreSQL through PostgREST. The admin payment RPC does not
-- select it; raw reconciliation stays in the SQL Editor.
grant select (
  id,
  provider,
  event_id,
  event_type,
  status,
  user_id,
  subscription_id,
  amount_minor,
  fee_minor,
  refunded_minor,
  currency,
  error,
  received_at,
  processed_at
) on public.payment_events to authenticated;

comment on table public.admin_settings is
  'RPC-only administrative settings. No client table grant: admin_settings_get() masks the webhook secret.';
comment on column public.payment_events.payload is
  'Minimal pseudonymous provider summary. Never granted to a client role; read through the SQL Editor only.';

-- ---------------------------------------------------------------------------
-- 3. RLS policy corrections
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_moderators_read" on public.admin_audit_log;
drop policy if exists "audit_log_admin_read" on public.admin_audit_log;
create policy "audit_log_admin_read"
  on public.admin_audit_log for select to authenticated
  using (public.has_permission('audit.view'));

drop policy if exists "user_roles_select_own_or_moderator" on public.user_roles;
drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id or public.has_permission('staff.manage'));

-- ---------------------------------------------------------------------------
-- 4. Indexes for the console's actual lookups
-- ---------------------------------------------------------------------------
create index if not exists admin_audit_log_target_user_idx
  on public.admin_audit_log (target_user_id)
  where target_user_id is not null;

create index if not exists admin_audit_log_target_report_idx
  on public.admin_audit_log (target_report_id)
  where target_report_id is not null;

create index if not exists reports_target_idx
  on public.reports (target_type, target_id)
  where target_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Role changes — serialise the last-super-admin check
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_role(
  p_user_id uuid,
  p_role    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me            uuid := auth.uid();
  previous_role text;
  admin_count   integer;
begin
  if not public.has_permission('staff.manage') then
    raise exception 'Staff management access required' using errcode = '42501';
  end if;
  if p_role not in ('user','moderator','support','finance','admin') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if p_user_id = me and p_role <> 'admin' then
    raise exception 'You cannot demote yourself' using errcode = '22023';
  end if;

  -- Two concurrent demotions of different admins must not both pass the
  -- "last admin" check. One key for all role changes is correct here.
  perform pg_advisory_xact_lock(hashtext('public.user_roles:admin')::bigint);

  select coalesce(r.role, 'user') into previous_role
  from public.user_roles r where r.user_id = p_user_id;
  previous_role := coalesce(previous_role, 'user');

  if previous_role = 'admin' and p_role <> 'admin' then
    select count(*)::int into admin_count from public.user_roles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'The last super admin cannot be demoted' using errcode = '22023';
    end if;
  end if;

  if p_role = 'user' then
    delete from public.user_roles where user_id = p_user_id;
  else
    insert into public.user_roles (user_id, role, granted_by)
    values (p_user_id, p_role, me)
    on conflict (user_id) do update
      set role = excluded.role,
          granted_at = now(),
          granted_by = excluded.granted_by;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'staff.role_changed', p_user_id,
          jsonb_build_object('from', previous_role, 'to', p_role));

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'role', p_role);
end;
$$;

revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Account management — no moderator may act on another staff account
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status  text,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if not public.has_permission('users.manage') then
    raise exception 'User management access required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'A target member is required' using errcode = '22023';
  end if;
  if p_user_id = me then
    raise exception 'You cannot change your own account status' using errcode = '22023';
  end if;
  if p_status not in ('active','suspended','banned') then
    raise exception 'Invalid account status' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'The reason is too long' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if public.is_staff_user(p_user_id) and not public.is_admin() then
    raise exception 'Only a super admin can change a staff account' using errcode = '42501';
  end if;

  perform set_config('mettivo.moderation_action', 'on', true);

  if p_status = 'active' then
    update public.profiles
       set is_suspended = false,
           suspended_at = null,
           suspension_reason = null,
           banned_until = null,
           ban_reason = null
     where id = p_user_id;
  elsif p_status = 'suspended' then
    update public.profiles
       set is_suspended = true,
           suspended_at = now(),
           suspension_reason = p_reason,
           banned_until = null,
           ban_reason = null
     where id = p_user_id;
  else
    update public.profiles
       set is_suspended = true,
           suspended_at = now(),
           suspension_reason = p_reason,
           banned_until = 'infinity'::timestamptz,
           ban_reason = p_reason
     where id = p_user_id;
  end if;

  perform set_config('mettivo.moderation_action', 'off', true);

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'user.status_changed', p_user_id,
          jsonb_build_object('status', p_status, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'status', p_status);
end;
$$;

revoke all on function public.admin_set_user_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_user_status(uuid, text, text) to authenticated;

create or replace function public.admin_warn_user(
  p_user_id uuid,
  p_reason  text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  warning uuid;
  message text;
begin
  if not public.has_permission('users.manage') then
    raise exception 'User management access required' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = me then
    raise exception 'Choose another member' using errcode = '22023';
  end if;
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A warning reason is required' using errcode = '22023';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'The warning is too long' using errcode = '22023';
  end if;
  if public.is_staff_user(p_user_id) and not public.is_admin() then
    raise exception 'Only a super admin can warn a staff account' using errcode = '42501';
  end if;

  message := 'Mettivo safety notice: ' || trim(p_reason);

  insert into public.notifications (user_id, actor_id, type, body)
  values (p_user_id, null, 'warning', message)
  returning id into warning;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'user.warned', p_user_id,
          jsonb_build_object('reason', trim(p_reason), 'notification_id', warning));

  return warning;
end;
$$;

revoke all on function public.admin_warn_user(uuid, text) from public, anon;
grant execute on function public.admin_warn_user(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Legacy moderation RPCs still used by /admin/moderation
-- ---------------------------------------------------------------------------
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

  if public.is_staff_user(p_target_user) and not public.is_admin() then
    raise exception 'Only a super admin can suspend a staff account' using errcode = '42501';
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

  if p_target_user is null then
    raise exception 'p_target_user is required' using errcode = '22023';
  end if;

  if public.is_staff_user(p_target_user) and not public.is_admin() then
    raise exception 'Only a super admin can restore a staff account' using errcode = '42501';
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

revoke all on function public.admin_suspend_user(uuid, text) from public, anon;
revoke all on function public.admin_unsuspend_user(uuid) from public, anon;
grant execute on function public.admin_suspend_user(uuid, text) to authenticated;
grant execute on function public.admin_unsuspend_user(uuid) to authenticated;

create or replace function public.admin_apply_moderation_action(
  p_target_user uuid,
  p_category    text,
  p_scope       text,
  p_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if p_target_user is null then
    raise exception 'A target member is required' using errcode = '22023';
  end if;
  if p_target_user = auth.uid() then
    raise exception 'You cannot restrict yourself' using errcode = '22023';
  end if;
  if public.is_staff_user(p_target_user) and not public.is_admin() then
    raise exception 'Only a super admin can restrict a staff account' using errcode = '42501';
  end if;
  return public.apply_moderation_action(
    p_target_user, p_category, p_scope, 'moderator', null, null, p_note, auth.uid());
end;
$$;

revoke all on function public.admin_apply_moderation_action(uuid, text, text, text) from public, anon;
grant execute on function public.admin_apply_moderation_action(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The single moderation writer — skip staff unless a super admin is acting
-- ---------------------------------------------------------------------------
-- This is the last line of defence for the report-action trigger, threshold
-- evaluation, and AI verdict paths. A non-admin caller gets no enforcement row,
-- no warning, no notification, and no profile suspension for a staff target.
create or replace function public.apply_moderation_action(
  p_user      uuid,
  p_category  text,
  p_scope     text,
  p_source    text,
  p_report_id uuid default null,
  p_scan_id   uuid default null,
  p_note      text default null,
  p_actor     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  days         integer;
  action_label text := 'account_suspended';
  message      text;
  subject      text;
  warning_id   uuid;
  email_addr   text;
  existing_id  uuid;
begin
  if p_user is null then
    raise exception 'A target member is required' using errcode = '22023';
  end if;
  if p_scope not in ('chat','video','account') then
    raise exception 'Invalid scope: %', p_scope using errcode = '22023';
  end if;
  if p_source not in ('auto_threshold','ai','moderator') then
    raise exception 'Invalid source: %', p_source using errcode = '22023';
  end if;

  if public.is_staff_user(p_user) and not public.is_admin() then
    return null;
  end if;

  -- One active pause at a time. A second action while one is running is a
  -- no-op that returns the existing warning, which is what makes running the
  -- threshold check on every report safe.
  select s.id into existing_id from public.suspensions s
   where s.user_id = p_user and s.active and s.ends_at > now()
   limit 1;

  if existing_id is not null then
    select w.id into warning_id
    from public.moderation_warnings w
    where w.user_id = p_user
    order by w.created_at desc limit 1;
    return warning_id;
  end if;

  days := public.moderation_suspension_days(p_category);

  insert into public.suspensions (user_id, category, reason, source, report_id, scan_id, ends_at, created_by)
  values (p_user, p_category, p_note, p_source, p_report_id, p_scan_id,
          now() + make_interval(days => days), p_actor);

  -- Mirror into the account flag the rest of the app already enforces. The
  -- transaction-local flag tells M14's guard this write is enforcement, not a
  -- member self-serving an edit to their own suspension columns.
  perform set_config('mettivo.moderation_action', 'on', true);
  update public.profiles
     set is_suspended = true,
         suspended_at = now(),
         suspension_reason = coalesce(p_note, public.moderation_category_phrase(p_category))
   where id = p_user;
  perform set_config('mettivo.moderation_action', 'off', true);

  message := format(
    'Your account has been paused for %s days after our safety review found %s. You can sign in and read, but you cannot post, send messages, or go live until the pause ends. If you believe this is a mistake, contact support.',
    days, public.moderation_category_phrase(p_category));
  subject := 'Mettivo: your account has been paused';

  insert into public.moderation_warnings (user_id, report_id, scan_id, category, scope, action, message, created_by)
  values (p_user, p_report_id, p_scan_id, p_category, p_scope, action_label, message, p_actor)
  returning id into warning_id;

  insert into public.notifications (user_id, actor_id, type, entity_id, body)
  values (p_user, null, 'warning', warning_id, message);

  select u.email into email_addr from auth.users u where u.id = p_user;
  insert into public.moderation_emails (user_id, recipient, subject, body, status)
  values (p_user, email_addr, subject, message, case when email_addr is null then 'skipped' else 'pending' end);

  if p_report_id is not null then
    update public.reports set action_taken = action_label, updated_at = now() where id = p_report_id;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, target_report_id, details)
  values (
    p_actor,
    'moderation.' || action_label,
    p_user,
    p_report_id,
    jsonb_build_object('category', p_category, 'scope', 'account', 'requested_scope', p_scope,
                       'source', p_source, 'days', days, 'scan_id', p_scan_id, 'warning_id', warning_id)
  );

  return warning_id;
end;
$$;

revoke all on function public.apply_moderation_action(uuid, text, text, text, uuid, uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.evaluate_report_thresholds(p_reported uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg          record;
  win          interval;
  c_text       integer;
  c_media      integer;
  c_live       integer;
  c_underage   integer;
  ai_minor     boolean;
  next_cat     text;
begin
  if p_reported is null then
    return jsonb_build_object('applied', false);
  end if;

  -- Staff accounts are protected from report-count enforcement. Only a super
  -- admin can act on them, through the explicit audited RPCs.
  if public.is_staff_user(p_reported) then
    return jsonb_build_object('applied', false, 'reason', 'protected_staff');
  end if;

  -- Already paused: nothing to stack.
  if exists (
    select 1 from public.suspensions s
    where s.user_id = p_reported and s.active and s.ends_at > now()
  ) then
    return jsonb_build_object('applied', false, 'reason', 'already_suspended');
  end if;

  select * into cfg from public.moderation_settings where id;
  win := make_interval(days => cfg.report_window_days);

  select count(distinct r.reporter_id), bool_or(r.ai_flagged) into c_underage, ai_minor
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'underage'
    and r.status in ('pending','reviewed','actioned')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_live
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'indecent_live'
    and r.status in ('pending','reviewed','actioned')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_media
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category in ('explicit_media','nudity')
    and r.status in ('pending','reviewed','actioned')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_text
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category in ('abuse_text','harassment','spam','other')
    and r.status in ('pending','reviewed','actioned')
    and r.created_at > now() - win;

  if c_underage >= cfg.underage_report_threshold
     and (not cfg.underage_requires_ai or coalesce(ai_minor, false)) then
    next_cat := 'underage';
  elsif c_live >= cfg.video_report_threshold then
    next_cat := 'indecent_live';
  elsif c_media >= cfg.video_report_threshold then
    next_cat := 'explicit_media';
  elsif c_text >= cfg.chat_report_threshold then
    next_cat := 'abuse_text';
  else
    return jsonb_build_object('applied', false);
  end if;

  perform public.apply_moderation_action(p_reported, next_cat, 'account', 'auto_threshold');

  return jsonb_build_object('applied', true, 'scope', 'account', 'category', next_cat);
end;
$$;

revoke all on function public.evaluate_report_thresholds(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Posture report
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_can_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
       on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'user_roles','admin_audit_log','admin_settings',
    'subscription_plans','subscriptions','payment_events',
    'notification_campaigns'
  )
group by c.relname, c.relrowsecurity, c.oid
order by c.relname;
