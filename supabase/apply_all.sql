-- =============================================================================
-- Mettivo — complete database bootstrap, in order.
-- =============================================================================
-- PASTE THIS ENTIRE FILE into the Supabase SQL Editor and press Run.
-- Then press Run a SECOND time to prove idempotency (it must be a no-op).
--
-- GENERATED FILE — do not edit by hand. `supabase/migrations/` is authoritative.
-- Regenerate with: npm run build:apply-all
--
-- Verified by tests/database/apply_all.test.ts: applies cleanly in one pass,
-- re-applies as a no-op, and leaves every personal-data table unreadable by
-- an anonymous caller.
-- =============================================================================

-- ############################################################################
-- # 20261015120000_m6_profiles_rls_lockdown.sql
-- ############################################################################

-- =============================================================================
-- M6 · Step 1 of 3 — Lock down public.profiles
-- =============================================================================
-- WHY: an unauthenticated request carrying only the public anon key could read
-- real profile rows, including birth_date, city, politics, religion, photos and
-- is_online. With no application server, RLS is the ONLY authorisation boundary,
-- so this was a live data leak.
--
-- WHAT THIS DOES
--   1. Enables RLS on public.profiles.
--   2. Removes EVERY existing policy on the table, whatever it is called, so a
--      permissive `public`/`anon` policy cannot silently survive.
--   3. Recreates a minimal, explicit policy set:
--        SELECT  -> any signed-in user (discovery needs to browse profiles)
--        INSERT  -> owner only            (WITH CHECK, never USING)
--        UPDATE  -> owner only
--        DELETE  -> owner only
--
-- SAFE TO RE-RUN: the policy drop is dynamic and unconditional, so applying this
-- file twice converges on exactly the same state.
--
-- VERIFY AFTER APPLYING:  ./scripts/verify-rls.sh   (profiles must report 0 rows)
-- =============================================================================

begin;

alter table public.profiles enable row level security;

-- Remove every existing policy on profiles (names are unknown, so enumerate).
do $$
declare
  pol record;
  dropped integer := 0;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', pol.policyname);
    dropped := dropped + 1;
    raise notice 'M6: dropped existing policy % on public.profiles', pol.policyname;
  end loop;

  if dropped = 0 then
    raise notice 'M6: no existing policies on public.profiles';
  end if;
end $$;

-- A signed-in user may browse profiles. Anonymous callers match no policy and
-- therefore receive zero rows (PostgreSQL default-deny once RLS is enabled).
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() is not null);

-- Owners may create their own profile row (first-time onboarding).
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Owners may edit their own profile. USING gates which row is targeted;
-- WITH CHECK gates the resulting row, so `id` cannot be reassigned to another user.
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Owners may delete their own profile (required by M15 account deletion).
create policy "profiles_delete_own"
  on public.profiles
  for delete
  to authenticated
  using (auth.uid() = id);

comment on table public.profiles is
  'User profiles. RLS: authenticated users may read; only the owner may write.';

commit;


-- ############################################################################
-- # 20261015120100_m6_enable_rls_all_tables.sql
-- ############################################################################

-- =============================================================================
-- M6 · Step 2 of 3 — Ensure RLS is enabled on every personal-data table
-- =============================================================================
-- WHY: RLS must be ON for every table holding personal data. A table with RLS
-- disabled is fully exposed through the public anon key.
--
-- ---------------------------------------------------------------------------
-- IMPORTANT — why this file installs more than a SELECT policy
-- ---------------------------------------------------------------------------
-- The first version of this migration enabled RLS and, for any table with no
-- policies, installed a SELECT-ONLY baseline. That silently made `messages` and
-- `follows` READ-ONLY: with RLS on and no INSERT policy, PostgreSQL rejects every
-- insert, so the chat and follow features were dead on a fresh database. The
-- test suite (tests/database/migrations.test.ts) caught this.
--
-- A baseline now covers the operations each table actually needs, scoped to the
-- caller, and it is still only installed when a table has ZERO policies so that
-- no existing, deliberately-tuned policy is ever weakened.
--
-- `matches` is deliberately absent: it does not exist yet at this point in the
-- migration order, and the M10 migration installs its participant policy.
-- ---------------------------------------------------------------------------

do $$
declare
  spec           record;
  has_policies   boolean;
  rls_on         boolean;
begin
  for spec in
    select * from (values
      -- table,           select expression,                                              insert check,                delete using
      ('profiles',        'auth.uid() is not null',
                          'auth.uid() = id',
                          'auth.uid() = id'),
      ('messages',        'auth.uid() is not null',
                          'auth.uid() = sender_id',
                          null::text),
      ('follows',         'auth.uid() is not null',
                          'auth.uid() = follower_id',
                          'auth.uid() = follower_id'),
      ('blocked_users',   'auth.uid() is not null',
                          'auth.uid() = blocker_id',
                          'auth.uid() = blocker_id'),
      ('reports',         'auth.uid() = reporter_id or auth.uid() = reported_user_id',
                          'auth.uid() = reporter_id',
                          null::text)
    ) as t(tbl, select_expr, insert_expr, delete_expr)
  loop
    -- Skip tables that do not exist yet.
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = spec.tbl and c.relkind = 'r'
    ) then
      raise notice 'M6: public.% does not exist yet - skipped', spec.tbl;
      continue;
    end if;

    -- Already-enabled RLS is fine; this only ever turns it on.
    select c.relrowsecurity into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = spec.tbl;

    if rls_on is distinct from true then
      execute format('alter table public.%I enable row level security', spec.tbl);
      raise notice 'M6: RLS ENABLED on public.%', spec.tbl;
    end if;

    select count(*) > 0 into has_policies
    from pg_policies
    where schemaname = 'public' and tablename = spec.tbl;

    if has_policies then
      raise notice 'M6: public.% already has policies - left untouched', spec.tbl;
      continue;
    end if;

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      spec.tbl || '_select_authenticated', spec.tbl, spec.select_expr
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      spec.tbl || '_insert_own', spec.tbl, spec.insert_expr
    );

    if spec.delete_expr is not null then
      execute format(
        'create policy %I on public.%I for delete to authenticated using (%s)',
        spec.tbl || '_delete_own', spec.tbl, spec.delete_expr
      );
    end if;

    raise notice 'M6: installed baseline policies on public.% (had none)', spec.tbl;
  end loop;
end $$;

-- Report the resulting posture so the SQL editor output doubles as evidence.
select
  c.relname                              as table_name,
  c.relrowsecurity                       as rls_enabled,
  count(p.policyname)                    as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
       on p.schemaname = 'public'
      and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('profiles','messages','follows','matches','reports','blocked_users')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015120200_m6_public_profiles_view.sql
-- ############################################################################

-- =============================================================================
-- M6 · Step 3 of 3 — Safe public projection of profiles (no birth_date)
-- =============================================================================
-- WHY: `profiles` now allows any signed-in user to read rows (discovery needs
-- it), but a `select *` still exposes birth_date, politics and religion to every
-- other member. This view is the allow-listed projection that public surfaces
-- should read from.
--
-- COLUMN ALLOW-LIST, NOT `SELECT *`.
--   Every column below was verified to exist on the live table. Anything added
--   to `profiles` in future is NOT exposed here until it is deliberately added —
--   new columns are private by default, which is the correct default.
--
-- DELIBERATELY EXCLUDED:
--   birth_date  -> exact dates of birth enable identity theft and are never
--                  needed to render a profile. Display the derived `age` instead.
--   followers / following / friends (raw arrays) and their *_count denormalised
--                  duplicates -> not needed by any public surface today.
--
-- NOTE ON RIGHTS: this view is created without `security_invoker`, so it reads
-- with the view owner's rights and is therefore *not* filtered by the RLS policy
-- on `profiles`. Row filtering is intentional (a discovery feed must see other
-- members); the protection here is column-level, and access is restricted to the
-- `authenticated` role with `anon` explicitly revoked.
--
-- SAFE TO RE-RUN: the view is DROPPED and recreated rather than `create or
-- replace`d. `create or replace view` may only append columns, so once a later
-- migration (M18) widened the projection this definition could no longer be
-- re-applied against it — and re-running `apply_all.sql` as a no-op is a tested
-- property that failed exactly that way. Nothing depends on the view
-- structurally, so a drop is safe.
-- =============================================================================

drop view if exists public.public_profiles;

create view public.public_profiles as
select
  id,
  display_name,
  age,
  gender,
  city,
  country,
  avatar_url,
  photos,
  bio,
  intention,
  looking_for,
  hobbies,
  pets,
  personality,
  religion,
  politics,
  drinking,
  smoking,
  interests,
  prompts,
  is_online,
  is_verified,
  onboarding_completed,
  updated_at
from public.profiles;

comment on view public.public_profiles is
  'Allow-listed public projection of profiles. Excludes birth_date and other private fields. Read this from discovery-style surfaces instead of public.profiles.';

-- Only signed-in members may read the projection.
grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- =============================================================================
-- FOLLOW-UP (tracked, requires a UI change — do NOT apply until then)
-- -----------------------------------------------------------------------------
-- Once src/app/profile/dashboard/page.tsx stops formatting `birth_date` and
-- renders the stored `age` column instead, the exact date of birth can be
-- removed from the API surface entirely:
--
--   revoke select (birth_date) on public.profiles from authenticated, anon;
--
-- That statement is intentionally commented out: the dashboard still reads
-- birth_date for the current user, so revoking it now would break that page.
--
-- Similarly, point discovery at this view (`from('public_profiles')`) instead of
-- `from('profiles')` with `select('*')` to guarantee private columns never leave
-- the database. That edit belongs to the discovery/matching milestone.
-- =============================================================================


-- ############################################################################
-- # 20261015130000_m10_likes_and_mutual_matching.sql
-- ############################################################################

-- =============================================================================
-- M10 · Discovery and mutual matching
-- =============================================================================
-- Adds the `likes` table (like / pass), normalises `matches`, and installs a
-- single race-safe entry point for recording a like and creating a match.
--
-- WHY A DATABASE FUNCTION
--   A "read partner's like, then insert a match" flow implemented in the browser
--   races: if both users like each other at the same moment, each client can read
--   before the other has written, and the match is never created. Doing it in one
--   transaction removes the race entirely.
--
-- WHY MATCHES HAVE NO INSERT POLICY
--   Deliberately omitted. Matches can only be created by `record_like`, which is
--   SECURITY DEFINER. Clients therefore cannot forge a match with someone who
--   never liked them back.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. likes — one row per (liker, target) pair, is_like=false means "pass"
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  id         uuid        primary key default gen_random_uuid(),
  liker_id   uuid        not null references auth.users(id) on delete cascade,
  liked_id   uuid        not null references auth.users(id) on delete cascade,
  is_like    boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (liker_id, liked_id),
  constraint likes_no_self_like check (liker_id <> liked_id)
);

create index if not exists likes_liker_id_idx on public.likes (liker_id);
create index if not exists likes_liked_id_like_idx on public.likes (liked_id) where is_like;

alter table public.likes enable row level security;

drop policy if exists "likes_insert_own" on public.likes;
create policy "likes_insert_own"
  on public.likes for insert to authenticated
  with check (auth.uid() = liker_id);          -- WITH CHECK, never USING

drop policy if exists "likes_select_involved" on public.likes;
create policy "likes_select_involved"
  on public.likes for select to authenticated
  using (auth.uid() = liker_id or auth.uid() = liked_id);

drop policy if exists "likes_update_own" on public.likes;
create policy "likes_update_own"
  on public.likes for update to authenticated
  using (auth.uid() = liker_id)
  with check (auth.uid() = liker_id);

drop policy if exists "likes_delete_own" on public.likes;
create policy "likes_delete_own"
  on public.likes for delete to authenticated
  using (auth.uid() = liker_id);

-- ---------------------------------------------------------------------------
-- 2. matches — normalise to a canonical, order-independent pair
-- ---------------------------------------------------------------------------
create table if not exists public.matches (
  id         uuid        primary key default gen_random_uuid(),
  user_a     uuid        not null references auth.users(id) on delete cascade,
  user_b     uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Add columns an older `matches` table may be missing. `if not exists` makes
-- this a no-op on a table that already has them.
alter table public.matches add column if not exists user_a     uuid;
alter table public.matches add column if not exists user_b     uuid;
alter table public.matches add column if not exists created_at timestamptz not null default now();

-- Exactly one row per pair, whichever direction the like came from.
create unique index if not exists matches_user_pair_key
  on public.matches (user_a, user_b);

alter table public.matches enable row level security;

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- No INSERT/UPDATE/DELETE policy on purpose: only `record_like` may write.

-- ---------------------------------------------------------------------------
-- 3. record_like — atomic like/pass + mutual match creation
-- ---------------------------------------------------------------------------
-- Returns: { liked, matched, match_id, matched_user_id }
-- Raises SQLSTATE 28000 when the caller has no session, 22023 on bad input.
-- ---------------------------------------------------------------------------
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

  -- Idempotent: re-liking the same person updates rather than erroring.
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

  -- Canonical ordering keeps the unique index meaningful in both directions.
  -- `do nothing` + `select` is used rather than `do update ... returning`
  -- because RETURNING yields no row when the conflict is skipped.
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

revoke all on function public.record_like(uuid, boolean) from public, anon;
grant execute on function public.record_like(uuid, boolean) to authenticated;

-- Table-level privileges, stated explicitly rather than relying on Supabase's
-- default privileges, so this migration is self-sufficient on any project.
-- RLS is layered on top of these grants and remains the real gate.
grant select, insert, update, delete on public.likes to authenticated;
grant select on public.matches to authenticated;

revoke all on public.likes from anon;
revoke all on public.matches from anon;

comment on function public.record_like(uuid, boolean) is
  'Records a like/pass and creates a match when the interest is mutual. SECURITY DEFINER so clients cannot forge matches.';
comment on table public.likes is
  'Like/pass decisions. RLS: users read only their own outgoing and incoming rows.';
comment on table public.matches is
  'Mutual matches, stored as a canonically ordered unordered pair. Written only by record_like().';

-- Report the resulting posture.
select
  c.relname                    as table_name,
  c.relrowsecurity             as rls_enabled,
  count(p.policyname)          as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('likes','matches')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015140000_m14_admin_and_abuse_controls.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015150000_m15_privacy_deletion_and_legal.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015160000_notifications_realtime.sql
-- ############################################################################

-- =============================================================================
-- Notifications · realtime backend
-- =============================================================================
-- Gives the owner's Notifications navigation button (MobileNav -> /notifications)
-- a real backend: a `notifications` table, RLS, automatic generation from the
-- events that already happen in the app, and Realtime publication so the list
-- updates live.
--
-- KEY SAFETY PROPERTY
--   Notification generation must NEVER break the action that caused it. Every
--   trigger body is wrapped in an exception block that swallows errors and
--   returns NEW, so a failure to notify can never roll back a like, a message,
--   a follow or a match.
--
-- WHERE NOTIFICATIONS COME FROM (existing app events)
--   likes    insert  -> "liked you"
--   matches  insert  -> "it's a match" (both directions)
--   messages insert  -> "sent you a message" (recipient of the match)
--   follows  insert  -> "started following you"
--   reports  update  -> status changed to 'actioned', tells the reporter
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. notifications table
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  -- Recipient. Cascades on account deletion (M15).
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Who caused it. Cascades too, so a deleted member leaves no orphan rows.
  actor_id   uuid references auth.users(id) on delete cascade,
  type       text not null
             constraint notifications_type_check
             check (type in ('follow','like','match','message','visitor','report')),
  -- Match id, message id, report id... depending on type.
  entity_id  uuid,
  read_at    timestamptz,
  created_at timestamptz not null default now(),

  constraint notifications_no_self_actor check (actor_id is null or actor_id <> user_id)
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS — a member sees and manages only their own notifications
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete to authenticated
  using (auth.uid() = user_id);

-- No INSERT policy: rows are created only by the SECURITY DEFINER triggers
-- below, so a client cannot fabricate a notification for another member.

grant select, update, delete on public.notifications to authenticated;
revoke all on public.notifications from anon;

-- ---------------------------------------------------------------------------
-- 3. Generation triggers
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.is_like and new.liker_id <> new.liked_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.liked_id, new.liker_id, 'like', new.id);
    end if;
  exception when others then
    -- Never block the like itself.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_like_trg on public.likes;
create trigger notify_on_like_trg
  after insert on public.likes
  for each row execute function public.notify_on_like();

create or replace function public.notify_on_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.notifications (user_id, actor_id, type, entity_id)
    values (new.user_a, new.user_b, 'match', new.id),
           (new.user_b, new.user_a, 'match', new.id);
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_match_trg on public.matches;
create trigger notify_on_match_trg
  after insert on public.matches
  for each row execute function public.notify_on_match();

create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  begin
    -- `messages.match_id` is text while `matches.id` is uuid, so compare as text.
    -- A malformed value simply matches nothing and yields no notification.
    select case when m.user_a = new.sender_id then m.user_b else m.user_a end
      into recipient
    from public.matches m
    -- Both sides cast to text: `messages.match_id` is `uuid` on the live project
    -- and `text` in some rebuilt environments. A one-sided cast raises
    -- "operator does not exist: text = uuid" the first time a message is sent.
    where m.id::text = new.match_id::text
    limit 1;

    if recipient is not null and recipient <> new.sender_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (recipient, new.sender_id, 'message', new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_message_trg on public.messages;
create trigger notify_on_message_trg
  after insert on public.messages
  for each row execute function public.notify_on_message();

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.follower_id <> new.following_id then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.following_id, new.follower_id, 'follow', null);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_follow_trg on public.follows;
create trigger notify_on_follow_trg
  after insert on public.follows
  for each row execute function public.notify_on_follow();

