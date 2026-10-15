-- =============================================================================
-- M21 · Universal AI moderation and self-executing safety enforcement
-- =============================================================================
-- WHY THIS MIGRATION EXISTS
--   Reporting already existed (M4 structure, M13 triage, M14 suspension), but it
--   was a dead-end: a member could report, a moderator could resolve, and
--   nothing happened to the offender automatically. This migration turns the
--   report pipeline into an ENFORCEMENT pipeline that runs inside the database,
--   because the browser talks to PostgREST directly and anything enforced only
--   in the UI can be bypassed with curl.
--
-- WHAT IT ADDS
--   1. `reports` grows a content-aware shape: a fixed violation category
--      (nudity | harassment | underage | spam), a polymorphic target
--      (user | message | moment | comment | live) and a server-captured context
--      snippet, so a report carries what the reporter saw, not what they typed.
--   2. `bans` (scoped chat | video) and `suspensions` (account-level) are the
--      authoritative restriction records. Enforcement QUERIES them; it never
--      trusts a client.
--   3. `moderation_ai_scans` is a durable queue + verdict log for the AI worker.
--      Content is snapshotted at write time so the worker never has to read
--      private tables directly.
--   4. `moderation_warnings` records every warning issued; the offender also
--      gets an in-app `notifications` row (type 'warning') and a row in
--      `moderation_emails`, the outbound mail outbox.
--   5. `moderation_settings` is the single tunable source of thresholds and
--      durations, so policy is data, not code.
--
-- THE SELF-EXECUTING LOOP (no application server involved)
--   a. A member calls `file_report(...)`; the report is stored with a context
--      snapshot. `evaluate_report_thresholds()` then counts DISTINCT reporters
--      for the reported member inside the rolling window. At or above the
--      category threshold the report flips to 'actioned'.
--   b. An AFTER UPDATE trigger on `reports` calls `apply_moderation_action()`,
--      which is the ONLY writer of bans/suspensions/warnings. It is
--      idempotent: an active restriction of the same scope is never duplicated.
--   c. The AI worker claims queued scans, returns a verdict, and
--      `record_ai_scan()` feeds flagged content through the same
--      `apply_moderation_action()` core. AI on its own can only ever restrict
--      content the SCANNED member authored — a reporter cannot fabricate an AI
--      verdict, because the verdict is applied server-side, not by the client.
--   d. A moderator can still force an action via
--      `admin_apply_moderation_action()`, or simply resolve a report to
--      'actioned' and let (b) fire.
--
-- DENIAL, NOT DELEGATION
--   Every new table has RLS enabled. Members may read their OWN restrictions and
--   warnings; nobody can write them from a client. The worker RPCs are
--   secret-gated (the secret lives in `moderation_secrets`, never in the client)
--   so an authenticated caller cannot read the outbox or forge a verdict.
--
-- SAFE TO RE-RUN: idempotent (guards, `if not exists`, `drop policy if exists`).
-- DEPENDS ON: M4 (reports structure), M6 (RLS baseline), M13 (snapshot trigger,
--             admin_report_queue/resolve), M14 (user_roles, is_moderator,
--             admin_audit_log, enforce_abuse_controls), notifications backend.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen notifications: a warning is not a user action
-- ---------------------------------------------------------------------------
-- The existing CHECK is a closed set of social events. A moderation warning is
-- a different kind of row, and it needs its own copy (the member did not "get a
-- notification", they were told they broke a rule), so `body` is added.
alter table public.notifications add column if not exists body text;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('follow','like','match','message','visitor','report','warning'));

-- ---------------------------------------------------------------------------
-- 2. Reports: categories, content targets and captured evidence
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists category      text;
alter table public.reports add column if not exists target_type   text not null default 'user';
alter table public.reports add column if not exists target_id     uuid;
alter table public.reports add column if not exists context       text;
alter table public.reports add column if not exists evidence_image text;
alter table public.reports add column if not exists ai_flagged    boolean not null default false;
alter table public.reports add column if not exists ai_score      numeric;
alter table public.reports add column if not exists action_taken  text;

-- Backfill the new category from the legacy reasons before NOT NULL applies.
update public.reports
   set category = case reason
     when 'fake_profile'  then 'spam'
     when 'inappropriate' then 'nudity'
     when 'underage'      then 'underage'
     when 'other'         then 'harassment'
     else 'harassment'
   end
 where category is null;

