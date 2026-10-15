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
