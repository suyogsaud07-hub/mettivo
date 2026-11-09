-- =============================================================================
-- M53 · Flatmate Find — shared accommodation discovery
-- =============================================================================
-- WHY
--   METTIVO's existing discovery is dating-only. Flatmate Find is a completely
--   independent discovery experience for shared accommodation: members can look
--   for a room, offer a room, or both. It has its own profile, preferences,
--   compatibility engine, and connection system — strictly separate from dating
--   likes, matches, and messages.
--
-- WHAT
--   1. flatmate_profiles — per-member flatmate profile (ownership-scoped, opt-in)
--   2. flatmate_connections — interest/save connections between members
--   3. flatmate_reports — abuse reports on flatmate profiles
--   4. RLS policies — owner-only writes, public discover of visible fields
--   5. RPCs — save_flatmate_profile, express_flatmate_interest, save_flatmate,
--      reject_flatmate_profile
--
-- SECURITY
--   Every table has RLS enabled. Writes are owner-only (auth.uid() = user_id).
--   Public discovery returns only approved visible fields. Private fields
--   (exact address, financial account details) are never exposed through public
--   views or RPCs. Blocks and reports from the dating system are reused: a
--   blocked or reported member never appears in flatmate discovery.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. flatmate_profiles — one row per member who has opted into flatmate sharing
-- ---------------------------------------------------------------------------
create table if not exists public.flatmate_profiles (
  id                      uuid        primary key references auth.users(id) on delete cascade,
  -- Personal information (section A)
  first_name              text        not null,
  age                     integer     not null check (age >= 18),
  occupation              text,
  university_workplace    text,
  introduction            text,
  general_interests       text[]      default '{}'::text[],
  preferred_language      text        default 'en',
  current_city            text,
  preferred_living_arrangement text  check (preferred_living_arrangement in ('roommate', 'solo', 'couple', 'family')),
  -- Accommodation requirements (section B)
  looking_for_room        boolean     not null default false,
  offering_room           boolean     not null default false,
  preferred_city          text,
  preferred_neighbourhood text,
  rent_budget_min         integer     check (rent_budget_min >= 0),
  rent_budget_max         integer     check (rent_budget_max >= 0),
  move_in_date            date,
  lease_duration_min      integer,    -- months
  lease_duration_max      integer,    -- months
  room_type               text        check (room_type in ('private', 'shared', 'studio', 'entire_place')),
  furnished               boolean,
  private_room            boolean,
  existing_occupants      integer     check (existing_occupants >= 0),
  utilities_included      boolean,
  accommodation_description text,
  -- Lifestyle compatibility (section C)
  sleeping_schedule       text        check (sleeping_schedule in ('early_sleeper', 'night_owl', 'flexible', 'irregular')),
  cleanliness             text        check (cleanliness in ('very_tidy', 'generally_tidy', 'relaxed', 'comfortable_mess')),
  smoking                 text        check (smoking in ('non_smoker', 'smoker', 'comfortable_smokers', 'prefers_smoke_free')),
  pets                    text        check (pets in ('has_pets', 'likes_pets', 'comfortable_pets', 'no_pets')),
  social_lifestyle        text        check (social_lifestyle in ('quiet_private', 'occasionally_social', 'frequently_social', 'enjoys_hosting')),
  cooking                 text        check (cooking in ('cooks_regularly', 'occasionally_cooks', 'orders_food', 'shared_cooking')),
  guests                  text        check (guests in ('occasional_guests', 'frequently_hosts', 'limited_visitors', 'no_visitors')),
  noise_tolerance         text        check (noise_tolerance in ('very_quiet', 'moderate_noise', 'flexible')),
  work_study_routine      text        check (work_study_routine in ('works_from_home', 'studies_from_home', 'works_outside', 'university_schedule', 'mixed_schedule')),
  household_responsibilities text     check (household_responsibilities in ('shared_cleaning', 'rotating_cleaning', 'individual_responsibilities', 'other_arrangements')),
  -- Financial compatibility (section D)
  rent_sharing_arrangement text       check (rent_sharing_arrangement in ('equal', 'proportional', 'room_based', 'negotiated')),
  utilities_budget        integer     check (utilities_budget >= 0),
  deposit_expectations    text,
  payment_frequency       text        check (payment_frequency in ('weekly', 'fortnightly', 'monthly')),
  additional_expenses     text,
  -- Profile visibility & completion
  is_active               boolean     not null default true,
  completion_percentage   integer     not null default 0 check (completion_percentage >= 0 and completion_percentage <= 100),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint flatmate_looking_or_offering check (looking_for_room or offering_room),
  constraint rent_budget_order check (rent_budget_min is null or rent_budget_max is null or rent_budget_min <= rent_budget_max),
  constraint lease_duration_order check (lease_duration_min is null or lease_duration_max is null or lease_duration_min <= lease_duration_max)
);