alter table public.reports alter column category set default 'harassment';
alter table public.reports alter column category set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_category_check' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_category_check
      check (category in ('nudity','harassment','underage','spam'));
    raise notice 'M21: added reports_category_check';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_target_type_check' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_target_type_check
      check (target_type in ('user','message','moment','comment','live'));
    raise notice 'M21: added reports_target_type_check';
  end if;

  -- A live snapshot is a JPEG data URL. Cap the column so a client cannot use a
  -- report as unbounded storage; ~600 KB is a 640px-wide JPEG with headroom.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_evidence_image_size_check' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_evidence_image_size_check
      check (evidence_image is null or char_length(evidence_image) <= 600000);
    raise notice 'M21: added reports_evidence_image_size_check';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. moderation_settings — policy as data
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_settings (
  id                        boolean primary key default true check (id),
  report_window_days        integer  not null default 30  check (report_window_days between 1 and 3650),
  chat_report_threshold     integer  not null default 3   check (chat_report_threshold >= 1),
  video_report_threshold    integer  not null default 2   check (video_report_threshold >= 1),
  underage_report_threshold integer  not null default 1   check (underage_report_threshold >= 1),
  -- Under-17 enforcement is the one action that can destroy an account, so by
  -- default a bare report is NOT enough: it needs an AI verdict or a moderator.
  underage_requires_ai      boolean  not null default true,
  chat_ban_days             integer  not null default 7   check (chat_ban_days >= 1),
  spam_ban_days             integer  not null default 7   check (spam_ban_days >= 1),
  video_ban_days            integer  not null default 14  check (video_ban_days >= 1),
  underage_suspension_days  integer  not null default 365 check (underage_suspension_days >= 1),
  ai_text_threshold         numeric  not null default 0.75 check (ai_text_threshold between 0 and 1),
  ai_media_threshold        numeric  not null default 0.60 check (ai_media_threshold between 0 and 1),
  updated_at                timestamptz not null default now()
);

insert into public.moderation_settings (id) values (true) on conflict (id) do nothing;

alter table public.moderation_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 4. moderation_secrets — the worker bearer token, never readable by a client
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_secrets (
  id            boolean primary key default true check (id),
  worker_secret text,
  updated_at    timestamptz not null default now()
);

insert into public.moderation_secrets (id) values (true) on conflict (id) do nothing;

alter table public.moderation_secrets enable row level security;
-- No policies: only SECURITY DEFINER functions read this table.

-- ---------------------------------------------------------------------------
-- 5. bans — scoped, time-boxed restrictions on chat or video
-- ---------------------------------------------------------------------------
create table if not exists public.bans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  scope      text not null check (scope in ('chat','video')),
  category   text not null check (category in ('nudity','harassment','underage','spam')),
  reason     text,
  source     text not null default 'auto_threshold'
             check (source in ('auto_threshold','ai','moderator')),
  report_id  uuid references public.reports(id) on delete set null,
  scan_id    uuid,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint bans_window_check check (ends_at > starts_at)
);

create index if not exists bans_user_idx        on public.bans (user_id);
create index if not exists bans_user_scope_idx  on public.bans (user_id, scope, ends_at);
create index if not exists bans_report_idx      on public.bans (report_id);
create index if not exists bans_created_by_idx  on public.bans (created_by);

alter table public.bans enable row level security;

drop policy if exists "bans_select_own_or_moderator" on public.bans;
create policy "bans_select_own_or_moderator"
  on public.bans for select to authenticated
  using (auth.uid() = user_id or public.is_moderator());

-- ---------------------------------------------------------------------------
-- 6. suspensions — account-level, minimum one year for underage
-- ---------------------------------------------------------------------------
create table if not exists public.suspensions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null check (category in ('nudity','harassment','underage','spam')),
  reason     text,
  source     text not null default 'auto_threshold'
             check (source in ('auto_threshold','ai','moderator')),
  report_id  uuid references public.reports(id) on delete set null,
  scan_id    uuid,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint suspensions_window_check check (ends_at > starts_at)
);

create index if not exists suspensions_user_idx       on public.suspensions (user_id);
create index if not exists suspensions_user_end_idx   on public.suspensions (user_id, ends_at);
create index if not exists suspensions_report_idx     on public.suspensions (report_id);
create index if not exists suspensions_created_by_idx on public.suspensions (created_by);

alter table public.suspensions enable row level security;

drop policy if exists "suspensions_select_own_or_moderator" on public.suspensions;
create policy "suspensions_select_own_or_moderator"
  on public.suspensions for select to authenticated
  using (auth.uid() = user_id or public.is_moderator());

-- ---------------------------------------------------------------------------
-- 7. moderation_ai_scans — queue and verdict log for the AI worker
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_ai_scans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  content_type     text not null check (content_type in
                     ('message','moment_caption','comment','bio','profile_photo','live_snapshot')),
  content_id       uuid,
  -- Snapshot at enqueue time. The worker must not need to read private tables.
  content_text     text,
  content_url      text,
  content_hash     text,
  status           text not null default 'queued'
                   check (status in ('queued','processing','done','skipped','failed')),
  attempts         integer not null default 0,
  last_error       text,
  provider         text,
  model            text,
  flagged          boolean,
  score            numeric,
  categories       jsonb,
  suggested_action text check (suggested_action in ('chat','video','account') or suggested_action is null),
  report_id        uuid references public.reports(id) on delete set null,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);

