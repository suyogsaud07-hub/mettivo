-- =============================================================================
-- M39 · Explore More metadata hardening
-- =============================================================================
-- WHY
--   M36 already ships the seven categories and derives every feed from live
--   profile signals. Two metadata gaps remained:
--
--   * the three Dating Goals were hardcoded in SQL `CASE`/`VALUES` expressions,
--     so an operator could not inspect, reorder, rename or disable them without
--     editing a function;
--   * category metadata had no update timestamp and no admin-managed write path.
--     It was readable but immutable through the product.
--
--   This migration normalises the three goals into a child table, keeps the
--   stored `profiles.intention` values (`friendship` / `dating` / `both`)
--   unchanged, and makes the existing feed/count functions read that table.
--
-- SECURITY
--   Metadata is public to signed-in members, but disabled rows are visible only
--   to administrators with `settings.manage`. There is no client DML grant:
--   writes go through two SECURITY DEFINER RPCs that re-check the permission.
--   Profile intention writes remain owner-only under the existing profiles RLS.
--
-- NOT CHANGED
--   No profile rows, swipes, likes, matches, blocks or existing goals are
--   rewritten. The category IDs and three goal keys stay stable.
--
-- SAFE TO RE-RUN: additive columns/tables, guarded indexes/constraints,
-- replaceable functions, and idempotent goal seeds.
-- DEPENDS ON: M7 (intention set), M32 (permission map), M36 (categories/feed).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Category metadata timestamps and integrity
-- ---------------------------------------------------------------------------
alter table public.explore_categories add column if not exists updated_at timestamptz;

update public.explore_categories
   set updated_at = created_at
 where updated_at is null;

alter table public.explore_categories alter column updated_at set default now();
alter table public.explore_categories alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'explore_categories_no_serious_top_level'
  ) then
    alter table public.explore_categories
      add constraint explore_categories_no_serious_top_level
      check (lower(btrim(title)) <> 'serious relationship');
  end if;
end $$;

create unique index if not exists explore_categories_title_key
  on public.explore_categories (lower(title));

-- ---------------------------------------------------------------------------
-- 2. Normalised Dating Goals child table
-- ---------------------------------------------------------------------------
create table if not exists public.explore_dating_goals (
  category_id    text not null default 'dating-goals'
                 references public.explore_categories(id)
                 on update cascade on delete cascade,
  goal_key       text not null
                 check (goal_key in ('friendship', 'serious', 'casual')),
  title          text not null
                 check (char_length(btrim(title)) between 1 and 60),
  description    text not null default ''
                 check (char_length(description) <= 240),
  intention_value text not null
                 check (intention_value in ('friendship', 'dating', 'both')),
  sort_order     integer not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (category_id, goal_key),
  constraint explore_dating_goals_parent_check
    check (category_id = 'dating-goals'),
  unique (category_id, intention_value)
);

alter table public.explore_dating_goals
  add column if not exists category_id text not null default 'dating-goals';
alter table public.explore_dating_goals
  add column if not exists goal_key text;
alter table public.explore_dating_goals
  add column if not exists title text;
alter table public.explore_dating_goals
  add column if not exists description text not null default '';
alter table public.explore_dating_goals
  add column if not exists intention_value text;
alter table public.explore_dating_goals
  add column if not exists sort_order integer;
alter table public.explore_dating_goals
  add column if not exists is_active boolean not null default true;
alter table public.explore_dating_goals
  add column if not exists created_at timestamptz not null default now();
alter table public.explore_dating_goals
  add column if not exists updated_at timestamptz not null default now();

create index if not exists explore_dating_goals_order_idx
  on public.explore_dating_goals (category_id, sort_order);

create unique index if not exists explore_dating_goals_title_key
  on public.explore_dating_goals (category_id, lower(title));

alter table public.explore_dating_goals enable row level security;

drop policy if exists "explore_dating_goals_select_authenticated"
  on public.explore_dating_goals;
