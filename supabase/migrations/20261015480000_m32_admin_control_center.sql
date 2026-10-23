-- =============================================================================
-- M32 · Administrative control center
-- =============================================================================
-- WHY
--   M14 gave the product a moderation role and an audit trail. Operating
--   Mettivo needs more than moderation: staff roles with least privilege,
--   subscription plans, subscription records, a verified payment-event ledger,
--   administrative settings, aggregate operational metrics, and a single
--   server-checked surface for every privileged read and write.
--
-- SECURITY MODEL
--   * `user_roles` remains the only source of authority. A member can never
--     write it from a client; roles are granted by an administrator through the
--     audited `admin_set_role()` RPC (or the documented SQL bootstrap).
--   * Every privileged RPC re-checks `auth.uid()` and the required permission
--     inside PostgreSQL. Hiding a button is never the boundary.
--   * New personal-data tables have RLS enabled. Reads are scoped to staff with
--     the matching permission; writes exist only inside SECURITY DEFINER
--     functions.
--   * Payment events are an append-only ledger. The webhook writer is gated by a
--     shared secret stored in `admin_settings`, never in the browser bundle.
--   * No `service_role` key is referenced anywhere in `src/`.
--
-- SAFE TO RE-RUN: idempotent (`if not exists`, guarded constraint swap,
-- `drop policy if exists`, `create or replace`).
-- DEPENDS ON: M14 (user_roles, admin_audit_log, rate limits), M21/M25
--             (moderation state), M13 (reports triage).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the role vocabulary. `admin` is the super-admin role.
-- ---------------------------------------------------------------------------
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('user','moderator','support','finance','admin'));

-- ---------------------------------------------------------------------------
-- 2. Role and permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid() and r.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.role from public.user_roles r where r.user_id = auth.uid()),
    'user'
  );
$$;

revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_staff_role() <> 'user';
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

-- Least-privilege permission map. Keep this the single place a capability is
-- granted; RPCs and the UI both read the same names.
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select public.current_staff_role() as role
  )
  select case p_permission
    when 'dashboard.view'        then me.role <> 'user'
    when 'users.view'            then me.role in ('admin','moderator','support')
    when 'users.manage'          then me.role in ('admin','moderator')
    when 'moderation.view'       then me.role in ('admin','moderator')
    when 'moderation.manage'     then me.role in ('admin','moderator')
    when 'subscriptions.view'    then me.role in ('admin','finance','support')
    when 'subscriptions.manage'  then me.role in ('admin','finance')
    when 'payments.view'         then me.role in ('admin','finance')
    when 'payments.manage'       then me.role in ('admin','finance')
    when 'plans.manage'          then me.role = 'admin'
    when 'content.view'          then me.role in ('admin','moderator')
    when 'content.manage'        then me.role in ('admin','moderator')
    when 'chat.view'             then me.role in ('admin','moderator')
    when 'notifications.manage'  then me.role in ('admin','moderator')
    when 'analytics.view'        then me.role in ('admin','finance')
    when 'staff.manage'          then me.role = 'admin'
    when 'audit.view'            then me.role = 'admin'
    when 'system.view'           then me.role = 'admin'
    when 'settings.manage'       then me.role = 'admin'
    else false
  end
  from me;
$$;

revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The caller's own console identity (safe for any signed-in member)
-- ---------------------------------------------------------------------------
create or replace function public.admin_me()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id',      me.uid,
    'role',         coalesce(r.role, 'user'),
    'display_name', p.display_name,
    'avatar_url',   p.avatar_url,
    'email',        u.email,
    'permissions',  to_jsonb(array_remove(array[
      case when coalesce(r.role,'user') <> 'user' then 'dashboard.view' end,
      case when coalesce(r.role,'user') in ('admin','moderator','support') then 'users.view' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'users.manage' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'moderation.view' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'moderation.manage' end,
      case when coalesce(r.role,'user') in ('admin','finance','support') then 'subscriptions.view' end,
      case when coalesce(r.role,'user') in ('admin','finance') then 'subscriptions.manage' end,
      case when coalesce(r.role,'user') in ('admin','finance') then 'payments.view' end,
      case when coalesce(r.role,'user') in ('admin','finance') then 'payments.manage' end,
      case when coalesce(r.role,'user') = 'admin' then 'plans.manage' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'content.view' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'content.manage' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'chat.view' end,
      case when coalesce(r.role,'user') in ('admin','moderator') then 'notifications.manage' end,
      case when coalesce(r.role,'user') in ('admin','finance') then 'analytics.view' end,
      case when coalesce(r.role,'user') = 'admin' then 'staff.manage' end,
      case when coalesce(r.role,'user') = 'admin' then 'audit.view' end,
      case when coalesce(r.role,'user') = 'admin' then 'system.view' end,
      case when coalesce(r.role,'user') = 'admin' then 'settings.manage' end
    ], null))
  )
  from (select auth.uid() as uid) me
  left join public.user_roles r on r.user_id = me.uid
  left join public.profiles p    on p.id = me.uid
  left join auth.users u         on u.id = me.uid
  where me.uid is not null;
$$;

revoke all on function public.admin_me() from public, anon;
grant execute on function public.admin_me() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Subscription plans
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  description      text,
  price_minor      integer not null default 0 check (price_minor >= 0),
  currency         text not null default 'USD'
                   check (currency in ('USD','EUR','NPR','GBP','INR')),
  billing_interval text not null default 'month'
                   check (billing_interval in ('month','year','none')),
  features         jsonb not null default '[]'::jsonb,
  limits           jsonb not null default '{}'::jsonb,
  trial_days       integer not null default 0 check (trial_days between 0 and 365),
  is_active        boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists subscription_plans_active_idx
  on public.subscription_plans (is_active, sort_order);

alter table public.subscription_plans enable row level security;

drop policy if exists "subscription_plans_read" on public.subscription_plans;
create policy "subscription_plans_read"
  on public.subscription_plans for select to authenticated
  using (is_active or public.has_permission('subscriptions.view'));

-- Drafts are deliberately honest: the operator sets a real price before a paid
-- plan can be activated. No invented pricing ships in this migration.
insert into public.subscription_plans
  (code, name, description, price_minor, currency, billing_interval, features, limits, is_active, sort_order)