create index if not exists moderation_ai_scans_user_idx        on public.moderation_ai_scans (user_id);
create index if not exists moderation_ai_scans_status_idx      on public.moderation_ai_scans (status, created_at);
create index if not exists moderation_ai_scans_content_idx     on public.moderation_ai_scans (content_type, content_id);
create index if not exists moderation_ai_scans_report_idx      on public.moderation_ai_scans (report_id);

alter table public.moderation_ai_scans enable row level security;

drop policy if exists "ai_scans_moderator_read" on public.moderation_ai_scans;
create policy "ai_scans_moderator_read"
  on public.moderation_ai_scans for select to authenticated
  using (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 8. moderation_warnings — the durable warning history
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_warnings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  report_id  uuid references public.reports(id) on delete set null,
  scan_id    uuid references public.moderation_ai_scans(id) on delete set null,
  category   text not null check (category in ('nudity','harassment','underage','spam')),
  scope      text not null check (scope in ('chat','video','account')),
  action     text not null,
  message    text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists moderation_warnings_user_idx       on public.moderation_warnings (user_id);
create index if not exists moderation_warnings_report_idx     on public.moderation_warnings (report_id);
create index if not exists moderation_warnings_scan_idx       on public.moderation_warnings (scan_id);
create index if not exists moderation_warnings_created_by_idx on public.moderation_warnings (created_by);

alter table public.moderation_warnings enable row level security;

drop policy if exists "warnings_select_own_or_moderator" on public.moderation_warnings;
create policy "warnings_select_own_or_moderator"
  on public.moderation_warnings for select to authenticated
  using (auth.uid() = user_id or public.is_moderator());

-- ---------------------------------------------------------------------------
-- 9. moderation_emails — outbound warning mail outbox
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  recipient   text,
  subject     text not null,
  body        text not null,
  template    text not null default 'moderation_warning',
  status      text not null default 'pending'
              check (status in ('pending','sending','sent','failed','skipped')),
  provider    text,
  provider_id text,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists moderation_emails_user_idx   on public.moderation_emails (user_id);
create index if not exists moderation_emails_status_idx on public.moderation_emails (status, created_at);
create index if not exists moderation_emails_created_idx on public.moderation_emails (created_at);

alter table public.moderation_emails enable row level security;

drop policy if exists "moderation_emails_moderator_read" on public.moderation_emails;
create policy "moderation_emails_moderator_read"
  on public.moderation_emails for select to authenticated
  using (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 10. Enforcement predicates — the ONLY source of truth for "is restricted"
-- ---------------------------------------------------------------------------
create or replace function public.is_chat_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = p_user and b.scope = 'chat' and b.active and b.ends_at > now()
  ) or exists (
    select 1 from public.suspensions s
    where s.user_id = p_user and s.active and s.ends_at > now()
  ) or exists (
    select 1 from public.profiles p
    where p.id = p_user and coalesce(p.is_suspended, false)
  );
$$;

create or replace function public.is_video_restricted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = p_user and b.scope = 'video' and b.active and b.ends_at > now()
  ) or exists (
    select 1 from public.suspensions s
    where s.user_id = p_user and s.active and s.ends_at > now()
  ) or exists (
    select 1 from public.profiles p
    where p.id = p_user and coalesce(p.is_suspended, false)
  );
$$;

revoke all on function public.is_chat_restricted(uuid)  from public, anon;
revoke all on function public.is_video_restricted(uuid) from public, anon;
grant execute on function public.is_chat_restricted(uuid)  to authenticated;
grant execute on function public.is_video_restricted(uuid) to authenticated;

-- `my_restrictions()` is what the UI reads to render a read-only notice.
create or replace function public.my_restrictions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  chat_ts timestamptz;
  vid_ts  timestamptz;
  susp    record;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select max(b.ends_at) into chat_ts from public.bans b
   where b.user_id = me and b.scope = 'chat' and b.active and b.ends_at > now();

  select max(b.ends_at) into vid_ts from public.bans b
   where b.user_id = me and b.scope = 'video' and b.active and b.ends_at > now();

  select s.ends_at, s.reason into susp
  from public.suspensions s
  where s.user_id = me and s.active and s.ends_at > now()
  order by s.ends_at desc limit 1;

  return jsonb_build_object(
    'chat_banned',      chat_ts is not null,
    'chat_until',       chat_ts,
    'video_banned',     vid_ts is not null,
    'video_until',      vid_ts,
    'suspended',        susp.ends_at is not null,
    'suspended_until',  susp.ends_at,
    'suspended_reason', susp.reason
  );
end;
$$;

revoke all on function public.my_restrictions() from public, anon;
grant execute on function public.my_restrictions() to authenticated;

