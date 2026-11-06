-- ===========================================================================
# 20261106000012_discover_profiles_distance.sql
-- M49 — Annotate discover_profiles() with distance_meters when the caller's
-- location is known, mirroring get_orbit_profiles() / get_nearby_profiles().
--
-- Two optional trailing parameters (p_lat, p_lng) are added. Existing callers
-- that omit them get identical behaviour: distance_meters is simply null.
-- When both are supplied, each candidate's distance from the caller is
-- computed against their snapped (privacy-protected) location.
--
-- Idempotent: safe to re-run.
-- ===========================================================================

drop function if exists public.discover_profiles(integer, integer, text[], integer, boolean, uuid[]);

create function public.discover_profiles(
  p_min_age     integer default 18,
  p_max_age     integer default 99,
  p_genders     text[]  default null,
  p_limit       integer default 50,
  p_online_only boolean default false,
  p_exclude_ids uuid[]  default '{}',
  p_lat         float   default null,
  p_lng         float   default null
)
returns table (
  id           uuid,
  first_name   text,
  last_name    text,
  username     text,
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
  mbti         text,
  interests    text[],
  prompts      jsonb,
  casual_intent text,
  is_online    boolean,
  is_verified  boolean,
  distance_meters float
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  user_point geography(Point, 4326);
begin
  -- Only build the caller's geography point when both coordinates are supplied.
  if p_lat is not null and p_lng is not null then
    user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography(Point, 4326);
  end if;

  return query
  select
    p.id, p.first_name, p.last_name, p.username, p.display_name,
    p.age, p.gender, p.city, p.country, p.avatar_url, p.photos, p.bio,
    p.intention, p.looking_for, p.hobbies, p.pets, p.mbti, p.interests,
    p.prompts,
    p.casual_intent,
    case
      when coalesce(pref.show_online_status, true) = false then false
      when exists (
        select 1 from public.presence_sessions ps
        where ps.user_id = p.id
          and ps.is_active = true
          and ps.expires_at > now()
      ) then true
      when p.last_seen_at is not null
        then p.last_seen_at >= now() - interval '2 minutes'
      else coalesce(p.is_online, false)
    end as is_online,
    p.is_verified,
    -- Distance against the caller's supplied location, using the profile's
    -- snapped (privacy-protected) location when the raw location is absent.
    case
      when user_point is not null and p.snapped_location is not null
      then ST_Distance(user_point, COALESCE(p.location, p.snapped_location))::float
    end as distance_meters
  from public.profiles p
  left join public.user_preferences pref on pref.user_id = p.id
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.onboarding_completed
    and coalesce(p.is_suspended, false) = false
    and coalesce(pref.profile_visibility, 'public') = 'public'
    and p.age between coalesce(p_min_age, 18) and coalesce(p_max_age, 99)
    and (p_genders is null or p.gender = any (p_genders))
    and (
      coalesce(p_online_only, false) = false
      or (case
            when coalesce(pref.show_online_status, true) = false then false
            when exists (
              select 1 from public.presence_sessions ps
              where ps.user_id = p.id
                and ps.is_active = true
                and ps.expires_at > now()
            ) then true
            when p.last_seen_at is not null
              then p.last_seen_at >= now() - interval '2 minutes'
            else coalesce(p.is_online, false)
          end)
    )
    and not public.is_blocked_pair(auth.uid(), p.id)
    and not (p.id = any (coalesce(p_exclude_ids, '{}'::uuid[])))
    and not exists (
      select 1 from public.likes l
      where l.liker_id = auth.uid() and l.liked_id = p.id
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a = auth.uid() and m.user_b = p.id)
         or (m.user_a = p.id and m.user_b = auth.uid())
    )
  order by
    case
      when coalesce(pref.show_online_status, true) = false then false
      when exists (
        select 1 from public.presence_sessions ps
        where ps.user_id = p.id
          and ps.is_active = true
          and ps.expires_at > now()
      ) then true
      when p.last_seen_at is not null
        then p.last_seen_at >= now() - interval '2 minutes'
      else coalesce(p.is_online, false)
    end desc,
    p.updated_at desc nulls last,
    p.id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

revoke all on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float) from public, anon;
grant execute on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float) to authenticated;

comment on function public.discover_profiles(integer, integer, text[], integer, boolean, uuid[], float, float) is
  'Allow-listed discovery feed. Excludes already-decided/blocked/matched/non-public members, supports load-more exclusions, ranks expiring online presence first, returns casual_intent and (optionally) distance_meters from the caller\'s supplied location.';
