-- =============================================================================
-- M35 · Verified donation ledger and Top Contributors leaderboard
-- =============================================================================
-- WHY
--   The landing donation flow created a Stripe Checkout session but never
--   persisted the result, so there was no truthful way to recognise supporters.
--   A leaderboard built from a client claim would be fiction.
--
-- WHAT
--   * `donation_contributions` is an append-only ledger written ONLY by the
--     Stripe webhook boundary, after Stripe has signed the event. Its RLS has
--     no client policies; the table itself is unreadable to anon and members.
--   * `record_verified_donation()` authenticates with the same shared secret as
--     M32's payment ledger and is idempotent on the Stripe event id.
--   * `refund_donation()` marks full or partial refunds; the public leaderboard
--     always reports the NET verified total.
--   * `donation_leaderboard()` is an allow-listed, read-only projection. It
--     never returns an email, user id, event id or payment identifier. It
--     excludes anonymous rows with no chosen display name.
--
-- PRIVACY
--   A signed-in donor is named from their public profile display name, not from
--   an unverified request-body value. An anonymous donor may choose the name
--   shown on the wall; the ledger stores only that display name, amount,
--   currency and the opaque Stripe identifiers needed for reconciliation.
--
-- SAFE TO RE-RUN: `if not exists`, `create or replace`, and idempotent upserts.
-- DEPENDS ON: M32 (`admin_settings.payment_webhook_secret`).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Verified donation ledger
-- ---------------------------------------------------------------------------
create table if not exists public.donation_contributions (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'stripe',
  event_id            text not null unique,
  checkout_session_id text,
  payment_intent_id   text,
  contributor_user_id uuid references auth.users(id) on delete set null,
  display_name        text,
  amount_minor        integer not null check (amount_minor > 0),
  refunded_minor      integer not null default 0 check (refunded_minor >= 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  status              text not null default 'verified'
                      check (status in ('verified', 'refunded')),
  verified_at         timestamptz not null default now(),
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),

  constraint donation_refund_within_amount
    check (refunded_minor <= amount_minor)
);

create index if not exists donation_contributions_user_idx
  on public.donation_contributions (contributor_user_id);
create index if not exists donation_contributions_verified_idx
  on public.donation_contributions (status, verified_at desc);
create index if not exists donation_contributions_payment_intent_idx
  on public.donation_contributions (payment_intent_id)
  where payment_intent_id is not null;

alter table public.donation_contributions enable row level security;

-- Deliberately no SELECT/INSERT/UPDATE/DELETE policy. The table is RPC-only:
-- the webhook writer is SECURITY DEFINER, and the public reads the allow-listed
-- leaderboard projection. No client role receives a table privilege either.
revoke all on public.donation_contributions from public, anon, authenticated;

comment on table public.donation_contributions is
  'Verified Stripe donation ledger. RPC-only. No client table grant; the public leaderboard is a separate allow-listed projection.';

-- ---------------------------------------------------------------------------
-- 2. Webhook writer
-- ---------------------------------------------------------------------------
create or replace function public.record_verified_donation(
  p_secret             text,
  p_event_id           text,
  p_checkout_session_id text default null,
  p_payment_intent_id  text default null,
  p_user_id            uuid default null,
  p_display_name       text default null,
  p_amount_minor       integer default null,
  p_currency           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured   text;
  clean_name   text;
  clean_currency text;
  new_id       uuid;
  duplicate    boolean := false;
begin
  select value->>'secret' into configured
  from public.admin_settings where key = 'payment_webhook_secret';

  if configured is null or configured = ''
     or p_secret is null or p_secret <> configured then
    raise exception 'Webhook authentication failed' using errcode = '42501';
  end if;

  if p_event_id is null or btrim(p_event_id) = '' then
    raise exception 'An event id is required' using errcode = '22023';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 10000000 then
    raise exception 'A positive donation amount is required' using errcode = '22023';
  end if;

  clean_currency := upper(btrim(coalesce(p_currency, '')));
  if clean_currency !~ '^[A-Z]{3}$' then
    raise exception 'A three-letter currency is required' using errcode = '22023';
  end if;

  clean_name := nullif(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g'),
        '[[:space:]]+', ' ', 'g'
      )
    ),
    ''
  );
  clean_name := left(clean_name, 40);

  -- A financial row must survive account deletion; keep the money without the
  -- FK rather than losing the ledger entry.
  if p_user_id is not null and not exists (
    select 1 from auth.users u where u.id = p_user_id
  ) then
    p_user_id := null;
  end if;

  insert into public.donation_contributions
    (provider, event_id, checkout_session_id, payment_intent_id,
     contributor_user_id, display_name, amount_minor, currency, status,
     verified_at)
  values
    ('stripe', p_event_id, nullif(btrim(p_checkout_session_id), ''),
     nullif(btrim(p_payment_intent_id), ''), p_user_id, clean_name,
     p_amount_minor, clean_currency, 'verified', now())
  on conflict (event_id) do nothing
  returning id into new_id;

  if new_id is null then
    duplicate := true;
    select id into new_id
    from public.donation_contributions
    where event_id = p_event_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', duplicate,
    'donation_id', new_id
  );