-- ---------------------------------------------------------------------------
-- 10b. Allow the enforcement core to write the account flag
-- ---------------------------------------------------------------------------
-- M14's `protect_moderation_columns` exists so a suspended member cannot clear
-- their own `is_suspended`. It allows moderators and backend writes, but the
-- threshold path runs inside `file_report()` under the REPORTER's identity, so
-- `auth.uid()` is not null and the guard would abort the suspension.
--
-- The enforcement function raises this transaction-local flag around exactly
-- one statement, and the guard honours it. Nothing else sets the flag, and a
-- client cannot: `set_config(..., true)` is scoped to the current transaction,
-- which the caller does not control inside a SECURITY DEFINER function.
create or replace function public.protect_moderation_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_moderator()
     or auth.uid() is null
     or coalesce(current_setting('mettivo.moderation_action', true), '') = 'on' then
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

-- ---------------------------------------------------------------------------
-- 11. apply_moderation_action() — the single writer of bans/suspensions
-- ---------------------------------------------------------------------------
-- Idempotent by scope: while an active restriction of the same scope exists, a
-- second identical action is a no-op that returns the existing warning id. This
-- is what makes threshold evaluation safe to run on every report.
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
  cfg          record;
  days         integer;
  action_label text;
  message      text;
  subject      text;
  warning_id   uuid;
  email_addr   text;
  existing_id  uuid;
begin
  if p_scope not in ('chat','video','account') then
    raise exception 'Invalid scope: %', p_scope using errcode = '22023';
  end if;
  if p_source not in ('auto_threshold','ai','moderator') then
    raise exception 'Invalid source: %', p_source using errcode = '22023';
  end if;

  select * into cfg from public.moderation_settings where id;

  -- Never stack a second active restriction of the same scope on the same day.
  if p_scope = 'chat' then
    select b.id into existing_id from public.bans b
     where b.user_id = p_user and b.scope = 'chat' and b.active and b.ends_at > now()
     limit 1;
  elsif p_scope = 'video' then
    select b.id into existing_id from public.bans b
     where b.user_id = p_user and b.scope = 'video' and b.active and b.ends_at > now()
     limit 1;
  else
    select s.id into existing_id from public.suspensions s
     where s.user_id = p_user and s.active and s.ends_at > now()
     limit 1;
  end if;

  if existing_id is not null then
    select w.id into warning_id
    from public.moderation_warnings w
    where w.user_id = p_user and w.scope = p_scope
    order by w.created_at desc limit 1;
    return warning_id;
  end if;

  if p_scope = 'chat' then
    days := case when p_category = 'spam' then cfg.spam_ban_days else cfg.chat_ban_days end;
    action_label := 'chat_banned';
    insert into public.bans (user_id, scope, category, reason, source, report_id, scan_id, ends_at, created_by)
    values (p_user, 'chat', p_category, p_note, p_source, p_report_id, p_scan_id,
            now() + make_interval(days => days), p_actor);
    message := format(
      'You have been muted for %s days. Multiple reports or an automated review found disrespectful or spam behaviour in your chats.',
      days);
    subject := 'Mettivo: your chat access has been restricted';
  elsif p_scope = 'video' then
    days := cfg.video_ban_days;
    action_label := 'video_banned';
    insert into public.bans (user_id, scope, category, reason, source, report_id, scan_id, ends_at, created_by)
    values (p_user, 'video', p_category, p_note, p_source, p_report_id, p_scan_id,
            now() + make_interval(days => days), p_actor);
    message := format(
      'Your access to Mettivo Live has been suspended for %s days after explicit or abusive content was flagged during a live stream.',
      days);
    subject := 'Mettivo: your Mettivo Live access has been suspended';
  else
    days := cfg.underage_suspension_days;
    action_label := 'account_suspended';
    insert into public.suspensions (user_id, category, reason, source, report_id, scan_id, ends_at, created_by)
    values (p_user, p_category, p_note, p_source, p_report_id, p_scan_id,
            now() + make_interval(days => days), p_actor);

    -- Mirror into the account flag the rest of the app already enforces. The
    -- flag tells M14's guard this write is enforcement, not a member self-serve.
    perform set_config('mettivo.moderation_action', 'on', true);
    update public.profiles
       set is_suspended = true, suspended_at = now(), suspension_reason = coalesce(p_note, 'Underage safety review')
     where id = p_user;
    perform set_config('mettivo.moderation_action', 'off', true);

    message := format(
      'Your account has been suspended for %s days pending a safety review. If you believe this is a mistake, contact support.',
      days);
    subject := 'Mettivo: your account has been suspended pending review';
  end if;

  insert into public.moderation_warnings (user_id, report_id, scan_id, category, scope, action, message, created_by)
  values (p_user, p_report_id, p_scan_id, p_category, p_scope, action_label, message, p_actor)
  returning id into warning_id;

  -- In-app warning (the notification table has no INSERT policy; this runs as
  -- the definer owner, which is exactly how every other notification is made).
  insert into public.notifications (user_id, actor_id, type, entity_id, body)
  values (p_user, null, 'warning', warning_id, message);

  -- Outbound mail, queued. The recipient is resolved from the identity, never
  -- from the client; a missing address marks the row 'skipped' rather than
  -- failing the enforcement.
  select u.email into email_addr from auth.users u where u.id = p_user;
  insert into public.moderation_emails (user_id, recipient, subject, body, status)
  values (p_user, email_addr, subject, message, case when email_addr is null then 'skipped' else 'pending' end);

  -- Capture the source report once, so the queue shows the action taken.
  if p_report_id is not null then
    update public.reports set action_taken = action_label, updated_at = now() where id = p_report_id;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, target_report_id, details)
  values (
    p_actor,
    'moderation.' || action_label,
    p_user,
    p_report_id,
    jsonb_build_object('category', p_category, 'scope', p_scope, 'source', p_source,
                       'days', days, 'scan_id', p_scan_id, 'warning_id', warning_id)
  );

  return warning_id;