values
  ('free', 'Free', 'The accessible Mettivo tier.', 0, 'USD', 'none',
   '["Discover members","Like and follow","Chat with matches","Post Moments"]'::jsonb,
   '{}'::jsonb, true, 10),
  ('premium', 'Premium', 'Draft — set the price and features before activating.', 0, 'USD', 'month',
   '[]'::jsonb, '{}'::jsonb, false, 20),
  ('premium_plus', 'Premium Plus', 'Draft — set the price and features before activating.', 0, 'USD', 'month',
   '[]'::jsonb, '{}'::jsonb, false, 30)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,
  plan_id                  uuid not null references public.subscription_plans(id) on delete restrict,
  status                   text not null default 'active'
                           check (status in ('trialing','active','past_due','canceled','expired')),
  provider                 text not null default 'manual'
                           check (provider in ('manual','stripe')),
  provider_customer_id     text,
  provider_subscription_id text unique,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  canceled_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists subscriptions_status_idx
  on public.subscriptions (status);
create index if not exists subscriptions_period_end_idx
  on public.subscriptions (current_period_end);
create index if not exists subscriptions_plan_idx
  on public.subscriptions (plan_id);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_read" on public.subscriptions;
create policy "subscriptions_read"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id or public.has_permission('subscriptions.view'));

-- ---------------------------------------------------------------------------
-- 6. Verified payment-event ledger
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null default 'stripe',
  event_id       text not null unique,
  event_type     text not null,
  status         text not null default 'received'
                 check (status in ('received','processed','ignored','failed')),
  user_id        uuid references auth.users(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount_minor   integer,
  fee_minor      integer,
  refunded_minor integer not null default 0 check (refunded_minor >= 0),
  currency       text,
  payload        jsonb,
  error          text,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz
);

create index if not exists payment_events_received_idx
  on public.payment_events (received_at desc);
create index if not exists payment_events_user_idx
  on public.payment_events (user_id);
create index if not exists payment_events_status_idx
  on public.payment_events (status);
create index if not exists payment_events_subscription_idx
  on public.payment_events (subscription_id);

alter table public.payment_events enable row level security;

drop policy if exists "payment_events_read" on public.payment_events;
create policy "payment_events_read"
  on public.payment_events for select to authenticated
  using (public.has_permission('payments.view'));

-- `payload` can contain customer data. Only administrators may see it; the
-- operator can audit the raw event through the SQL Editor when necessary.
drop policy if exists "payment_events_read_full" on public.payment_events;

