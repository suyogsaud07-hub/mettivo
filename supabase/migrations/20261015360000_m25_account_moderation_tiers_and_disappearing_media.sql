-- =============================================================================
-- M25 · Account-wide moderation tiers and disappearing chat media
-- =============================================================================
-- WHY THIS MIGRATION EXISTS
--   M21 built the enforcement pipeline but made it SCOPED (a chat ban stopped
--   messages, a video ban stopped Live) and let the AI worker act on its own.
--   The product now wants one rule set for the whole platform:
--
--     * Abusive text, a bio, or a general report ....... account pause, 7 days
--     * Nudes / explicit photos inside a chat .......... account pause, 15 days
--     * Indecent behaviour on Live or Voice ............ account pause, 30 days
--
--   A paused account can read but not post anywhere: chat, Moments (posts and
--   comments), Live and Voice. The restriction is ACCOUNT-WIDE, timed, and
--   recorded on the same `suspensions` row the rest of the app already reads.
--
--   It also ships disappearing / view-once media in chats: a private Storage
--   bucket, a `chat_media` row per item, and a `redeem_chat_media()` call that
--   burns a view-once item the moment the recipient opens it. The browser talks
--   straight to Supabase, so all of this is enforced in PostgreSQL and on
--   `storage.objects` — never in the UI.
--
-- WHAT CHANGES FROM M21
--   1. `reports.category` learns four product-facing buckets:
--      abuse_text | explicit_media | indecent_live | other (legacy M21 values
--      are kept so no historical row is invalidated).
--   2. `moderation_settings` gains the tier durations as DATA (7 / 15 / 30).
--   3. `apply_moderation_action()` now always writes an ACCOUNT suspension for
--      the category's tier. The `bans` table is retained for history only.
--   4. `record_ai_scan()` enforces ONLY when the scan is linked to a user
--      report. Content that nobody reported is still scanned and logged, but
--      never punished automatically.
--   5. Moments and comments gain a BEFORE INSERT gate, so a paused account
--      physically cannot post.
--
-- SAFE TO RE-RUN: idempotent (guards, `if not exists`, `drop ... if exists`).
-- DEPENDS ON: M21 (reports, bans, suspensions, moderation_settings,
--             moderation_ai_scans, apply_moderation_action, is_chat_restricted),
--             M10 (matches), M11 (messages), M12 (blocked_users),
--             moments_feed (moments, moment_comments).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Report vocabulary — product buckets on top of the M21 set
-- ---------------------------------------------------------------------------
-- The CHECK is widened in place. Dropping first (rather than trying to alter)
-- keeps this re-runnable and mirrors how M21 introduced the constraint.
alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports
  add constraint reports_category_check
  check (category in (
    'nudity','harassment','underage','spam',
    'abuse_text','explicit_media','indecent_live','other'
  ));

-- A report may now point at a bio, a profile photo, a whole chat session or a
-- Voice card, not just a single message/moment/comment/live frame.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports
  add constraint reports_target_type_check
  check (target_type in (
    'user','message','moment','comment','live','bio','photo','chat','voice'
  ));

-- The same vocabulary must be accepted by the restriction tables, or an
-- enforcement insert would be rejected by the very CHECK that describes it.
alter table public.bans drop constraint if exists bans_category_check;
alter table public.bans
  add constraint bans_category_check
  check (category in (
    'nudity','harassment','underage','spam',
    'abuse_text','explicit_media','indecent_live','other'
  ));

alter table public.suspensions drop constraint if exists suspensions_category_check;
alter table public.suspensions
  add constraint suspensions_category_check
  check (category in (
    'nudity','harassment','underage','spam',
    'abuse_text','explicit_media','indecent_live','other'
  ));

alter table public.moderation_warnings drop constraint if exists moderation_warnings_category_check;
alter table public.moderation_warnings
  add constraint moderation_warnings_category_check
  check (category in (
    'nudity','harassment','underage','spam',
    'abuse_text','explicit_media','indecent_live','other'
  ));

-- The vision worker needs to know what it is looking at. A reported chat image
-- and a reported voice card are new kinds of job.
alter table public.moderation_ai_scans drop constraint if exists moderation_ai_scans_content_type_check;
alter table public.moderation_ai_scans
  add constraint moderation_ai_scans_content_type_check
  check (content_type in (
    'message','moment_caption','comment','bio','profile_photo','live_snapshot',
    'chat_media','voice'
  ));