create or replace function public.notify_on_report_actioned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if new.status = 'actioned' and (old.status is distinct from 'actioned') then
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (new.reporter_id, null, 'report', new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists notify_on_report_actioned_trg on public.reports;
create trigger notify_on_report_actioned_trg
  after update on public.reports
  for each row execute function public.notify_on_report_actioned();

-- ---------------------------------------------------------------------------
-- 4. Realtime — stream inserts to the signed-in member
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
      raise notice 'notifications added to supabase_realtime';
    else
      raise notice 'notifications already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for notifications in the dashboard';
  end if;
end $$;

comment on table public.notifications is
  'Per-member notification feed. Rows are generated by SECURITY DEFINER triggers; clients may only read, mark read and delete their own.';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'notifications'
group by c.relname, c.relrowsecurity;


-- ############################################################################
-- # 20261015170000_moments_feed.sql
-- ############################################################################

-- =============================================================================
-- Moments · real activity feed
-- =============================================================================
-- Gives the owner's Moments navigation button (MobileNav -> /moments) a real
-- backend: posts, likes, comments, shares, an aggregated feed view, Realtime,
-- and automatic reuse of the M14 abuse controls (suspension + rate limiting).
--
-- TABLES
--   moments          one row per post (caption + media array + tags + shares)
--   moment_likes     who liked which post   (PK prevents double-liking)
--   moment_comments  threaded-free comments on a post
--
-- FEED VIEW
--   public.moment_feed returns each post already joined with like_count,
--   comment_count and a per-caller liked_by_me flag, so the client makes ONE
--   request instead of four and cannot miscount.
--
-- SAFE TO RE-RUN: idempotent. Statements that depend on M14 are guarded, so this
-- file also applies cleanly on a project where M14 has not been run yet.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments
-- ---------------------------------------------------------------------------
create table if not exists public.moments (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users(id) on delete cascade,
  caption     text,
  media       text[] not null default '{}',
  tags        text[] not null default '{}',
  shares      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint moments_caption_len check (caption is null or char_length(caption) <= 2000),
  constraint moments_media_max   check (array_length(media, 1) is null or array_length(media, 1) <= 4),
  constraint moments_tags_max    check (array_length(tags, 1) is null or array_length(tags, 1) <= 6),
  constraint moments_shares_pos  check (shares >= 0)
);

create index if not exists moments_created_idx on public.moments (created_at desc);
create index if not exists moments_author_idx  on public.moments (author_id);

-- ---------------------------------------------------------------------------
-- 2. moment_likes — composite PK makes double-liking impossible
-- ---------------------------------------------------------------------------
create table if not exists public.moment_likes (
  moment_id  uuid not null references public.moments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (moment_id, user_id)
);

create index if not exists moment_likes_user_idx on public.moment_likes (user_id);

-- ---------------------------------------------------------------------------
-- 3. moment_comments
-- ---------------------------------------------------------------------------
create table if not exists public.moment_comments (
  id         uuid primary key default gen_random_uuid(),
  moment_id  uuid not null references public.moments(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint moment_comments_body_len check (char_length(body) between 1 and 1000)
);

create index if not exists moment_comments_moment_idx on public.moment_comments (moment_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.moments         enable row level security;
alter table public.moment_likes    enable row level security;
alter table public.moment_comments enable row level security;

-- Feed is visible to every signed-in member, never to anonymous callers.
drop policy if exists "moments_select_authenticated" on public.moments;
create policy "moments_select_authenticated"
  on public.moments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moments_insert_own" on public.moments;
create policy "moments_insert_own"
  on public.moments for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "moments_update_own" on public.moments;
create policy "moments_update_own"
  on public.moments for update to authenticated
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "moments_delete_own" on public.moments;
create policy "moments_delete_own"
  on public.moments for delete to authenticated
  using (auth.uid() = author_id);

-- Likes: everyone can see them (needed for counts), only the owner can add/remove.
drop policy if exists "moment_likes_select_all" on public.moment_likes;
create policy "moment_likes_select_all"
  on public.moment_likes for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moment_likes_insert_own" on public.moment_likes;
create policy "moment_likes_insert_own"
  on public.moment_likes for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "moment_likes_delete_own" on public.moment_likes;
create policy "moment_likes_delete_own"
  on public.moment_likes for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "moment_comments_select_all" on public.moment_comments;
create policy "moment_comments_select_all"
  on public.moment_comments for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "moment_comments_insert_own" on public.moment_comments;
create policy "moment_comments_insert_own"
  on public.moment_comments for insert to authenticated
  with check (auth.uid() = author_id);

drop policy if exists "moment_comments_delete_own" on public.moment_comments;
create policy "moment_comments_delete_own"
  on public.moment_comments for delete to authenticated
  using (auth.uid() = author_id);

grant select, insert, update, delete on public.moments         to authenticated;
grant select, insert, delete         on public.moment_likes    to authenticated;
grant select, insert, delete         on public.moment_comments to authenticated;

revoke all on public.moments         from anon;
revoke all on public.moment_likes    from anon;
revoke all on public.moment_comments from anon;

-- ---------------------------------------------------------------------------
-- 5. moment_feed — one request, correct counts
-- ---------------------------------------------------------------------------
-- NOTE ON RIGHTS: this view is created with the owner's rights (the PostgreSQL
-- default), so it is NOT filtered by the RLS policies above. That is safe today
-- because `moments_select_authenticated` already grants every signed-in member
-- read access to every post, so the view exposes nothing extra. If that policy
-- is ever tightened to a subset of posts, this view MUST be revisited (for
-- example by setting `security_invoker = true` on PostgreSQL 15+).
-- ---------------------------------------------------------------------------
drop view if exists public.moment_feed;

create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.tags,
  m.shares,
  m.created_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id;

comment on view public.moment_feed is
  'Moments with aggregated like/comment counts and a per-caller liked_by_me flag. Read this instead of the base table.';

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

-- ---------------------------------------------------------------------------
-- 6. share_moment() — server-side counter (the client cannot simply set it)
-- ---------------------------------------------------------------------------
create or replace function public.share_moment(p_moment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_shares integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
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
-- 7. Reuse the M14 abuse controls (suspension + rate limiting) for Moments
-- ---------------------------------------------------------------------------
do $$
begin
  -- Only if M14 has been applied.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_abuse_controls'
  ) then
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'rate_limit_rules' and c.relkind = 'r'
    ) then
      insert into public.rate_limit_rules (action, max_events, window_seconds, description)
      values ('moments', 10, 3600, 'Moments posted per hour')
      on conflict (action) do update
        set max_events     = excluded.max_events,
            window_seconds = excluded.window_seconds,
            description    = excluded.description;
    end if;

    drop trigger if exists enforce_abuse_controls_moments on public.moments;
    create trigger enforce_abuse_controls_moments
      before insert on public.moments
      for each row execute function public.enforce_abuse_controls();

    raise notice 'Moments wired into M14 abuse controls';
  else
    raise notice 'M14 abuse controls not installed - skipping (run the M14 migration for suspension + rate limiting)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Realtime — new moments appear without a refresh
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moments'
    ) then
      alter publication supabase_realtime add table public.moments;
      raise notice 'moments added to supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for moments in the dashboard';
  end if;
end $$;

comment on table public.moments is
  'Moments feed posts. RLS: readable by any signed-in member, writable only by the author.';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('moments','moment_likes','moment_comments')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015180000_game_zone.sql
-- ############################################################################

-- =============================================================================
-- Game Zone · playable games backend
-- =============================================================================
-- Gives the owner's Games navigation button (MobileNav -> /game-zone) real
-- playable routes backed by persistent results.
--
-- TABLES
--   game_catalog  the games that exist, and whether they are playable yet
--   game_results  append-only ledger of finished games, one row per game
--
-- TRUST MODEL
--   Results are written through `record_game_result()`, which validates the
--   game id against the catalogue and derives the user from auth.uid(). The
--   score is still client-reported — acceptable for casual social games, and
--   the honest limit of a client-authoritative design. Making it tamper-proof
--   means running each game's rules server-side, which is a later milestone.
--
-- SAFE TO RE-RUN: idempotent. M14-dependent statements are guarded.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. game_catalog
-- ---------------------------------------------------------------------------
create table if not exists public.game_catalog (
  game_id      text primary key,
  title        text not null,
  is_playable  boolean not null default false,
  max_score    integer,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

insert into public.game_catalog (game_id, title, is_playable, max_score, sort_order) values
  ('tic-tac-toe',  'Tic Tac Toe',   true,  10,   1),
  ('uno-lite',     'UNO',           true,  500,  2),
  ('ludo-royale',  'Ludo Royale',   false, null, 3),
  ('ludo-dash',    'Ludo Dash',     false, null, 4)
on conflict (game_id) do update
  set title       = excluded.title,
      is_playable = excluded.is_playable,
      max_score   = excluded.max_score,
      sort_order  = excluded.sort_order;

alter table public.game_catalog enable row level security;

drop policy if exists "game_catalog_readable" on public.game_catalog;
create policy "game_catalog_readable"
  on public.game_catalog for select to authenticated
  using (true);

grant select on public.game_catalog to authenticated;
revoke all on public.game_catalog from anon;

-- ---------------------------------------------------------------------------
-- 2. game_results — append-only ledger
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  game_id          text not null references public.game_catalog(game_id),
  outcome          text not null
                   constraint game_results_outcome_check
                   check (outcome in ('win','loss','draw')),
  score            integer not null default 0,
  duration_seconds integer,
  created_at       timestamptz not null default now(),

  constraint game_results_score_nonneg check (score >= 0),
  constraint game_results_duration_ok  check (duration_seconds is null or duration_seconds between 0 and 86400)
);

create index if not exists game_results_user_idx on public.game_results (user_id, created_at desc);
create index if not exists game_results_game_idx on public.game_results (game_id);

alter table public.game_results enable row level security;

drop policy if exists "game_results_select_own" on public.game_results;
create policy "game_results_select_own"
  on public.game_results for select to authenticated
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: writes go through the RPC below, so a member
-- cannot forge a row for somebody else or rewrite history.

grant select on public.game_results to authenticated;
revoke all on public.game_results from anon;

-- ---------------------------------------------------------------------------
-- 3. record_game_result()
-- ---------------------------------------------------------------------------
create or replace function public.record_game_result(
  p_game_id          text,
  p_outcome          text,
  p_score            integer default 0,
  p_duration_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := auth.uid();
  catalog  record;
  new_id   uuid;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_outcome not in ('win','loss','draw') then
    raise exception 'Invalid outcome: %', p_outcome using errcode = '22023';
  end if;

  select * into catalog from public.game_catalog where game_id = p_game_id;
  if not found then
    raise exception 'Unknown game: %', p_game_id using errcode = '22023';
  end if;

  if not catalog.is_playable then
    raise exception '% is not playable yet', catalog.title using errcode = '22023';
  end if;

  if p_score < 0 or (catalog.max_score is not null and p_score > catalog.max_score) then
    raise exception 'Score out of range for %', catalog.title using errcode = '22023';
  end if;

  insert into public.game_results (user_id, game_id, outcome, score, duration_seconds)
  values (me, p_game_id, p_outcome, coalesce(p_score, 0), p_duration_seconds)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'result_id', new_id, 'game_id', p_game_id, 'outcome', p_outcome);
end;
$$;

revoke all on function public.record_game_result(text, text, integer, integer) from public, anon;
grant execute on function public.record_game_result(text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reuse the M14 abuse controls (suspension + rate limiting)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_abuse_controls'
  ) and exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'rate_limit_rules' and c.relkind = 'r'
  ) then
    insert into public.rate_limit_rules (action, max_events, window_seconds, description)
    values ('game_results', 120, 3600, 'Games recorded per hour')
    on conflict (action) do update
      set max_events = excluded.max_events,
          window_seconds = excluded.window_seconds,
          description = excluded.description;

    drop trigger if exists enforce_abuse_controls_game_results on public.game_results;
    create trigger enforce_abuse_controls_game_results
      before insert on public.game_results
      for each row execute function public.enforce_abuse_controls();

    raise notice 'Game results wired into M14 abuse controls';
  else
    raise notice 'M14 abuse controls not installed - skipping rate limiting for game results';
  end if;
end $$;

comment on table public.game_results is
  'Append-only ledger of finished games. RLS: a member reads only their own rows; writes go through record_game_result().';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('game_catalog','game_results')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015190000_onboarding_wizard_columns.sql
-- ############################################################################

