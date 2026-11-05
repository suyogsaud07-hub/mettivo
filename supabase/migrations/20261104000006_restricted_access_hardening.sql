-- =============================================================================
-- M46 · Restricted-access hardening
-- =============================================================================
-- Replaces the unsafe parts of MXX (20261104000000) with one confirmed-only,
-- account-wide, read-only restriction system.
--
-- Rules enforced here:
--   * Only a moderator-confirmed violation can create a restriction.
--   * A restriction is exactly 2, 6, 12 or 24 hours. There is no clamping to an
--     arbitrary value and no caller-supplied duration outside that set.
--   * AI scans and report counts are evidence, never punishment.
--   * A restricted member can still sign in, read, browse and play games, but
--     cannot create or mutate social content.
--   * Expiry is derived from timestamps, so a restriction ends even if no cron
--     job cleans the profile flag.
--
-- SAFE TO RE-RUN: idempotent.
-- DEPENDS ON: M21, M25, M29, M32, M37, MXX.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Authoritative columns and constraints
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists restricted_until timestamptz;

alter table public.suspensions
  add column if not exists updated_at timestamptz not null default now();

-- Historical rows created by MXX may not use the final hour set. The constraint
-- is NOT VALID so the migration is safe on an existing database, while every new
-- row is still checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'confirmed_violations_hours_check'
      and conrelid = 'public.confirmed_violations'::regclass
  ) then
    alter table public.confirmed_violations
      add constraint confirmed_violations_hours_check
      check (restriction_hours is null or restriction_hours in (2, 6, 12, 24))
      not valid;
  end if;
end $$;

create index if not exists confirmed_violations_active_idx
  on public.confirmed_violations (user_id, restriction_ends_at);
create index if not exists confirmed_violations_scan_idx
  on public.confirmed_violations (scan_id);
create index if not exists confirmed_violations_confirmer_idx
  on public.confirmed_violations (confirmed_by);

-- M45 introduced this FK without its supporting index; keep the M4 integrity
-- invariant true for the full schema.
create index if not exists pinned_messages_message_idx
  on public.pinned_messages (message_id);

create index if not exists profiles_restricted_until_idx
  on public.profiles (restricted_until);

-- Only the SECURITY DEFINER enforcement functions may write this ledger. The
-- old MXX INSERT/UPDATE policies let any authenticated caller forge a
-- "confirmed" violation, which defeats the whole human-confirmation rule.
drop policy if exists "confirmed_violations_insert_moderator_only" on public.confirmed_violations;
drop policy if exists "confirmed_violations_update_moderator_only" on public.confirmed_violations;
drop policy if exists "confirmed_violations_delete_moderator_only" on public.confirmed_violations;
revoke all on public.confirmed_violations from anon, authenticated;
grant select on public.confirmed_violations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The single source of truth for "is this member read-only?"
-- ---------------------------------------------------------------------------
create or replace function public.is_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and (
    exists (
      select 1 from public.profiles p
      where p.id = p_user
        and (
          (p.restricted_until is not null and p.restricted_until > now())
          or (p.banned_until is not null and p.banned_until > now())
          -- Legacy indefinite suspension: the old admin RPC only set the flag
          -- and never wrote a suspension row. Once a row exists, timestamps win.
          or (
            coalesce(p.is_suspended, false)
            and not exists (
              select 1 from public.suspensions s where s.user_id = p.id
            )
            and not exists (
              select 1 from public.confirmed_violations cv where cv.user_id = p.id
            )
          )
        )
    )
    or exists (
      select 1 from public.suspensions s
      where s.user_id = p_user and s.active and s.ends_at > now()
    )
    or exists (
      select 1 from public.confirmed_violations cv
      where cv.user_id = p_user and cv.restriction_ends_at > now()
    )
  );
$$;

revoke all on function public.is_restricted(uuid) from public, anon;
grant execute on function public.is_restricted(uuid) to authenticated;

create or replace function public.is_chat_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_restricted(p_user);
$$;

create or replace function public.is_video_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_restricted(p_user);
$$;