-- ---------------------------------------------------------------------------
-- 2. moderation_settings — the tier durations are policy, not code
-- ---------------------------------------------------------------------------
alter table public.moderation_settings
  add column if not exists abuse_text_suspension_days    integer not null default 7  check (abuse_text_suspension_days >= 1);
alter table public.moderation_settings
  add column if not exists explicit_media_suspension_days integer not null default 15 check (explicit_media_suspension_days >= 1);
alter table public.moderation_settings
  add column if not exists indecent_live_suspension_days  integer not null default 30 check (indecent_live_suspension_days >= 1);
alter table public.moderation_settings
  add column if not exists other_suspension_days          integer not null default 7  check (other_suspension_days >= 1);

-- A single place that turns a category into its account-pause length. Legacy
-- M21 categories fold into the closest product tier so replayed history keeps
-- a sensible duration.
create or replace function public.moderation_suspension_days(p_category text)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cfg record;
  days integer;
begin
  select * into cfg from public.moderation_settings where id;
  if not found then
    return 7;
  end if;

  days := case p_category
    when 'abuse_text'     then cfg.abuse_text_suspension_days
    when 'harassment'     then cfg.abuse_text_suspension_days
    when 'explicit_media' then cfg.explicit_media_suspension_days
    when 'nudity'         then cfg.explicit_media_suspension_days
    when 'indecent_live'  then cfg.indecent_live_suspension_days
    when 'underage'       then cfg.underage_suspension_days
    when 'spam'           then cfg.other_suspension_days
    else                       cfg.other_suspension_days
  end;

  return coalesce(days, 7);
end;
$$;

revoke all on function public.moderation_suspension_days(text) from public, anon;
grant execute on function public.moderation_suspension_days(text) to authenticated;

-- A short human phrase used in warning copy, so the message explains the tier.
create or replace function public.moderation_category_phrase(p_category text)
returns text
language sql
immutable
as $$
  select case p_category
    when 'abuse_text'                       then 'abusive language'
    when 'harassment'                       then 'abusive language or harassment'
    when 'explicit_media'                   then 'sending explicit images'
    when 'nudity'                           then 'sending explicit images'
    when 'indecent_live'                    then 'indecent behaviour on Mettivo Live or Voice'
    when 'underage'                         then 'a safety review'
    when 'spam'                             then 'spam or a fake profile'
    else                                         'breaking our community rules'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. apply_moderation_action() — now always an account-wide pause
-- ---------------------------------------------------------------------------
-- Signature is unchanged so every existing caller (thresholds, AI, moderator)
-- keeps working. The `p_scope` argument is still validated, but the action is
-- recorded as an ACCOUNT suspension: the product no longer has chat-only or
-- video-only punishment. A warning still carries the scope the caller claimed,
-- which keeps the moderator audit trail legible.
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
  if p_scope not in ('chat','video','account') then
    raise exception 'Invalid scope: %', p_scope using errcode = '22023';
  end if;
  if p_source not in ('auto_threshold','ai','moderator') then
    raise exception 'Invalid source: %', p_source using errcode = '22023';
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