-- =============================================================================
-- Onboarding wizard · profile columns
-- =============================================================================
-- WHY: the 15-step onboarding wizard (src/app/profile/edit/page.tsx) commits the
-- whole form in ONE upsert. Nine of the columns in that payload previously
-- existed only in the legacy `migrations/onboarding_wizard_columns.sql` file,
-- which is NOT part of this authoritative directory. A database rebuilt from
-- `supabase/migrations/` therefore had no `pronouns`, `mbti`, ... and the
-- wizard's save failed with PostgREST 400 "column does not exist" at step 15 --
-- the product could not complete onboarding at all.
--
-- This closes ARCHITECTURE.md "Known gaps" #3 and satisfies CONSTITUTION
-- Article 3.12: migrations in the repo must be executable on a clean database.
--
-- PRIVACY: these are personal fields. None of them is added to `public_profiles`
-- (see 20261015120200_m6_public_profiles_view.sql), so they stay owner-readable
-- only -- new columns are private by default.
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`). Re-running is a no-op.
-- =============================================================================

alter table public.profiles add column if not exists pronouns            text;
alter table public.profiles add column if not exists physical_attributes text[];
alter table public.profiles add column if not exists sexual_orientation  text;
alter table public.profiles add column if not exists mbti                text;
alter table public.profiles add column if not exists height              text;
alter table public.profiles add column if not exists exercise            text;
alter table public.profiles add column if not exists education           text;
alter table public.profiles add column if not exists profession          text;
alter table public.profiles add column if not exists languages_spoken    text[];

comment on table public.profiles is
  'User profiles, including the fields collected by the 15-step onboarding wizard.';

-- Report the resulting posture: this must print 9 after a successful run.
select count(*) as onboarding_wizard_columns_present
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name in (
    'pronouns', 'physical_attributes', 'sexual_orientation', 'mbti',
    'height', 'exercise', 'education', 'profession', 'languages_spoken'
  );


-- ############################################################################
-- # 20261015195000_m4_schema_consolidation.sql
-- ############################################################################

-- =============================================================================
-- M4 · Supabase schema consolidation
-- =============================================================================
-- WHY: `reports` and `blocked_users` were originally created by the legacy,
-- non-executable `migrations/reports_blocked_users.sql`. That file cannot run on
-- a clean database (0/22 statements): it calls `uuid_generate_v4()` without
-- creating the `uuid-ossp` extension, and it uses `FOR INSERT ... USING`, which
-- PostgreSQL rejects -- an INSERT policy may only carry `WITH CHECK`.
--
-- The tables exist on the live project (created by hand), so they also carry
-- whatever constraints a human remembered to add. This migration makes the
-- STRUCTURE authoritative and reproducible:
--
--   * the tables exist, with `gen_random_uuid()` defaults;
--   * the integrity constraints are present (uniqueness, self-reference, FKs);
--   * every foreign key is backed by an index (unindexed FKs make cascading
--     deletes and joins on the erasure path slow, and RLS checks slower still);
--   * nothing here depends on an extension.
--
-- This file deliberately does NOT touch policies: M6 installed the RLS baseline
-- and M12 owns blocking enforcement. Mixing structure and policy in one
-- migration is how the original file became unrunnable.
--
-- SAFE TO RE-RUN: every statement is guarded. PostgreSQL has no
-- `add constraint if not exists`, so constraints are added inside `do` blocks
-- that check `pg_constraint` first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables — create if a project is missing them entirely
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  reason           text not null,
  details          text,
  status           text not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.blocked_users (
  id              uuid primary key default gen_random_uuid(),
  blocker_id      uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Columns — backfill anything a hand-made table is missing
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists details    text;
alter table public.reports add column if not exists status     text not null default 'pending';
alter table public.reports add column if not exists created_at timestamptz not null default now();
alter table public.reports add column if not exists updated_at timestamptz not null default now();

alter table public.blocked_users add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- 3. De-duplication before constraining
-- ---------------------------------------------------------------------------
-- A live table created by hand has had no constraint to stop duplicates. Adding
-- one would abort the migration on real data, so the duplicates are removed
-- first. `ctid` keeps the physically first row of each group, which is the
-- oldest: for reports that is the original report.
delete from public.reports f
using public.reports g
where f.ctid > g.ctid
  and f.reporter_id = g.reporter_id
  and f.reported_user_id = g.reported_user_id;

delete from public.blocked_users f
using public.blocked_users g
where f.ctid > g.ctid
  and f.blocker_id = g.blocker_id
  and f.blocked_user_id = g.blocked_user_id;

delete from public.follows f
using public.follows g
where f.ctid > g.ctid
  and f.follower_id = g.follower_id
  and f.following_id = g.following_id;

-- ---------------------------------------------------------------------------
-- 4. Constraints
-- ---------------------------------------------------------------------------
-- `add constraint` has no IF NOT EXISTS form, so each is guarded by a lookup on
-- pg_constraint. The constraint name is the guard AND the stable identity.

do $$
begin
  -- `follows` was created without any key at all: duplicate follows were
  -- possible and the row had no identity, so RLS and cascades had nothing to
  -- anchor to. The natural key is the pair itself, which also keeps a
  -- self-follow legal (the notification trigger already suppresses that case).
  if to_regclass('public.follows') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.follows'::regclass and contype = 'p'
     ) then
    alter table public.follows
      add constraint follows_pkey primary key (follower_id, following_id);
    raise notice 'M4: added follows_pkey';
  end if;

  -- One report per (reporter, reported) pair: reporting is not a scoreboard.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reporter_reported_key'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reporter_reported_key unique (reporter_id, reported_user_id);
    raise notice 'M4: added reports_reporter_reported_key';
  end if;

  -- Report status is a closed set. Enforced in the database so a client cannot
  -- invent a status and disappear from the moderator queue.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_status_check'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_status_check
      check (status in ('pending', 'reviewed', 'dismissed', 'actioned'));
    raise notice 'M4: added reports_status_check';
  end if;

  -- Nobody reports themselves.
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_no_self_report'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_no_self_report check (reporter_id <> reported_user_id);
    raise notice 'M4: added reports_no_self_report';
  end if;

  -- One block per (blocker, blocked) pair.
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocker_blocked_key'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocker_blocked_key unique (blocker_id, blocked_user_id);
    raise notice 'M4: added blocked_users_blocker_blocked_key';
  end if;

  -- Nobody blocks themselves.
  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_no_self_block'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_no_self_block check (blocker_id <> blocked_user_id);
    raise notice 'M4: added blocked_users_no_self_block';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Foreign keys
-- ---------------------------------------------------------------------------
-- A live table created by hand may have plain `uuid` columns with no referential
-- integrity at all, which would let a report point at a deleted account and
-- silently break the erasure cascade (CONSTITUTION Article 1, M15).

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reporter_id_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reporter_id_fkey
      foreign key (reporter_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added reports_reporter_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_reported_user_id_fkey'
      and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports
      add constraint reports_reported_user_id_fkey
      foreign key (reported_user_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added reports_reported_user_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocker_id_fkey'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocker_id_fkey
      foreign key (blocker_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added blocked_users_blocker_id_fkey';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'blocked_users_blocked_user_id_fkey'
      and conrelid = 'public.blocked_users'::regclass
  ) then
    alter table public.blocked_users
      add constraint blocked_users_blocked_user_id_fkey
      foreign key (blocked_user_id) references auth.users(id) on delete cascade;
    raise notice 'M4: added blocked_users_blocked_user_id_fkey';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
-- Scanned `create index` for the whole schema turned up four unindexed foreign
-- keys and one unindexed join column. Each is written as a `do` block with a
-- `to_regclass` guard, so this file still applies on a project that has only
-- run part of the migration set.
--
-- (The M4 audit is `tests/database/schema.test.ts` — it fails if any future
-- migration adds an unindexed foreign key.)

do $$
begin
  -- `matches` has a unique index on (user_a, user_b), which covers lookups by
  -- user_a only. The participant policy also matches on user_b.
  if to_regclass('public.matches') is not null then
    execute 'create index if not exists matches_user_b_idx on public.matches (user_b)';
  end if;

  -- Notifications are read by recipient; the actor join in the UI had no index.
  if to_regclass('public.notifications') is not null then
    execute 'create index if not exists notifications_actor_idx on public.notifications (actor_id)';
  end if;

  -- Comment authors are joined for display.
  if to_regclass('public.moment_comments') is not null then
    execute 'create index if not exists moment_comments_author_idx on public.moment_comments (author_id)';
  end if;

  -- `granted_by` is `on delete set null`, so every account deletion scans this
  -- unindexed column.
  if to_regclass('public.user_roles') is not null then
    execute 'create index if not exists user_roles_granted_by_idx on public.user_roles (granted_by)';
  end if;

  -- `follows` gained a composite primary key above, which covers follower_id.
  -- The reverse direction (followers of X) is still unindexed.
  if to_regclass('public.follows') is not null then
    execute 'create index if not exists follows_following_id_idx on public.follows (following_id)';
  end if;
end $$;

-- The moderator queue reads `status` + `created_at`; the reporter's own list
-- reads `reporter_id` newest-first. Both were missing an index that matches the
-- actual access pattern.
create index if not exists reports_reporter_idx
  on public.reports (reporter_id, created_at desc);
create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id);
create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);
create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

create index if not exists blocked_users_blocker_idx
  on public.blocked_users (blocker_id);
create index if not exists blocked_users_blocked_user_idx
  on public.blocked_users (blocked_user_id);
create index if not exists blocked_users_created_at_idx
  on public.blocked_users (created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Documentation
-- ---------------------------------------------------------------------------
comment on table public.reports is
  'Reports of a member for violating community guidelines. Triage is moderator-only (M14).';
comment on column public.reports.reason is
  'Why the report was filed: harassment, fake_profile, inappropriate, underage, other.';
comment on column public.reports.status is
  'Triage state: pending -> reviewed | dismissed | actioned.';
comment on table public.blocked_users is
  'Block relationships between members. Effect is symmetric: neither member may see or message the other (M12).';

-- ---------------------------------------------------------------------------
-- 8. Posture report — the SQL editor output doubles as evidence.
-- ---------------------------------------------------------------------------
select
  c.relname                                        as table_name,
  c.relrowsecurity                                 as rls_enabled,
  (select count(*) from pg_constraint k
    where k.conrelid = c.oid)                      as constraint_count,
  (select count(*) from pg_index i
    where i.indrelid = c.oid)                      as index_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('reports', 'blocked_users')
order by c.relname;


-- ############################################################################
-- # 20261015210000_m12_blocking_enforcement.sql
-- ############################################################################

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
  -- Both sides cast to text: `messages.match_id` is `uuid` on the live project
  -- and `text` in some rebuilt environments.
  where m.id::text = new.match_id::text
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


-- ############################################################################
-- # 20261015220000_m8_interest_prompt_catalogue.sql
-- ############################################################################

-- =============================================================================
-- M8 · Interest & prompt catalogue
-- =============================================================================
-- WHY: interests and prompts were string literals duplicated in three places --
-- `mockData.ts` fixtures, hard-coded arrays inside the onboarding wizard, and
-- free-text columns on `profiles`. Nothing stopped a client writing an interest
-- that no other member can ever share, which silently zeroes its match score,
-- and nothing let the curator add a prompt without a code change.
--
-- This migration makes the catalogue DATA:
--   * `interest_categories` — the groups shown in the wizard
--   * `interests`           — the selectable interests, stable ids
--   * `prompt_catalogue`    — the curated questions
--
-- All three are reference data: readable by any signed-in member, writable only
-- by an administrator running SQL. There is deliberately no client write policy.
--
-- The TypeScript boundary (`src/lib/catalogue.ts`) validates user input against
-- these rows, and `MAX_*` limits are enforced there and restated in SQL below.
--
-- SAFE TO RE-RUN: idempotent. Seeds use `on conflict (id) do nothing`, so a
-- curator's later edit to a label is never overwritten by a re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. interest_categories
-- ---------------------------------------------------------------------------
create table if not exists public.interest_categories (
  id         text primary key,
  label      text not null,
  icon       text,
  sort_order integer not null default 0,
  constraint interest_categories_label_len check (char_length(label) between 1 and 60),
  constraint interest_categories_id_shape  check (id ~ '^[a-z0-9_-]+$')
);

-- ---------------------------------------------------------------------------
-- 2. interests
-- ---------------------------------------------------------------------------
create table if not exists public.interests (
  id          text primary key,
  category_id text not null references public.interest_categories(id) on delete restrict,
  label       text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  constraint interests_label_len check (char_length(label) between 1 and 60),
  constraint interests_id_shape  check (id ~ '^[a-z0-9_-]+$')
);

-- The M4 audit fails any unindexed foreign key.
create index if not exists interests_category_idx on public.interests (category_id);
create index if not exists interests_active_sort_idx on public.interests (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 3. prompt_catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_catalogue (
  id         text primary key,
  category   text not null,
  question   text not null,
  hint       text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  constraint prompt_catalogue_question_len check (char_length(question) between 5 and 200),
  constraint prompt_catalogue_id_shape      check (id ~ '^[a-z0-9_-]+$')
);

create index if not exists prompt_catalogue_active_sort_idx
  on public.prompt_catalogue (is_active, sort_order);

-- ---------------------------------------------------------------------------
-- 4. RLS — reference data, read-only to clients
-- ---------------------------------------------------------------------------
alter table public.interest_categories enable row level security;
alter table public.interests           enable row level security;
alter table public.prompt_catalogue    enable row level security;

drop policy if exists "interest_categories_select_authenticated" on public.interest_categories;
create policy "interest_categories_select_authenticated"
  on public.interest_categories for select to authenticated using (true);

drop policy if exists "interests_select_authenticated" on public.interests;
create policy "interests_select_authenticated"
  on public.interests for select to authenticated using (true);

drop policy if exists "prompt_catalogue_select_authenticated" on public.prompt_catalogue;
create policy "prompt_catalogue_select_authenticated"
  on public.prompt_catalogue for select to authenticated using (true);

-- No INSERT/UPDATE/DELETE policy anywhere: the catalogue is curated by an
-- administrator running SQL, exactly like `user_roles`.

grant select on public.interest_categories to authenticated;
grant select on public.interests           to authenticated;
grant select on public.prompt_catalogue    to authenticated;
revoke all on public.interest_categories from anon;
revoke all on public.interests           from anon;
revoke all on public.prompt_catalogue    from anon;

-- ---------------------------------------------------------------------------
-- 5. Seed — the curated v1 catalogue
-- ---------------------------------------------------------------------------
insert into public.interest_categories (id, label, icon, sort_order) values
  ('outdoors',  'Outdoors & Adventure', '🏔️', 10),
  ('creative',  'Creative',             '🎨', 20),
  ('food',      'Food & Drink',         '🍜', 30),
  ('wellbeing', 'Health & Wellbeing',   '🧘', 40),
  ('culture',   'Culture & Learning',   '📚', 50),
  ('social',    'Social & Nightlife',   '🎶', 60),
  ('pets',      'Pets & Animals',       '🐾', 70),
  ('tech',      'Tech & Gaming',        '🎮', 80)
on conflict (id) do nothing;

insert into public.interests (id, category_id, label, sort_order) values
  ('hiking',            'outdoors',  'Hiking',            10),
  ('trekking',          'outdoors',  'Trekking',          20),
  ('travel',            'outdoors',  'Travel',            30),
  ('camping',           'outdoors',  'Camping',           40),
  ('photography',       'creative',  'Photography',       10),
  ('art',               'creative',  'Art & Design',      20),
  ('music',             'creative',  'Music',             30),
  ('writing',           'creative',  'Writing',           40),
  ('dancing',           'creative',  'Dancing',           50),
  ('cooking',           'food',      'Cooking',           10),
  ('coffee',            'food',      'Coffee & Tea',      20),
  ('street-food',       'food',      'Street Food',       30),
  ('dining-out',        'food',      'Dining Out',        40),
  ('yoga',              'wellbeing', 'Yoga',              10),
  ('fitness',           'wellbeing', 'Gym & Fitness',     20),
  ('running',           'wellbeing', 'Running',           30),
  ('meditation',        'wellbeing', 'Meditation',        40),
  ('reading',           'culture',   'Reading',           10),
  ('movies',            'culture',   'Movies & Series',   20),
  ('history',           'culture',   'History',           30),
  ('volunteering',      'culture',   'Volunteering',      40),
  ('live-music',        'social',    'Live Music',        10),
  ('nightlife',         'social',    'Nightlife',         20),
  ('board-games',       'social',    'Board Games',       30),
  ('dogs',              'pets',      'Dogs',              10),
  ('cats',              'pets',      'Cats',              20),
  ('animal-welfare',    'pets',      'Animal Welfare',    30),
  ('gaming',            'tech',      'Gaming',            10),
  ('coding',            'tech',      'Coding',            20),
  ('startups',          'tech',      'Startups',          30)
on conflict (id) do nothing;

insert into public.prompt_catalogue (id, category, question, hint, sort_order) values
  ('simple-pleasures', 'about-me',  'The simple pleasures I enjoy are…',        'Coffee at sunrise, a good playlist…', 10),
  ('perfect-weekend',  'about-me',  'My perfect weekend looks like…',          'Hiking then momo, then sleep',        20),
  ('unusual-skill',    'about-me',  'An unusual skill I have is…',             'I can name any Nepali district',      30),
  ('green-flag',       'values',    'A green flag I look for is…',             'Kind to waiters',                     40),
  ('important-to-me',  'values',    'Something I care deeply about is…',       'Family, or the mountains',            50),
  ('learn-together',   'together',  'We could learn together…',                'Cooking, or a new language',          60),
  ('first-date',       'together',  'A great first date would be…',            'Street food and a long walk',         70),
  ('makes-me-laugh',   'fun',       'What makes me laugh is…',                 'Bad puns, honestly',                  80),
  ('hidden-gem',       'about-nepal','My favourite place in Nepal is…',        'A quiet spot in Bandipur',            90)
on conflict (id) do nothing;

comment on table public.interests is
  'Curated selectable interests. Reference data, admin-written. Read by the onboarding wizard and the recommendation engine.';
comment on table public.prompt_catalogue is
  'Curated conversation prompts. Reference data, admin-written. Answers live in profiles.prompts keyed by this id.';

-- ---------------------------------------------------------------------------
-- 6. Posture report
-- ---------------------------------------------------------------------------
select
  'interest_categories' as table_name,
  count(*)              as rows
from public.interest_categories
union all
select 'interests', count(*) from public.interests
union all
select 'prompt_catalogue', count(*) from public.prompt_catalogue
order by 1;


-- ############################################################################
-- # 20261015230000_m11_messaging.sql
-- ############################################################################

-- =============================================================================
-- M11 · Real-time one-to-one messaging
-- =============================================================================
-- Three things this migration fixes or adds.
--
-- 1. A CRITICAL PRIVACY DEFECT. The M6 RLS baseline installed a SELECT policy
--    on `messages` of `auth.uid() is not null`, which means EVERY signed-in
--    member could read EVERY private message in the product. `follows` had the
--    same expression, exposing the whole follow graph. M6 only installs a
--    baseline when a table has zero policies, so the baseline is replaced here
--    by an explicit participant policy. (The M6 tests only ever asserted that
--    ANONYMOUS callers read zero rows, which was true and hid this completely.)
--
-- 2. Message delivery hardening. `auth.uid() = sender_id` proved who was
--    sending but not that they belong to the conversation, so a member could
--    append to any match id they could guess.
--
-- 3. Unread counters and read state, so the chat list can show a badge and the
--    badge can be cleared reliably rather than approximated on the client.
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. messages — participants only
-- ---------------------------------------------------------------------------
-- The subquery is evaluated with the caller's own rights, and `matches` is
-- itself participant-scoped (M10), so a member can only satisfy this predicate
-- for a conversation they are actually in.
drop policy if exists "messages_select_authenticated" on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (
    exists (
      select 1
      from public.matches m
      -- Both sides are cast to text. `messages.match_id` is `uuid` on the live
      -- project and `text` in some rebuilt environments, and `CREATE POLICY` is
      -- TYPE-CHECKED at creation, so a one-sided cast fails outright with
      -- "operator does not exist: text = uuid".
      where m.id::text = messages.match_id::text
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own"
  on public.messages for update to authenticated
  using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id);

-- ---------------------------------------------------------------------------
-- 2. follows — involved parties only
-- ---------------------------------------------------------------------------
drop policy if exists "follows_select_authenticated" on public.follows;
drop policy if exists "follows_select_involved" on public.follows;
create policy "follows_select_involved"
  on public.follows for select to authenticated
  using (auth.uid() = follower_id or auth.uid() = following_id);

-- ---------------------------------------------------------------------------
-- 3. Indexes for the read patterns the chat list actually uses
-- ---------------------------------------------------------------------------
create index if not exists messages_match_created_idx
  on public.messages (match_id, created_at desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- ---------------------------------------------------------------------------
-- 4. require_message_participation() — you may only write to your own thread
-- ---------------------------------------------------------------------------
-- Guarded on "the match exists". A message row whose `match_id` resolves to no
-- match is visible to nobody (the participant policy excludes it), so rejecting
-- it would add nothing while breaking fixture inserts that use synthetic ids.
-- The attack worth stopping -- appending to somebody else's conversation -- is
-- stopped, because that requires a real match id.
create or replace function public.require_message_participation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.matches m where m.id::text = new.match_id::text)
     and not exists (
       select 1 from public.matches m
       where m.id::text = new.match_id::text
         and (m.user_a = new.sender_id or m.user_b = new.sender_id)
     ) then
    raise exception 'You are not part of this conversation.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists require_message_participation_trg on public.messages;
create trigger require_message_participation_trg
  before insert on public.messages
  for each row execute function public.require_message_participation();

-- ---------------------------------------------------------------------------
-- 5. match_read_state — one row per (conversation, member)
-- ---------------------------------------------------------------------------
create table if not exists public.match_read_state (
  match_id     uuid not null references public.matches(id) on delete cascade,
  user_id      uuid not null references auth.users(id)   on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- The M4 audit fails any unindexed foreign key; the primary key covers
-- match_id, this covers user_id.
create index if not exists match_read_state_user_idx
  on public.match_read_state (user_id);

alter table public.match_read_state enable row level security;

drop policy if exists "match_read_state_select_own" on public.match_read_state;
create policy "match_read_state_select_own"
  on public.match_read_state for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "match_read_state_insert_own" on public.match_read_state;
create policy "match_read_state_insert_own"
  on public.match_read_state for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "match_read_state_update_own" on public.match_read_state;
create policy "match_read_state_update_own"
  on public.match_read_state for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.match_read_state to authenticated;
revoke all on public.match_read_state from anon;

-- ---------------------------------------------------------------------------
-- 6. mark_conversation_read()
-- ---------------------------------------------------------------------------
-- Only a participant can mark a conversation read, and the timestamp comes from
-- the server clock, so a client cannot backdate its way past the badge.
create or replace function public.mark_conversation_read(p_match_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  ts timestamptz := now();
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  insert into public.match_read_state (match_id, user_id, last_read_at)
  values (p_match_id, me, ts)
  on conflict (match_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  return ts;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. unread_counts() — the badge for every conversation, in one round trip
-- ---------------------------------------------------------------------------
-- A member compares against their own last_read_at, and only messages they did
-- NOT send count. `left join messages` means a conversation with no messages
-- still returns a row with unread = 0, so the chat list never has to guess.
create or replace function public.unread_counts()
returns table (match_id uuid, unread integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id as match_id,
    count(msg.id) filter (
      where msg.sender_id <> auth.uid()
        and msg.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
    )::integer as unread
  from public.matches m
  left join public.match_read_state rs
    on rs.match_id = m.id and rs.user_id = auth.uid()
  left join public.messages msg
    on msg.match_id::text = m.id::text
  where auth.uid() is not null
    and (m.user_a = auth.uid() or m.user_b = auth.uid())
  group by m.id, rs.last_read_at;
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

comment on function public.unread_counts() is
  'Per-conversation unread message count for the signed-in member. Server-computed so the badge cannot drift from the data.';
comment on table public.match_read_state is
  'When each member last read each conversation. Owner-scoped; drives unread_counts().';

-- ---------------------------------------------------------------------------
-- 8. Posture report
-- ---------------------------------------------------------------------------
select
  p.proname                                  as function_name,
  p.prosecdef                                as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '(unpinned)') as settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'require_message_participation', 'mark_conversation_read', 'unread_counts'
  )
order by p.proname;


-- ############################################################################
-- # 20261015240000_m13_moderation_workflow.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015250000_m7_profile_validation.sql
-- ############################################################################

-- =============================================================================
-- M7 · Full profile management — database-side validation guards
-- =============================================================================
-- WHY: the onboarding wizard validates on the client, and the client is not a
-- security boundary. Everything it checks must also be true in the database, or
-- a crafted request bypasses it.
--
-- The three guards that matter for a dating product for adults:
--   * an adult age (RISK_REGISTER R-05),
--   * a real display name -- a blank profile is unusable to everyone who sees it,
--   * a closed set of declared intentions, because the recommendation engine
--     scores on it and an unknown value can never be satisfied by anyone.
--
-- WHY `NOT VALID`
--   Each constraint is added with `NOT VALID`. PostgreSQL then enforces it for
--   every new or updated row immediately, but does NOT abort the migration on
--   rows that already violate it. On a live table that humans have edited by
--   hand, that is the difference between a migration that applies and one that
--   does not. `validate constraint` can be run later, deliberately, once the
--   existing rows are cleaned.
--
-- SAFE TO RE-RUN: guarded by `pg_constraint` lookups.
-- =============================================================================

do $$
begin
  -- Age 18 or over. The client must reject an under-18 date of birth outright;
  -- this is the backstop that survives a crafted request.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_age_adult' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_age_adult check (age is null or age >= 18) not valid;
    raise notice 'M7: added profiles_age_adult (not valid)';
  end if;

  -- A display name that is actually a name: present, trimmed, bounded.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_display_name_shape' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_display_name_shape
      check (
        display_name is null
        or (char_length(btrim(display_name)) between 1 and 60)
      ) not valid;
    raise notice 'M7: added profiles_display_name_shape (not valid)';
  end if;

  -- Intention is a closed set: the scoring engine must be able to reason about
  -- every value it can encounter.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_intention_set' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_intention_set
      check (intention is null or intention in ('friendship','dating','both')) not valid;
    raise notice 'M7: added profiles_intention_set (not valid)';
  end if;

  -- A bio is free text, but not unbounded: it is rendered in list views.
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_len
      check (bio is null or char_length(bio) <= 1000) not valid;
    raise notice 'M7: added profiles_bio_len (not valid)';
  end if;
end $$;

comment on constraint profiles_age_adult on public.profiles is
  'Members must be 18+. Backstop for the client-side date-of-birth gate (CONSTITUTION Article 1).';

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  conname        as constraint_name,
  convalidated   as validated,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname in (
    'profiles_age_adult',
    'profiles_display_name_shape',
    'profiles_intention_set',
    'profiles_bio_len'
  )
order by conname;


-- ############################################################################
-- # 20261015260000_m15_revoke_birth_date.sql
-- ############################################################################

-- =============================================================================
-- M15 · Make profiles.birth_date unreadable (column-level privileges)
-- =============================================================================
-- WHY: `CONSTITUTION.md` Article 1.4 — never expose a date of birth. It enables
-- identity theft and is not needed to render a profile; the derived `age` is.
--
-- Today, RLS on `profiles` lets ANY signed-in member read ANY other member's
-- row (`auth.uid() is not null`). That is deliberate for discovery, which is
-- exactly why the protection for this one column has to be column-level.
--
-- ---------------------------------------------------------------------------
-- IMPORTANT — the obvious approach does not work
-- ---------------------------------------------------------------------------
-- M15 originally recorded this statement, commented out, as the fix:
--
--     revoke select (birth_date) on public.profiles from authenticated, anon;
--
-- That is a NO-OP here, and shipping it would have produced a security control
-- that silently protected nothing. Verified empirically against PostgreSQL:
--
--     create role app_user; create table t (a int, b int);
--     grant select on t to app_user;
--     revoke select (b) on t from app_user;
--     -- as app_user:  select b from t  ->  ALLOWED
--
-- A table-level SELECT grant covers every column, and a column-level REVOKE
-- cannot subtract from it. Supabase grants table-level SELECT to `anon` and
-- `authenticated` by default, so the situation above is exactly ours.
--
-- The working pattern is to drop the table-wide grant and re-grant the columns
-- that ARE allowed:
--
--     revoke select on public.profiles from anon, authenticated;
--     grant  select (<everything except birth_date>) on public.profiles to ...;
--
-- which is what this migration does. The column list is generated from the
-- catalogue rather than hard-coded, so a column added by a later migration is
-- readable by default instead of silently locking the app out of it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT BREAK
-- ---------------------------------------------------------------------------
--   * `public_profiles` — a view without `security_invoker`, so it reads with
--     the OWNER's rights and is unaffected by grants to anon/authenticated. It
--     never selected birth_date anyway.
--   * `export_my_data()`, `delete_my_account()`, `discover_profiles()`,
--     `admin_report_queue()`, `snapshot_report_evidence()` and every trigger —
--     all SECURITY DEFINER, so they keep owner rights.
--   * A member's own data export still contains their date of birth, as
--     data-subject rights require (`export_my_data`).
--
-- ---------------------------------------------------------------------------
-- CLIENT CONTRACT
-- ---------------------------------------------------------------------------
-- `select *` on `profiles` AS ANON OR AUTHENTICATED now FAILS. Every client read
-- must name its columns. The two surfaces that read the member's own row (the
-- wizard and the dashboard) use explicit allow-lists, and the wizard gets its
-- date of birth from `my_birth_date()` below.
--
-- SAFE TO RE-RUN: idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. my_birth_date() — the owner-only escape hatch
-- ---------------------------------------------------------------------------
-- The wizard must still prefill the member's own date of birth after the column
-- is revoked from every role. This returns exactly one value, for exactly the
-- caller, and accepts no user id — so it cannot be pointed at anybody else.
create or replace function public.my_birth_date()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.birth_date
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.my_birth_date() from public, anon;
grant execute on function public.my_birth_date() to authenticated;

comment on function public.my_birth_date() is
  'The caller''s own date of birth only. Exists because profiles.birth_date is revoked at the column level for every role; derives identity from auth.uid() and accepts no user id.';

-- ---------------------------------------------------------------------------
-- 2. Revoke table-wide SELECT, then re-grant everything except birth_date
-- ---------------------------------------------------------------------------
do $$
declare
  readable_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into readable_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'profiles'
    and column_name <> 'birth_date';

  if readable_columns is null then
    raise exception 'M15: could not enumerate columns of public.profiles';
  end if;

  -- The revoke is what makes the subsequent grant meaningful: without it the
  -- table-wide privilege would still cover birth_date.
  execute 'revoke select on public.profiles from anon, authenticated';

  -- Authenticated members keep full read access to every other column, which is
  -- what discovery, the dashboard and the wizard rely on.
  execute format('grant select (%s) on public.profiles to authenticated', readable_columns);

  -- `anon` gets NOTHING back. RLS already returns zero rows to an anonymous
  -- caller; this makes the denial structural rather than policy-dependent.
  execute 'revoke select on public.profiles from anon';

  raise notice 'M15: birth_date revoked; % other columns re-granted to authenticated', 
    array_length(string_to_array(readable_columns, ','), 1);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Posture report
-- ---------------------------------------------------------------------------
select
  grantee,
  privilege_type,
  column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profiles'
  and column_name  = 'birth_date'
order by grantee, privilege_type;


-- ############################################################################
-- # 20261015270000_m16_game_catalog_expansion.sql
-- ############################################################################

-- =============================================================================
-- M16 · Game Zone catalogue expansion — playable social mini-games
-- =============================================================================
-- M14 (20261015180000_game_zone.sql) seeded four games, of which only
-- `tic-tac-toe` and `uno-lite` were playable. Everything else the Game Hub
-- offered was a "coming soon" card.
--
-- WHY THIS MIGRATION IS REQUIRED, NOT OPTIONAL
--   `record_game_result()` validates the game id against `public.game_catalog`
--   and rejects an unknown id outright. A new playable game therefore cannot
--   save its score — or even render an honest result — until its catalogue row
--   exists. The UI and the database must agree; adding a game only to the client
--   would ship a button whose result silently fails to record.
--
--   The inserted ids are the exact set the client registry in
--   `src/app/components/games/engine.tsx` renders, and `max_score` is the score
--   ceiling that `record_game_result()` enforces.
--
-- SAFE TO RE-RUN: idempotent. Plain upsert on the primary key, no DDL, no policy
-- changes (the existing `game_catalog_readable` policy and grants already cover
-- these rows). Running it twice is a no-op.
-- =============================================================================

insert into public.game_catalog (game_id, title, is_playable, max_score, sort_order) values
  ('memory-match',     'Memory Match',        true, 100, 5),
  ('word-guess',       'Word Guessing',       true,  60, 6),
  ('icebreaker',       'Icebreaker Trivia',   true,  50, 7),
  ('twenty-questions', '20 Questions',        true,  30, 8),
  ('truth-or-dare',    'Truth or Dare',       true,  15, 9),
  ('spin-the-wheel',   'Spin the Wheel',      true,  20, 10),
  ('speed-matching',   'Speed Matching',      true,  80, 11)
on conflict (game_id) do update
  set title       = excluded.title,
      is_playable = excluded.is_playable,
      max_score   = excluded.max_score,
      sort_order  = excluded.sort_order;

-- Report the resulting posture, so applying this by hand in the SQL Editor
-- shows what changed rather than returning silently.
select
  count(*) filter (where is_playable) as playable_games,
  count(*)                            as total_games
from public.game_catalog;


-- ############################################################################
-- # 20261015280000_m17_user_preferences.sql
-- ############################################################################

-- =============================================================================
-- M17 · user_preferences — per-member translation settings
-- =============================================================================
-- Adds the storage behind Mettivo's on-demand chat translation:
-- `preferred_translation_language`, the language a member wants incoming
-- messages translated INTO. Translation itself is on-demand — nothing is
-- translated until the member taps the translate control on a message — so this
-- is a preference, not a job queue.
--
-- WHY A SEPARATE TABLE RATHER THAN A COLUMN ON `profiles`
--   `profiles` is the most audience-sensitive row in the product: it carries the
--   column-level `birth_date` revoke (20261015260000_m15_revoke_birth_date.sql)
--   and every column in it is either displayed on a public surface or carefully
--   excluded from one. UI preferences have a different blast radius and a
--   different read pattern (read once per chat screen, written from settings),
--   so they get their own table with their own policy rather than widening the
--   row that the public projections must reason about.
--
-- SAFE TO RE-RUN: idempotent. `create table if not exists`, `add column if not
-- exists`, `drop policy if exists` before every `create policy`, and the seed is
-- an `on conflict do nothing`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  preferred_translation_language varchar(10) not null default 'en',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  -- A language code, not free text: the value is interpolated into an upstream
  -- translation request, so an unconstrained string is an injection surface and
  -- a guaranteed upstream 400. Mirrors the allow-list in `src/lib/translation.ts`
  -- (`SUPPORTED_LANGUAGE_CODES` + `LANGUAGE_CODE_PATTERN`); the app copy produces
  -- the friendly message, this one is the boundary that cannot be bypassed.
  constraint user_preferences_language_format
    check (preferred_translation_language ~ '^[a-z]{2}(-[a-z]{2})?$')
);

comment on table public.user_preferences is
  'Per-member UI preferences. RLS: a member reads and writes only their own row.';
comment on column public.user_preferences.preferred_translation_language is
  'Language code incoming chat messages are translated into. Defaults to en.';

-- Idempotent for environments where an earlier build created the table without
-- the column.
alter table public.user_preferences
  add column if not exists preferred_translation_language varchar(10) not null default 'en';

-- ---------------------------------------------------------------------------
-- 2. updated_at maintenance
-- ---------------------------------------------------------------------------
-- Kept in the database so the timestamp cannot be forged or forgotten by a
-- client. This is the same trigger shape used by the rest of the schema.
create or replace function public.touch_user_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_preferences_touch_updated_at on public.user_preferences;
create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_user_preferences_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed a row for every existing member
-- ---------------------------------------------------------------------------
-- `on conflict do nothing` so this never overwrites a preference a member has
-- already chosen. New members are handled on write: `savePreferredTranslation-
-- Language()` upserts, and the read path treats a missing row as the default.
insert into public.user_preferences (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
-- No personal data here, but the row is still member-scoped: another member
-- learning your translation language is a (small) disclosure and there is no
-- product reason to allow it. `auth.uid()` is the only source of identity.
alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences for insert to authenticated
  -- INSERT policies use WITH CHECK, never USING: PostgreSQL rejects USING here.
  with check (auth.uid() = user_id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Deliberately NO delete policy. A member row is removed by account erasure
-- (`delete_my_account()` cascades from auth.users); the settings UI writes, it
-- does not delete, so exposing DELETE would only add a way to lose the row.

grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname = 'user_preferences'
group by c.relname, c.relrowsecurity;


-- ############################################################################
-- # 20261015290000_profile_social_counts.sql
-- ############################################################################

-- =============================================================================
-- M18 · Profile social counts — followers, following, matches and profile likes
-- =============================================================================
-- WHY: the profile surfaces (own dashboard and the public profile) show four
-- counters under the member's name: Matches, Following, Followers and Profile
-- Likes. `follows` and `likes` are the source of truth, but RLS only lets a
-- member read the rows they are *part of*:
--
--   * `follows_select_involved`  -> you can count your own followers/following
--                                    but not a stranger's,
--   * `likes_select_involved`    -> you can count likes you received or sent,
--                                    but not a third party's.
--
-- A public profile therefore cannot derive those numbers with a client query.
-- They are denormalised onto `profiles` and kept correct by triggers, which
-- also avoids N correlated subqueries per discovery row.
--
-- SECURITY DEFINER on the trigger functions is deliberate: the counter must be
-- maintained no matter who wrote the underlying `follows` / `likes` / `matches`
-- row. Under RLS the writer usually cannot UPDATE the *other* member's profile
-- row, so an invoker-rights trigger would silently fail to increment.
--
-- ALSO IN THIS MIGRATION
--   * `follows` gains INSERT/DELETE policies scoped to the follower. Until now
--     the table was read-only under RLS ("no INSERT policy"), so every
--     follow/unfollow action in the UI silently changed zero rows.
--   * `public_profiles` is extended with the four counters, which is the only
--     reason the earlier "not needed by any public surface" exclusion no longer
--     holds.
--
-- SAFE TO RE-RUN: columns are added with `if not exists`, triggers are dropped
-- before creation, the backfill is a pure function of the source tables, and
-- the view is `create or replace`d.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Counter columns on profiles
-- ---------------------------------------------------------------------------
-- `not null default 0` so the columns are immediately usable and never null in
-- arithmetic. Idempotent: a second run is a no-op.
alter table public.profiles add column if not exists followers_count     integer not null default 0;
alter table public.profiles add column if not exists following_count     integer not null default 0;
alter table public.profiles add column if not exists matches_count       integer not null default 0;
alter table public.profiles add column if not exists profile_likes_count integer not null default 0;

comment on column public.profiles.followers_count is
  'Members who follow this member. Maintained by sync_follow_counts(). Denormalised so a public profile can show it under RLS.';
comment on column public.profiles.following_count is
  'Members this member follows. Maintained by sync_follow_counts().';
comment on column public.profiles.matches_count is
  'Mutual matches involving this member. Maintained by sync_match_counts().';
comment on column public.profiles.profile_likes_count is
  'Distinct likes received (is_like = true, not passes). Maintained by sync_profile_like_counts().';

-- M15 dropped the table-wide SELECT on `profiles` and re-granted only the
-- columns that existed then, so every column added later (these four) must be
-- granted explicitly or "select followers_count" fails with
-- "permission denied for table profiles" while the row itself is readable.
grant select (followers_count, following_count, matches_count, profile_likes_count)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill from the source-of-truth tables
-- ---------------------------------------------------------------------------
-- Runs as the migration owner (auth.uid() is null), so the moderation guard on
-- `profiles` lets the write through. Recomputing from scratch keeps the values
-- correct even if a previous partial run left them stale.
update public.profiles p
set followers_count = (
      select count(*)::int from public.follows f where f.following_id = p.id
    ),
    following_count = (
      select count(*)::int from public.follows f where f.follower_id = p.id
    ),
    matches_count = (
      select count(*)::int from public.matches m
      where m.user_a = p.id or m.user_b = p.id
    ),
    profile_likes_count = (
      select count(*)::int from public.likes l
      where l.liked_id = p.id and l.is_like
    );

-- ---------------------------------------------------------------------------
-- 3. follows — a member may follow and unfollow, but only as themselves
-- ---------------------------------------------------------------------------
-- The existing posture was SELECT-only ("READ-ONLY"), which is why the Follow
-- buttons elsewhere in the app appeared to work but changed nothing. These add
-- the smallest write surface: you own the outbound edge and nothing else.
--
-- A self-follow stays *legal at the schema level*, matching the M4 decision;
-- the notification trigger already suppresses the self-notification, and the
-- UI never offers it.
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert to authenticated
  with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete to authenticated
  using (auth.uid() = follower_id);

grant select, insert, delete on public.follows to authenticated;

-- NOTE: `anon` keeps its table privileges (the Supabase default) and is denied
-- purely by RLS — there is no policy for the `anon` role, so every read and
-- write is filtered to zero. Revoking the grant would move the denial out of
-- RLS and make the "anonymous reads zero rows" security assertion vacuous.

-- ---------------------------------------------------------------------------
-- 4. sync_follow_counts() — followers of the target, following of the actor
-- ---------------------------------------------------------------------------
create or replace function public.sync_follow_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set following_count = following_count + 1
      where id = new.follower_id;
    update public.profiles
      set followers_count = followers_count + 1
      where id = new.following_id;
  elsif tg_op = 'DELETE' then
    update public.profiles
      set following_count = greatest(following_count - 1, 0)
      where id = old.follower_id;
    update public.profiles
      set followers_count = greatest(followers_count - 1, 0)
      where id = old.following_id;
  end if;

  return null;
end;
$$;

drop trigger if exists follows_sync_counts_trg on public.follows;
create trigger follows_sync_counts_trg
  after insert or delete on public.follows
  for each row execute function public.sync_follow_counts();

-- ---------------------------------------------------------------------------
-- 5. sync_profile_like_counts() — likes received, passes excluded
-- ---------------------------------------------------------------------------
-- `record_like` upserts, so a pass -> like transition fires UPDATE, not INSERT.
-- All three operations are handled or a re-like would double count.
create or replace function public.sync_profile_like_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_like then
      update public.profiles
        set profile_likes_count = profile_likes_count + 1
        where id = new.liked_id;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_like and not old.is_like then
      update public.profiles
        set profile_likes_count = profile_likes_count + 1
        where id = new.liked_id;
    elsif old.is_like and not new.is_like then
      update public.profiles
        set profile_likes_count = greatest(profile_likes_count - 1, 0)
        where id = old.liked_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.is_like then
      update public.profiles
        set profile_likes_count = greatest(profile_likes_count - 1, 0)
        where id = old.liked_id;
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists likes_sync_profile_counts_trg on public.likes;
create trigger likes_sync_profile_counts_trg
  after insert or update or delete on public.likes
  for each row execute function public.sync_profile_like_counts();

-- ---------------------------------------------------------------------------
-- 6. sync_match_counts() — both participants on a new/mutual match
-- ---------------------------------------------------------------------------
create or replace function public.sync_match_counts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
      set matches_count = matches_count + 1
      where id in (new.user_a, new.user_b);
  elsif tg_op = 'DELETE' then
    update public.profiles
      set matches_count = greatest(matches_count - 1, 0)
      where id in (old.user_a, old.user_b);
  end if;

  return null;
end;
$$;

drop trigger if exists matches_sync_counts_trg on public.matches;
create trigger matches_sync_counts_trg
  after insert or delete on public.matches
  for each row execute function public.sync_match_counts();

-- ---------------------------------------------------------------------------
-- 7. public_profiles — expose the four counters
-- ---------------------------------------------------------------------------
-- Recreated with the counters appended to the allow-list. The view is DROPPED
-- and recreated rather than `create or replace`d: `create or replace view` may
-- only append columns, so once a deployment has a view whose column order was
-- produced by an older `public_profiles` definition it can refuse the replace.
-- Dropping first makes this step idempotent against any prior shape — the same
-- reason the M6 definition does it. Nothing depends on the view structurally.
--
-- Still excluded: birth_date, and the raw `followers`/`following`/`friends`
-- arrays (the aggregate counts are all any surface needs).
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  id,
  display_name,
  age,
  gender,
  city,
  country,
  avatar_url,
  photos,
  bio,
  intention,
  looking_for,
  hobbies,
  pets,
  personality,
  religion,
  politics,
  drinking,
  smoking,
  interests,
  prompts,
  is_online,
  is_verified,
  onboarding_completed,
  updated_at,
  followers_count,
  following_count,
  matches_count,
  profile_likes_count
from public.profiles;

comment on view public.public_profiles is
  'Allow-listed public projection of profiles. Excludes birth_date and other private fields. Includes the aggregate social counters so a public profile can render them under RLS.';

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  c.relname      as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('follows', 'likes', 'matches')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015295000_moments_engagement.sql
-- ############################################################################

-- =============================================================================
-- Moments · engagement upgrade (rich media + views)
-- =============================================================================
-- Extends the M… moments feed with the three things a modern social feed needs
-- on top of likes/comments/shares:
--
--   1. media_type  — tells the card whether a post is an image or a short video
--                    so the feed can autoplay video instead of rendering a
--                    frozen frame (image is the default, so legacy rows are
--                    untouched).
--   2. views_count — a total view counter on the post itself.
--   3. moment_views — one row per (post, viewer) so the UI can also show a
--                    *unique* viewer count and a viewer can only inflate the
--                    total once per row, not by refreshing the page.
--
-- It also (a) rebuilds `public.moment_feed` to expose the new columns — a view
-- cannot gain columns via CREATE OR REPLACE, so it is dropped and recreated —
-- (b) adds a SECURITY DEFINER `record_moment_view()` that owns the counter so
-- the client can never set it directly, and (c) idempotently creates the
-- `moment-media` Storage bucket used for uploads, guarded so this file still
-- applies on a database without the `storage` schema (the test harness).
--
-- SAFE TO RE-RUN: every statement is `if not exists` / `drop … if exists` /
-- `on conflict`, and the Storage block is a no-op when `storage` is absent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments — new columns
-- ---------------------------------------------------------------------------
alter table public.moments add column if not exists media_type  text;
alter table public.moments add column if not exists views_count integer not null default 0;

-- Constraint guards: `add constraint` has no `if not exists`, so test for the
-- name first. Existing rows have a null media_type and pass the check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_media_type_chk' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_media_type_chk
      check (media_type is null or media_type in ('image', 'video'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_views_count_pos' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_views_count_pos check (views_count >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. moment_views — one row per (post, viewer) so views are deduplicated
-- ---------------------------------------------------------------------------
create table if not exists public.moment_views (
  moment_id       uuid not null references public.moments(id) on delete cascade,
  viewer_id       uuid not null references auth.users(id) on delete cascade,
  view_count      integer not null default 1,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),
  primary key (moment_id, viewer_id),

  constraint moment_views_count_pos check (view_count >= 1)
);

create index if not exists moment_views_viewer_idx on public.moment_views (viewer_id);

-- RLS is on (the security suite requires it for every public table), but the
-- table is written ONLY through `record_moment_view()`. No client role holds a
-- table privilege, so there is no policy to bypass.
alter table public.moment_views enable row level security;

revoke all on public.moment_views from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_moment_view() — the client asks to be counted, it cannot set a value
-- ---------------------------------------------------------------------------
-- Returns the post's new total and its unique-viewer count in one round trip.
-- Self-views are deliberately not counted (consistent with most feeds), but the
-- call still returns the current totals so the caller can render immediately.
create or replace function public.record_moment_view(p_moment_id uuid)
returns table (views_count integer, unique_views integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := auth.uid();
  v_author uuid;
  v_total  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select m.author_id, m.views_count
    into v_author, v_total
    from public.moments m
   where m.id = p_moment_id;

  if not found then
    raise exception 'Moment not found' using errcode = 'P0002';
  end if;

  if me <> v_author then
    insert into public.moment_views (moment_id, viewer_id)
    values (p_moment_id, me)
    on conflict (moment_id, viewer_id)
      do update set view_count     = public.moment_views.view_count + 1,
                    last_viewed_at = now();

    -- Qualify the column: the RETURNS TABLE output is also named views_count,
    -- so a bare reference is ambiguous.
    update public.moments m
       set views_count = m.views_count + 1
     where m.id = p_moment_id
    returning m.views_count into v_total;
  end if;

  return query
    select v_total,
           (select count(*)::int from public.moment_views v where v.moment_id = p_moment_id);
end;
$$;

revoke all on function public.record_moment_view(uuid) from public, anon;
grant execute on function public.record_moment_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. moment_feed — expose the new columns (drop + recreate; a view cannot
--    gain columns through CREATE OR REPLACE)
-- ---------------------------------------------------------------------------
drop view if exists public.moment_feed;

create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.tags,
  m.shares,
  m.views_count,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as unique_views
  from public.moment_views group by moment_id
) v on v.moment_id = m.id
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id;

comment on view public.moment_feed is
  'Moments with media type, view totals, like/comment counts and a per-caller liked_by_me flag. Read this instead of the base table.';

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

-- ---------------------------------------------------------------------------
-- 5. Realtime — live comment threads on an open post
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moment_comments'
    ) then
      alter publication supabase_realtime add table public.moment_comments;
      raise notice 'moment_comments added to supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for moment_comments in the dashboard';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Storage — the `moment-media` bucket for HD images and short video
-- ---------------------------------------------------------------------------
-- Guarded on the `storage` schema: the PGlite test harness does not model
-- Supabase Storage, so this whole block is skipped there. On a real project the
-- bucket is created (public read, so <img>/<video> can load the object) and
-- uploads are scoped to a `<user-id>/…` folder the uploader owns.
do $storage$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('moment-media', 'moment-media', true)
    on conflict (id) do update set public = true;

    execute $p$drop policy if exists "moment_media_read" on storage.objects$p$;
    execute $p$create policy "moment_media_read"
      on storage.objects for select to authenticated
      using (bucket_id = 'moment-media')$p$;

    execute $p$drop policy if exists "moment_media_insert_own" on storage.objects$p$;
    execute $p$create policy "moment_media_insert_own"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "moment_media_update_own" on storage.objects$p$;
    execute $p$create policy "moment_media_update_own"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "moment_media_delete_own" on storage.objects$p$;
    execute $p$create policy "moment_media_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'moment-media'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    raise notice 'moment-media storage bucket ready';
  else
    raise notice 'storage schema not found - create the moment-media bucket in the dashboard';
  end if;
end $storage$;

comment on column public.moments.media_type is
  'image | video | null (legacy inline data URL, treated as image by the client).';
comment on column public.moments.views_count is
  'Total views, maintained by record_moment_view(). Never written by the client.';

-- Report the resulting posture.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('moments', 'moment_likes', 'moment_comments', 'moment_views')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015300000_m20_settings_preferences.sql
-- ############################################################################

-- =============================================================================
-- M20 · Settings — notification preferences, privacy controls, avatars bucket
-- =============================================================================
-- WHY: `/profile/settings` must be more than a menu of alerts. Three of its
-- groups need somewhere to persist a member's choice:
--
--   * Notifications — which events reach them (matches, messages, likes,
--     moments) and over which channel (in-app push, email).
--   * Privacy Control — whether their online status is shown, whether distance
--     is hidden, and who may see the profile at all.
--   * Change Avatar — a Storage object rather than a base64 data URL, so the
--     image is cached and CDN-served instead of travelling inside every profile
--     row.
--
-- WHY ON `user_preferences` RATHER THAN `profiles`
--   `user_preferences` already exists (M17) as "the table for member-scoped UI
--   choices", with its own policy and its own blast radius. A notification or
--   visibility toggle is exactly that kind of value; adding it to `profiles`
--   would widen the row that every public projection has to reason about.
--
-- HONEST SCOPE NOTE
--   These columns record intent. Wiring `notify_*` into the delivery triggers in
--   `20261015160000_notifications_realtime.sql` and honouring `profile_visibility`
--   / `hide_distance` in discovery is a follow-up that touches those functions;
--   this migration only adds the storage so the settings UI stops pretending.
--
-- SAFE TO RE-RUN: `add column if not exists`, `drop policy if exists` before
-- every `create policy`, `on conflict` on the bucket, and the constraint is
-- dropped before it is re-added. The Storage block is a no-op when the
-- `storage` schema is absent (the PGlite harness does not model it).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notification preferences
-- ---------------------------------------------------------------------------
-- Every default is "on" except email, which is opt-in: an emailed notification
-- is a bigger step than an in-app one, and defaulting it on would sign members
-- up for mail they never asked for.
alter table public.user_preferences
  add column if not exists notify_new_matches boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_messages boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_likes boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_moments boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_push boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_email boolean not null default false;

comment on column public.user_preferences.notify_new_matches is
  'Show a notification when the member gains a new match.';
comment on column public.user_preferences.notify_messages is
  'Show a notification for a new chat message.';
comment on column public.user_preferences.notify_likes is
  'Show a notification when someone likes the member.';
comment on column public.user_preferences.notify_moments is
  'Show a notification for Moments activity (likes/comments on the member''s posts).';
comment on column public.user_preferences.notify_push is
  'Master switch for in-app/push notifications.';
comment on column public.user_preferences.notify_email is
  'Whether notification emails may be sent. Off by default.';

-- ---------------------------------------------------------------------------
-- 2. Privacy controls
-- ---------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists show_online_status boolean not null default true;
alter table public.user_preferences
  add column if not exists hide_distance boolean not null default false;
alter table public.user_preferences
  add column if not exists profile_visibility varchar(10) not null default 'public';

comment on column public.user_preferences.show_online_status is
  'When false the member is always presented as offline.';
comment on column public.user_preferences.hide_distance is
  'When true the discovery surface omits the member''s distance.';
comment on column public.user_preferences.profile_visibility is
  'Who may see the profile: public | matches | private.';

-- A closed set, mirrored by the UI. `drop ... if exists` first so a re-run
-- cannot fail on the duplicate-constraint error.
alter table public.user_preferences
  drop constraint if exists user_preferences_visibility_set;
alter table public.user_preferences
  add constraint user_preferences_visibility_set
  check (profile_visibility in ('public', 'matches', 'private'));

-- Table-level grants already cover new columns, but re-assert them so a fresh
-- apply on a database with different default privileges is still correct.
grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

-- ---------------------------------------------------------------------------
-- 3. Storage — the `avatars` bucket
-- ---------------------------------------------------------------------------
-- Guarded on the `storage` schema: the PGlite test harness does not model
-- Supabase Storage, so this block is skipped there. Public read (so an <img>
-- can load the object), writes scoped to a `<user-id>/…` folder the uploader
-- owns — the same posture as `moment-media`.
do $storage$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true)
    on conflict (id) do update set public = true;

    execute $p$drop policy if exists "avatars_read" on storage.objects$p$;
    execute $p$create policy "avatars_read"
      on storage.objects for select to authenticated
      using (bucket_id = 'avatars')$p$;

    execute $p$drop policy if exists "avatars_insert_own" on storage.objects$p$;
    execute $p$create policy "avatars_insert_own"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "avatars_update_own" on storage.objects$p$;
    execute $p$create policy "avatars_update_own"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "avatars_delete_own" on storage.objects$p$;
    execute $p$create policy "avatars_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    raise notice 'avatars storage bucket ready';
  else
    raise notice 'storage schema not found - create the avatars bucket in the dashboard';
  end if;
end $storage$;

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname = 'user_preferences'
group by c.relname, c.relrowsecurity;


-- ############################################################################
-- # 20261015310000_m21_universal_moderation.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015320000_m11_chat_realtime_and_links.sql
-- ############################################################################

-- M11 follow-up — make one-to-one chat actually live, and fix the reply link.
--
-- Two production defects this corrects:
--
--   1. `public.messages` was never added to the `supabase_realtime` publication.
--      The `/chat/<matchId>` screen subscribes to `postgres_changes` INSERTs on
--      `messages`, and it neither appends locally nor refetches after a send, so
--      with no publication the subscription delivered NOTHING: neither the
--      partner's reply nor the member's own just-sent bubble appeared until a
--      manual reload. Every other realtime surface (notifications, moments,
--      moment_comments) was already added; `messages` was simply missed.
--
--   2. `notify_on_message()` stored the MESSAGE id in `notifications.entity_id`,
--      while `actionForNotification()` navigates to `/chat/<entity_id>` — a match
--      route. The "Reply" button therefore opened `/chat/<message-id>`, which
--      RLS filters to nothing, i.e. an empty thread. The trigger now stores the
--      MATCH id, and existing message notifications are repointed.
--
-- Idempotent: a guarded publication add, a `create or replace` function, and a
-- backfill that only touches rows still holding a message id. Safe to re-run.

-- 1. Stream message INSERTs to the browser.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
      raise notice 'messages added to supabase_realtime';
    else
      raise notice 'messages already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for messages in the dashboard';
  end if;
end $$;

-- 2. A message notification points at the CONVERSATION, not the message.
create or replace function public.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient uuid;
begin
  begin
    -- `messages.match_id` is text while `matches.id` is uuid, so compare as text.
    -- A malformed value simply matches nothing and yields no notification.
    select case when m.user_a = new.sender_id then m.user_b else m.user_a end
      into recipient
    from public.matches m
    -- Both sides cast to text: `messages.match_id` is `uuid` on the live project
    -- and `text` in some rebuilt environments. A one-sided cast raises
    -- "operator does not exist: text = uuid" the first time a message is sent.
    where m.id::text = new.match_id::text
    limit 1;

    if recipient is not null and recipient <> new.sender_id then
      -- entity_id is the match id so `/chat/<entity_id>` is a real thread.
      insert into public.notifications (user_id, actor_id, type, entity_id)
      values (recipient, new.sender_id, 'message', new.match_id::uuid);
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

-- 3. Repoint existing message notifications that still hold a message id.
update public.notifications n
set entity_id = m.match_id::uuid
from public.messages m
where n.type = 'message'
  and n.entity_id = m.id
  and n.entity_id is distinct from m.match_id::uuid;


-- ############################################################################
-- # 20261015330000_m22_profile_management_privacy.sql
-- ############################################################################

-- =============================================================================
-- M22 · Profile management, archiving and post-level privacy
-- =============================================================================
-- Gives the profile surface a Facebook-style management layer on top of the
-- existing Moments feed:
--
--   1. per-post privacy tiers   (only_me | matches | public)
--   2. an archive              (hidden from the profile + feed, capped at
--                               5 photo posts and 2 video posts per member)
--   3. author-only management  (edit caption, delete, archive, restore)
--
-- WHERE THE AUTHORISATION LIVES
--   There is no application server. The ONLY boundary is RLS + the two
--   `SECURITY DEFINER` functions that write the archive, which re-check
--   ownership explicitly. A browser-supplied id is never trusted.
--
-- THE TWO PRIVACY BUGS THIS CLOSES
--   Before this file, `moments_select_authenticated` let EVERY signed-in member
--   read EVERY post, and `moment_feed` is an owner-rights view (its comment
--   already warned it must be revisited "if that policy is ever tightened to a
--   subset of posts"). Tightening the base policy alone would have been a false
--   fix: the view would still hand out every row. So BOTH are updated here — the
--   RLS policy AND the view predicate — plus a second view for the archive.
--
-- SAFE TO RE-RUN: every statement is `add column if not exists` /
-- `drop … if exists` / name-guarded `add constraint`, and both views are dropped
-- and recreated (a view cannot gain columns via CREATE OR REPLACE).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. moments — privacy tier + archive column
-- ---------------------------------------------------------------------------
alter table public.moments add column if not exists visibility text not null default 'public';
alter table public.moments add column if not exists archived_at timestamptz;

-- `add constraint` has no `if not exists`; test the catalogue first.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'moments_visibility_chk' and conrelid = 'public.moments'::regclass
  ) then
    alter table public.moments
      add constraint moments_visibility_chk
      check (visibility in ('only_me', 'matches', 'public'));
  end if;
end $$;

-- The feed only ever reads active posts, the archive only archived ones, so both
-- get a partial index keyed on the author.
create index if not exists moments_author_active_idx
  on public.moments (author_id, created_at desc)
  where archived_at is null;

create index if not exists moments_author_archived_idx
  on public.moments (author_id, archived_at desc)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- 1b. profiles.status — the optional headline shown under the member's name
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists status text;

-- M15 dropped the table-wide SELECT grant and re-granted the columns that
-- existed THEN, so a column added later is not readable until it is named here.
grant select (status) on public.profiles to authenticated;

comment on column public.profiles.status is
  'Optional short headline (M22 profile status). Readable by any signed-in member; editable only by the owner through the profiles update policy.';

-- ---------------------------------------------------------------------------
-- 2. can_view_moment() — the single visibility rule, in one place
-- ---------------------------------------------------------------------------
-- PL/pgSQL (not SQL) so the body is resolved lazily and the function still
-- creates on a database where a dependency has not been applied yet.
--
-- SECURITY DEFINER so the follow/match lookups do not depend on the viewer's own
-- grants on `follows`/`matches`. `auth.uid()` still reads the REQUESTER's JWT
-- claim (it is a GUC, not the DB role), so the caller identity is correct.
create or replace function public.can_view_moment(p_author uuid, p_visibility text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me      uuid := auth.uid();
  visible boolean := false;
begin
  if me is null then
    return false;
  end if;

  -- The author always sees their own post (archived filtering is separate).
  if p_author = me then
    return true;
  end if;

  if p_visibility = 'public' then
    return true;
  end if;

  if p_visibility = 'matches' then
    -- "Followers / matches": a member who follows the author, or a mutual match.
    select
      exists (
        select 1 from public.follows f
        where f.follower_id = me and f.following_id = p_author
      )
      or exists (
        select 1 from public.matches m
        where (m.user_a = me and m.user_b = p_author)
           or (m.user_b = me and m.user_a = p_author)
      )
    into visible;
    return visible;
  end if;

  -- 'only_me' (and any unknown value) is never visible to a non-author.
  return false;
end;
$$;

comment on function public.can_view_moment(uuid, text) is
  'True when the caller may see a moment of the given visibility tier. SECURITY DEFINER so follow/match checks do not depend on the caller''s grants.';

revoke all on function public.can_view_moment(uuid, text) from public, anon;
grant execute on function public.can_view_moment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS — replace the blanket "everyone reads everything" select policy
-- ---------------------------------------------------------------------------
drop policy if exists "moments_select_authenticated" on public.moments;
drop policy if exists "moments_select_visible" on public.moments;
create policy "moments_select_visible"
  on public.moments for select to authenticated
  using (
    auth.uid() = author_id
    or (archived_at is null and public.can_view_moment(author_id, visibility))
  );

-- Insert / update / delete policies from the base moments migration are
-- unchanged: only the author may write, and the author already passes the select
-- policy for their own rows.

-- ---------------------------------------------------------------------------
-- 4. Archive capacity — 5 photo posts and 2 video posts, hard-enforced
-- ---------------------------------------------------------------------------
-- A BEFORE trigger, not a CHECK, because the limit is "at most N archived rows
-- per author", which depends on the other rows. SECURITY DEFINER so the count is
-- taken over ALL of the author's archived rows regardless of the caller's RLS.
create or replace function public.enforce_archive_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  is_video boolean;
  cap      integer;
  used     integer;
begin
  -- Nothing to enforce while the row is active.
  if new.archived_at is null then
    return new;
  end if;

  -- Re-saving an already-archived row must not consume a second slot.
  if tg_op = 'UPDATE' and old.archived_at is not null then
    return new;
  end if;

  -- A 'video' post is media_type = 'video'; everything else (including the
  -- legacy null) counts against the photo cap.
  is_video := new.media_type = 'video';
  cap      := case when is_video then 2 else 5 end;

  select count(*)::int into used
  from public.moments m
  where m.author_id = new.author_id
    and m.id <> new.id
    and m.archived_at is not null
    and (
      (is_video and m.media_type = 'video')
      or (not is_video and coalesce(m.media_type, 'image') <> 'video')
    );

  if used >= cap then
    raise exception 'archive_limit:%', case when is_video then 'video' else 'photo' end
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists moments_archive_capacity on public.moments;
create trigger moments_archive_capacity
  before insert or update of archived_at on public.moments
  for each row execute function public.enforce_archive_capacity();

-- ---------------------------------------------------------------------------
-- 5. Archive / restore — the only sanctioned writers of `archived_at`
-- ---------------------------------------------------------------------------
-- Both are SECURITY DEFINER so the ownership check is explicit (`author_id = me`)
-- rather than delegated to a policy the browser could be tricked out of.

create or replace function public.archive_moment(p_moment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me    uuid := auth.uid();
  moved boolean;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.moments
     set archived_at = now(), updated_at = now()
   where id = p_moment_id and author_id = me and archived_at is null
  returning true into moved;

  -- The capacity trigger raises `archive_limit:*` before this returns false.
  return coalesce(moved, false);
end;
$$;

create or replace function public.restore_moment(p_moment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me     uuid := auth.uid();
  moved  boolean;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Restoring puts the post back on the profile AND the Moments feed, so it
  -- returns to the public tier.
  update public.moments
     set archived_at = null, visibility = 'public', updated_at = now()
   where id = p_moment_id and author_id = me and archived_at is not null
  returning true into moved;

  return coalesce(moved, false);
end;
$$;

revoke all on function public.archive_moment(uuid) from public, anon;
revoke all on function public.restore_moment(uuid) from public, anon;
grant execute on function public.archive_moment(uuid) to authenticated;
grant execute on function public.restore_moment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Archive usage — one round trip for the dashboard's capacity meter
-- ---------------------------------------------------------------------------
create or replace function public.moment_archive_counts()
returns table (
  photo_count  integer,
  video_count  integer,
  photo_limit  integer,
  video_limit  integer
)
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

  return query
    select
      (select count(*)::int from public.moments m
        where m.author_id = me and m.archived_at is not null
          and coalesce(m.media_type, 'image') <> 'video'),
      (select count(*)::int from public.moments m
        where m.author_id = me and m.archived_at is not null
          and m.media_type = 'video'),
      5,
      2;
end;
$$;

revoke all on function public.moment_archive_counts() from public, anon;
grant execute on function public.moment_archive_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. moment_feed — rebuilt with visibility + archived filtering
-- ---------------------------------------------------------------------------
-- Owner-rights view: the base-table RLS does NOT apply inside it, so the
-- predicate is repeated here. `can_view_moment` already returns true for the
-- author, and archived rows are excluded for everyone (the author reads them
-- from `moment_archive` instead).
drop view if exists public.moment_feed;

create view public.moment_feed as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.tags,
  m.shares,
  m.views_count,
  m.visibility,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as unique_views
  from public.moment_views group by moment_id
) v on v.moment_id = m.id
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
where m.archived_at is null
  and public.can_view_moment(m.author_id, m.visibility);

grant select on public.moment_feed to authenticated;
revoke all on public.moment_feed from anon;

comment on view public.moment_feed is
  'Active moments the caller may see (respects visibility tier, hides archived), with media type, view totals, like/comment counts and a per-caller liked_by_me flag.';

-- ---------------------------------------------------------------------------
-- 8. moment_archive — the author's own archived posts
-- ---------------------------------------------------------------------------
-- Owner-rights view filtered to the caller, so a member can only ever read their
-- own archive.
drop view if exists public.moment_archive;

create view public.moment_archive as
select
  m.id,
  m.author_id,
  m.caption,
  m.media,
  m.media_type,
  m.tags,
  m.shares,
  m.views_count,
  m.visibility,
  m.archived_at,
  coalesce(v.unique_views, 0)   as unique_views,
  m.created_at,
  m.updated_at,
  coalesce(l.like_count, 0)     as like_count,
  coalesce(c.comment_count, 0)  as comment_count,
  coalesce(me.liked, false)     as liked_by_me
from public.moments m
left join (
  select moment_id, count(*)::int as unique_views
  from public.moment_views group by moment_id
) v on v.moment_id = m.id
left join (
  select moment_id, count(*)::int as like_count
  from public.moment_likes group by moment_id
) l on l.moment_id = m.id
left join (
  select moment_id, count(*)::int as comment_count
  from public.moment_comments group by moment_id
) c on c.moment_id = m.id
left join (
  select moment_id, true as liked
  from public.moment_likes where user_id = auth.uid()
) me on me.moment_id = m.id
where m.archived_at is not null
  and m.author_id = auth.uid();

grant select on public.moment_archive to authenticated;
revoke all on public.moment_archive from anon;

comment on view public.moment_archive is
  'The signed-in member''s own archived posts (never visible to anyone else), with the same engagement columns as moment_feed.';

comment on column public.moments.visibility is
  'Post privacy tier: only_me (author only), matches (followers/matches), public (everyone signed in).';
comment on column public.moments.archived_at is
  'Null while the post is on the profile; a timestamp once archived (hidden from the profile and feed, capped at 5 photos / 2 videos).';

-- ---------------------------------------------------------------------------
-- 9. Report the resulting posture
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('moments', 'moment_likes', 'moment_comments', 'moment_views')
group by c.relname, c.relrowsecurity
order by c.relname;


-- ############################################################################
-- # 20261015340000_m23_social_graph_and_privacy.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015350000_m24_authenticity_verification.sql
-- ############################################################################

-- =============================================================================
-- M24 — Authenticity verification and strict photo onboarding
-- =============================================================================
-- WHY
--   A dating profile is only worth trusting if the face in the photos belongs to
--   the person behind the account. This migration adds the durable record of
--   that claim:
--
--     * `profile_verifications` — one row per member: did a live face check, a
--       live voice check and a full photo audit pass, and for which gender.
--     * `profile_photo_checks`  — a per-photo audit trail (hash, role, verdict).
--
--   The rules are ENFORCED IN THE DATABASE, not in the wizard. The browser
--   talks straight to PostgREST, so a client-side gate is a suggestion. The
--   `enforce_verification_before_onboarding_trg` trigger is what makes
--   "you cannot publish a profile you have not verified" true: a member's own
--   write that flips `profiles.onboarding_completed` to true is refused unless a
--   complete verification AND a passing check for every saved photo already
--   exist. There is no INSERT/UPDATE policy on either new table, so a member can
--   never write their own verdict — only the secret-gated RPCs below can.
--
-- IDENTITY AND SECRETS
--   The AI itself lives in a server route (`/api/verification/*`), never in the
--   browser. The route holds a shared secret and calls the RPCs here the same
--   way the M21 moderation worker does: the secret is the authorisation
--   boundary, and only the server has it. `auth.uid()` still decides whose row a
--   verification is written to — a forged member id from the browser can never
--   mark somebody else verified. (Both `auth.uid()` and the shared secret are
--   checked; neither alone is trusted.)
--
-- PHOTOS ARE DATA URLS
--   This build stores gallery photos and the avatar inline as `data:` URLs, not
--   in Storage. Only an MD5 hash of each verified URL is kept here, so the audit
--   trail cannot become a second copy of a member's photo library.
--
-- SAFE TO RE-RUN: idempotent — `create table if not exists`, `add column if not
-- exists`, `drop policy if exists` before `create policy`, and `create or
-- replace function` throughout.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profile_verifications — one row per member
-- ---------------------------------------------------------------------------
create table if not exists public.profile_verifications (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  /** The gender the live face check confirmed. */
  gender           text,
  face_verified    boolean not null default false,
  voice_verified   boolean not null default false,
  photo_verified   boolean not null default false,
  /** MD5 of the live selfie that passed, so later photo checks reuse it. */
  face_ref_hash    text,
  /** Measured median pitch (Hz) from the voice check. Advisory, not a proof. */
  pitch_hz         numeric,
  face_checked_at  timestamptz,
  voice_checked_at timestamptz,
  photo_checked_at timestamptz,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profile_verifications is
  'Per-member authenticity record: face, voice and photo checks. Written only by the secret-gated verification RPCs; readable only by its owner.';

