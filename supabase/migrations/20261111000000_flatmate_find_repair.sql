-- =============================================================================
-- M55 · Flatmate Find — repair save_flatmate_profile function
-- =============================================================================
-- WHY
--   M53 (20261109000000_flatmate_find.sql) created save_flatmate_profile() with
--   two defects:
--     1. It INSERTs/UPDATEs a `photos` column that does not exist on
--        flatmate_profiles (flatmate photos live in the separate flatmate_photos
--        gallery table created by M54). This causes ERROR 42703 at call time.
--     2. The completion calculation can sum to 105, but the table CHECK
--        constraint limits completion_percentage to <= 100, causing ERROR 23514
--        for fully-populated profiles.
--
-- WHAT
--   Recreates save_flatmate_profile() via CREATE OR REPLACE so it:
--     * never references flatmate_profiles.photos (separate gallery architecture),
--     * caps completion at 100 before persisting and returning.
--
--   The 41-parameter signature and its GRANT/REVOKE are already correct in M53
--   and are preserved unchanged here. The TypeScript RPC caller matches the
--   signature exactly, so no caller changes are required.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE is idempotent; no tables are dropped or
-- altered; no data is deleted.
-- =============================================================================

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

  -- Cap completion at 100 so it never violates the CHECK constraint.
  completion := least(completion, 100);

  -- Upsert the flatmate profile. No `photos` column exists on flatmate_profiles;
  -- flatmate photos are stored in the separate flatmate_photos gallery table (M54).
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
    is_active, completion_percentage, updated_at
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
    p_is_active, completion, now()
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
      updated_at = now();

  return jsonb_build_object(
    'saved', true,
    'completion_percentage', completion,
    'is_discoverable', completion >= 50 and p_is_active
  );
end;
$$;

revoke all on function public.save_flatmate_profile(text, integer, text, text, text, text[], text, text, text, boolean, boolean, text, text, integer, integer, date, integer, integer, text, boolean, boolean, integer, boolean, text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.save_flatmate_profile(text, integer, text, text, text, text[], text, text, text, boolean, boolean, text, text, integer, integer, date, integer, integer, text, boolean, boolean, integer, boolean, text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read-only)
-- ---------------------------------------------------------------------------
select
  proname as function_name,
  pg_get_function_identity_arguments(oid) as argument_signature,
  prosecdef as security_definer
from pg_proc
where proname = 'save_flatmate_profile'
  and pronamespace = 'public'::regnamespace;