end;
$$;

revoke all on function public.record_verified_donation(text, text, text, text, uuid, text, integer, text) from public;
grant execute on function public.record_verified_donation(text, text, text, text, uuid, text, integer, text) to anon, authenticated;

comment on function public.record_verified_donation(text, text, text, text, uuid, text, integer, text) is
  'The only writer of the verified donation ledger. Shared-secret authenticated and idempotent on the Stripe event id.';

-- ---------------------------------------------------------------------------
-- 3. Refund reconciliation
-- ---------------------------------------------------------------------------
create or replace function public.refund_donation(
  p_secret            text,
  p_payment_intent_id text,
  p_refunded_minor    integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured text;
  affected   integer := 0;
begin
  select value->>'secret' into configured
  from public.admin_settings where key = 'payment_webhook_secret';

  if configured is null or configured = ''
     or p_secret is null or p_secret <> configured then
    raise exception 'Webhook authentication failed' using errcode = '42501';
  end if;

  if p_payment_intent_id is null or btrim(p_payment_intent_id) = '' then
    raise exception 'A payment intent id is required' using errcode = '22023';
  end if;

  update public.donation_contributions
     set refunded_minor = case
           when p_refunded_minor is null then amount_minor
           else greatest(0, least(p_refunded_minor, amount_minor))
         end,
         refunded_at = now(),
         status = case
           when p_refunded_minor is null then 'refunded'
           when p_refunded_minor >= amount_minor then 'refunded'
           else status
         end
   where payment_intent_id = btrim(p_payment_intent_id)
     and status = 'verified';

  get diagnostics affected = row_count;

  return jsonb_build_object('ok', true, 'updated', affected);
end;
$$;

revoke all on function public.refund_donation(text, text, integer) from public;
grant execute on function public.refund_donation(text, text, integer) to anon, authenticated;

comment on function public.refund_donation(text, text, integer) is
  'Applies a full or partial Stripe refund to a verified donation. The leaderboard reports net amounts.';

-- ---------------------------------------------------------------------------
-- 4. Public leaderboard projection
-- ---------------------------------------------------------------------------
-- Only donors who are either signed in (and therefore named from their public
-- profile) or who chose a display name appear. Anonymous, unnamed gifts still
-- count financially but are not turned into a public row.
drop function if exists public.donation_leaderboard(integer);

create or replace function public.donation_leaderboard(p_limit integer default 10)
returns table (
  rank          integer,
  display_name  text,
  total_minor   bigint,
  currency      text,
  donation_count integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with visible as (
    select
      c.contributor_user_id,
      coalesce(
        nullif(btrim(p.display_name), ''),
        c.display_name
      ) as display_name,
      c.currency,
      (c.amount_minor - c.refunded_minor)::bigint as net_minor
    from public.donation_contributions c
    left join public.profiles p on p.id = c.contributor_user_id
    where c.status = 'verified'
      and (c.amount_minor - c.refunded_minor) > 0
      and (
        c.contributor_user_id is not null
        or nullif(btrim(c.display_name), '') is not null
      )
  ),
  totals as (
    select
      display_name,
      currency,
      sum(net_minor)::bigint as total_minor,
      count(*)::int as donation_count
    from visible
    where display_name is not null
    group by display_name, currency
  )
  select
    (row_number() over (
      order by total_minor desc, display_name asc, currency asc
    ))::int as rank,
    display_name,
    total_minor,
    currency,
    donation_count
  from totals
  order by rank
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke all on function public.donation_leaderboard(integer) from public;
grant execute on function public.donation_leaderboard(integer) to anon, authenticated;

comment on function public.donation_leaderboard(integer) is
  'Allow-listed Top Contributors projection. Returns no emails, user ids, event ids or payment identifiers; refunds are netted out.';

-- ---------------------------------------------------------------------------
-- 5. Posture report
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'donation_contributions'
group by c.relname, c.relrowsecurity;