alter table public.profile_verifications enable row level security;

-- Owner may read their own verification status (the wizard shows it).
-- There is deliberately NO insert/update/delete policy: only the definer RPCs
-- write here, so a member cannot award themselves a verification.
drop policy if exists "profile_verifications_select_own" on public.profile_verifications;
create policy "profile_verifications_select_own"
  on public.profile_verifications for select to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_verifications from anon;
grant select on public.profile_verifications to authenticated;

-- ---------------------------------------------------------------------------
-- 2. profile_photo_checks — per-photo audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.profile_photo_checks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  photo_hash    text not null,
  role          text not null check (role in ('gallery', 'avatar')),
  human         boolean not null default false,
  gender_match  boolean not null default false,
  passed        boolean not null default false,
  provider      text,
  model         text,
  score         numeric,
  reasons       jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, photo_hash)
);

comment on table public.profile_photo_checks is
  'Audit trail of AI photo verdicts. Stores only an MD5 hash of each photo, never the image. Readable by its owner; written only by record_photo_check().';

create index if not exists profile_photo_checks_user_idx
  on public.profile_photo_checks (user_id, role, passed);

alter table public.profile_photo_checks enable row level security;

drop policy if exists "profile_photo_checks_select_own" on public.profile_photo_checks;
create policy "profile_photo_checks_select_own"
  on public.profile_photo_checks for select to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_photo_checks from anon;