revoke all on function public.apply_moderation_action(uuid, text, text, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. evaluate_report_thresholds() — collective reports, one account pause
-- ---------------------------------------------------------------------------
-- Counts DISTINCT reporters inside the rolling window, grouped into the three
-- product tiers. The most serious tier that has crossed its threshold wins, so
-- a nudity report can never be "downgraded" by a pile of text reports. Underage
-- still needs an AI verdict (or the operator turning that requirement off),
-- because a bare accusation must not destroy an account.
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
-- 5. Moderator resolution — actioning a report still pauses the account
-- ---------------------------------------------------------------------------
create or replace function public.action_report_on_actioned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src      text;
  category text;
begin
  begin
    if new.status = 'actioned' and old.status is distinct from 'actioned' then
      src := case when coalesce(new.ai_flagged, false) then 'ai' else 'auto_threshold' end;
      -- Legacy categories are accepted by the map; anything unknown folds into
      -- the general 7-day tier rather than being silently dropped.
      category := case
        when new.category in ('abuse_text','explicit_media','indecent_live','other') then new.category
        when new.category = 'nudity'      then 'explicit_media'
        when new.category = 'harassment'  then 'abuse_text'
        when new.category = 'spam'        then 'other'
        when new.category = 'underage'    then 'underage'
        else 'other'
      end;

      if not exists (
        select 1 from public.suspensions s
        where s.user_id = new.reported_user_id and s.active and s.ends_at > now()
      ) then
        perform public.apply_moderation_action(
          new.reported_user_id, category, 'account', src,
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
-- 6. file_report() — accept the new categories and targets
-- ---------------------------------------------------------------------------
-- The body is M21's, with two changes: the category/target vocabularies are
-- widened, and a media report carries its image straight into the AI queue as a
-- `chat_media` job instead of masquerading as a live snapshot.
create or replace function public.file_report(
  p_target_user    uuid,
  p_category       text,
  p_target_type    text default 'user',
  p_target_id      uuid default null,
  p_details        text default null,
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
  scan_type   text := 'live_snapshot';
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
  if p_category not in ('nudity','harassment','underage','spam',
                        'abuse_text','explicit_media','indecent_live','other') then
    raise exception 'Invalid category: %', p_category using errcode = '22023';
  end if;
  if p_target_type not in ('user','message','moment','comment','live','bio','photo','chat','voice') then
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
  elsif p_target_type = 'bio' then
    select p.bio into context_txt from public.profiles p
     where p.id = p_target_user;
  end if;

  -- A reported image is a vision job for the offender's own content. The target
  -- decides how the worker looks at it: a live frame is a live snapshot, an
  -- image posted elsewhere is treated as chat media.
  if p_target_type = 'live' then
    scan_type := 'live_snapshot';
  elsif p_category in ('nudity','explicit_media') then
    scan_type := 'chat_media';
  end if;

  insert into public.reports (
    reporter_id, reported_user_id, reason, details, category,
    target_type, target_id, context, evidence_image
  )
  values (
    me, p_target_user,
    case p_category
      when 'spam'          then 'fake_profile'
      when 'nudity'        then 'inappropriate'
      when 'explicit_media' then 'inappropriate'
      when 'underage'      then 'underage'
      when 'indecent_live' then 'inappropriate'
      when 'abuse_text'    then 'harassment'
      when 'other'         then 'other'
      else 'harassment'
    end,
    nullif(btrim(coalesce(p_details, '')), ''),
    p_category, p_target_type, p_target_id, context_txt, p_evidence_image
  )
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

  if p_evidence_image is not null then
    insert into public.moderation_ai_scans (user_id, content_type, content_id, content_url, report_id)
    values (p_target_user, scan_type, p_target_id, p_evidence_image, report_id);
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
-- 7. record_ai_scan() — a verdict enforces ONLY when a member reported it
-- ---------------------------------------------------------------------------
-- This is the product's central safety decision: automated review is a TOOL
-- that supports a report, not a judge that acts unprompted. A flagged scan with
-- no `report_id` is recorded and left for a moderator; nothing happens to the
-- member. A flagged scan linked to a report pauses the offender's account for
-- the tier that matches what was found.
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
  scan     record;
  category text;
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

  if not coalesce(p_flagged, false) then
    return jsonb_build_object('ok', true, 'flagged', false);
  end if;

  -- Report-linked verdict: mark the report and enforce.
  if scan.report_id is not null then
    update public.reports
       set ai_flagged = true, ai_score = p_score, updated_at = now()
     where id = scan.report_id;

    category := case
      when scan.content_type in ('profile_photo','chat_media') then 'explicit_media'
      when scan.content_type in ('live_snapshot','voice')      then 'indecent_live'
      else 'abuse_text'
    end;

    perform public.apply_moderation_action(
      scan.user_id, category, 'account', 'ai',
      scan.report_id, scan.id, 'Automated review of reported content', null);

    return jsonb_build_object('ok', true, 'flagged', true, 'action', 'account', 'category', category);
  end if;

  -- Flagged but unreported: log only. No enforcement, no warning, no email.
  return jsonb_build_object('ok', true, 'flagged', true, 'action', 'logged');
end;
$$;

revoke all on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text) from public, anon;
grant execute on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Posting gates — a paused account cannot post to Moments
-- ---------------------------------------------------------------------------
-- Chat already has its own BEFORE INSERT trigger from M21; M25 only updates the
-- wording, since the punishment is now a whole-account pause, not a mute.
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
    raise exception 'Your account is paused and you cannot send messages right now.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Moments and their comments need the same wall, because they are a second
-- public surface a restricted member would otherwise still reach. `auth.uid()`
-- is null for the definer (worker/system) path, which is exactly when the gate
-- stands down.
create or replace function public.enforce_moderation_posting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.is_chat_restricted(new.author_id) then
    raise exception 'Your account is paused and you cannot post right now.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_moderation_posting_moments_trg on public.moments;
create trigger enforce_moderation_posting_moments_trg
  before insert on public.moments
  for each row execute function public.enforce_moderation_posting();

drop trigger if exists enforce_moderation_posting_comments_trg on public.moment_comments;
create trigger enforce_moderation_posting_comments_trg
  before insert on public.moment_comments
  for each row execute function public.enforce_moderation_posting();

-- ---------------------------------------------------------------------------
-- 9. chat_media — one row per disappearing / view-once item
-- ---------------------------------------------------------------------------
-- The bytes live in a PRIVATE Storage bucket; this table is the ledger that
-- decides who may read them and whether the item is still alive. The row is
-- written only by `send_chat_media()`, so a client cannot forge a match_id,
-- a sender, or an expiry.
create table if not exists public.chat_media (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null,
  match_id     uuid not null references public.matches(id) on delete cascade,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  media_type   text not null default 'image' check (media_type in ('image','video')),
  view_once    boolean not null default false,
  expires_at   timestamptz not null default (now() + interval '1 day'),
  viewed_at    timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists chat_media_message_idx on public.chat_media (message_id);
create index if not exists chat_media_match_idx   on public.chat_media (match_id, created_at desc);
create index if not exists chat_media_sender_idx  on public.chat_media (sender_id);

-- Is `p_user` one of the two members of match `p_match`? Declared before the
-- policies that reference it, because Postgres resolves policy function calls
-- at CREATE POLICY time.
create or replace function public.chat_media_participant(p_match uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.matches m
    where m.id = p_match
      and (m.user_a = p_user or m.user_b = p_user)
  );
$$;

revoke all on function public.chat_media_participant(uuid, uuid) from public, anon;
grant execute on function public.chat_media_participant(uuid, uuid) to authenticated;

alter table public.chat_media enable row level security;

-- Participants may READ the ledger for their own conversations. There is no
-- INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER functions below write.
drop policy if exists "chat_media_select_participant" on public.chat_media;
create policy "chat_media_select_participant"
  on public.chat_media for select to authenticated
  using (public.chat_media_participant(match_id, auth.uid()));

grant select on public.chat_media to authenticated;

-- ---------------------------------------------------------------------------
-- 10. chat_media bucket policies
-- ---------------------------------------------------------------------------
-- Readability of a stored object, keyed by its path. Looks up the ledger row so
-- view-once and expiry are decided from data, not from the caller's claim.
-- Declared BEFORE the storage policies, which reference it by name.
create or replace function public.chat_media_can_read_storage(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.chat_media cm
    where cm.storage_path = p_name
      and public.chat_media_participant(cm.match_id, auth.uid())
      and (
        cm.sender_id = auth.uid()
        or (
          cm.expires_at > now()
          and (
            cm.view_once = false
            or cm.viewed_at is null
            -- A short grace window lets the recipient actually fetch bytes
            -- after `redeem_chat_media()` has burned the view.
            or cm.viewed_at > now() - interval '2 minutes'
          )
        )
      )
  );
$$;

revoke all on function public.chat_media_can_read_storage(text) from public, anon;
grant execute on function public.chat_media_can_read_storage(text) to authenticated;

-- Storage policies are written in dynamic SQL inside a schema guard, because
-- the PGlite harness does not model Supabase's `storage` schema (M20 set the
-- precedent). In production the bucket and its policies ship with the migration.
do $storage$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute $b$
      insert into storage.buckets (id, name, public)
      values ('chat-media', 'chat-media', false)
      on conflict (id) do nothing
    $b$;

    -- A sender may upload only into their own conversation folder, and only
    -- while they are not paused. Path shape: {match_id}/{sender_id}/{token}.
    execute $p$drop policy if exists "chat_media_upload_participant" on storage.objects$p$;
    execute $p$
      create policy "chat_media_upload_participant"
        on storage.objects for insert to authenticated
        with check (
          bucket_id = 'chat-media'
          and (storage.foldername(name))[2] = auth.uid()::text
          and public.chat_media_participant(((storage.foldername(name))[1])::uuid, auth.uid())
          and not public.is_chat_restricted(auth.uid())
        )
    $p$;

    -- Either participant may read, but a view-once item is readable only while
    -- unseen, and any item is unreadable once it has expired.
    execute $p$drop policy if exists "chat_media_read_participant" on storage.objects$p$;
    execute $p$
      create policy "chat_media_read_participant"
        on storage.objects for select to authenticated
        using (
          bucket_id = 'chat-media'
          and public.chat_media_can_read_storage(name)
        )
    $p$;

    raise notice 'chat-media storage bucket ready';
  else
    raise notice 'storage schema not found - create the chat-media bucket in the dashboard';
  end if;
end $storage$;

-- ---------------------------------------------------------------------------
-- 11. send_chat_media() — the only writer of a media message
-- ---------------------------------------------------------------------------
-- Writes the `messages` row (so the thread's realtime channel and unread counts
-- keep working unchanged) and the `chat_media` ledger row in one transaction.
create or replace function public.send_chat_media(
  p_match_id     uuid,
  p_storage_path text,
  p_media_type   text default 'image',
  p_view_once    boolean default false,
  p_ttl_seconds  integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := auth.uid();
  msg_id   uuid;
  media_id uuid;
  ttl      integer;
  expires  timestamptz;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.chat_media_participant(p_match_id, me) then
    raise exception 'You are not part of this conversation' using errcode = '42501';
  end if;
  if public.is_chat_restricted(me) then
    raise exception 'Your account is paused and you cannot send media right now.' using errcode = '42501';
  end if;
  if p_media_type not in ('image','video') then
    raise exception 'Invalid media type: %', p_media_type using errcode = '22023';
  end if;
  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'Missing media path' using errcode = '22023';
  end if;

  -- Clamp the lifetime: at least a minute, at most a week.
  ttl := greatest(60, least(coalesce(p_ttl_seconds, 86400), 604800));
  expires := now() + make_interval(secs => ttl);

  insert into public.messages (match_id, sender_id, content)
  values (p_match_id, me, '')
  returning id into msg_id;

  insert into public.chat_media (message_id, match_id, sender_id, storage_path, media_type, view_once, expires_at)
  values (msg_id, p_match_id, me, p_storage_path, p_media_type, coalesce(p_view_once, false), expires)
  returning id into media_id;

  return jsonb_build_object(
    'media_id', media_id,
    'message_id', msg_id,
    'view_once', coalesce(p_view_once, false),
    'expires_at', expires
  );
end;
$$;

revoke all on function public.send_chat_media(uuid, text, text, boolean, integer) from public, anon;
grant execute on function public.send_chat_media(uuid, text, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. redeem_chat_media() — burns a view-once item exactly once
-- ---------------------------------------------------------------------------
-- Returns the path the recipient should now fetch (within the grace window the
-- storage policy allows) and stamps `viewed_at`. The sender redeems to obtain
-- the path without burning their own item.
create or replace function public.redeem_chat_media(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  cm record;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into cm from public.chat_media where id = p_media_id;
  if not found then
    raise exception 'Media not found' using errcode = 'P0002';
  end if;
  if not public.chat_media_participant(cm.match_id, me) then
    raise exception 'You are not part of this conversation' using errcode = '42501';
  end if;

  if cm.expires_at <= now() then
    return jsonb_build_object('available', false, 'reason', 'expired');
  end if;

  if cm.sender_id <> me and cm.view_once and cm.viewed_at is null then
    update public.chat_media set viewed_at = now() where id = cm.id;
  end if;

  return jsonb_build_object(
    'available', true,
    'storage_path', cm.storage_path,
    'media_type', cm.media_type,
    'view_once', cm.view_once,
    'expires_at', cm.expires_at
  );
end;
$$;

revoke all on function public.redeem_chat_media(uuid) from public, anon;
grant execute on function public.redeem_chat_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Comments for the new tables (onboarding doc for the next milestone)
-- ---------------------------------------------------------------------------
comment on table public.chat_media is
  'Disappearing / view-once chat media ledger (M25). Bytes live in the private chat-media bucket; written only by send_chat_media().';
comment on function public.redeem_chat_media(uuid) is
  'Burns a view-once item for the recipient and returns the storage path while it is still readable.';
comment on function public.moderation_suspension_days(text) is
  'Account-pause length for a violation category: abusive text 7, explicit media 15, indecent live 30 days (M25).';
comment on function public.record_ai_scan(text, uuid, boolean, numeric, jsonb, text, text, text) is
  'Records an AI verdict. Enforces an account pause only when the scan is linked to a user report (M25).';