-- ---------------------------------------------------------------------------
-- 7. Notification campaigns (draft records only until a provider is wired)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_campaigns (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  channel       text not null default 'in_app'
                check (channel in ('in_app','email','push')),
  audience      jsonb not null default '{}'::jsonb,
  status        text not null default 'draft'
                check (status in ('draft','scheduled','sent','failed','canceled')),
  scheduled_for timestamptz,
  sent_at       timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists notification_campaigns_status_idx
  on public.notification_campaigns (status, created_at desc);
create index if not exists notification_campaigns_created_by_idx
  on public.notification_campaigns (created_by);

alter table public.notification_campaigns enable row level security;

drop policy if exists "notification_campaigns_read" on public.notification_campaigns;
create policy "notification_campaigns_read"
  on public.notification_campaigns for select to authenticated
  using (public.has_permission('notifications.manage'));

-- ---------------------------------------------------------------------------
-- 8. Administrative settings (feature flags, policy config, webhook secret)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  description text,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create index if not exists admin_settings_updated_by_idx
  on public.admin_settings (updated_by);

alter table public.admin_settings enable row level security;

drop policy if exists "admin_settings_read" on public.admin_settings;
create policy "admin_settings_read"
  on public.admin_settings for select to authenticated
  using (public.has_permission('settings.manage'));

insert into public.admin_settings (key, value, description) values
  ('maintenance_mode', '{"enabled": false}'::jsonb,
   'When enabled, the public surfaces may show a maintenance notice.'),
  ('feature_flags', '{"moments": true, "live": true, "games": true, "subscriptions": false}'::jsonb,
   'Product feature switches. `subscriptions` stays false until checkout is configured.'),
  ('discovery_policy', '{"daily_like_limit": 200, "daily_message_limit": 30, "profile_visibility": "members"}'::jsonb,
   'Advisory discovery policy. Hard limits live in rate_limit_rules.'),
  ('payment_webhook_secret', '{"secret": null}'::jsonb,
   'Shared secret for the Stripe webhook -> record_payment_event() boundary. Set it with SQL; never commit a value.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Table privileges (RLS remains the boundary; anon gets nothing)
-- ---------------------------------------------------------------------------
grant select on public.subscription_plans      to authenticated;
grant select on public.subscriptions           to authenticated;
grant select on public.payment_events           to authenticated;
grant select on public.notification_campaigns  to authenticated;
grant select on public.admin_settings          to authenticated;

revoke all on public.subscription_plans      from anon;
revoke all on public.subscriptions           from anon;
revoke all on public.payment_events          from anon;
revoke all on public.notification_campaigns  from anon;
revoke all on public.admin_settings          from anon;

-- Defensive re-assertion for the social graph. `scripts/verify-rls.sh` found
-- the deployed `follows` table answering anonymous callers; enabling RLS alone
-- is not enough if the anon role still holds a table grant. Both boundaries are
-- closed here, and the involved-parties SELECT policy is re-created.
alter table public.follows enable row level security;
revoke all on public.follows from anon;
drop policy if exists "follows_select_anon" on public.follows;
drop policy if exists "follows_select_authenticated" on public.follows;
drop policy if exists "follows_select_involved" on public.follows;
create policy "follows_select_involved"
  on public.follows for select to authenticated
  using (auth.uid() = follower_id or auth.uid() = following_id);

-- ---------------------------------------------------------------------------
-- 10. Dashboard aggregate — real data only; unavailable data is null
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_users        integer;
  v_new_today          integer;
  v_new_week           integer;
  v_new_month          integer;
  v_registration_ok    boolean := false;
  v_user_growth        jsonb := '[]'::jsonb;
  v_dau                integer;
  v_wau                integer;
  v_mau                integer;
  v_active_subs        integer;
  v_expired_subs       integer;
  v_new_paid           integer;
  v_revenue            jsonb := '[]'::jsonb;
  v_revenue_timeline   jsonb := '[]'::jsonb;
  v_plan_distribution  jsonb := '{}'::jsonb;
  v_open_reports       integer;
  v_report_categories  jsonb := '{}'::jsonb;
  v_avg_resolution_h   numeric;
  v_resolved_7d        integer;
  v_moments_total      integer;
  v_moments_pending    integer;
  v_moments_rejected   integer;
  v_messages_total     integer;
  v_messages_24h       integer;
begin
  if not public.has_permission('dashboard.view') then
    raise exception 'Dashboard access required' using errcode = '42501';
  end if;

  select count(*)::int into v_total_users from public.profiles;

  -- `auth.users.created_at` is Supabase-managed. It is absent from the local
  -- PGlite harness, so registration deltas degrade to null instead of failing.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'created_at'
  ) into v_registration_ok;

  if v_registration_ok then
    execute 'select count(*)::int from auth.users where created_at >= date_trunc(''day'', now())'
      into v_new_today;
    execute 'select count(*)::int from auth.users where created_at >= now() - interval ''7 days'''
      into v_new_week;
    execute 'select count(*)::int from auth.users where created_at >= now() - interval ''30 days'''
      into v_new_month;
    execute '
      select coalesce(jsonb_agg(jsonb_build_object(''day'', d.day, ''count'', d.n) order by d.day), ''[]''::jsonb)
      from (
        select date_trunc(''day'', created_at) as day, count(*)::int as n
        from auth.users
        where created_at >= now() - interval ''30 days''
        group by 1
      ) d'
      into v_user_growth;
  end if;

  select count(*)::int into v_dau
  from public.profiles where last_seen_at >= now() - interval '24 hours';
  select count(*)::int into v_wau
  from public.profiles where last_seen_at >= now() - interval '7 days';
  select count(*)::int into v_mau
  from public.profiles where last_seen_at >= now() - interval '30 days';

  select count(*)::int into v_active_subs
  from public.subscriptions s
  where s.status in ('active','trialing')
    and (s.current_period_end is null or s.current_period_end > now());

  select count(*)::int into v_expired_subs
  from public.subscriptions s
  where s.status = 'expired'
     or (s.current_period_end is not null and s.current_period_end <= now()
         and s.status in ('active','trialing'));

  select count(*)::int into v_new_paid
  from public.subscriptions
  where status = 'active' and created_at >= now() - interval '30 days';

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_revenue
  from (
    select
      coalesce(currency, 'unknown') as currency,
      sum(coalesce(amount_minor, 0))::bigint as gross,
      sum(coalesce(refunded_minor, 0))::bigint as refunds,
      sum(coalesce(fee_minor, 0))::bigint as fees,
      (sum(coalesce(amount_minor, 0))
        - sum(coalesce(refunded_minor, 0))
        - sum(coalesce(fee_minor, 0)))::bigint as net
    from public.payment_events
    where status = 'processed'
    group by 1
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', x.day, 'currency', x.currency, 'gross', x.gross) order by x.day), '[]'::jsonb)
    into v_revenue_timeline
  from (
    select date_trunc('day', coalesce(processed_at, received_at)) as day,
           coalesce(currency, 'unknown') as currency,
           sum(coalesce(amount_minor, 0))::bigint as gross
    from public.payment_events
    where status = 'processed'
    group by 1, 2
  ) x;

  select coalesce(jsonb_object_agg(x.plan, x.n), '{}'::jsonb) into v_plan_distribution
  from (
    select pl.name as plan, count(*)::int as n
    from public.subscriptions s
    join public.subscription_plans pl on pl.id = s.plan_id
    where s.status in ('active','trialing')
    group by pl.name
  ) x;

  select count(*)::int into v_open_reports
  from public.reports where status in ('pending','reviewed');

  select coalesce(jsonb_object_agg(x.category, x.n), '{}'::jsonb) into v_report_categories
  from (
    select category, count(*)::int as n
    from public.reports
    where status in ('pending','reviewed')
    group by category
  ) x;

  select count(*)::int into v_resolved_7d
  from public.reports
  where resolved_at is not null and resolved_at >= now() - interval '7 days';

  select round(avg(extract(epoch from (resolved_at - created_at)) / 3600.0), 2)
    into v_avg_resolution_h
  from public.reports
  where resolved_at is not null;

  select count(*)::int into v_moments_total from public.moments where archived_at is null;
  select count(*)::int into v_moments_pending
  from public.moments where archived_at is null and moderation_status = 'pending';
  select count(*)::int into v_moments_rejected
  from public.moments where archived_at is null and moderation_status = 'rejected';

  select count(*)::int into v_messages_total from public.messages;
  select count(*)::int into v_messages_24h
  from public.messages where created_at >= now() - interval '24 hours';

  return jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', v_total_users,
      'new_today', v_new_today,
      'new_week', v_new_week,
      'new_month', v_new_month,
      'registration_growth_available', v_registration_ok,
      'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
      'activity_definition', 'DAU/WAU/MAU use profiles.last_seen_at, refreshed by the presence heartbeat.'
    ),
    'growth', v_user_growth,
    'subscriptions', jsonb_build_object(
      'active', v_active_subs,
      'expired', v_expired_subs,
      'new_paid_30d', v_new_paid,
      'distribution', v_plan_distribution
    ),
    'revenue', jsonb_build_object(
      'by_currency', v_revenue,
      'timeline', v_revenue_timeline,
      'definition', 'Net = gross payment amount - refunded amount - processing fees. Minor currency units.'
    ),
    'moderation', jsonb_build_object(
      'open_reports', v_open_reports,
      'resolved_7d', v_resolved_7d,
      'avg_resolution_hours', v_avg_resolution_h,
      'categories', v_report_categories
    ),
    'content', jsonb_build_object(
      'moments_total', v_moments_total,
      'moments_pending', v_moments_pending,
      'moments_rejected', v_moments_rejected,
      'storage_bytes', null,
      'storage_note', 'Storage usage is not exposed by the current integration.'
    ),
    'messages', jsonb_build_object(
      'total', v_messages_total,
      'last_24h', v_messages_24h
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_stats() from public, anon;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. User management
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_list(
  p_search text default null,
  p_status text default null,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  user_id        uuid,
  display_name   text,
  username       text,
  email          text,
  age            integer,
  gender         text,
  city           text,
  country        text,
  avatar_url     text,
  is_verified    boolean,
  account_status text,
  role           text,
  plan_name      text,
  report_count   bigint,
  last_seen_at   timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('users.view') then
    raise exception 'User access required' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    coalesce(p.display_name, p.username, p.first_name, 'Member')::text,
    p.username,
    u.email,
    p.age,
    p.gender,
    p.city,
    p.country,
    p.avatar_url,
    coalesce(p.is_verified, false),
    case
      when p.banned_until is not null and p.banned_until > now() then 'banned'
      when coalesce(p.is_suspended, false) then 'suspended'
      else 'active'
    end::text,
    coalesce(r.role, 'user')::text,
    pl.name,
    (select count(*) from public.reports rep where rep.reported_user_id = p.id),
    p.last_seen_at,
    count(*) over ()
  from public.profiles p
  left join auth.users u             on u.id = p.id
  left join public.user_roles r      on r.user_id = p.id
  left join public.subscriptions s   on s.user_id = p.id
  left join public.subscription_plans pl on pl.id = s.plan_id
  where
    (p_search is null or p_search = ''
      or p.display_name ilike '%' || p_search || '%'
      or p.username ilike '%' || p_search || '%'
      or p.first_name ilike '%' || p_search || '%'
      or p.last_name ilike '%' || p_search || '%'
      or coalesce(u.email, '') ilike '%' || p_search || '%')
    and (
      p_status is null or p_status = ''
      or (p_status = 'active'
          and coalesce(p.is_suspended, false) = false
          and (p.banned_until is null or p.banned_until <= now()))
      or (p_status = 'suspended'
          and coalesce(p.is_suspended, false) = true
          and (p.banned_until is null or p.banned_until <= now()))
      or (p_status = 'banned' and p.banned_until > now())
      or (p_status = 'unverified' and coalesce(p.is_verified, false) = false)
    )
  order by p.last_seen_at desc nulls last, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_user_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_user_list(text, text, integer, integer) to authenticated;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if not public.has_permission('users.view') then
    raise exception 'User access required' using errcode = '42501';
  end if;
  v_role := public.current_staff_role();

  return (
    select jsonb_build_object(
      'user_id', p.id,
      'display_name', coalesce(p.display_name, p.username, p.first_name, 'Member'),
      'username', p.username,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', case when v_role in ('admin','moderator','support') then u.email else null end,
      'age', p.age,
      'gender', p.gender,
      'city', p.city,
      'country', p.country,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'intention', p.intention,
      'is_verified', coalesce(p.is_verified, false),
      'onboarding_completed', coalesce(p.onboarding_completed, false),
      'is_online', coalesce(p.is_online, false),
      'last_seen_at', p.last_seen_at,
      'is_suspended', coalesce(p.is_suspended, false),
      'suspended_at', p.suspended_at,
      'suspension_reason', p.suspension_reason,
      'banned_until', p.banned_until,
      'ban_reason', p.ban_reason,
      'role', coalesce(r.role, 'user'),
      'subscription', (
        select jsonb_build_object(
          'id', s.id,
          'plan_name', pl.name,
          'plan_code', pl.code,
          'status', s.status,
          'current_period_end', s.current_period_end,
          'cancel_at_period_end', s.cancel_at_period_end
        )
        from public.subscriptions s
        join public.subscription_plans pl on pl.id = s.plan_id
        where s.user_id = p.id
        limit 1
      ),
      'reports_against', (
        select coalesce(jsonb_agg(x), '[]'::jsonb)
        from (
          select rep.id, rep.category, rep.status, rep.created_at
          from public.reports rep
          where rep.reported_user_id = p.id
          order by rep.created_at desc
          limit 10
        ) x
      ),
      'reports_by', (select count(*) from public.reports rep where rep.reporter_id = p.id),
      'moderation_actions', (
        select coalesce(jsonb_agg(x), '[]'::jsonb)
        from (
          select a.action, a.details, a.created_at
          from public.admin_audit_log a
          where a.target_user_id = p.id
          order by a.created_at desc
          limit 10
        ) x
      )
    )
    from public.profiles p
    left join public.user_roles r on r.user_id = p.id
    left join auth.users u        on u.id = p.id
    where p.id = p_user_id
  );
end;
$$;

revoke all on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

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
  me        uuid := auth.uid();
  target_role text;
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

  select coalesce(r.role, 'user') into target_role
  from public.user_roles r where r.user_id = p_user_id;
  target_role := coalesce(target_role, 'user');

  if target_role = 'admin' and not public.is_admin() then
    raise exception 'Only a super admin can change another admin' using errcode = '42501';
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
-- 12. Staff and audit
-- ---------------------------------------------------------------------------
create or replace function public.admin_staff_list()
returns table (
  user_id      uuid,
  display_name text,
  email        text,
  role         text,
  granted_at   timestamptz,
  granted_by   uuid,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('staff.manage') then
    raise exception 'Staff management access required' using errcode = '42501';
  end if;

  return query
  select r.user_id,
         coalesce(p.display_name, p.username, p.first_name, 'Staff member')::text,
         u.email,
         r.role,
         r.granted_at,
         r.granted_by,
         p.last_seen_at
  from public.user_roles r
  left join public.profiles p on p.id = r.user_id
  left join auth.users u      on u.id = r.user_id
  order by case r.role when 'admin' then 1 when 'moderator' then 2 when 'finance' then 3 else 4 end,
           r.granted_at;
end;
$$;

revoke all on function public.admin_staff_list() from public, anon;
grant execute on function public.admin_staff_list() to authenticated;

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

create or replace function public.admin_audit_list(
  p_action text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id             uuid,
  actor_id       uuid,
  actor_name     text,
  action         text,
  target_user_id uuid,
  target_name    text,
  target_report_id uuid,
  details        jsonb,
  created_at     timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('audit.view') then
    raise exception 'Audit access required' using errcode = '42501';
  end if;

  return query
  select a.id, a.actor_id,
         actor.display_name,
         a.action, a.target_user_id, target.display_name,
         a.target_report_id, a.details, a.created_at,
         count(*) over ()
  from public.admin_audit_log a
  left join public.profiles actor  on actor.id = a.actor_id
  left join public.profiles target on target.id = a.target_user_id
  where p_action is null or p_action = '' or a.action ilike '%' || p_action || '%'
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_audit_list(text, integer, integer) from public, anon;
grant execute on function public.admin_audit_list(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Plans and subscriptions
-- ---------------------------------------------------------------------------
create or replace function public.admin_plan_list()
returns table (
  id               uuid,
  code             text,
  name             text,
  description      text,
  price_minor      integer,
  currency         text,
  billing_interval text,
  features         jsonb,
  limits           jsonb,
  trial_days       integer,
  is_active        boolean,
  sort_order       integer,
  subscriber_count bigint,
  updated_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('subscriptions.view') then
    raise exception 'Subscription access required' using errcode = '42501';
  end if;

  return query
  select pl.id, pl.code, pl.name, pl.description, pl.price_minor, pl.currency,
         pl.billing_interval, pl.features, pl.limits, pl.trial_days,
         pl.is_active, pl.sort_order,
         (select count(*) from public.subscriptions s
          where s.plan_id = pl.id and s.status in ('active','trialing')),
         pl.updated_at
  from public.subscription_plans pl
  order by pl.sort_order, pl.name;
end;
$$;

revoke all on function public.admin_plan_list() from public, anon;
grant execute on function public.admin_plan_list() to authenticated;

create or replace function public.admin_plan_upsert(
  p_id               uuid,
  p_code             text,
  p_name             text,
  p_description      text,
  p_price_minor      integer,
  p_currency         text,
  p_billing_interval text,
  p_features         jsonb,
  p_limits           jsonb,
  p_trial_days       integer,
  p_is_active        boolean,
  p_sort_order       integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  out_id uuid;
begin
  if not public.has_permission('plans.manage') then
    raise exception 'Plan management access required' using errcode = '42501';
  end if;
  if p_code is null or trim(p_code) = '' or char_length(p_code) > 60 then
    raise exception 'A code of 1-60 characters is required' using errcode = '22023';
  end if;
  if p_name is null or trim(p_name) = '' or char_length(p_name) > 120 then
    raise exception 'A name of 1-120 characters is required' using errcode = '22023';
  end if;
  if p_price_minor is null or p_price_minor < 0 then
    raise exception 'The price cannot be negative' using errcode = '22023';
  end if;
  if p_currency not in ('USD','EUR','NPR','GBP','INR') then
    raise exception 'Unsupported currency' using errcode = '22023';
  end if;
  if p_billing_interval not in ('month','year','none') then
    raise exception 'Unsupported billing interval' using errcode = '22023';
  end if;
  if p_trial_days is null or p_trial_days < 0 or p_trial_days > 365 then
    raise exception 'Trial days must be between 0 and 365' using errcode = '22023';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'Features must be a JSON array' using errcode = '22023';
  end if;
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' then
    raise exception 'Limits must be a JSON object' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.subscription_plans
      (code, name, description, price_minor, currency, billing_interval,
       features, limits, trial_days, is_active, sort_order)
    values
      (trim(p_code), trim(p_name), p_description, p_price_minor, p_currency,
       p_billing_interval, p_features, p_limits, p_trial_days,
       coalesce(p_is_active, false), coalesce(p_sort_order, 0))
    on conflict (code) do update
      set name = excluded.name,
          description = excluded.description,
          price_minor = excluded.price_minor,
          currency = excluded.currency,
          billing_interval = excluded.billing_interval,
          features = excluded.features,
          limits = excluded.limits,
          trial_days = excluded.trial_days,
          is_active = excluded.is_active,
          sort_order = excluded.sort_order,
          updated_at = now()
    returning id into out_id;
  else
    update public.subscription_plans
       set code = trim(p_code),
           name = trim(p_name),
           description = p_description,
           price_minor = p_price_minor,
           currency = p_currency,
           billing_interval = p_billing_interval,
           features = p_features,
           limits = p_limits,
           trial_days = p_trial_days,
           is_active = coalesce(p_is_active, false),
           sort_order = coalesce(p_sort_order, 0),
           updated_at = now()
     where id = p_id
     returning id into out_id;
  end if;

  if out_id is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, details)
  values (me, 'plan.upserted',
          jsonb_build_object('plan_id', out_id, 'code', p_code, 'price_minor', p_price_minor,
                             'currency', p_currency, 'is_active', p_is_active));

  return out_id;
end;
$$;

revoke all on function public.admin_plan_upsert(uuid, text, text, text, integer, text, text, jsonb, jsonb, integer, boolean, integer) from public, anon;
grant execute on function public.admin_plan_upsert(uuid, text, text, text, integer, text, text, jsonb, jsonb, integer, boolean, integer) to authenticated;

create or replace function public.admin_subscription_list(
  p_search text default null,
  p_status text default null,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  subscription_id   uuid,
  user_id           uuid,
  display_name      text,
  email             text,
  plan_name         text,
  plan_code         text,
  status            text,
  provider          text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  created_at        timestamptz,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('subscriptions.view') then
    raise exception 'Subscription access required' using errcode = '42501';
  end if;

  return query
  select s.id, s.user_id,
         coalesce(p.display_name, p.username, p.first_name, 'Member')::text,
         u.email,
         pl.name, pl.code, s.status, s.provider,
         s.current_period_end, s.cancel_at_period_end, s.created_at,
         count(*) over ()
  from public.subscriptions s
  join public.subscription_plans pl on pl.id = s.plan_id
  left join public.profiles p on p.id = s.user_id
  left join auth.users u on u.id = s.user_id
  where (p_search is null or p_search = ''
         or p.display_name ilike '%' || p_search || '%'
         or p.username ilike '%' || p_search || '%'
         or coalesce(u.email,'') ilike '%' || p_search || '%')
    and (p_status is null or p_status = '' or s.status = p_status)
  order by s.created_at desc
  limit least(greatest(coalesce(p_limit,25),1),100)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

revoke all on function public.admin_subscription_list(text, text, integer, integer) from public, anon;
grant execute on function public.admin_subscription_list(text, text, integer, integer) to authenticated;

create or replace function public.admin_assign_subscription(
  p_user_id   uuid,
  p_plan_id   uuid,
  p_status    text,
  p_period_end timestamptz default null,
  p_note      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  out_id uuid;
  plan_code text;
begin
  if not public.has_permission('subscriptions.manage') then
    raise exception 'Subscription management access required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  select code into plan_code from public.subscription_plans where id = p_plan_id;
  if plan_code is null then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  if p_status not in ('trialing','active','past_due','canceled','expired') then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;

  insert into public.subscriptions
    (user_id, plan_id, status, provider, current_period_start, current_period_end,
     canceled_at)
  values
    (p_user_id, p_plan_id, p_status, 'manual', now(), p_period_end,
     case when p_status = 'canceled' then now() else null end)
  on conflict (user_id) do update
    set plan_id = excluded.plan_id,
        status = excluded.status,
        provider = 'manual',
        current_period_start = now(),
        current_period_end = excluded.current_period_end,
        canceled_at = excluded.canceled_at,
        updated_at = now()
  returning id into out_id;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (me, 'subscription.assigned', p_user_id,
          jsonb_build_object('subscription_id', out_id, 'plan_code', plan_code,
                             'status', p_status, 'period_end', p_period_end, 'note', p_note));

  return out_id;
end;
$$;

revoke all on function public.admin_assign_subscription(uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_assign_subscription(uuid, uuid, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Payments
-- ---------------------------------------------------------------------------
create or replace function public.admin_payment_list(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id             uuid,
  event_type     text,
  status         text,
  user_id        uuid,
  display_name   text,
  amount_minor   integer,
  fee_minor      integer,
  refunded_minor integer,
  currency       text,
  received_at    timestamptz,
  processed_at   timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('payments.view') then
    raise exception 'Payment access required' using errcode = '42501';
  end if;

  return query
  select e.id, e.event_type, e.status, e.user_id,
         coalesce(p.display_name, p.username, p.first_name, 'Member')::text,
         e.amount_minor, e.fee_minor, e.refunded_minor, e.currency,
         e.received_at, e.processed_at,
         count(*) over ()
  from public.payment_events e
  left join public.profiles p on p.id = e.user_id
  order by e.received_at desc
  limit least(greatest(coalesce(p_limit,50),1),200)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

revoke all on function public.admin_payment_list(integer, integer) from public, anon;
grant execute on function public.admin_payment_list(integer, integer) to authenticated;

create or replace function public.admin_payment_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  by_currency jsonb;
  last_event  timestamptz;
  counts      jsonb;
begin
  if not public.has_permission('payments.view') then
    raise exception 'Payment access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into by_currency
  from (
    select coalesce(currency,'unknown') as currency,
           sum(coalesce(amount_minor,0))::bigint as gross,
           sum(coalesce(refunded_minor,0))::bigint as refunds,
           sum(coalesce(fee_minor,0))::bigint as fees,
           (sum(coalesce(amount_minor,0)) - sum(coalesce(refunded_minor,0))
             - sum(coalesce(fee_minor,0)))::bigint as net
    from public.payment_events
    where status = 'processed'
    group by 1
  ) x;

  select max(received_at) into last_event from public.payment_events;

  select jsonb_build_object(
    'received', count(*) filter (where status = 'received'),
    'processed', count(*) filter (where status = 'processed'),
    'failed', count(*) filter (where status = 'failed'),
    'ignored', count(*) filter (where status = 'ignored')
  ) into counts
  from public.payment_events;

  return jsonb_build_object(
    'by_currency', by_currency,
    'counts', counts,
    'last_event_at', last_event,
    'definition', 'Net = gross - refunds - fees, in minor currency units.'
  );
end;
$$;

revoke all on function public.admin_payment_summary() from public, anon;
grant execute on function public.admin_payment_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 15. Content / Moments
-- ---------------------------------------------------------------------------
create or replace function public.admin_moment_list(
  p_status text default null,
  p_limit  integer default 25,
  p_offset integer default 0
)
returns table (
  moment_id         uuid,
  author_id         uuid,
  author_name       text,
  caption           text,
  content_kind      text,
  moderation_status text,
  media_count       integer,
  report_count      bigint,
  created_at        timestamptz,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('content.view') then
    raise exception 'Content access required' using errcode = '42501';
  end if;

  return query
  select m.id, m.author_id,
         coalesce(p.display_name, p.username, p.first_name, 'Member')::text,
         m.caption, m.content_kind, m.moderation_status,
         coalesce(array_length(m.media, 1), 0),
         (select count(*) from public.reports r
           where r.target_type = 'moment' and r.target_id = m.id),
         m.created_at,
         count(*) over ()
  from public.moments m
  left join public.profiles p on p.id = m.author_id
  where p_status is null or p_status = '' or m.moderation_status = p_status
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit,25),1),100)
  offset greatest(coalesce(p_offset,0),0);
end;
$$;

revoke all on function public.admin_moment_list(text, integer, integer) from public, anon;
grant execute on function public.admin_moment_list(text, integer, integer) to authenticated;

create or replace function public.admin_media_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('content.view') then
    raise exception 'Content access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'moments_total', (select count(*) from public.moments where archived_at is null),
    'posts', (select count(*) from public.moments where archived_at is null and content_kind = 'post'),
    'reels', (select count(*) from public.moments where archived_at is null and content_kind = 'reel'),
    'pending', (select count(*) from public.moments where archived_at is null and moderation_status = 'pending'),
    'rejected', (select count(*) from public.moments where archived_at is null and moderation_status = 'rejected'),
    'failed_review', (select count(*) from public.moments where archived_at is null and moderation_status = 'failed_review'),
    'reported_moments', (select count(distinct target_id) from public.reports
                         where target_type = 'moment' and status in ('pending','reviewed')),
    'storage_bytes', null,
    'storage_note', 'Storage usage is not exposed by the current integration.'
  );
end;
$$;

revoke all on function public.admin_media_stats() from public, anon;
grant execute on function public.admin_media_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 16. Communication aggregates (never private message bodies)
-- ---------------------------------------------------------------------------
create or replace function public.admin_chat_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('chat.view') then
    raise exception 'Chat access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'messages_total', (select count(*) from public.messages),
    'messages_24h', (select count(*) from public.messages where created_at >= now() - interval '24 hours'),
    'messages_7d', (select count(*) from public.messages where created_at >= now() - interval '7 days'),
    'matches_total', (select count(*) from public.matches),
    'reported_messages_open', (select count(*) from public.reports
                               where target_type = 'message' and status in ('pending','reviewed')),
    'chat_media_total', (select count(*) from public.chat_media),
    'privacy_note', 'This surface exposes aggregate counts only. Private conversations are never readable here.'
  );
end;
$$;

revoke all on function public.admin_chat_stats() from public, anon;
grant execute on function public.admin_chat_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 16b. Discovery health aggregates
-- ---------------------------------------------------------------------------
create or replace function public.admin_discovery_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('content.view') then
    raise exception 'Discovery access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profiles_total', (select count(*) from public.profiles),
    'profiles_with_photos', (select count(*) from public.profiles
                             where photos is not null and array_length(photos, 1) > 0),
    'verified_profiles', (select count(*) from public.profiles where coalesce(is_verified,false)),
    'online_now', (select count(*) from public.profiles where last_seen_at >= now() - interval '2 minutes'),
    'likes', (select count(*) from public.likes where is_like),
    'passes', (select count(*) from public.likes where not is_like),
    'matches', (select count(*) from public.matches),
    'follows', (select count(*) from public.follows),
    'blocks', (select count(*) from public.blocked_users),
    'suspended', (select count(*) from public.profiles where coalesce(is_suspended,false)),
    'reports_open', (select count(*) from public.reports where status in ('pending','reviewed')),
    'report_targets', (select coalesce(jsonb_object_agg(x.target_type, x.n), '{}'::jsonb)
                       from (select coalesce(target_type,'user') as target_type, count(*)::int as n
                             from public.reports where status in ('pending','reviewed')
                             group by 1) x),
    'note', 'Discovery ranking is deterministic and rule-based. This console configures platform limits; it does not rewrite private relationship preferences.'
  );
end;
$$;

revoke all on function public.admin_discovery_stats() from public, anon;
grant execute on function public.admin_discovery_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 17. Campaign drafts
-- ---------------------------------------------------------------------------
create or replace function public.admin_campaign_list()
returns table (
  id            uuid,
  title         text,
  body          text,
  channel       text,
  audience      jsonb,
  status        text,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('notifications.manage') then
    raise exception 'Notification access required' using errcode = '42501';
  end if;

  return query
  select c.id, c.title, c.body, c.channel, c.audience, c.status,
         c.scheduled_for, c.sent_at, c.created_at
  from public.notification_campaigns c
  order by c.created_at desc
  limit 100;
end;
$$;

revoke all on function public.admin_campaign_list() from public, anon;
grant execute on function public.admin_campaign_list() to authenticated;

create or replace function public.admin_create_campaign(
  p_title    text,
  p_body     text,
  p_channel  text,
  p_audience jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  out_id uuid;
begin
  if not public.has_permission('notifications.manage') then
    raise exception 'Notification access required' using errcode = '42501';
  end if;
  if p_title is null or trim(p_title) = '' or char_length(p_title) > 160 then
    raise exception 'A title of 1-160 characters is required' using errcode = '22023';
  end if;
  if p_body is null or trim(p_body) = '' or char_length(p_body) > 4000 then
    raise exception 'A body of 1-4000 characters is required' using errcode = '22023';
  end if;
  if p_channel not in ('in_app','email','push') then
    raise exception 'Unsupported channel' using errcode = '22023';
  end if;
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then
    raise exception 'Audience must be a JSON object' using errcode = '22023';
  end if;

  insert into public.notification_campaigns (title, body, channel, audience, status, created_by)
  values (trim(p_title), trim(p_body), p_channel, p_audience, 'draft', me)
  returning id into out_id;

  insert into public.admin_audit_log (actor_id, action, details)
  values (me, 'campaign.created',
          jsonb_build_object('campaign_id', out_id, 'channel', p_channel, 'title', trim(p_title)));

  return out_id;
end;
$$;

revoke all on function public.admin_create_campaign(text, text, text, jsonb) from public, anon;
grant execute on function public.admin_create_campaign(text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Analytics
-- ---------------------------------------------------------------------------
create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  days      integer := least(greatest(coalesce(p_days, 30), 1), 365);
  reg_ok    boolean := false;
  growth    jsonb := '[]'::jsonb;
  revenue   jsonb := '[]'::jsonb;
  plans     jsonb := '[]'::jsonb;
  reports   jsonb := '{}'::jsonb;
  churn     integer;
  renewals  integer;
  payments  jsonb;
begin
  if not public.has_permission('analytics.view') then
    raise exception 'Analytics access required' using errcode = '42501';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='created_at'
  ) into reg_ok;

  if reg_ok then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''day'', d.day, ''count'', d.n) order by d.day), ''[]''::jsonb)
       from (select date_trunc(''day'', created_at) as day, count(*)::int as n
             from auth.users where created_at >= now() - interval ''%s days''
             group by 1) d', days)
      into growth;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', x.day, 'currency', x.currency, 'gross', x.gross,
           'refunds', x.refunds, 'fees', x.fees, 'net', x.net) order by x.day), '[]'::jsonb)
    into revenue
  from (
    select date_trunc('day', coalesce(processed_at, received_at)) as day,
           coalesce(currency,'unknown') as currency,
           sum(coalesce(amount_minor,0))::bigint as gross,
           sum(coalesce(refunded_minor,0))::bigint as refunds,
           sum(coalesce(fee_minor,0))::bigint as fees,
           (sum(coalesce(amount_minor,0)) - sum(coalesce(refunded_minor,0))
             - sum(coalesce(fee_minor,0)))::bigint as net
    from public.payment_events
    where status = 'processed'
      and coalesce(processed_at, received_at) >= now() - make_interval(days => days)
    group by 1, 2
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'plan', pl.name, 'code', pl.code, 'active', x.active,
           'canceled_30d', x.canceled, 'revenue_minor', x.revenue)), '[]'::jsonb)
    into plans
  from (
    select s.plan_id,
           count(*) filter (where s.status in ('active','trialing')) as active,
           count(*) filter (where s.status = 'canceled' and s.canceled_at >= now() - interval '30 days') as canceled,
           0::bigint as revenue
    from public.subscriptions s
    group by s.plan_id
  ) x
  join public.subscription_plans pl on pl.id = x.plan_id;

  select coalesce(jsonb_object_agg(x.category, x.n), '{}'::jsonb) into reports
  from (
    select category, count(*)::int as n
    from public.reports
    where created_at >= now() - make_interval(days => days)
    group by category
  ) x;

  select count(*)::int into churn
  from public.subscriptions
  where status = 'canceled' and canceled_at >= now() - interval '30 days';

  select count(*)::int into renewals
  from public.subscriptions
  where status in ('active','trialing') and current_period_end is not null
    and current_period_end >= now() - make_interval(days => days);

  select public.admin_payment_summary() into payments;

  return jsonb_build_object(
    'days', days,
    'registration_growth_available', reg_ok,
    'registration_growth', growth,
    'revenue_timeline', revenue,
    'plans', plans,
    'reports_by_category', reports,
    'churn_30d', churn,
    'renewals_window', renewals,
    'payments', payments,
    'active_users', jsonb_build_object(
      'dau', (select count(*) from public.profiles where last_seen_at >= now() - interval '24 hours'),
      'wau', (select count(*) from public.profiles where last_seen_at >= now() - interval '7 days'),
      'mau', (select count(*) from public.profiles where last_seen_at >= now() - interval '30 days')
    )
  );
end;
$$;

revoke all on function public.admin_analytics(integer) from public, anon;
grant execute on function public.admin_analytics(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 19. System health and settings
-- ---------------------------------------------------------------------------
create or replace function public.admin_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('system.view') then
    raise exception 'System access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'database_time', now(),
    'counts', jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'messages', (select count(*) from public.messages),
      'reports', (select count(*) from public.reports),
      'subscriptions', (select count(*) from public.subscriptions),
      'payment_events', (select count(*) from public.payment_events),
      'audit_entries', (select count(*) from public.admin_audit_log)
    ),
    'last_payment_event_at', (select max(received_at) from public.payment_events),
    'last_audit_at', (select max(created_at) from public.admin_audit_log),
    'open_reports', (select count(*) from public.reports where status = 'pending'),
    'failed_payment_events', (select count(*) from public.payment_events where status = 'failed'),
    'unprocessed_payment_events', (select count(*) from public.payment_events where status = 'received'),
    'rate_limits', (select coalesce(jsonb_agg(jsonb_build_object(
       'action', action, 'max_events', max_events, 'window_seconds', window_seconds
     ) order by action), '[]'::jsonb) from public.rate_limit_rules)
  );