grant select on public.profile_photo_checks to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_verification — the face/voice verdict writer (secret-gated)
-- ---------------------------------------------------------------------------
-- `p_kind` is 'face' or 'voice'. The member id is passed by the server route
-- AFTER it has validated the caller's access token, and the shared secret is
-- required on top of that, so neither a browser-supplied id nor a browser
-- request can reach this.
create or replace function public.record_verification(
  p_secret        text,
  p_user_id       uuid,
  p_kind          text,
  p_passed        boolean,
  p_gender        text default null,
  p_provider      text default null,
  p_model         text default null,
  p_score         numeric default null,
  p_face_ref_hash text default null,
  p_pitch_hz      numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_complete boolean;
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  -- `auth.uid()` must equal the subject when a member session is present. The
  -- server route calls with the member's own bearer token, so this holds; an
  -- operator/backfill with no session is allowed through on the secret alone.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot verify another member' using errcode = '42501';
  end if;

  if p_kind not in ('face', 'voice') then
    raise exception 'Unknown verification kind' using errcode = '22023';
  end if;

  -- A failed check clears the flag rather than recording a pass.
  if p_kind = 'face' then
    insert into public.profile_verifications (user_id, gender, face_verified, face_ref_hash, face_checked_at, updated_at)
    values (p_user_id, p_gender, coalesce(p_passed, false), p_face_ref_hash, now(), now())
    on conflict (user_id) do update set
      gender          = coalesce(excluded.gender, public.profile_verifications.gender),
      face_verified   = coalesce(p_passed, false),
      face_ref_hash   = case when coalesce(p_passed, false) then excluded.face_ref_hash else public.profile_verifications.face_ref_hash end,
      face_checked_at = now(),
      verified_at     = null,
      updated_at      = now();
  else
    insert into public.profile_verifications (user_id, voice_verified, pitch_hz, voice_checked_at, updated_at)
    values (p_user_id, coalesce(p_passed, false), p_pitch_hz, now(), now())
    on conflict (user_id) do update set
      voice_verified   = coalesce(p_passed, false),
      pitch_hz         = p_pitch_hz,
      voice_checked_at = now(),
      verified_at      = null,
      updated_at       = now();
  end if;

  -- Completion is derived, never asserted by the caller.
  select (face_verified and voice_verified and photo_verified)
    into v_complete
    from public.profile_verifications where user_id = p_user_id;

  update public.profile_verifications
     set verified_at = case when v_complete then now() else null end
   where user_id = p_user_id;

  -- `profiles.is_verified` is the public signal; it mirrors the record.
  update public.profiles
     set is_verified = coalesce(v_complete, false), updated_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'passed', coalesce(p_passed, false),
    'complete', coalesce(v_complete, false)
  );