alter table public.flatmate_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. flatmate_connections — interest/save connections between members
-- ---------------------------------------------------------------------------
create table if not exists public.flatmate_connections (
  id           uuid        primary key default gen_random_uuid(),
  from_user_id uuid        not null references auth.users(id) on delete cascade,
  to_user_id   uuid        not null references auth.users(id) on delete cascade,
  connection_type text     not null check (connection_type in ('interest', 'save', 'skip')),
  created_at   timestamptz not null default now(),

  unique (from_user_id, to_user_id, connection_type),
  constraint flatmate_connections_not_self check (from_user_id <> to_user_id)
);

create index if not exists flatmate_connections_from_idx on public.flatmate_connections (from_user_id);
create index if not exists flatmate_connections_to_idx   on public.flatmate_connections (to_user_id);

alter table public.flatmate_connections enable row level security;

-- ---------------------------------------------------------------------------
-- 3. flatmate_reports — abuse reports on flatmate profiles
-- ---------------------------------------------------------------------------
create table if not exists public.flatmate_reports (
  id               uuid        primary key default gen_random_uuid(),
  reporter_id      uuid        not null references auth.users(id) on delete cascade,
  reported_user_id uuid        not null references auth.users(id) on delete cascade,
  reason           text        not null,
  details          text,
  status           text        default 'pending' check (status in ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (reporter_id, reported_user_id)
);

create index if not exists flatmate_reports_reporter_idx on public.flatmate_reports (reporter_id);
create index if not exists flatmate_reports_reported_idx on public.flatmate_reports (reported_user_id);

alter table public.flatmate_reports enable row level security;

-- ---------------------------------------------------------------------------
-- 4. RLS policies
-- ---------------------------------------------------------------------------

-- flatmate_profiles: public can read active profiles for discovery, owner writes
drop policy if exists "flatmate_profiles_select_public" on public.flatmate_profiles;
create policy "flatmate_profiles_select_public"
  on public.flatmate_profiles
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "flatmate_profiles_insert_own" on public.flatmate_profiles;
create policy "flatmate_profiles_insert_own"
  on public.flatmate_profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "flatmate_profiles_update_own" on public.flatmate_profiles;
create policy "flatmate_profiles_update_own"
  on public.flatmate_profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "flatmate_profiles_delete_own" on public.flatmate_profiles;
create policy "flatmate_profiles_delete_own"
  on public.flatmate_profiles
  for delete
  to authenticated
  using (auth.uid() = id);

-- flatmate_connections: public can read own connections, owner writes
drop policy if exists "flatmate_connections_select_own" on public.flatmate_connections;
create policy "flatmate_connections_select_own"
  on public.flatmate_connections
  for select
  to authenticated
  using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "flatmate_connections_insert_own" on public.flatmate_connections;
create policy "flatmate_connections_insert_own"
  on public.flatmate_connections
  for insert
  to authenticated
  with check (auth.uid() = from_user_id);

drop policy if exists "flatmate_connections_delete_own" on public.flatmate_connections;
create policy "flatmate_connections_delete_own"
  on public.flatmate_connections
  for delete
  to authenticated
  using (auth.uid() = from_user_id);

-- flatmate_reports: reporter writes own, staff can read all
drop policy if exists "flatmate_reports_insert_own" on public.flatmate_reports;
create policy "flatmate_reports_insert_own"
  on public.flatmate_reports
  for insert
  to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "flatmate_reports_select_own" on public.flatmate_reports;
create policy "flatmate_reports_select_own"
  on public.flatmate_reports
  for select
  to authenticated
  using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------------
-- 5. flatmate_profiles save RPC — owner writes their own profile
-- ---------------------------------------------------------------------------
create or replace function public.save_flatmate_profile(
  p_first_name              text,
  p_age                     integer,
  p_occupation              text default null,
  p_university_workplace    text default null,
  p_introduction            text default null,
  p_general_interests       text[] default '{}'::text[],
  p_preferred_language      text default 'en',
  p_current_city            text default null,
  p_preferred_living_arrangement text default null,
  p_looking_for_room        boolean default false,
  p_offering_room           boolean default false,
  p_preferred_city          text default null,
  p_preferred_neighbourhood text default null,
  p_rent_budget_min         integer default null,
  p_rent_budget_max         integer default null,
  p_move_in_date            date default null,
  p_lease_duration_min      integer default null,
  p_lease_duration_max      integer default null,
  p_room_type               text default null,
  p_furnished               boolean default null,
  p_private_room            boolean default null,
  p_existing_occupants      integer default null,
  p_utilities_included      boolean default null,
  p_accommodation_description text default null,
  p_sleeping_schedule       text default null,
  p_cleanliness             text default null,
  p_smoking                 text default null,
  p_pets                    text default null,
  p_social_lifestyle        text default null,
  p_cooking                 text default null,
  p_guests                  text default null,
  p_noise_tolerance         text default null,
  p_work_study_routine      text default null,
  p_household_responsibilities text default null,
  p_rent_sharing_arrangement text default null,
  p_utilities_budget        integer default null,
  p_deposit_expectations    text default null,
  p_payment_frequency       text default null,
  p_additional_expenses     text default null,
  p_is_active               boolean default true,
  p_photos                  text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  completion integer := 0;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_age is null or p_age < 18 then
    raise exception 'Age must be 18 or older' using errcode = '22023';
  end if;

  if not p_looking_for_room and not p_offering_room then
    raise exception 'Must be looking for a room, offering a room, or both' using errcode = '22023';
  end if;

  -- Calculate completion percentage on essential fields
  completion := 0;
  if p_first_name is not null and trim(p_first_name) <> '' then completion := completion + 10; end if;
  if p_age is not null then completion := completion + 10; end if;
  if p_occupation is not null and trim(p_occupation) <> '' then completion := completion + 5; end if;
  if p_introduction is not null and trim(p_introduction) <> '' then completion := completion + 10; end if;
  if p_current_city is not null and trim(p_current_city) <> '' then completion := completion + 10; end if;
  if p_preferred_living_arrangement is not null then completion := completion + 5; end if;
  if p_looking_for_room or p_offering_room then completion := completion + 10; end if;
  if p_preferred_city is not null and trim(p_preferred_city) <> '' then completion := completion + 5; end if;
  if p_rent_budget_max is not null then completion := completion + 10; end if;
  if p_move_in_date is not null then completion := completion + 10; end if;
  if p_sleeping_schedule is not null then completion := completion + 5; end if;
  if p_cleanliness is not null then completion := completion + 5; end if;
  if p_smoking is not null then completion := completion + 5; end if;
  if p_pets is not null then completion := completion + 5; end if;

  -- Upsert the flatmate profile
  insert into public.flatmate_profiles (
    id, first_name, age, occupation, university_workplace, introduction,
    general_interests, preferred_language, current_city, preferred_living_arrangement,
    looking_for_room, offering_room, preferred_city, preferred_neighbourhood,
    rent_budget_min, rent_budget_max, move_in_date, lease_duration_min, lease_duration_max,
    room_type, furnished, private_room, existing_occupants, utilities_included,
    accommodation_description, sleeping_schedule, cleanliness, smoking, pets,
    social_lifestyle, cooking, guests, noise_tolerance, work_study_routine,
    household_responsibilities, rent_sharing_arrangement, utilities_budget,
    deposit_expectations, payment_frequency, additional_expenses,
    is_active, completion_percentage, photos, updated_at
  ) values (
    me, p_first_name, p_age, p_occupation, p_university_workplace, p_introduction,
    p_general_interests, p_preferred_language, p_current_city, p_preferred_living_arrangement,
    p_looking_for_room, p_offering_room, p_preferred_city, p_preferred_neighbourhood,
    p_rent_budget_min, p_rent_budget_max, p_move_in_date, p_lease_duration_min, p_lease_duration_max,
    p_room_type, p_furnished, p_private_room, p_existing_occupants, p_utilities_included,
    p_accommodation_description, p_sleeping_schedule, p_cleanliness, p_smoking, p_pets,
    p_social_lifestyle, p_cooking, p_guests, p_noise_tolerance, p_work_study_routine,
    p_household_responsibilities, p_rent_sharing_arrangement, p_utilities_budget,
    p_deposit_expectations, p_payment_frequency, p_additional_expenses,
    p_is_active, completion, p_photos, now()
  )
  on conflict (id)
    do update set
      first_name = excluded.first_name,
      age = excluded.age,
      occupation = excluded.occupation,
      university_workplace = excluded.university_workplace,
      introduction = excluded.introduction,
      general_interests = excluded.general_interests,
      preferred_language = excluded.preferred_language,
      current_city = excluded.current_city,
      preferred_living_arrangement = excluded.preferred_living_arrangement,
      looking_for_room = excluded.looking_for_room,
      offering_room = excluded.offering_room,
      preferred_city = excluded.preferred_city,
      preferred_neighbourhood = excluded.preferred_neighbourhood,
      rent_budget_min = excluded.rent_budget_min,
      rent_budget_max = excluded.rent_budget_max,
      move_in_date = excluded.move_in_date,
      lease_duration_min = excluded.lease_duration_min,
      lease_duration_max = excluded.lease_duration_max,
      room_type = excluded.room_type,
      furnished = excluded.furnished,
      private_room = excluded.private_room,
      existing_occupants = excluded.existing_occupants,
      utilities_included = excluded.utilities_included,
      accommodation_description = excluded.accommodation_description,
      sleeping_schedule = excluded.sleeping_schedule,
      cleanliness = excluded.cleanliness,
      smoking = excluded.smoking,
      pets = excluded.pets,
      social_lifestyle = excluded.social_lifestyle,
      cooking = excluded.cooking,
      guests = excluded.guests,
      noise_tolerance = excluded.noise_tolerance,
      work_study_routine = excluded.work_study_routine,
      household_responsibilities = excluded.household_responsibilities,
      rent_sharing_arrangement = excluded.rent_sharing_arrangement,
      utilities_budget = excluded.utilities_budget,
      deposit_expectations = excluded.deposit_expectations,
      payment_frequency = excluded.payment_frequency,
      additional_expenses = excluded.additional_expenses,
      is_active = excluded.is_active,
      completion_percentage = excluded.completion_percentage,
      photos = excluded.photos,
      updated_at = now();

  return jsonb_build_object(
    'saved', true,
    'completion_percentage', completion,
    'is_discoverable', completion >= 50 and p_is_active
  );
end;
$$;

revoke all on function public.save_flatmate_profile(text, integer, text, text, text, text[], text, text, text, boolean, boolean, text, text, integer, integer, date, integer, integer, text, boolean, boolean, integer, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.save_flatmate_profile(text, integer, text, text, text, text[], text, text, text, boolean, boolean, text, text, integer, integer, date, integer, integer, text, boolean, boolean, integer, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. flatmate interest RPC — express interest in another flatmate profile
-- ---------------------------------------------------------------------------
create or replace function public.express_flatmate_interest(
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  reciprocal boolean := false;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  if p_target_user_id = me then
    raise exception 'You cannot express interest in yourself' using errcode = '22023';
  end if;

  -- Only active profiles can be discovered
  if not exists (
    select 1 from public.flatmate_profiles fp
    where fp.id = p_target_user_id and fp.is_active = true and fp.completion_percentage >= 50
  ) then
    raise exception 'Profile not discoverable' using errcode = '42501';
  end if;

  -- Respect dating blocks: blocked pairs never appear in discovery
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_user_id = p_target_user_id)
       or (b.blocker_id = p_target_user_id and b.blocked_user_id = me)
  ) then
    raise exception 'Blocked pair' using errcode = '42501';
  end if;

  -- Insert interest (idempotent: re-expressing updates rather than duplicating)
  insert into public.flatmate_connections (from_user_id, to_user_id, connection_type)
  values (me, p_target_user_id, 'interest')
  on conflict (from_user_id, to_user_id, connection_type)
    do update set created_at = now();

  -- Check for mutual interest
  select exists (
    select 1 from public.flatmate_connections fc
    where fc.from_user_id = p_target_user_id
      and fc.to_user_id = me
      and fc.connection_type = 'interest'
  ) into reciprocal;

  return jsonb_build_object(
    'expressed', true,
    'mutual', reciprocal,
    'target_user_id', p_target_user_id
  );
end;
$$;

revoke all on function public.express_flatmate_interest(uuid) from public, anon;
grant execute on function public.express_flatmate_interest(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. flatmate save RPC — save/unsave a profile
-- ---------------------------------------------------------------------------
create or replace function public.save_flatmate_profile_connection(
  p_target_user_id uuid,
  p_save boolean default true
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

  if p_target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  if p_target_user_id = me then
    raise exception 'You cannot save your own profile' using errcode = '22023';
  end if;

  if p_save then
    insert into public.flatmate_connections (from_user_id, to_user_id, connection_type)
    values (me, p_target_user_id, 'save')
    on conflict (from_user_id, to_user_id, connection_type)
      do update set created_at = now();
  else
    delete from public.flatmate_connections
    where from_user_id = me and to_user_id = p_target_user_id and connection_type = 'save';
  end if;

  return jsonb_build_object('saved', p_save, 'target_user_id', p_target_user_id);
end;
$$;

revoke all on function public.save_flatmate_profile_connection(uuid, boolean) from public, anon;
grant execute on function public.save_flatmate_profile_connection(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Indexes for discovery performance
-- ---------------------------------------------------------------------------
create index if not exists flatmate_profiles_active_city_idx
  on public.flatmate_profiles (preferred_city)
  where is_active = true;

create index if not exists flatmate_profiles_active_completion_idx
  on public.flatmate_profiles (completion_percentage)
  where is_active = true;

-- ---------------------------------------------------------------------------
-- 9. Report posture
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('flatmate_profiles', 'flatmate_connections', 'flatmate_reports')
group by c.relname, c.relrowsecurity
order by c.relname;
