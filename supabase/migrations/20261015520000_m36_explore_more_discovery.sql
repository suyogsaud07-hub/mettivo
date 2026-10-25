-- =============================================================================
-- M36 · Explore More — seven category feeds on one eligibility engine
-- =============================================================================
-- WHY
--   Discovery was a single undifferentiated feed. Explore More offers seven
--   entry points, but a second eligibility implementation would inevitably
--   drift: a blocked member could appear in one feed, a suspended account in
--   another, and category counts could disagree with the cards they label.
--
-- WHAT
--   * `explore_categories` is curated reference data for exactly seven entry
--     points. Category membership is still derived from the candidate's live
--     profile (interests/hobbies/pets/intention), never copied onto a row.
--   * `explore_eligible_profiles()` is the ONE internal eligible set: public
--     visibility, onboarding complete, not suspended/banned, not blocked,
--     within the viewer's gender preference, age range, and not already
--     liked/passed/matched. It is not executable by clients.
--   * `explore_more_counts()` and `explore_more_feed()` both read that set.
--     Counts cannot describe a population the feed would refuse to show.
--   * `explore_more_feed()` ranks deterministically in SQL, supports keyset
--     (cursor) pagination and id de-duplication, and returns only allow-listed
--     public profile fields.
--   * Dating Goals is deliberately NOT a top-level goal. The category opens a
--     three-goal chooser, and each feed requires the candidate's own stored
--     `intention` to equal that goal:
--        friendship -> Friendship and Networking
--        dating     -> Serious Relationship
--        both       -> Casual & Open to Options
--     Changing the viewer's browsing category never changes their profile.
--
-- DISTANCE
--   The product stores city/country, not coordinates (privacy by design), so
--   there is no honest kilometre distance to filter on. This engine does not
--   invent one. Age and gender preferences are enforced; a future coordinate
--   model can add distance to the same eligible function.
--
-- SAFE TO RE-RUN: guarded tables/indexes, `create or replace`, explicit drops
-- before functions whose return shape changes.
-- DEPENDS ON: M7 (intention set), M8 (interest ids), M10 (likes), M12 (blocks),
--             M17 (preferences), M20 (visibility), M23/M33 (matches), M32/M36
--             moderation fields.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Curated categories (exactly seven)
-- ---------------------------------------------------------------------------
create table if not exists public.explore_categories (
  id                text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  title             text not null check (char_length(title) between 1 and 60),
  description       text not null check (char_length(description) between 1 and 240),
  interest_ids      text[] not null default '{}',
  hobby_labels      text[] not null default '{}',
  pet_labels        text[] not null default '{}',
  intention_values  text[] not null default '{}',
  sort_order        integer not null,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.explore_categories is
  'Curated Explore More entry points and the live profile signals that qualify a candidate. Definitions only; membership is always derived.';

alter table public.explore_categories enable row level security;

drop policy if exists "explore_categories_select_authenticated" on public.explore_categories;
create policy "explore_categories_select_authenticated"
  on public.explore_categories for select to authenticated
  using (is_active);

revoke all on public.explore_categories from anon, authenticated;
grant select on public.explore_categories to authenticated;

insert into public.explore_categories
  (id, title, description, interest_ids, hobby_labels, pet_labels, intention_values, sort_order)
values
  ('dating-goals', 'Dating Goals',
   'Browse by what someone is explicitly looking for.',
   '{}', '{}', '{}', '{}', 10),
  ('coffee-food', 'Coffee & Food Dates',
   'Coffee, street food, dining out and cooking.',
   array['coffee','street-food','dining-out','cooking'],
   array['coffee & tea','cooking','wine & dining'], '{}', '{}', 20),
  ('nature-adventure', 'Nature & Adventure',
   'Hiking, trekking, camping and the outdoors.',
   array['hiking','trekking','camping'],
   array['outdoors & hiking'], '{}', '{}', 30),
  ('gamers-entertainment', 'Gamers & Entertainment',
   'Gaming, films, music and shared entertainment.',
   array['gaming','board-games','movies','music','live-music'],
   array['gaming','movies','music'], '{}', '{}', 40),
  ('pet-lovers', 'Pet Lovers',
   'People who explicitly love or live with animals.',
   array['dogs','cats','animal-welfare'], '{}',
   array['dog lover','cat lover','have pets','want pets'], '{}', 50),
  ('travel-partners', 'Travel Partners',
   'People who explicitly want more travel in their life.',
   array['travel'], array['travel'], '{}', '{}', 60),
  ('new-friends', 'New Friends',
   'Broader social discovery for people open to friendship.',
   '{}', '{}', '{}', array['friendship','both'], 70)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  interest_ids = excluded.interest_ids,
  hobby_labels = excluded.hobby_labels,
  pet_labels = excluded.pet_labels,
  intention_values = excluded.intention_values,
  sort_order = excluded.sort_order,
  is_active = true;

-- ---------------------------------------------------------------------------
-- 2. Supporting indexes
-- ---------------------------------------------------------------------------
create index if not exists profiles_explore_eligible_idx
  on public.profiles (age, gender, intention)
  where onboarding_completed and not is_suspended;
create index if not exists profiles_explore_interests_gin
  on public.profiles using gin (interests);
create index if not exists profiles_explore_hobbies_gin
  on public.profiles using gin (hobbies);
create index if not exists profiles_explore_pets_gin
  on public.profiles using gin (pets);

-- ---------------------------------------------------------------------------
-- 3. Viewer gender preference (mirrors src/lib/dating-preferences.ts)
-- ---------------------------------------------------------------------------
-- A saved `looking_for` of Men/Women is authoritative. With no saved value we
-- fall back to the opposite binary gender; a nonbinary viewer gets all genders
-- because "opposite" is not a meaningful rule there. Unknown values fall back
-- to all rather than silently hiding the entire feed.
create or replace function public.explore_viewer_genders(p_viewer uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  prefs text[];
  viewer_gender text;
  result text[] := '{}';
begin
  select p.looking_for, p.gender into prefs, viewer_gender
  from public.profiles p where p.id = p_viewer;

  if prefs is null or cardinality(prefs) = 0 then
    return case lower(coalesce(viewer_gender, ''))
      when 'woman' then array['Man']
      when 'female' then array['Man']
      when 'man' then array['Woman']
      when 'male' then array['Woman']
      else array['Woman','Man','Nonbinary']
    end;
  end if;

  if 'Everyone' = any (prefs) then
    return array['Woman','Man','Nonbinary'];
  end if;

  if 'Women' = any (prefs) then result := array_append(result, 'Woman'); end if;
  if 'Men' = any (prefs) then result := array_append(result, 'Man'); end if;

  return case when cardinality(result) = 0
    then array['Woman','Man','Nonbinary']
    else result
  end;
end;
$$;

revoke all on function public.explore_viewer_genders(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The single eligible set
-- ---------------------------------------------------------------------------
-- Internal only. It returns first/last name because the identity rules already
-- make those public, but NOT birth_date, religion, politics, precise location
-- or any moderation column. Callers project what they need.
drop function if exists public.explore_eligible_profiles(integer, integer);

create function public.explore_eligible_profiles(
  p_min_age integer default 18,
  p_max_age integer default 99
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
  last_seen_at timestamptz,
  updated_at timestamptz,
  viewer_intention text,
  candidate_accepts_viewer boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select
      p.id,
      p.gender,
      p.intention,
      p.looking_for
    from public.profiles p
    where p.id = auth.uid()
      and p.onboarding_completed
  )
  select
    c.id, c.first_name, c.last_name, c.has_last_name, c.username,
    c.display_name, c.age, c.gender, c.city, c.country,
    c.avatar_url, c.photos, c.bio, c.intention, c.looking_for,
    c.hobbies, c.pets, c.mbti, c.interests, c.prompts,
    case
      when coalesce(pref.show_online_status, true) = false then false
      when c.last_seen_at is not null
        then c.last_seen_at >= now() - interval '2 minutes'
      else coalesce(c.is_online, false)
    end as is_online,
    c.is_verified,
    c.last_seen_at,
    c.updated_at,
    me.intention as viewer_intention,
    (
      c.looking_for is null
      or cardinality(c.looking_for) = 0
      or 'Everyone' = any (c.looking_for)
      or (lower(coalesce(me.gender, '')) in ('woman','female') and 'Women' = any (c.looking_for))
      or (lower(coalesce(me.gender, '')) in ('man','male') and 'Men' = any (c.looking_for))
    ) as candidate_accepts_viewer
  from public.profiles c
  join me on true
  left join public.user_preferences pref on pref.user_id = c.id
  where c.id <> me.id
    and c.onboarding_completed
    and c.gender is not null
    and c.gender = any (public.explore_viewer_genders(me.id))
    and c.age between greatest(18, coalesce(p_min_age, 18))
                 and least(99, coalesce(p_max_age, 99))
    and coalesce(pref.profile_visibility, 'public') = 'public'
    and coalesce(c.is_suspended, false) = false
    and (c.banned_until is null or c.banned_until <= now())
    and not public.is_blocked_pair(me.id, c.id)
    and not exists (
      select 1 from public.likes l
      where l.liker_id = me.id and l.liked_id = c.id
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a = me.id and m.user_b = c.id)
         or (m.user_a = c.id and m.user_b = me.id)
    );
$$;

revoke all on function public.explore_eligible_profiles(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Category acceptance — one definition, used by counts AND feed
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
      p_intention in ('friendship', 'dating', 'both')
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

revoke all on function public.explore_category_accepts(text, text[], text[], text[], text[]) from public, anon, authenticated;

create or replace function public.explore_category_hits(
  p_category_id text,
  p_interests text[],
  p_hobbies text[],
  p_pets text[]
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select count(*) from unnest(coalesce(p_interests, '{}')) v
      where v = any (d.interest_ids))
    + (select count(*) from unnest(coalesce(p_hobbies, '{}')) v
      where lower(v) = any (d.hobby_labels))
    + (select count(*) from unnest(coalesce(p_pets, '{}')) v
      where lower(v) = any (d.pet_labels)),
    0
  )::int
  from public.explore_categories d
  where d.id = p_category_id and d.is_active;
$$;

revoke all on function public.explore_category_hits(text, text[], text[], text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Counts — same eligible set as the feed
-- ---------------------------------------------------------------------------
drop function if exists public.explore_more_counts(integer, integer);

create function public.explore_more_counts(
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
  select 'dating-goals'::text, g.goal_key,
         count(e.id)::int
  from (values
    ('friendship', 'friendship'),
    ('serious',    'dating'),
    ('casual',     'both')
  ) as g(goal_key, intention_value)
  left join eligible e on e.intention = g.intention_value
  group by g.goal_key
  order by 1, 2 nulls first;
$$;

revoke all on function public.explore_more_counts(integer, integer) from public, anon;
grant execute on function public.explore_more_counts(integer, integer) to authenticated;

comment on function public.explore_more_counts(integer, integer) is
  'Counts for all seven Explore categories and the three Dating Goals, computed from the exact eligible set the feeds use.';

-- ---------------------------------------------------------------------------
-- 7. Ranked, cursor-paginated feed
-- ---------------------------------------------------------------------------
drop function if exists public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]);

create function public.explore_more_feed(
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
    mapped_goal := case p_goal
      when 'friendship' then 'friendship'
      when 'serious' then 'dating'
      when 'casual' then 'both'
      else null
    end;

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

revoke all on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]) from public, anon;
grant execute on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]) to authenticated;

comment on function public.explore_more_feed(text, text, text, integer, integer, integer, uuid[]) is
  'One ranked Explore feed. Uses the shared eligible set, keyset cursor pagination, explicit id de-duplication, and returns public profile fields only.';

-- ---------------------------------------------------------------------------
-- 8. Posture report
-- ---------------------------------------------------------------------------
select
  'explore_categories' as object_name,
  count(*)::int as row_count
from public.explore_categories
where is_active;