end;
$$;

revoke all on function public.record_verification(text, uuid, text, boolean, text, text, text, numeric, text, numeric)
  from public, anon;
grant execute on function public.record_verification(text, uuid, text, boolean, text, text, text, numeric, text, numeric)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_photo_check — the per-photo verdict writer (secret-gated)
-- ---------------------------------------------------------------------------
create or replace function public.record_photo_check(
  p_secret       text,
  p_user_id      uuid,
  p_photo_url    text,
  p_role         text,
  p_human        boolean,
  p_gender_match boolean,
  p_passed       boolean,
  p_face_ref_hash text default null,
  p_provider     text default null,
  p_model        text default null,
  p_score        numeric default null,
  p_reasons      jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash     text;
  v_complete boolean;
  v_gallery  int;
  v_avatar   int;
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot verify another member' using errcode = '42501';
  end if;

  if p_role not in ('gallery', 'avatar') then
    raise exception 'Unknown photo role' using errcode = '22023';
  end if;

  if p_photo_url is null or length(p_photo_url) = 0 then
    raise exception 'A photo is required' using errcode = '22023';
  end if;

  -- A photo can only be judged against the selfie that already passed the live
  -- face check. The hash is supplied by the server route from the same selfie,
  -- so a member cannot swap in a different reference face between steps.
  if not exists (
    select 1 from public.profile_verifications
     where user_id = p_user_id and face_verified
       and (p_face_ref_hash is null or face_ref_hash = p_face_ref_hash)
  ) then
    raise exception 'A verified live selfie is required before photos can be checked'
      using errcode = '42501';
  end if;

  v_hash := md5(p_photo_url);

  insert into public.profile_photo_checks
      (user_id, photo_hash, role, human, gender_match, passed, provider, model, score, reasons)
  values
      (p_user_id, v_hash, p_role, coalesce(p_human, false), coalesce(p_gender_match, false),
       coalesce(p_passed, false), p_provider, p_model, p_score, p_reasons)
  on conflict (user_id, photo_hash) do update set
      role         = excluded.role,
      human        = excluded.human,
      gender_match = excluded.gender_match,
      passed       = excluded.passed,
      provider     = excluded.provider,
      model        = excluded.model,
      score        = excluded.score,
      reasons      = excluded.reasons,
      created_at   = now();

  -- Photo verification needs exactly the audit the trigger will demand: at least
  -- four passing gallery photos and one passing avatar.
  select count(*) filter (where role = 'gallery' and passed),
         count(*) filter (where role = 'avatar' and passed)
    into v_gallery, v_avatar
    from public.profile_photo_checks
   where user_id = p_user_id;

  update public.profile_verifications
     set photo_verified = (coalesce(v_gallery, 0) >= 4 and coalesce(v_avatar, 0) >= 1),
         photo_checked_at = now(),
         verified_at = null,
         updated_at = now()
   where user_id = p_user_id;

  select (face_verified and voice_verified and photo_verified)
    into v_complete
    from public.profile_verifications where user_id = p_user_id;

  update public.profile_verifications
     set verified_at = case when v_complete then now() else null end
   where user_id = p_user_id;

  update public.profiles
     set is_verified = coalesce(v_complete, false), updated_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'passed', coalesce(p_passed, false),
    'gallery', coalesce(v_gallery, 0),
    'avatar', coalesce(v_avatar, 0),
    'complete', coalesce(v_complete, false)
  );