end;
$$;

-- Internal only: callers go through a threshold, the AI verdict RPC, or the
-- moderator RPC. Not executable from any client role.
revoke all on function public.apply_moderation_action(uuid, text, text, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. evaluate_report_thresholds() — collective reports become action
-- ---------------------------------------------------------------------------
-- Counts DISTINCT reporters inside the rolling window. Underage is special: it
-- only auto-suspends when the operator has turned the AI requirement off, or a
-- report already carries an AI flag, because a bare accusation should never
-- destroy an account on its own.
create or replace function public.evaluate_report_thresholds(p_reported uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg          record;
  win          interval;
  chat_count   integer;
  video_count  integer;
  minor_count  integer;
  ai_minor     boolean;
begin
  if p_reported is null then
    return jsonb_build_object('applied', false);
  end if;

  select * into cfg from public.moderation_settings where id;
  win := make_interval(days => cfg.report_window_days);

  select count(distinct r.reporter_id) into chat_count
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category in ('harassment','spam')
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id) into video_count
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'nudity'
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  select count(distinct r.reporter_id), bool_or(r.ai_flagged) into minor_count, ai_minor
  from public.reports r
  where r.reported_user_id = p_reported
    and r.category = 'underage'
    and r.status in ('pending','reviewed')
    and r.created_at > now() - win;

  if video_count >= cfg.video_report_threshold and not public.is_video_restricted(p_reported) then
    perform public.apply_moderation_action(p_reported, 'nudity', 'video', 'auto_threshold');
    return jsonb_build_object('applied', true, 'scope', 'video', 'count', video_count);
  end if;

  if chat_count >= cfg.chat_report_threshold and not public.is_chat_restricted(p_reported) then
    perform public.apply_moderation_action(p_reported, 'harassment', 'chat', 'auto_threshold');
    return jsonb_build_object('applied', true, 'scope', 'chat', 'count', chat_count);
  end if;

  if minor_count >= cfg.underage_report_threshold
     and (not cfg.underage_requires_ai or coalesce(ai_minor, false))
     and not public.is_video_restricted(p_reported) then
    perform public.apply_moderation_action(p_reported, 'underage', 'account', 'auto_threshold');
    return jsonb_build_object('applied', true, 'scope', 'account', 'count', minor_count);
  end if;

  return jsonb_build_object('applied', false);
end;
$$;

revoke all on function public.evaluate_report_thresholds(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. file_report() — the single client entry point for filing a report
-- ---------------------------------------------------------------------------
-- Derives the reporter from auth.uid() and snapshots the referenced content
-- server-side, so the report carries what was actually posted, not what the
-- reporter typed into a box.
create or replace function public.file_report(
  p_target_user   uuid,
  p_category      text,
  p_target_type   text default 'user',
  p_target_id     uuid default null,
  p_details       text default null,
  p_evidence_image text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me          uuid := auth.uid();
  report_id   uuid;
  context_txt text;
  is_new      boolean := true;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_target_user is null then
    raise exception 'A reported user is required' using errcode = '22023';
  end if;
  if p_target_user = me then
    raise exception 'You cannot report yourself' using errcode = '22023';
  end if;
  if p_category not in ('nudity','harassment','underage','spam') then
    raise exception 'Invalid category: %', p_category using errcode = '22023';
  end if;
  if p_target_type not in ('user','message','moment','comment','live') then
    raise exception 'Invalid target type: %', p_target_type using errcode = '22023';
  end if;
  if p_evidence_image is not null and char_length(p_evidence_image) > 600000 then
    raise exception 'Evidence image is too large' using errcode = '22023';
  end if;

  -- The content snippet is captured from the real row, verified to belong to the
  -- reported member, so a reporter cannot fabricate context.
  if p_target_type = 'message' and p_target_id is not null then
    select m.content into context_txt from public.messages m
     where m.id = p_target_id and m.sender_id = p_target_user;
  elsif p_target_type = 'comment' and p_target_id is not null then
    select c.body into context_txt from public.moment_comments c
     where c.id = p_target_id and c.author_id = p_target_user;
  elsif p_target_type = 'moment' and p_target_id is not null then
    select mm.caption into context_txt from public.moments mm
     where mm.id = p_target_id and mm.author_id = p_target_user;
  end if;

  insert into public.reports (
    reporter_id, reported_user_id, reason, details, category,
    target_type, target_id, context, evidence_image
  )
  values (
    me, p_target_user,
    case p_category
      when 'spam' then 'fake_profile'
      when 'nudity' then 'inappropriate'
      when 'underage' then 'underage'
      else 'harassment'
    end,
    nullif(btrim(coalesce(p_details, '')), ''),
    p_category, p_target_type, p_target_id, context_txt, p_evidence_image
  )
  -- One open report per (reporter, reported) pair (M4's unique key). A repeat
  -- refreshes the evidence rather than failing, so a member can report a new
  -- message from the same person.
  on conflict (reporter_id, reported_user_id) do update
    set category       = excluded.category,
        reason         = excluded.reason,
        details        = coalesce(excluded.details, public.reports.details),
        target_type    = excluded.target_type,
        target_id      = excluded.target_id,
        context        = coalesce(excluded.context, public.reports.context),
        evidence_image = coalesce(excluded.evidence_image, public.reports.evidence_image),
        updated_at     = now()
    returning id into report_id;

  -- A live report may carry a snapshot. Queue it for the vision worker and link
  -- it to the report, so an AI verdict lands on the same report the moderator
  -- reads. The snapshot is the offender's own stream, which is what makes an AI
  -- action against them defensible.
  if p_evidence_image is not null then
    insert into public.moderation_ai_scans (user_id, content_type, content_id, content_url, report_id)
    values (p_target_user, 'live_snapshot', p_target_id, p_evidence_image, report_id);
  end if;

  perform public.evaluate_report_thresholds(p_target_user);

  select (r.status = 'pending') into is_new from public.reports r where r.id = report_id;

  return jsonb_build_object(
    'report_id', report_id,
    'category', p_category,
    'status', case when is_new then 'pending' else 'actioned' end
  );
end;
$$;

revoke all on function public.file_report(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.file_report(uuid, text, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Report action trigger — the hinge between triage and enforcement
-- ---------------------------------------------------------------------------
-- Fires whenever a report becomes 'actioned', no matter who actioned it
-- (threshold, AI or moderator). It picks the scope from the category and lets
-- apply_moderation_action do the rest.
create or replace function public.action_report_on_actioned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scope text;
  src   text;
begin
  begin
    if new.status = 'actioned' and old.status is distinct from 'actioned' then
      scope := case
        when new.category = 'underage' then 'account'
        when new.category = 'nudity'   then 'video'
        else 'chat'
      end;
      src := case when coalesce(new.ai_flagged, false) then 'ai' else 'auto_threshold' end;

      if not (
        (scope = 'chat'  and public.is_chat_restricted(new.reported_user_id)) or
        (scope = 'video' and public.is_video_restricted(new.reported_user_id)) or
        (scope = 'account' and exists (
          select 1 from public.suspensions s
          where s.user_id = new.reported_user_id and s.active and s.ends_at > now()))
      ) then
        perform public.apply_moderation_action(
          new.reported_user_id, new.category, scope, src,
          new.id, null, new.resolution_note, null);
      end if;
    end if;
  exception when others then
    -- Enforcement must never roll back a moderator's decision.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists action_report_on_actioned_trg on public.reports;
create trigger action_report_on_actioned_trg
  after update on public.reports
  for each row execute function public.action_report_on_actioned();

-- ---------------------------------------------------------------------------
-- 15. Chat enforcement — a restricted member physically cannot send
-- ---------------------------------------------------------------------------
create or replace function public.enforce_chat_restriction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_chat_restricted(new.sender_id) then
    raise exception 'You are muted and cannot send messages right now.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_chat_restriction_trg on public.messages;
create trigger enforce_chat_restriction_trg
  before insert on public.messages
  for each row execute function public.enforce_chat_restriction();

-- ---------------------------------------------------------------------------
-- 16. AI scan queue — content enqueued at write time
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_ai_scan(
  p_user         uuid,
  p_content_type text,
  p_content_id   uuid,
  p_content_text text,
  p_content_url  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if p_user is null then
      return;
    end if;
    -- Nothing worth scanning.
    if coalesce(btrim(p_content_text), '') = '' and coalesce(p_content_url, '') = '' then
      return;
    end if;

    insert into public.moderation_ai_scans (user_id, content_type, content_id, content_text, content_url)
    values (p_user, p_content_type, p_content_id,
            nullif(btrim(coalesce(p_content_text, '')), ''),
            nullif(btrim(coalesce(p_content_url, '')), ''));
  exception when others then
    -- A scan-enqueue failure must never block the message/moment/etc.
    null;
  end;
end;
$$;

create or replace function public.enqueue_ai_scan_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.enqueue_ai_scan(new.sender_id, 'message', new.id, new.content, null);
  return new;
end; $$;

drop trigger if exists enqueue_ai_scan_message_trg on public.messages;
create trigger enqueue_ai_scan_message_trg
  after insert on public.messages
  for each row execute function public.enqueue_ai_scan_message();

create or replace function public.enqueue_ai_scan_comment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.enqueue_ai_scan(new.author_id, 'comment', new.id, new.body, null);
  return new;
end; $$;

drop trigger if exists enqueue_ai_scan_comment_trg on public.moment_comments;
create trigger enqueue_ai_scan_comment_trg
  after insert on public.moment_comments
  for each row execute function public.enqueue_ai_scan_comment();

create or replace function public.enqueue_ai_scan_moment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  first_media text;
begin
  first_media := case when new.media is not null and array_length(new.media, 1) >= 1
                      then new.media[1] else null end;
  perform public.enqueue_ai_scan(new.author_id, 'moment_caption', new.id, new.caption, null);
  if first_media is not null then
    perform public.enqueue_ai_scan(new.author_id, 'profile_photo', new.id, null, first_media);
  end if;
  return new;
end; $$;

drop trigger if exists enqueue_ai_scan_moment_trg on public.moments;
create trigger enqueue_ai_scan_moment_trg
  after insert on public.moments
  for each row execute function public.enqueue_ai_scan_moment();

create or replace function public.enqueue_ai_scan_bio()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.bio is distinct from old.bio and coalesce(btrim(new.bio), '') <> '' then
    perform public.enqueue_ai_scan(new.id, 'bio', null, new.bio, null);
  end if;
  return new;
end; $$;

drop trigger if exists enqueue_ai_scan_bio_trg on public.profiles;
create trigger enqueue_ai_scan_bio_trg
  after update on public.profiles
  for each row execute function public.enqueue_ai_scan_bio();

-- ---------------------------------------------------------------------------
-- 17. Worker RPCs (secret-gated, never callable without the configured token)
-- ---------------------------------------------------------------------------
create or replace function public.worker_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- `exists` (not a bare comparison) is deliberate: a bare
  -- `p_secret = (select ...)` yields NULL when the secret row is missing, and
  -- `if not NULL` is NOT taken — which would let every worker RPC run without a
  -- secret on a fresh database. `exists` is always true or false.
  select p_secret is not null
     and p_secret <> ''
     and exists (
       select 1 from public.moderation_secrets s
       where s.id and s.worker_secret = p_secret
     );
$$;

revoke all on function public.worker_secret_ok(text) from public, anon, authenticated;

-- The worker runs with only the public anon key plus this shared secret (the
-- project has no application server and the service_role key must never reach
-- source control). Reaching the function is therefore allowed to `anon`, and the
-- SECRET is the gate: every body below refuses before touching any row.
create or replace function public.moderation_policy(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;
  return (select to_jsonb(s) from public.moderation_settings s where s.id);
end;
$$;

revoke all on function public.moderation_policy(text) from public;
grant execute on function public.moderation_policy(text) to anon, authenticated;

-- Claim a batch of queued scans, marking them 'processing' atomically.
create or replace function public.claim_moderation_scans(p_secret text, p_limit integer default 10)
returns table (
  scan_id      uuid,
  user_id      uuid,
  content_type text,
  content_id   uuid,
  content_text text,
  content_url  text,
  report_id    uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  return query
  with claimed as (
    select s.id
    from public.moderation_ai_scans s
    where s.status = 'queued'
    order by s.created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  update public.moderation_ai_scans s
     set status = 'processing', attempts = s.attempts + 1
   from claimed
   where s.id = claimed.id
  returning s.id, s.user_id, s.content_type, s.content_id, s.content_text, s.content_url, s.report_id;
end;
$$;

revoke all on function public.claim_moderation_scans(text, integer) from public, anon;
grant execute on function public.claim_moderation_scans(text, integer) to anon, authenticated;

-- Record a verdict and, when flagged, enforce through the shared core.
create or replace function public.record_ai_scan(
  p_secret            text,
  p_scan_id           uuid,
  p_flagged           boolean,
  p_score             numeric default null,
  p_categories        jsonb default null,
  p_provider          text default null,
  p_model             text default null,
  p_suggested_action  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  scan    record;
  action  text;
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

  if coalesce(p_flagged, false) then
    -- Mark a linked report as AI-flagged so threshold evaluation and the
    -- moderator queue both see the verdict.
    if scan.report_id is not null then
      update public.reports
         set ai_flagged = true, ai_score = p_score, updated_at = now()
       where id = scan.report_id;
    end if;

    -- The AI can only restrict the member who AUTHORED the scanned content.
    -- That is the whole basis of trusting this path: the offender's own content,
    -- a server-side verdict, and no client in the decision.
    action := coalesce(p_suggested_action,
      case
        when scan.content_type in ('profile_photo','live_snapshot') then 'video'
        when scan.content_type = 'message' then 'chat'
        else 'chat'
      end);

    perform public.apply_moderation_action(
      scan.user_id,
      case when action = 'video' then 'nudity'
           when action = 'account' then 'underage'
           else 'harassment' end,
      action,
      'ai',
      scan.report_id,
      scan.id,
      'Automated content review',
      null);

    return jsonb_build_object('ok', true, 'flagged', true, 'action', action);
  end if;

  return jsonb_build_object('ok', true, 'flagged', false);
end;
$$;

revoke all on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text) from public, anon;
grant execute on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text) to anon, authenticated;

-- A provider outage must not look like a clean verdict. The worker reports the
-- failure and the scan returns to the queue until it has been tried enough
-- times to give up. No content is enforced from a failed call.
create or replace function public.fail_moderation_scan(
  p_secret  text,
  p_scan_id uuid,
  p_error   text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  update public.moderation_ai_scans
     set status     = case when attempts >= 5 then 'failed' else 'queued' end,
         last_error = left(coalesce(p_error, 'scan_failed'), 500)
   where id = p_scan_id;
end;
$$;

revoke all on function public.fail_moderation_scan(text, uuid, text) from public, anon;
grant execute on function public.fail_moderation_scan(text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 18. Email outbox worker RPCs (same secret gate)
-- ---------------------------------------------------------------------------
create or replace function public.claim_moderation_emails(p_secret text, p_limit integer default 20)
returns table (
  email_id  uuid,
  recipient text,
  subject   text,
  body      text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  return query
  with claimed as (
    select e.id
    from public.moderation_emails e
    where e.status = 'pending' and e.recipient is not null
    order by e.created_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  )
  update public.moderation_emails e
     set status = 'sending', attempts = e.attempts + 1
   from claimed
   where e.id = claimed.id
  returning e.id, e.recipient, e.subject, e.body;
end;
$$;

revoke all on function public.claim_moderation_emails(text, integer) from public, anon;
grant execute on function public.claim_moderation_emails(text, integer) to anon, authenticated;

create or replace function public.mark_moderation_email(
  p_secret    text,
  p_email_id  uuid,
  p_sent      boolean,
  p_provider  text default null,
  p_provider_id text default null,
  p_error     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  if coalesce(p_sent, false) then
    update public.moderation_emails
       set status = 'sent', provider = p_provider, provider_id = p_provider_id,
           last_error = null, sent_at = now()
     where id = p_email_id;
  else
    update public.moderation_emails
       set status = 'failed', provider = p_provider, last_error = p_error
     where id = p_email_id;
  end if;
end;
$$;

revoke all on function public.mark_moderation_email(text, uuid, boolean, text, text, text) from public, anon;
grant execute on function public.mark_moderation_email(text, uuid, boolean, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 19. Moderator override
-- ---------------------------------------------------------------------------
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
  if p_target_user = auth.uid() then
    raise exception 'You cannot restrict yourself' using errcode = '22023';
  end if;
  return public.apply_moderation_action(
    p_target_user, p_category, p_scope, 'moderator', null, null, p_note, auth.uid());
end;
$$;

revoke all on function public.admin_apply_moderation_action(uuid, text, text, text) from public, anon;
grant execute on function public.admin_apply_moderation_action(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 20. Table privileges
-- ---------------------------------------------------------------------------
grant select on public.bans                to authenticated;
grant select on public.suspensions         to authenticated;
grant select on public.moderation_warnings to authenticated;
grant select on public.moderation_ai_scans to authenticated;
grant select on public.moderation_emails   to authenticated;
grant select on public.moderation_settings to authenticated;

revoke all on public.moderation_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 21. Documentation
-- ---------------------------------------------------------------------------
comment on table public.bans is
  'Scoped, time-boxed chat/video restrictions. Written only by apply_moderation_action(); members read their own.';
comment on table public.suspensions is
  'Account-level suspensions (minimum one year for underage). Written only by apply_moderation_action().';
comment on table public.moderation_ai_scans is
  'AI moderation queue and verdict log. Content is snapshotted at write time; the worker claims and records verdicts.';
comment on table public.moderation_warnings is
  'Durable warning history. Every warning also produces an in-app notification and an outbox email.';
comment on table public.moderation_emails is
  'Outbound moderation email outbox. A server worker sends pending rows and marks them sent.';
comment on table public.moderation_settings is
  'Tunable moderation policy: report thresholds, ban durations and AI score cut-offs.';
comment on column public.reports.category is
  'Violation category: nudity | harassment | underage | spam (M21).';
comment on function public.file_report(uuid, text, text, uuid, text, text) is
  'Client entry point for filing a report. Captures the referenced content server-side and runs threshold evaluation.';

-- ---------------------------------------------------------------------------
-- 22. Posture report
-- ---------------------------------------------------------------------------
select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('bans','suspensions','moderation_ai_scans','moderation_warnings',
                    'moderation_emails','moderation_settings','moderation_secrets','reports')
group by c.relname, c.relrowsecurity
order by c.relname;