revoke all on function public.is_chat_restricted(uuid) from public, anon;
revoke all on function public.is_video_restricted(uuid) from public, anon;
grant execute on function public.is_chat_restricted(uuid) to authenticated;
grant execute on function public.is_video_restricted(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Duration policy: 2, 6, 12, 24 hours only
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_restriction_hours(p_hours integer)
returns boolean
language sql
immutable
as $$
  select p_hours in (2, 6, 12, 24);
$$;

revoke all on function public.is_valid_restriction_hours(integer) from public, anon, authenticated;

create or replace function public.calculate_restriction_hours(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  select coalesce(p.confirmed_violation_count, 0)
    into v_count
  from public.profiles p
  where p.id = p_user_id;

  -- 1st = 2h, 2nd = 6h, 3rd = 12h, 4th and later = 24h.
  return case
    when coalesce(v_count, 0) <= 0 then 2
    when v_count = 1 then 6
    when v_count = 2 then 12
    else 24
  end;
end;
$$;

revoke all on function public.calculate_restriction_hours(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal writer — confirmed violations only
-- ---------------------------------------------------------------------------
create or replace function public.apply_temporary_restriction(
  p_user_id uuid,
  p_category text,
  p_reason text default null,
  p_source text default 'moderator',
  p_report_id uuid default null,
  p_scan_id uuid default null,
  p_confirmed_by uuid default null,
  p_hours integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hours integer;
  v_violation_id uuid;
  v_existing_id uuid;
  v_actor uuid := coalesce(p_confirmed_by, auth.uid());
  v_starts_at timestamptz := now();
  v_active_until timestamptz;
  v_ends_at timestamptz;
  v_new_count integer;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Community guidelines violation');
  v_until_text text;
begin
  if p_user_id is null then
    raise exception 'A target member is required' using errcode = '22023';
  end if;
  if p_category is null then
    raise exception 'A violation category is required' using errcode = '22023';
  end if;
  if p_source <> 'moderator' then
    raise exception 'A restriction requires a confirmed moderator decision' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'A confirming moderator is required' using errcode = '42501';
  end if;
  if not public.is_moderator() and auth.uid() is not null then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if p_hours is not null and not public.is_valid_restriction_hours(p_hours) then
    raise exception 'Invalid restriction duration. Choose 2, 6, 12 or 24 hours.'
      using errcode = '22023';
  end if;

  -- A report may only ever produce one confirmed violation. This makes a
  -- double-clicked moderator action idempotent.
  if p_report_id is not null then
    select cv.id into v_existing_id
    from public.confirmed_violations cv
    where cv.report_id = p_report_id
    order by cv.confirmed_at asc
    limit 1;

    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  v_hours := coalesce(p_hours, public.calculate_restriction_hours(p_user_id));

  -- Never shorten a restriction that is already running. This also makes a
  -- shorter moderator choice safe while a longer one is still active.
  select max(s.ends_at) into v_active_until
  from public.suspensions s
  where s.user_id = p_user_id and s.active and s.ends_at > now();

  v_ends_at := greatest(v_starts_at + make_interval(hours => v_hours),
                       coalesce(v_active_until, v_starts_at));
  v_until_text := to_char(v_ends_at, 'YYYY-MM-DD HH24:MI TZ');

  update public.profiles
     set confirmed_violation_count = coalesce(confirmed_violation_count, 0) + 1,
         last_violation_at = now()
   where id = p_user_id
   returning confirmed_violation_count into v_new_count;

  insert into public.confirmed_violations (
    user_id, report_id, scan_id, category, reason, source, confirmed_by,
    restriction_starts_at, restriction_ends_at, restriction_hours, details
  ) values (
    p_user_id, p_report_id, p_scan_id, p_category, v_reason, 'moderator', v_actor,
    v_starts_at, v_ends_at, v_hours,
    jsonb_build_object('previous_count', greatest(coalesce(v_new_count, 1) - 1, 0))
  ) returning id into v_violation_id;

  insert into public.suspensions (
    user_id, category, reason, source, report_id, scan_id,
    starts_at, ends_at, active, created_by, updated_at
  ) values (
    p_user_id, p_category, v_reason, 'moderator', p_report_id, p_scan_id,
    v_starts_at, v_ends_at, true, v_actor, now()
  );

  perform set_config('mettivo.moderation_action', 'on', true);
  update public.profiles
     set is_suspended = true,
         suspended_at = v_starts_at,
         suspension_reason = v_reason,
         restricted_until = v_ends_at
   where id = p_user_id;
  perform set_config('mettivo.moderation_action', 'off', true);

  insert into public.moderation_warnings (
    user_id, report_id, scan_id, category, scope, action, message, created_by
  ) values (
    p_user_id, p_report_id, p_scan_id, p_category, 'account', 'account_restricted',
    format('Your account is read-only until %s after a confirmed community guidelines violation.', v_until_text),
    v_actor
  );

  insert into public.notifications (user_id, actor_id, type, entity_id, body)
  values (
    p_user_id, null, 'warning', v_violation_id,
    format('Account temporarily restricted for %s hours. You can browse and play games, but cannot post or interact until %s.',
           v_hours, v_until_text)
  );

  insert into public.moderation_emails (user_id, recipient, subject, body, status)
  select p_user_id, u.email,
         'Mettivo: your account is temporarily read-only',
         format('A moderator confirmed a community guidelines violation. Your account is read-only for %s hours, until %s. You can still sign in, browse profiles and play games.', v_hours, v_until_text),
         case when u.email is null then 'skipped' else 'pending' end
  from auth.users u
  where u.id = p_user_id;

  if p_report_id is not null then
    update public.reports
       set action_taken = 'account_restricted', updated_at = now()
     where id = p_report_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, target_user_id, target_report_id, details
  ) values (
    v_actor,
    'moderation.confirmed_violation',
    p_user_id,
    p_report_id,
    jsonb_build_object(
      'category', p_category,
      'hours', v_hours,
      'restriction_ends_at', v_ends_at,
      'violation_count', v_new_count,
      'violation_id', v_violation_id,
      'report_id', p_report_id,
      'scan_id', p_scan_id
    )
  );

  return v_violation_id;
end;
$$;

-- Internal only. No authenticated caller may create a restriction directly.
revoke all on function public.apply_temporary_restriction(uuid, text, text, text, uuid, uuid, uuid, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read-only state for the UI
-- ---------------------------------------------------------------------------
create or replace function public.my_restrictions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_restricted boolean;
  v_until timestamptz;
  v_starts timestamptz;
  v_hours integer;
  v_reason text;
  v_category text;
  v_count integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  v_restricted := public.is_restricted(me);

  select max(s.ends_at), max(s.starts_at) filter (where s.ends_at = (
           select max(s2.ends_at) from public.suspensions s2
           where s2.user_id = me and s2.active and s2.ends_at > now()
         ))
    into v_until, v_starts
  from public.suspensions s
  where s.user_id = me and s.active and s.ends_at > now();

  select cv.restriction_hours, cv.reason, cv.category
    into v_hours, v_reason, v_category
  from public.confirmed_violations cv
  where cv.user_id = me and cv.restriction_ends_at > now()
  order by cv.confirmed_at desc
  limit 1;

  select coalesce(p.confirmed_violation_count, 0)
    into v_count
  from public.profiles p
  where p.id = me;

  if v_reason is null then
    select s.reason into v_reason
    from public.suspensions s
    where s.user_id = me and s.active and s.ends_at > now()
    order by s.ends_at desc limit 1;
  end if;

  -- A legacy Subbu ban or pre-M46 writer may only have set the profile columns.
  -- Surface that timestamp too, so the client clock and the database agree.
  if v_until is null then
    select coalesce(p.restricted_until, p.banned_until),
           coalesce(v_reason, p.suspension_reason, p.ban_reason)
      into v_until, v_reason
    from public.profiles p
    where p.id = me
      and (p.restricted_until > now() or p.banned_until > now());
  end if;

  return jsonb_build_object(
    'chat_banned', v_restricted,
    'chat_until', v_until,
    'video_banned', v_restricted,
    'video_until', v_until,
    'suspended', v_restricted,
    'suspended_until', v_until,
    'suspended_reason', v_reason,
    'is_read_only', v_restricted,
    'restricted_until', v_until,
    'restriction_starts_at', v_starts,
    'restriction_hours', v_hours,
    'restriction_category', v_category,
    'confirmed_violation_count', coalesce(v_count, 0)
  );
end;
$$;

revoke all on function public.my_restrictions() from public, anon;
grant execute on function public.my_restrictions() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The legacy ban endpoint reflects the same clock
-- ---------------------------------------------------------------------------
create or replace function public.my_ban_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_until timestamptz;
  v_reason text;
  v_banned boolean;
begin
  if me is null then
    return jsonb_build_object('banned', false, 'banned_until', null, 'ban_reason', null);
  end if;

  v_banned := public.is_restricted(me);

  select max(s.ends_at), (array_agg(s.reason order by s.ends_at desc))[1]
    into v_until, v_reason
  from public.suspensions s
  where s.user_id = me and s.active and s.ends_at > now();

  if v_until is null then
    select max(cv.restriction_ends_at), (array_agg(cv.reason order by cv.confirmed_at desc))[1]
      into v_until, v_reason
    from public.confirmed_violations cv
    where cv.user_id = me and cv.restriction_ends_at > now();
  end if;

  if v_until is null then
    select coalesce(p.restricted_until, p.banned_until),
           coalesce(v_reason, p.suspension_reason, p.ban_reason)
      into v_until, v_reason
    from public.profiles p
    where p.id = me
      and (p.restricted_until > now() or p.banned_until > now());
  end if;

  if v_reason is null then
    select coalesce(p.suspension_reason, p.ban_reason) into v_reason
    from public.profiles p where p.id = me;
  end if;

  return jsonb_build_object(
    'banned', v_banned,
    'banned_until', v_until,
    'ban_reason', v_reason
  );
end;
$$;

revoke all on function public.my_ban_status() from public, anon;
grant execute on function public.my_ban_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. AI and report counts are evidence only
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_report_thresholds(p_reported uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cfg record;
  win interval;
  c_text integer := 0;
  c_media integer := 0;
  c_live integer := 0;
  c_underage integer := 0;
  ai_minor boolean := false;
  suggested text;
begin
  if p_reported is null then
    return jsonb_build_object('applied', false, 'requires_human_review', false);
  end if;

  if public.is_staff_user(p_reported) then
    return jsonb_build_object(
      'applied', false,
      'requires_human_review', false,
      'reason', 'protected_staff'
    );
  end if;

  select * into cfg from public.moderation_settings where id;
  win := make_interval(days => cfg.report_window_days);

  select count(distinct r.reporter_id), bool_or(r.ai_flagged)
    into c_underage, ai_minor
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'underage'
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_live
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'indecent_live'
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_media
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category in ('explicit_media','nudity')
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into c_text
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category in ('abuse_text','harassment','spam','other')
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  if c_underage >= cfg.underage_report_threshold
     and (not cfg.underage_requires_ai or coalesce(ai_minor, false)) then
    suggested := 'underage';
  elsif c_live >= cfg.video_report_threshold then
    suggested := 'indecent_live';
  elsif c_media >= cfg.video_report_threshold then
    suggested := 'explicit_media';
  elsif c_text >= cfg.chat_report_threshold then
    suggested := 'abuse_text';
  end if;

  -- Deliberately no call to apply_temporary_restriction(). The return value is
  -- the moderator queue's signal that a human should look at this member.
  return jsonb_build_object(
    'applied', false,
    'requires_human_review', suggested is not null,
    'suggested_category', suggested,
    'counts', jsonb_build_object(
      'text', c_text,
      'media', c_media,
      'live', c_live,
      'underage', c_underage
    )
  );
end;
$$;

revoke all on function public.evaluate_report_thresholds(uuid) from public, anon, authenticated;

create or replace function public.record_ai_scan(
  p_secret text,
  p_scan_id uuid,
  p_flagged boolean,
  p_score numeric default null,
  p_categories jsonb default null,
  p_provider text default null,
  p_model text default null,
  p_suggested_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scan record;
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  select * into scan from public.moderation_ai_scans where id = p_scan_id;
  if not found then
    raise exception 'Scan not found' using errcode = 'P0002';
  end if;

  update public.moderation_ai_scans
     set status = 'done',
         flagged = coalesce(p_flagged, false),
         score = p_score,
         categories = p_categories,
         provider = p_provider,
         model = p_model,
         suggested_action = p_suggested_action,
         processed_at = now()
   where id = p_scan_id;

  if coalesce(p_flagged, false) and scan.report_id is not null then
    update public.reports
       set ai_flagged = true,
           ai_score = p_score,
           updated_at = now()
     where id = scan.report_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'flagged', coalesce(p_flagged, false),
    'action', 'pending_human_review',
    'requires_human_review', coalesce(p_flagged, false)
  );
end;
$$;

revoke all on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text)
  from public, anon;
grant execute on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Remove the old automatic "report actioned -> punish" path
-- ---------------------------------------------------------------------------
drop trigger if exists action_report_on_actioned on public.reports;

create or replace function public.apply_moderation_action(
  p_user uuid,
  p_category text,
  p_scope text,
  p_source text,
  p_report_id uuid default null,
  p_scan_id uuid default null,
  p_note text default null,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Compatibility shim for older callers. Only a moderator decision may write.
  if p_source <> 'moderator' then
    return null;
  end if;
  if not public.is_moderator() and auth.uid() is not null then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;

  return public.apply_temporary_restriction(
    p_user,
    p_category,
    p_note,
    'moderator',
    p_report_id,
    p_scan_id,
    coalesce(p_actor, auth.uid()),
    null
  );
end;
$$;

revoke all on function public.apply_moderation_action(uuid, text, text, text, uuid, uuid, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Moderator RPCs — one unambiguous signature each
-- ---------------------------------------------------------------------------
drop function if exists public.admin_suspend_user(uuid, text);
drop function if exists public.admin_suspend_user(uuid, text, integer);

create or replace function public.admin_suspend_user(
  p_target_user uuid,
  p_reason text default null,
  p_hours integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_violation_id uuid;
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

  v_violation_id := public.apply_temporary_restriction(
    p_target_user,
    'other',
    p_reason,
    'moderator',
    null,
    null,
    auth.uid(),
    p_hours
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', p_target_user,
    'suspended', true,
    'restricted_until', (
      select cv.restriction_ends_at
      from public.confirmed_violations cv
      where cv.id = v_violation_id
    ),
    'violation_id', v_violation_id
  );
end;
$$;

revoke all on function public.admin_suspend_user(uuid, text, integer) from public, anon;
grant execute on function public.admin_suspend_user(uuid, text, integer) to authenticated;

drop function if exists public.admin_apply_moderation_action(uuid, text, text, text);
drop function if exists public.admin_apply_moderation_action(uuid, text, text, text, integer);

create or replace function public.admin_apply_moderation_action(
  p_target_user uuid,
  p_category text,
  p_scope text default 'account',
  p_note text default null,
  p_hours integer default null
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
  if p_scope is not null and p_scope not in ('account', 'chat', 'video') then
    raise exception 'Invalid scope: %', p_scope using errcode = '22023';
  end if;

  return public.apply_temporary_restriction(
    p_target_user,
    p_category,
    p_note,
    'moderator',
    null,
    null,
    auth.uid(),
    p_hours
  );
end;
$$;

revoke all on function public.admin_apply_moderation_action(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.admin_apply_moderation_action(uuid, text, text, text, integer)
  to authenticated;

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

  update public.suspensions
     set active = false,
         updated_at = now()
   where user_id = p_target_user
     and active;

  update public.confirmed_violations
     set restriction_ends_at = now()
   where user_id = p_target_user
     and restriction_ends_at > now();

  perform set_config('mettivo.moderation_action', 'on', true);
  update public.profiles
     set is_suspended = false,
         suspended_at = null,
         suspension_reason = null,
         restricted_until = null,
         banned_until = null,
         ban_reason = null
   where id = p_target_user;
  perform set_config('mettivo.moderation_action', 'off', true);

  insert into public.admin_audit_log (actor_id, action, target_user_id)
  values (auth.uid(), 'user.unsuspended', p_target_user);

  return jsonb_build_object('ok', true, 'user_id', p_target_user, 'suspended', false);
end;
$$;

revoke all on function public.admin_unsuspend_user(uuid) from public, anon;
grant execute on function public.admin_unsuspend_user(uuid) to authenticated;

-- The old 3-argument resolve signature is dropped so a 3-argument call resolves
-- to the 4-argument function and its default duration instead of becoming
-- ambiguous.
drop function if exists public.admin_resolve_report(uuid, text, text);

create or replace function public.admin_resolve_report(
  p_report_id uuid,
  p_status text,
  p_note text default null,
  p_duration_hours integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_report record;
  v_violation_id uuid;
  v_until timestamptz;
  v_hours integer;
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

  if p_duration_hours is not null and not public.is_valid_restriction_hours(p_duration_hours) then
    raise exception 'Invalid restriction duration. Choose 2, 6, 12 or 24 hours.'
      using errcode = '22023';
  end if;

  select r.id, r.reported_user_id, r.category
    into v_report
  from public.reports r
  where r.id = p_report_id;

  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  update public.reports
     set status = p_status,
         resolution_note = p_note,
         resolved_by = me,
         resolved_at = case when p_status = 'pending' then null else now() end,
         updated_at = now()
   where id = p_report_id;

  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;

  if p_status = 'actioned' then
    if public.is_staff_user(v_report.reported_user_id) and not public.is_admin() then
      raise exception 'Only a super admin can restrict a staff account' using errcode = '42501';
    end if;

    v_violation_id := public.apply_temporary_restriction(
      v_report.reported_user_id,
      v_report.category,
      p_note,
      'moderator',
      p_report_id,
      null,
      me,
      p_duration_hours
    );

    select cv.restriction_ends_at, cv.restriction_hours
      into v_until, v_hours
    from public.confirmed_violations cv
    where cv.id = v_violation_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, target_report_id, target_user_id, details
  ) values (
    me,
    'report.resolved',
    p_report_id,
    v_report.reported_user_id,
    jsonb_build_object(
      'status', p_status,
      'note', p_note,
      'duration_hours', p_duration_hours,
      'violation_id', v_violation_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'report_id', p_report_id,
    'status', p_status,
    'violation_id', v_violation_id,
    'restriction_hours', v_hours,
    'restricted_until', v_until,
    'notified_reporter', p_status = 'actioned'
  );
end;
$$;

revoke all on function public.admin_resolve_report(uuid, text, text, integer) from public, anon;
grant execute on function public.admin_resolve_report(uuid, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Subbu may not punish. Keep the RPC as a safe compatibility no-op.
-- ---------------------------------------------------------------------------
drop function if exists public.apply_self_ban(integer, text);

create or replace function public.apply_self_ban(
  p_duration_hours integer,
  p_reason text default null
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

  -- Deliberately no write. Automated or self-issued punishment is not a
  -- confirmed violation; a moderator must review evidence first.
  return jsonb_build_object(
    'ok', false,
    'disabled', true,
    'requested_hours', p_duration_hours,
    'reason', p_reason,
    'message', 'Self-issued restrictions are disabled. Reports are reviewed by a moderator.'
  );
end;
$$;

revoke all on function public.apply_self_ban(integer, text) from public, anon;
grant execute on function public.apply_self_ban(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Profile columns are not self-service
-- ---------------------------------------------------------------------------
create or replace function public.protect_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_moderator() or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_suspended, false)
       or new.suspended_at is not null
       or new.suspension_reason is not null
       or new.restricted_until is not null
       or new.confirmed_violation_count <> 0
       or new.last_violation_at is not null
       or new.banned_until is not null then
      raise exception 'Not allowed to set moderation fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_suspended is distinct from old.is_suspended
     or new.suspended_at is distinct from old.suspended_at
     or new.suspension_reason is distinct from old.suspension_reason
     or new.restricted_until is distinct from old.restricted_until
     or new.confirmed_violation_count is distinct from old.confirmed_violation_count
     or new.last_violation_at is distinct from old.last_violation_at
     or new.banned_until is distinct from old.banned_until
     or new.ban_reason is distinct from old.ban_reason then
    raise exception 'Not allowed to change moderation fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Universal social-write guards
-- ---------------------------------------------------------------------------
create or replace function public.enforce_abuse_controls()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  rule record;
  bucket timestamptz;
  new_count integer;
begin
  if actor is null then
    return new;
  end if;

  -- Restricted members may still file a safety report and record a game
  -- result. They may not create any other social content or mutate their
  -- profile.
  if tg_table_name not in ('reports', 'game_results') and public.is_restricted(actor) then
    raise exception 'Your account is read-only until your restriction ends.'
      using errcode = '42501';
  end if;

  select * into rule from public.rate_limit_rules r where r.action = tg_table_name;
  if found then
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

create or replace function public.enforce_restricted_follows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  actor := case when tg_op = 'DELETE' then old.follower_id else new.follower_id end;
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot follow or unfollow members.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_likes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  actor := case when tg_op = 'DELETE' then old.liker_id else new.liker_id end;
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot like or pass on members.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_moment_likes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot like Moments.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_moment_comments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  actor := case when tg_op = 'DELETE' then old.author_id else new.author_id end;
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot comment on Moments.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_moments()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and public.is_restricted(auth.uid()) then
    if tg_op = 'DELETE' then
      if old.author_id = auth.uid() then
        raise exception 'Your account is read-only and cannot change Moments.'
          using errcode = '42501';
      end if;
    elsif new.author_id = auth.uid() then
      raise exception 'Your account is read-only and cannot post or change Moments.'
        using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_messages()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := case when tg_op = 'DELETE' then old.sender_id else old.sender_id end;
begin
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot change messages.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.enforce_restricted_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and old.id = auth.uid()
     and new.id = auth.uid()
     and public.is_restricted(auth.uid()) then
    raise exception 'Your account is read-only and cannot update your profile yet.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_restricted_message_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  actor := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if actor is not null and actor = auth.uid() and public.is_restricted(actor) then
    raise exception 'Your account is read-only and cannot change message interactions.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Follows: follow, unfollow and any moderation-preserving edit.
drop trigger if exists enforce_restricted_follows_ins on public.follows;
create trigger enforce_restricted_follows_ins
  before insert on public.follows
  for each row execute function public.enforce_restricted_follows();

drop trigger if exists enforce_restricted_follows_upd on public.follows;
create trigger enforce_restricted_follows_upd
  before update on public.follows
  for each row execute function public.enforce_restricted_follows();

drop trigger if exists enforce_restricted_follows_del on public.follows;
create trigger enforce_restricted_follows_del
  before delete on public.follows
  for each row execute function public.enforce_restricted_follows();

-- Likes.
drop trigger if exists enforce_restricted_likes_ins on public.likes;
create trigger enforce_restricted_likes_ins
  before insert on public.likes
  for each row execute function public.enforce_restricted_likes();

drop trigger if exists enforce_restricted_likes_upd on public.likes;
create trigger enforce_restricted_likes_upd
  before update on public.likes
  for each row execute function public.enforce_restricted_likes();

drop trigger if exists enforce_restricted_likes_del on public.likes;
create trigger enforce_restricted_likes_del
  before delete on public.likes
  for each row execute function public.enforce_restricted_likes();

-- Moments, comments and moment likes.
drop trigger if exists enforce_restricted_moments_ins on public.moments;
create trigger enforce_restricted_moments_ins
  before insert on public.moments
  for each row execute function public.enforce_restricted_moments();

drop trigger if exists enforce_restricted_moments_upd on public.moments;
create trigger enforce_restricted_moments_upd
  before update on public.moments
  for each row execute function public.enforce_restricted_moments();

drop trigger if exists enforce_restricted_moments_del on public.moments;
create trigger enforce_restricted_moments_del
  before delete on public.moments
  for each row execute function public.enforce_restricted_moments();

drop trigger if exists enforce_restricted_moment_likes_ins on public.moment_likes;
create trigger enforce_restricted_moment_likes_ins
  before insert on public.moment_likes
  for each row execute function public.enforce_restricted_moment_likes();

drop trigger if exists enforce_restricted_moment_likes_del on public.moment_likes;
create trigger enforce_restricted_moment_likes_del
  before delete on public.moment_likes
  for each row execute function public.enforce_restricted_moment_likes();

drop trigger if exists enforce_restricted_moment_comments_ins on public.moment_comments;
create trigger enforce_restricted_moment_comments_ins
  before insert on public.moment_comments
  for each row execute function public.enforce_restricted_moment_comments();

drop trigger if exists enforce_restricted_moment_comments_upd on public.moment_comments;
create trigger enforce_restricted_moment_comments_upd
  before update on public.moment_comments
  for each row execute function public.enforce_restricted_moment_comments();

drop trigger if exists enforce_restricted_moment_comments_del on public.moment_comments;
create trigger enforce_restricted_moment_comments_del
  before delete on public.moment_comments
  for each row execute function public.enforce_restricted_moment_comments();

-- Messages: existing rows must not be editable while read-only either.
drop trigger if exists enforce_restricted_messages_upd on public.messages;
create trigger enforce_restricted_messages_upd
  before update on public.messages
  for each row execute function public.enforce_restricted_messages();

drop trigger if exists enforce_restricted_messages_del on public.messages;
create trigger enforce_restricted_messages_del
  before delete on public.messages
  for each row execute function public.enforce_restricted_messages();

-- Profiles.
drop trigger if exists enforce_restricted_profile_upd on public.profiles;
create trigger enforce_restricted_profile_upd
  before update on public.profiles
  for each row execute function public.enforce_restricted_profile();

-- Optional chat metadata tables. They are created by later migrations, so this
-- block is skipped on a database that has not reached them yet.
do $$
begin
  if to_regclass('public.message_reactions') is not null then
    drop trigger if exists enforce_restricted_reactions_ins on public.message_reactions;
    create trigger enforce_restricted_reactions_ins
      before insert on public.message_reactions
      for each row execute function public.enforce_restricted_message_meta();

    drop trigger if exists enforce_restricted_reactions_del on public.message_reactions;
    create trigger enforce_restricted_reactions_del
      before delete on public.message_reactions
      for each row execute function public.enforce_restricted_message_meta();
  end if;

  if to_regclass('public.pinned_messages') is not null then
    drop trigger if exists enforce_restricted_pins_ins on public.pinned_messages;
    create trigger enforce_restricted_pins_ins
      before insert on public.pinned_messages
      for each row execute function public.enforce_restricted_message_meta();

    drop trigger if exists enforce_restricted_pins_del on public.pinned_messages;
    create trigger enforce_restricted_pins_del
      before delete on public.pinned_messages
      for each row execute function public.enforce_restricted_message_meta();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. share_moment() must not be a side door around the moment guards
-- ---------------------------------------------------------------------------
create or replace function public.share_moment(p_moment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  new_shares integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if public.is_restricted(me) then
    raise exception 'Your account is read-only and cannot share Moments.'
      using errcode = '42501';
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
-- 14. Uploads: no new bytes while read-only
-- ---------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  execute $p$drop policy if exists "avatars_insert_own" on storage.objects$p$;
  execute $p$create policy "avatars_insert_own"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )$p$;

  execute $p$drop policy if exists "avatars_update_own" on storage.objects$p$;
  execute $p$create policy "avatars_update_own"
    on storage.objects for update to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )$p$;

  execute $p$drop policy if exists "moment_media_insert_own" on storage.objects$p$;
  execute $p$create policy "moment_media_insert_own"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'moment-media'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )$p$;

  execute $p$drop policy if exists "moment_media_update_own" on storage.objects$p$;
  execute $p$create policy "moment_media_update_own"
    on storage.objects for update to authenticated
    using (
      bucket_id = 'moment-media'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )
    with check (
      bucket_id = 'moment-media'
      and (storage.foldername(name))[1] = auth.uid()::text
      and not public.is_restricted(auth.uid())
    )$p$;
end $storage$;

comment on function public.is_restricted(uuid) is
  'True while a confirmed violation, active suspension, banned_until or legacy indefinite suspension makes the member read-only.';
comment on function public.apply_temporary_restriction(uuid, text, text, text, uuid, uuid, uuid, integer) is
  'Internal confirmed-violation writer. Only 2/6/12/24-hour moderator-confirmed restrictions are allowed.';
comment on function public.admin_resolve_report(uuid, text, text, integer) is
  'Moderator triage. Status actioned records a confirmed violation and applies the selected 2/6/12/24-hour restriction.';
comment on function public.apply_self_ban(integer, text) is
  'Compatibility no-op. Subbu may not restrict a member; only a moderator-confirmed violation can.';