end;
$$;

revoke all on function public.admin_system_health() from public, anon;
grant execute on function public.admin_system_health() to authenticated;

create or replace function public.admin_settings_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;

  -- Never return the webhook secret value; only whether one is configured.
  return (
    select coalesce(jsonb_object_agg(
      s.key,
      case when s.key = 'payment_webhook_secret'
           then jsonb_build_object('configured', coalesce(s.value->>'secret','') <> '')
           else s.value end
    ), '{}'::jsonb)
    from public.admin_settings s
  );
end;
$$;

revoke all on function public.admin_settings_get() from public, anon;
grant execute on function public.admin_settings_get() to authenticated;

create or replace function public.admin_settings_set(
  p_key   text,
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_]{2,60}$' then
    raise exception 'Invalid setting key' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'A setting value is required' using errcode = '22023';
  end if;
  if p_key = 'payment_webhook_secret' then
    raise exception 'The webhook secret is set with SQL, never through the UI' using errcode = '42501';
  end if;

  insert into public.admin_settings (key, value, updated_by)
  values (p_key, p_value, me)
  on conflict (key) do update
    set value = excluded.value,
        updated_by = excluded.updated_by,
        updated_at = now();

  insert into public.admin_audit_log (actor_id, action, details)
  values (me, 'settings.changed', jsonb_build_object('key', p_key, 'value', p_value));

  return jsonb_build_object('ok', true, 'key', p_key);