create policy "explore_dating_goals_select_authenticated"
  on public.explore_dating_goals for select to authenticated
  using (is_active or public.has_permission('settings.manage'));

revoke all on public.explore_dating_goals from anon, authenticated;
grant select on public.explore_dating_goals to authenticated;

comment on table public.explore_dating_goals is
  'Stable goal keys under the Dating Goals category. intention_value maps each goal to the existing profiles.intention value; no profile data is stored here.';

-- ---------------------------------------------------------------------------
-- 3. Admin-only metadata reads and writes
-- ---------------------------------------------------------------------------
drop policy if exists "explore_categories_select_authenticated" on public.explore_categories;
create policy "explore_categories_select_authenticated"
  on public.explore_categories for select to authenticated
  using (is_active or public.has_permission('settings.manage'));

create or replace function public.touch_explore_metadata_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_explore_metadata_updated_at() from public, anon, authenticated;

drop trigger if exists explore_categories_touch_updated_at_trg on public.explore_categories;
create trigger explore_categories_touch_updated_at_trg
  before update on public.explore_categories
  for each row execute function public.touch_explore_metadata_updated_at();

drop trigger if exists explore_dating_goals_touch_updated_at_trg on public.explore_dating_goals;
create trigger explore_dating_goals_touch_updated_at_trg
  before update on public.explore_dating_goals
  for each row execute function public.touch_explore_metadata_updated_at();