end;
$$;

revoke all on function public.record_photo_check(text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb)
  from public, anon;
grant execute on function public.record_photo_check(text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The enforcement trigger: no unverified profile can be published
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_before_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v          record;
  v_gallery  int;
  v_avatar   int;
begin
  -- Only the transition to completed is gated, and only for the member's own
  -- browser write. Operator/backfill writes carry no session (auth.uid() null)
  -- and members already onboarded before this migration keep editing normally.
  if new.onboarding_completed is not true then
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.onboarding_completed, false) then
    return new;
  end if;

  if auth.uid() is null or auth.uid() <> new.id then
    return new;
  end if;

  select * into v from public.profile_verifications where user_id = new.id;
  if not found
     or not coalesce(v.face_verified, false)
     or not coalesce(v.voice_verified, false)
     or not coalesce(v.photo_verified, false) then
    raise exception 'Finish face, voice and photo verification before publishing your profile.'
      using errcode = '23514';
  end if;

  -- The avatar actually being saved must be one that passed...
  if new.avatar_url is null or new.avatar_url = '' or not exists (
    select 1 from public.profile_photo_checks c
     where c.user_id = new.id and c.role = 'avatar' and c.passed and c.photo_hash = md5(new.avatar_url)
  ) then
    raise exception 'Your profile picture has not been verified.'
      using errcode = '23514';
  end if;

  -- ...and every gallery photo being saved must have passed too.
  if exists (
    select 1 from unnest(coalesce(new.photos, '{}'::text[])) as p(url)
     where not exists (
       select 1 from public.profile_photo_checks c
        where c.user_id = new.id and c.role = 'gallery' and c.passed and c.photo_hash = md5(p.url)
     )
  ) then
    raise exception 'Every gallery photo must be verified before publishing.'
      using errcode = '23514';
  end if;

  select count(*) filter (where role = 'gallery' and passed),
         count(*) filter (where role = 'avatar' and passed)
    into v_gallery, v_avatar
    from public.profile_photo_checks
   where user_id = new.id;

  if coalesce(v_gallery, 0) < 4 or coalesce(v_avatar, 0) < 1 then
    raise exception 'At least four verified gallery photos and one verified profile picture are required.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_verification_before_onboarding_trg on public.profiles;
create trigger enforce_verification_before_onboarding_trg
  before insert or update on public.profiles
  for each row execute function public.enforce_verification_before_onboarding();

-- ---------------------------------------------------------------------------
-- 6. get_my_verification — the member's own status, for the wizard UI
-- ---------------------------------------------------------------------------
create or replace function public.get_my_verification()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v from public.profile_verifications where user_id = auth.uid();

  return jsonb_build_object(
    'gender', v.gender,
    'face_verified', coalesce(v.face_verified, false),
    'voice_verified', coalesce(v.voice_verified, false),
    'photo_verified', coalesce(v.photo_verified, false),
    'complete', coalesce(v.face_verified, false) and coalesce(v.voice_verified, false) and coalesce(v.photo_verified, false),
    'verified_at', v.verified_at
  );
end;
$$;

revoke all on function public.get_my_verification() from public, anon;
grant execute on function public.get_my_verification() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Posture report
-- ---------------------------------------------------------------------------
do $$
declare
  rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class where oid = 'public.profile_verifications'::regclass;
  raise notice 'M24 profile_verifications RLS: %', coalesce(rls_on, false);

  select relrowsecurity into rls_on from pg_class where oid = 'public.profile_photo_checks'::regclass;
  raise notice 'M24 profile_photo_checks RLS: %', coalesce(rls_on, false);
end;
$$;


-- ############################################################################
-- # 20261015360000_m25_account_moderation_tiers_and_disappearing_media.sql
-- ############################################################################

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


-- ############################################################################
-- # 20261015370000_m26_receipts_two_view_and_disappearing_chats.sql
-- ############################################################################

-- =============================================================================
-- M26 · Delivery/seen receipts, strict 2-view media, 24-hour disappearing chats
-- =============================================================================
-- Builds on M11 (messaging) and M25 (disappearing chat media) and adds the three
-- things a modern messenger is judged on:
--
--   1. DELIVERY + SEEN RECEIPTS. `messages.delivered_at`/`seen_at` record the
--      OTHER participant's receipt of a 1:1 message. They are stamped by
--      SECURITY DEFINER functions that resolve the recipient from the match, so
--      a member can only ever acknowledge messages addressed to them.
--
--   2. STRICT 2-VIEW MEDIA. M25 shipped a boolean `view_once`. M26 replaces it
--      with a counted `view_limit`/`view_count`, and rewrites the redeem RPC so
--      the SECOND recipient open permanently exhausts the item. The ledger row
--      survives as an audit trail (it is what the ban pipeline reads), but the
--      message is hidden from both members once exhausted.
--
--   3. 24-HOUR DISAPPEARING CHATS. A per-conversation `chat_settings` row can
--      set `disappear_after_seconds`. The `messages` SELECT policy then hides
--      anything older than that window, and `purge_expired_chat_content()`
--      actually deletes it. Neither client nor server trusts the client clock:
--      `now()` decides.
--
-- The bytes still live in the private `chat-media` bucket; only its readability
-- predicate changes, and that is decided from data.
--
-- SAFE TO RE-RUN: idempotent (`if not exists`, `create or replace`, explicit
-- `drop ... if exists` before each create).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Receipt columns on `messages`
-- ---------------------------------------------------------------------------
-- These describe the RECIPIENT's state, not the sender's: a row is "delivered"
-- when the other member's device has fetched it and "seen" when their thread was
-- open and scrolled to it. Null means "not yet", which is exactly how the UI
-- tells a single tick from a double tick.
alter table public.messages add column if not exists delivered_at timestamptz;
alter table public.messages add column if not exists seen_at      timestamptz;

-- The receipt sweep only ever looks at rows still missing a receipt.
create index if not exists messages_pending_receipt_idx
  on public.messages (match_id, created_at)
  where seen_at is null;

-- ---------------------------------------------------------------------------
-- 2. Counted views on `chat_media`
-- ---------------------------------------------------------------------------
-- `view_once` is kept for backward compatibility (and because it is a useful
-- audit flag) but is no longer read by any policy or RPC. `view_count` is
-- incremented by `redeem_chat_media()`; `view_limit` is what the send RPC sets.
alter table public.chat_media add column if not exists view_limit integer not null default 2;
alter table public.chat_media add column if not exists view_count integer not null default 0;

-- Rows written before this migration defaulted to a single view.
update public.chat_media
   set view_limit = 1
 where view_once = true
   and view_limit = 2;

-- ---------------------------------------------------------------------------
-- 3. chat_settings — one row per conversation
-- ---------------------------------------------------------------------------
-- `disappear_after_seconds` is null when normal (non-disappearing) chat is on.
-- The CHECK clamps any value to a sane window so a client cannot ask for a
-- one-second or decade-long retention.
create table if not exists public.chat_settings (
  match_id                uuid primary key references public.matches(id) on delete cascade,
  disappear_after_seconds integer
    check (disappear_after_seconds is null
           or (disappear_after_seconds >= 60 and disappear_after_seconds <= 604800)),
  updated_by              uuid references auth.users(id) on delete set null,
  updated_at              timestamptz not null default now()
);

-- The M4 audit fails any unindexed foreign key; the primary key covers match_id.
create index if not exists chat_settings_updated_by_idx
  on public.chat_settings (updated_by);

alter table public.chat_settings enable row level security;

-- Participants may read their own conversation's setting. There is no write
-- policy: only `set_disappearing_messages()` (SECURITY DEFINER) writes.
drop policy if exists "chat_settings_select_participant" on public.chat_settings;
create policy "chat_settings_select_participant"
  on public.chat_settings for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = chat_settings.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

grant select on public.chat_settings to authenticated;
revoke all on public.chat_settings from anon;

-- ---------------------------------------------------------------------------
-- 4. Expiry helpers (declared BEFORE the policy that calls them)
-- ---------------------------------------------------------------------------
-- `messages.match_id` is `uuid` on the live project and `text` in the harness,
-- so the parameter is `text` and every caller casts; a one-sided comparison
-- would fail CREATE POLICY type-checking on one of the two shapes.
create or replace function public.chat_disappear_seconds(p_match_id text)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cs.disappear_after_seconds
  from public.chat_settings cs
  where cs.match_id::text = p_match_id;
$$;

-- Is a message still inside the conversation's retention window? A conversation
-- with no setting (or a null setting) keeps everything.
create or replace function public.message_is_alive(p_match_id text, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select cs.disappear_after_seconds
       from public.chat_settings cs
      where cs.match_id::text = p_match_id),
    0
  ) = 0
  or p_created_at > now() - make_interval(
       secs => (select cs.disappear_after_seconds
                  from public.chat_settings cs
                 where cs.match_id::text = p_match_id)
     );
$$;

revoke all on function public.chat_disappear_seconds(text) from public, anon;
revoke all on function public.message_is_alive(text, timestamptz) from public, anon;
grant execute on function public.chat_disappear_seconds(text) to authenticated;
grant execute on function public.message_is_alive(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. messages SELECT policy — participants, and not past its expiry
-- ---------------------------------------------------------------------------
-- The M25 read path is preserved exactly; the only addition is the retention
-- gate. Because Realtime evaluates this same policy, an expired message is not
-- pushed to a live client either.
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id::text = messages.match_id::text
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
    and public.message_is_alive(messages.match_id::text, messages.created_at)
  );

-- ---------------------------------------------------------------------------
-- 6. chat_media readability — counted views, not a boolean
-- ---------------------------------------------------------------------------
-- The sender may always read their own object. The recipient may read while the
-- item is fresh (views remaining) or during a short grace window after a redeem
-- stamped `viewed_at` — that grace is what lets the bytes actually download on
-- the final permitted open. Once exhausted, the object is unreadable even if a
-- client still knows the path.
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
            cm.view_count < cm.view_limit
            or cm.viewed_at > now() - interval '2 minutes'
          )
        )
      )
  );
$$;