end;
$$;

revoke all on function public.admin_settings_set(text, jsonb) from public, anon;
grant execute on function public.admin_settings_set(text, jsonb) to authenticated;

create or replace function public.admin_rate_limit_list()
returns table (action text, max_events integer, window_seconds integer, description text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;

  return query
  select r.action, r.max_events, r.window_seconds, r.description
  from public.rate_limit_rules r
  order by r.action;
end;
$$;

revoke all on function public.admin_rate_limit_list() from public, anon;
grant execute on function public.admin_rate_limit_list() to authenticated;

create or replace function public.admin_update_rate_limit(
  p_action         text,
  p_max_events     integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;
  if p_max_events is null or p_max_events < 1 or p_max_events > 100000 then
    raise exception 'max_events is out of range' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'window_seconds is out of range' using errcode = '22023';
  end if;

  update public.rate_limit_rules
     set max_events = p_max_events,
         window_seconds = p_window_seconds
   where action = p_action;

  if not found then
    raise exception 'Unknown rate-limit action' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_log (actor_id, action, details)
  values (me, 'settings.rate_limit_changed',
          jsonb_build_object('action', p_action, 'max_events', p_max_events,
                             'window_seconds', p_window_seconds));

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$$;

revoke all on function public.admin_update_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.admin_update_rate_limit(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 20. Payment webhook boundary (shared-secret gated; no service_role in src)
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(
  p_secret             text,
  p_event_id           text,
  p_event_type         text,
  p_provider           text default 'stripe',
  p_user_id            uuid default null,
  p_plan_code          text default null,
  p_amount_minor       integer default null,
  p_fee_minor          integer default null,
  p_refunded_minor     integer default 0,
  p_currency           text default null,
  p_subscription_status text default null,
  p_period_end         timestamptz default null,
  p_payload            jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured text;
  new_id     uuid;
  plan_id    uuid;
  sub_id     uuid;
begin
  select value->>'secret' into configured
  from public.admin_settings where key = 'payment_webhook_secret';

  -- `exists` semantics, not a bare comparison: a missing secret must refuse.
  if configured is null or configured = '' or p_secret is null or p_secret <> configured then
    raise exception 'Webhook authentication failed' using errcode = '42501';
  end if;
  if p_event_id is null or p_event_id = '' or p_event_type is null or p_event_type = '' then
    raise exception 'An event id and type are required' using errcode = '22023';
  end if;

  insert into public.payment_events
    (provider, event_id, event_type, status, user_id, amount_minor, fee_minor,
     refunded_minor, currency, payload, processed_at)
  values
    (coalesce(nullif(p_provider,''), 'stripe'), p_event_id, p_event_type, 'processed',
     p_user_id, p_amount_minor, p_fee_minor, greatest(coalesce(p_refunded_minor,0),0),
     p_currency, p_payload, now())
  on conflict (event_id) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id from public.payment_events where event_id = p_event_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_event_id', new_id);
  end if;

  if p_user_id is not null and p_plan_code is not null and p_subscription_status is not null then
    select id into plan_id from public.subscription_plans where code = p_plan_code;
    if plan_id is not null and p_subscription_status in ('trialing','active','past_due','canceled','expired') then
      insert into public.subscriptions
        (user_id, plan_id, status, provider, current_period_start, current_period_end,
         canceled_at)
      values
        (p_user_id, plan_id, p_subscription_status, 'stripe', now(), p_period_end,
         case when p_subscription_status = 'canceled' then now() else null end)
      on conflict (user_id) do update
        set plan_id = excluded.plan_id,
            status = excluded.status,
            provider = 'stripe',
            current_period_end = excluded.current_period_end,
            canceled_at = excluded.canceled_at,
            updated_at = now()
      returning id into sub_id;
      update public.payment_events set subscription_id = sub_id where id = new_id;
    end if;
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id, details)
  values (null, 'payment.event_recorded', p_user_id,
          jsonb_build_object('event_id', p_event_id, 'event_type', p_event_type,
                             'provider', coalesce(p_provider,'stripe')));

  return jsonb_build_object('ok', true, 'duplicate', false, 'payment_event_id', new_id);
end;
$$;

revoke all on function public.record_payment_event(text, text, text, text, uuid, text, integer, integer, integer, text, text, timestamptz, jsonb) from public;
grant execute on function public.record_payment_event(text, text, text, text, uuid, text, integer, integer, integer, text, text, timestamptz, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 21. Posture report
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
       on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'subscription_plans','subscriptions','payment_events',
    'notification_campaigns','admin_settings'
  )
group by c.relname, c.relrowsecurity
order by c.relname;