create or replace function public.admin_upsert_explore_category(
  p_id text,
  p_title text,
  p_description text,
  p_interest_ids text[] default '{}',
  p_hobby_labels text[] default '{}',
  p_pet_labels text[] default '{}',
  p_intention_values text[] default '{}',
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;

  insert into public.explore_categories (
    id, title, description, interest_ids, hobby_labels, pet_labels,
    intention_values, sort_order, is_active
  )
  values (
    p_id, btrim(p_title), btrim(p_description),
    coalesce(p_interest_ids, '{}'), coalesce(p_hobby_labels, '{}'),
    coalesce(p_pet_labels, '{}'), coalesce(p_intention_values, '{}'),
    coalesce(p_sort_order, 0), coalesce(p_is_active, true)
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    interest_ids = excluded.interest_ids,
    hobby_labels = excluded.hobby_labels,
    pet_labels = excluded.pet_labels,
    intention_values = excluded.intention_values,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();
end;
$$;

revoke all on function public.admin_upsert_explore_category(
  text, text, text, text[], text[], text[], text[], integer, boolean
) from public, anon;
grant execute on function public.admin_upsert_explore_category(
  text, text, text, text[], text[], text[], text[], integer, boolean
) to authenticated;

create or replace function public.admin_upsert_explore_goal(
  p_goal_key text,
  p_title text,
  p_description text,
  p_intention_value text,
  p_sort_order integer default 0,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('settings.manage') then
    raise exception 'Settings access required' using errcode = '42501';
  end if;

  insert into public.explore_dating_goals (
    category_id, goal_key, title, description, intention_value,
    sort_order, is_active
  )
  values (
    'dating-goals', p_goal_key, btrim(p_title), btrim(p_description),
    p_intention_value, coalesce(p_sort_order, 0), coalesce(p_is_active, true)
  )
  on conflict (category_id, goal_key) do update set
    title = excluded.title,
    description = excluded.description,
    intention_value = excluded.intention_value,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();
end;
$$;

revoke all on function public.admin_upsert_explore_goal(
  text, text, text, text, integer, boolean
) from public, anon;
grant execute on function public.admin_upsert_explore_goal(
  text, text, text, text, integer, boolean
) to authenticated;

comment on function public.admin_upsert_explore_category(
  text, text, text, text[], text[], text[], text[], integer, boolean
) is
  'Admin-only idempotent category metadata upsert. Disabling is preferred over deleting.';
comment on function public.admin_upsert_explore_goal(
  text, text, text, text, integer, boolean
) is
  'Admin-only idempotent Dating Goals metadata upsert. goal_key is stable; intention_value maps to profiles.intention.';

-- ---------------------------------------------------------------------------
-- 4. Seed the three goals without overwriting an existing disabled state
-- ---------------------------------------------------------------------------
insert into public.explore_dating_goals
  (category_id, goal_key, title, description, intention_value, sort_order)
values
  ('dating-goals', 'friendship', 'Friendship and Networking',
   'People who explicitly want friendship first.', 'friendship', 10),
  ('dating-goals', 'serious', 'Serious Relationship',
   'People who explicitly want a committed relationship.', 'dating', 20),
  ('dating-goals', 'casual', 'Casual & Open to Options',
   'People who are open to whatever develops naturally.', 'both', 30)
on conflict (category_id, goal_key) do update set
  title = excluded.title,
  description = excluded.description,
  intention_value = excluded.intention_value,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 5. Read the goal mapping from the table
-- ---------------------------------------------------------------------------
create or replace function public.explore_category_accepts(
  p_category_id text,
  p_interests text[],
  p_hobbies text[],
  p_pets text[],
  p_intention text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when d.id = 'dating-goals' then
      exists (
        select 1
        from public.explore_dating_goals g
        where g.category_id = d.id
          and g.is_active
          and g.intention_value = p_intention
      )
    else
      (cardinality(d.interest_ids) > 0 and coalesce(p_interests, '{}') && d.interest_ids)
      or (
        cardinality(d.hobby_labels) > 0
        and exists (
          select 1 from unnest(coalesce(p_hobbies, '{}')) h
          where lower(h) = any (d.hobby_labels)
        )
      )
      or (
        cardinality(d.pet_labels) > 0
        and exists (
          select 1 from unnest(coalesce(p_pets, '{}')) pet
          where lower(pet) = any (d.pet_labels)
        )
      )
      or (
        cardinality(d.intention_values) > 0
        and p_intention = any (d.intention_values)
      )
  end
  from public.explore_categories d
  where d.id = p_category_id and d.is_active;
$$;

revoke all on function public.explore_category_accepts(text, text[], text[], text[], text)
  from public, anon, authenticated;

drop function if exists public.explore_more_counts(integer, integer);

create or replace function public.explore_more_counts(
  p_min_age integer default 18,
  p_max_age integer default 99
)
returns table (
  category_id text,
  goal_key text,
  profile_count integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with eligible as materialized (
    select * from public.explore_eligible_profiles(p_min_age, p_max_age)
  )
  select d.id as category_id, null::text as goal_key, count(e.id)::int as profile_count
  from public.explore_categories d
  left join eligible e
    on public.explore_category_accepts(
         d.id, e.interests, e.hobbies, e.pets, e.intention
       )
  where d.is_active
  group by d.id, d.sort_order
  union all
  select g.category_id, g.goal_key, count(e.id)::int
  from public.explore_dating_goals g
  left join eligible e on e.intention = g.intention_value
  where g.category_id = 'dating-goals' and g.is_active
  group by g.category_id, g.goal_key, g.sort_order
  order by 1, 2 nulls first;
$$;

revoke all on function public.explore_more_counts(integer, integer) from public, anon;
grant execute on function public.explore_more_counts(integer, integer) to authenticated;

comment on function public.explore_more_counts(integer, integer) is
  'Counts for active Explore categories and active Dating Goals, computed from the exact eligible set the feeds use.';

drop function if exists public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]);

create or replace function public.explore_more_feed(
  p_category_id text,
  p_goal text default null,
  p_cursor text default null,
  p_limit integer default 20,
  p_min_age integer default 18,
  p_max_age integer default 99,
  p_exclude_ids uuid[] default '{}'
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  has_last_name boolean,
  username text,
  display_name text,
  age integer,
  gender text,
  city text,
  country text,
  avatar_url text,
  photos text[],
  bio text,
  intention text,
  looking_for text[],
  hobbies text[],
  pets text[],
  mbti text,
  interests text[],
  prompts jsonb,
  is_online boolean,
  is_verified boolean,
  match_score integer,
  category_hits integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer uuid := auth.uid();
  category_exists boolean;
  mapped_goal text;
  cursor_score integer;
  cursor_id uuid;
begin
  if viewer is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  select exists (
    select 1 from public.explore_categories c
    where c.id = p_category_id and c.is_active
  ) into category_exists;

  if not category_exists then
    raise exception 'Unknown Explore category' using errcode = '22023';
  end if;

  if p_category_id = 'dating-goals' then
    select g.intention_value into mapped_goal
    from public.explore_dating_goals g
    where g.category_id = 'dating-goals'
      and g.goal_key = p_goal
      and g.is_active;

    if mapped_goal is null then
      raise exception 'A valid dating goal is required' using errcode = '22023';
    end if;
  end if;

  if p_cursor is not null and btrim(p_cursor) <> '' then
    if p_cursor !~ '^[0-9]{1,9}:[0-9a-fA-F-]{36}$' then
      raise exception 'Invalid pagination cursor' using errcode = '22023';
    end if;
    cursor_score := split_part(p_cursor, ':', 1)::integer;
    cursor_id := split_part(p_cursor, ':', 2)::uuid;
  end if;

  return query
  with eligible as materialized (
    select * from public.explore_eligible_profiles(p_min_age, p_max_age)
  ),
  scored as (
    select
      e.*,
      public.explore_category_hits(
        p_category_id, e.interests, e.hobbies, e.pets
      ) as hits,
      (
        public.explore_category_hits(
          p_category_id, e.interests, e.hobbies, e.pets
        ) * 8
        + case
            when p_category_id = 'dating-goals' then 20
            when e.viewer_intention is null then 0
            when e.intention = e.viewer_intention then 10
            when e.intention = 'both' or e.viewer_intention = 'both' then 5
            else 0
          end
        + case when e.candidate_accepts_viewer then 6 else 0 end
        + case when e.is_online then 4 else 0 end
        + case
            when e.avatar_url is not null then 2 else 0
          end
        + case when coalesce(e.bio, '') <> '' then 2 else 0 end
        + case when coalesce(array_length(e.photos, 1), 0) > 0 then 2 else 0 end
        + case when coalesce(array_length(e.interests, 1), 0) > 0 then 2 else 0 end
        + case when e.mbti is not null then 1 else 0 end
        + case when e.prompts is not null and e.prompts <> '{}'::jsonb then 1 else 0 end
        + case when e.city is not null then 1 else 0 end
        + case when e.is_verified then 1 else 0 end
      )::integer as rank_score
    from eligible e
    where (
      p_category_id <> 'dating-goals'
      and public.explore_category_accepts(
        p_category_id, e.interests, e.hobbies, e.pets, e.intention
      )
    ) or (
      p_category_id = 'dating-goals'
      and e.intention = mapped_goal
    )
  )
  select
    s.id, s.first_name, s.last_name, s.has_last_name, s.username,
    s.display_name, s.age, s.gender, s.city, s.country,
    s.avatar_url, s.photos, s.bio, s.intention, s.looking_for,
    s.hobbies, s.pets, s.mbti, s.interests, s.prompts,
    s.is_online, s.is_verified, s.rank_score, s.hits
  from scored s
  where not (s.id = any (coalesce(p_exclude_ids, '{}'::uuid[])))
    and (
      cursor_score is null
      or s.rank_score < cursor_score
      or (s.rank_score = cursor_score and s.id > cursor_id)
    )
  order by s.rank_score desc, s.id asc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

revoke all on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[])
  from public, anon;
grant execute on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[])
  to authenticated;

comment on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]) is
  'One ranked Explore feed. Reads the active Dating Goals mapping, the shared eligible set, and returns public profile fields only.';

-- ---------------------------------------------------------------------------
-- 6. Posture report
-- ---------------------------------------------------------------------------
select
  (select count(*)::int from public.explore_categories where is_active) as active_categories,
  (select count(*)::int from public.explore_dating_goals where is_active) as active_goals;