revoke all on function public.chat_media_can_read_storage(text) from public, anon;
grant execute on function public.chat_media_can_read_storage(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. send_chat_media() — now takes a view limit
-- ---------------------------------------------------------------------------
-- The M25 signature took a boolean. It is dropped rather than overloaded so
-- there is exactly one entry point and no ambiguity for a named-argument call.
drop function if exists public.send_chat_media(uuid, text, text, boolean, integer);

create or replace function public.send_chat_media(
  p_match_id     uuid,
  p_storage_path text,
  p_media_type   text    default 'image',
  p_view_limit   integer default 2,
  p_ttl_seconds  integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me         uuid := auth.uid();
  msg_id     uuid;
  media_id   uuid;
  ttl        integer;
  vlimit     integer;
  expires    timestamptz;
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
  -- Every item is a strict 2-view by default; the range keeps a hostile client
  -- from asking for "unlimited" (0) or a thousand views.
  vlimit  := greatest(1, least(coalesce(p_view_limit, 2), 5));
  expires := now() + make_interval(secs => ttl);

  insert into public.messages (match_id, sender_id, content)
  values (p_match_id, me, '')
  returning id into msg_id;

  insert into public.chat_media
    (message_id, match_id, sender_id, storage_path, media_type, view_limit, expires_at)
  values
    (msg_id, p_match_id, me, p_storage_path, p_media_type, vlimit, expires)
  returning id into media_id;

  return jsonb_build_object(
    'media_id', media_id,
    'message_id', msg_id,
    'view_limit', vlimit,
    'expires_at', expires
  );
end;
$$;

revoke all on function public.send_chat_media(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.send_chat_media(uuid, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. redeem_chat_media() — counts a view and exhausts at the limit
-- ---------------------------------------------------------------------------
-- The recipient's open increments `view_count` and stamps `viewed_at`. The
-- sender's own redeem never counts, so they can preview the item they sent.
-- When `view_count` reaches `view_limit` the item reports `exhausted` and neither
-- member can open it again.
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

  -- The sender previews without spending the recipient's views.
  if cm.sender_id = me then
    return jsonb_build_object(
      'available', true,
      'storage_path', cm.storage_path,
      'media_type', cm.media_type,
      'view_limit', cm.view_limit,
      'view_count', cm.view_count,
      'remaining', greatest(cm.view_limit - cm.view_count, 0),
      'expires_at', cm.expires_at
    );
  end if;

  if cm.view_count >= cm.view_limit then
    return jsonb_build_object('available', false, 'reason', 'exhausted');
  end if;

  update public.chat_media
     set view_count = cm.view_count + 1,
         viewed_at  = now()
   where id = cm.id
  returning view_count into cm.view_count;

  return jsonb_build_object(
    'available', true,
    'storage_path', cm.storage_path,
    'media_type', cm.media_type,
    'view_limit', cm.view_limit,
    'view_count', cm.view_count,
    'remaining', greatest(cm.view_limit - cm.view_count, 0),
    'expires_at', cm.expires_at
  );
end;
$$;

revoke all on function public.redeem_chat_media(uuid) from public, anon;
grant execute on function public.redeem_chat_media(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. set_disappearing_messages() — the 24-hour toggle
-- ---------------------------------------------------------------------------
-- Only a participant may change it, and only to a value inside the CHECK window.
-- Passing null (or 0) disables disappearing mode.
create or replace function public.set_disappearing_messages(p_match_id uuid, p_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me    uuid := auth.uid();
  secs  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  secs := nullif(p_seconds, 0);
  if secs is not null then
    secs := greatest(60, least(secs, 604800));
  end if;

  insert into public.chat_settings (match_id, disappear_after_seconds, updated_by, updated_at)
  values (p_match_id, secs, me, now())
  on conflict (match_id) do update
    set disappear_after_seconds = excluded.disappear_after_seconds,
        updated_by              = excluded.updated_by,
        updated_at              = now();

  return jsonb_build_object('disappear_after_seconds', secs);
end;
$$;

revoke all on function public.set_disappearing_messages(uuid, integer) from public, anon;
grant execute on function public.set_disappearing_messages(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Receipts: mark_conversation_read() also stamps "seen"
-- ---------------------------------------------------------------------------
-- Opening the thread clears the badge (M11) AND acknowledges everything the
-- other member sent, in one round trip. The recipient is derived from the match,
-- never from an argument, so a member can only acknowledge messages sent TO them.
create or replace function public.mark_conversation_read(p_match_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  ts timestamptz := now();
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  insert into public.match_read_state (match_id, user_id, last_read_at)
  values (p_match_id, me, ts)
  on conflict (match_id, user_id)
    do update set last_read_at = excluded.last_read_at;

  update public.messages
     set seen_at      = ts,
         delivered_at = coalesce(delivered_at, ts)
   where messages.match_id::text = p_match_id::text
     and messages.sender_id <> me
     and messages.seen_at is null;

  return ts;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- mark_messages_delivered() — the lighter acknowledgement, called as soon as the
-- recipient's device has the thread open (whether or not they have read it).
create or replace function public.mark_messages_delivered(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  n  integer;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id and (m.user_a = me or m.user_b = me)
  ) then
    raise exception 'Not a participant in this conversation' using errcode = '42501';
  end if;

  update public.messages
     set delivered_at = now()
   where messages.match_id::text = p_match_id::text
     and messages.sender_id <> me
     and messages.delivered_at is null;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_messages_delivered(uuid) from public, anon;
grant execute on function public.mark_messages_delivered(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. purge_expired_chat_content() — actually delete what has aged out
-- ---------------------------------------------------------------------------
-- RLS hides expired messages; this removes them for good (and their media ledger
-- rows for good measure). A member may only purge conversations they are in, and
-- only rows past that conversation's window.
create or replace function public.purge_expired_chat_content()
returns integer
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

  delete from public.chat_media cm
   where exists (
     select 1
     from public.messages m
     join public.chat_settings cs on cs.match_id::text = m.match_id::text
     join public.matches mt        on mt.id::text = m.match_id::text
     where cm.message_id = m.id
       and cs.disappear_after_seconds is not null
       and (mt.user_a = me or mt.user_b = me)
       and m.created_at < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  delete from public.messages m
   where exists (
     select 1
     from public.chat_settings cs
     join public.matches mt on mt.id::text = m.match_id::text
     where cs.match_id::text = m.match_id::text
       and cs.disappear_after_seconds is not null
       and (mt.user_a = me or mt.user_b = me)
       and m.created_at < now() - make_interval(secs => cs.disappear_after_seconds)
   );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_chat_content() from public, anon;
grant execute on function public.purge_expired_chat_content() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Realtime — publish chat_media so an exhausted item vanishes live
-- ---------------------------------------------------------------------------
-- `messages` was already added by M11 and its publication publishes UPDATE, so
-- a receipt change reaches the sender. `chat_media` is new here.
do $rt$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chat_media'
    ) then
      alter publication supabase_realtime add table public.chat_media;
      raise notice 'chat_media added to supabase_realtime';
    else
      raise notice 'chat_media already in supabase_realtime';
    end if;
  else
    raise notice 'supabase_realtime publication not found - enable Realtime for chat_media in the dashboard';
  end if;
end
$rt$;

-- ---------------------------------------------------------------------------
-- 13. Documentation for the next reader
-- ---------------------------------------------------------------------------
comment on column public.messages.delivered_at is
  'When the OTHER participant''s device fetched this message (M26 delivery receipt).';
comment on column public.messages.seen_at is
  'When the OTHER participant read this message with the thread open (M26 read receipt).';
comment on column public.chat_media.view_limit is
  'How many times the recipient may open this item (M26; default 2).';
comment on column public.chat_media.view_count is
  'Times the recipient has opened this item (M26). At view_limit the item is exhausted.';
comment on table public.chat_settings is
  'Per-conversation retention (M26). disappear_after_seconds non-null enables disappearing mode; written only by set_disappearing_messages().';
comment on function public.redeem_chat_media(uuid) is
  'Counts one recipient open of a chat media item and returns its path; refuses once view_count reaches view_limit (M26).';
comment on function public.mark_messages_delivered(uuid) is
  'Stamps delivered_at on unacknowledged messages the signed-in member received (M26).';
comment on function public.purge_expired_chat_content() is
  'Deletes messages (and their media ledger rows) past their conversation''s disappearing window (M26).';


-- ############################################################################
-- # 20261015380000_m27_interface_language.sql
-- ############################################################################

-- =============================================================================
-- M27 · interface language preference
-- =============================================================================
-- Adds `interface_language` to `user_preferences`: the UI language a member
-- chose in Settings, stored server-side so it follows them to a new device
-- instead of living only in that device's localStorage.
--
-- WHY A COLUMN HERE AND NOT ON `profiles`
--   `user_preferences` is already the member-scoped home for settings (M17/M20),
--   with owner-only RLS and an upsert-on-write client. A UI language is exactly
--   that kind of value, so it joins the row rather than widening `profiles`,
--   which every public projection has to reason about.
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`, and `drop constraint
-- if exists` before `add constraint`). No new table, so no new policy is needed:
-- the existing user_preferences RLS already scopes this column to its owner.
-- =============================================================================

alter table public.user_preferences
  add column if not exists interface_language varchar(10) not null default 'en';

-- Same shape as `user_preferences_language_format` (M17): the value indexes a
-- UI locale table, so an unconstrained string is both an injection surface and a
-- guaranteed "missing translation" fallback.
alter table public.user_preferences
  drop constraint if exists user_preferences_interface_language_format;
alter table public.user_preferences
  add constraint user_preferences_interface_language_format
  check (interface_language ~ '^[a-z]{2}(-[a-z]{2})?$');

comment on column public.user_preferences.interface_language is
  'The member''s chosen interface (UI) language. Defaults to en.';


-- ############################################################################
-- # 20261015390000_m28_location_verification.sql
-- ############################################################################

-- =============================================================================
-- M28 · Profile location verification
-- =============================================================================
-- Adds two owner-scoped columns to `profiles` that power the "where are you?"
-- prompt (see src/hooks/useLocationVerification.ts):
--
--   current_location     the last city/country the member confirmed, as text
--   last_location_check  when the member last confirmed (or dismissed) it
--
-- The client re-checks every 5 days, so `last_location_check` is an
-- acknowledgement timestamp ("I have seen this and it is current"), not an
-- audit trail that must be append-only.
--
-- WHY THESE COLUMNS NEED AN EXPLICIT GRANT
--   M15 (20261015260000) dropped the table-wide SELECT on `profiles` and
--   re-granted only the columns that existed *then*, computed from the
--   catalogue at the moment M15 ran. A column added afterwards is therefore NOT
--   readable — this migration must grant it, or the client's
--   `select current_location, last_location_check` fails with a permission
--   error. (On a full replay M15 recomputes its list and covers them too; the
--   grant here is what makes an *incremental* apply correct.)
--
-- SAFE TO RE-RUN: idempotent (`add column if not exists`, bare `grant`).
-- No new table, so no new RLS policy is needed: `profiles_update_own` (M6)
-- already scopes every write to `auth.uid() = id`, and these two columns are
-- owner-only data that no public projection reads.
-- =============================================================================

alter table public.profiles
  add column if not exists current_location text;

alter table public.profiles
  add column if not exists last_location_check timestamptz;

comment on column public.profiles.current_location is
  'Last city/country the member confirmed, e.g. "Kathmandu, Nepal". Free text, owner-written; never shown on a public projection.';

comment on column public.profiles.last_location_check is
  'When the member last confirmed or dismissed the location prompt. Drives the 5-day re-check.';

-- The owner reads their own row through the same authenticated role as every
-- other profile column (M6 select policy → M15 column grant).
grant select (current_location, last_location_check)
  on public.profiles to authenticated;

-- Writes still require ownership via `profiles_update_own`; granting the
-- columns keeps this usable even if a later migration drops the table-wide
-- UPDATE, without widening who may write them.
grant update (current_location, last_location_check)
  on public.profiles to authenticated;

-- `anon` was stripped of profile SELECT entirely by M15 and never had a write
-- policy; state that explicitly for these columns too.
revoke all (current_location, last_location_check)
  on public.profiles from anon;


-- ############################################################################
-- # 20261015400000_m29_subbu_bans.sql
-- ############################################################################

-- =============================================================================
-- M29 · Subbu bans — real, enforced, time-boxed account bans
-- =============================================================================
-- WHY
--   The Subbu companion could previously only *say* "you are banned". There was
--   no ban column, and the API/front-end never consulted one — so the warning
--   was roleplay. This migration gives the bot a real ban that the chat API
--   enforces before it talks to the model, and that the chat UI renders on load.
--
-- WHAT THIS DOES
--   1. profiles.banned_until / ban_reason (NULL = not banned).
--   2. Extends M14's `protect_moderation_columns()` to the ban columns, so a
--      member can neither clear nor shorten their own ban.
--   3. `apply_self_ban(days, reason)` — the ONLY writer. It is SECURITY DEFINER
--      and derives the subject from `auth.uid()`. It accepts NO user id, so a
--      prompt-injected model or a malicious caller can never ban somebody else.
--   4. `my_ban_status()` — the caller's own ban only, for the API, proxy and UI.
--
-- PRIVACY
--   The new columns are deliberately NOT granted to `authenticated`. The ban is
--   read through `my_ban_status()`, so one member cannot read another's ban
--   state (and `select *` on profiles cannot expose it).
--
-- SAFE TO RE-RUN: idempotent (add column if not exists / create or replace).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The ban itself
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists banned_until timestamptz;
alter table public.profiles add column if not exists ban_reason   text;

comment on column public.profiles.banned_until is
  'End of a Subbu-issued account ban. NULL or in the past = not banned.';
comment on column public.profiles.ban_reason is
  'Machine token describing a Subbu ban (e.g. verbal_harassment, explicit_image).';

create index if not exists profiles_banned_until_idx
  on public.profiles (banned_until)
  where banned_until is not null;

-- ---------------------------------------------------------------------------
-- 2. Guard the ban columns exactly like the suspension columns
-- ---------------------------------------------------------------------------
-- Replaces the M21 body with one that also compares the ban fields. The
-- transaction-local `mettivo.moderation_action` flag is how the SECURITY DEFINER
-- writer below is allowed through; a client cannot set it in the RPC's
-- transaction.
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
       or new.suspension_reason is not null
       or new.banned_until is not null
       or new.ban_reason is not null then
      raise exception 'Not allowed to set moderation fields.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.is_suspended       is distinct from old.is_suspended
     or new.suspended_at       is distinct from old.suspended_at
     or new.suspension_reason  is distinct from old.suspension_reason
     or new.banned_until       is distinct from old.banned_until
     or new.ban_reason         is distinct from old.ban_reason then
    raise exception 'Not allowed to change moderation fields.' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The single writer — always the caller
-- ---------------------------------------------------------------------------
create or replace function public.apply_self_ban(
  p_duration_days integer,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me        uuid := auth.uid();
  reason    text := left(coalesce(nullif(trim(p_reason), ''), 'community_guidelines'), 120);
  base      timestamptz;
  new_until timestamptz;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- 2 days (text) and 30 days (explicit image) are the product tiers; the range
  -- guard stops a caller from self-applying an absurd window.
  if p_duration_days is null or p_duration_days < 1 or p_duration_days > 30 then
    raise exception 'Invalid ban duration' using errcode = '22023';
  end if;

  -- Never shorten an existing ban: start from the later of now and the current
  -- end, then add the new window.
  select greatest(now(), coalesce(p.banned_until, now()))
    into base
  from public.profiles p
  where p.id = me;

  if base is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  new_until := base + make_interval(days => p_duration_days);

  perform set_config('mettivo.moderation_action', 'on', true);
  update public.profiles
     set banned_until = new_until,
         ban_reason   = reason
   where id = me;
  perform set_config('mettivo.moderation_action', 'off', true);

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'user.subbu_banned', me,
          jsonb_build_object('days', p_duration_days, 'reason', reason, 'banned_until', new_until));

  return jsonb_build_object('ok', true, 'banned_until', new_until, 'reason', reason);
end;
$$;

revoke all on function public.apply_self_ban(integer, text) from public, anon;
grant execute on function public.apply_self_ban(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The caller's own ban only
-- ---------------------------------------------------------------------------
create or replace function public.my_ban_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'banned',       coalesce(p.banned_until > now(), false),
    'banned_until', p.banned_until,
    'ban_reason',   p.ban_reason
  )
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.my_ban_status() from public, anon;
grant execute on function public.my_ban_status() to authenticated;

commit;


-- ############################################################################
-- # 20261015410000_m30_ludo_solo_playable.sql
-- ############################################################################

-- =============================================================================
-- M30 · Ludo Royale & Ludo Dash — playable solo against bots
-- =============================================================================
-- M14 (20261015180000_game_zone.sql) seeded four games and left both Ludo
-- variants `is_playable = false` on purpose: they needed realtime turn
-- synchronisation this build did not have. They now have a full local rules
-- engine and bot opponent (`src/app/components/games/ludo.ts`), so a player can
-- finish a whole game on-device and record the result.
--
-- WHY THIS MIGRATION IS REQUIRED, NOT OPTIONAL
--   `record_game_result()` rejects a game id that is not playable, and rejects a
--   score above its `max_score`. The client registry now launches both variants
--   with a ceiling of 100, so the catalogue must agree or a finished game would
--   fail to save its result. The UI and the database must stay in step.
--
-- SAFE TO RE-RUN: idempotent upsert on the primary key. No DDL, no policy or
-- grant changes — the existing `game_catalog_readable` policy already covers
-- these rows.
-- =============================================================================

insert into public.game_catalog (game_id, title, is_playable, max_score, sort_order) values
  ('ludo-royale', 'Ludo Royale', true, 100, 3),
  ('ludo-dash',   'Ludo Dash',   true, 100, 4)
on conflict (game_id) do update
  set title       = excluded.title,
      is_playable = excluded.is_playable,
      max_score   = excluded.max_score,
      sort_order  = excluded.sort_order;

-- Report the resulting posture, so applying this by hand in the SQL Editor
-- shows what changed rather than returning silently.
select
  count(*) filter (where is_playable) as playable_games,
  count(*)                            as total_games
from public.game_catalog;


-- ############################################################################
-- # 20261015420000_m31_remove_face_voice_verification.sql
-- ############################################################################

-- =============================================================================
-- M31 — Remove face and voice verification
-- =============================================================================
-- WHY
--   The product no longer performs face, voice or AI photo verification. The
--   onboarding wizard now accepts a profile picture and four gallery photos
--   without a biometric check.
--
--   Removing the UI alone is not enough: the M24 trigger is the real gate and
--   would keep refusing `onboarding_completed = true` for every unverified
--   member. This migration removes that enforcement and retires the
--   secret-gated writer RPCs and the status reader.
--
-- DATA SAFETY
--   `profile_verifications` and `profile_photo_checks` are NOT dropped. Their
--   contents are historical records and may be needed for audit or rollback.
--   They remain RLS-protected and owner-readable, but no application code writes
--   them after this migration. `profiles.is_verified` is likewise retained; it
--   is simply no longer updated by the application.
--
-- SAFE TO RE-RUN: every statement is `drop ... if exists`, so a second run is a
-- no-op.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove the onboarding gate first: the trigger depends on the function.
-- ---------------------------------------------------------------------------
drop trigger if exists enforce_verification_before_onboarding_trg on public.profiles;
drop function if exists public.enforce_verification_before_onboarding();

-- ---------------------------------------------------------------------------
-- 2. Retire the secret-gated verdict writers and the status reader.
-- ---------------------------------------------------------------------------
drop function if exists public.record_verification(
  text, uuid, text, boolean, text, text, text, numeric, text, numeric
);

drop function if exists public.record_photo_check(
  text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb
);

drop function if exists public.get_my_verification();

-- ---------------------------------------------------------------------------
-- 3. Mark the retained audit tables as historical.
-- ---------------------------------------------------------------------------
comment on table public.profile_verifications is
  'Historical M24 authenticity records retained for audit. Face/voice verification was removed in M31; the application no longer reads or writes this table.';

comment on table public.profile_photo_checks is
  'Historical M24 photo-verdict records retained for audit. Photo verification was removed in M31; the application no longer reads or writes this table.';

-- ---------------------------------------------------------------------------
-- 4. Posture report
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice 'M31 removed face/voice verification trigger and RPCs; historical tables retained';
end;
$$;


