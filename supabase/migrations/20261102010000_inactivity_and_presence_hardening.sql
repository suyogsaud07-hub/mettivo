-- =============================================================================
-- Inactivity hardening and presence fallback removal
-- =============================================================================

-- Harden check_activity_validity to only allow checking own status
create or replace function public.check_activity_validity(p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  target uuid := coalesce(p_user_id, auth.uid());
  last_active timestamptz;
begin
  if me is null then
    return false;
  end if;
  -- Only allow checking own activity status
  if target <> me then
    return false;
  end if;

  select last_active_at into last_active
  from public.user_activity
  where user_id = me;

  if last_active is null then
    return true;
  end if;

  if last_active >= now() - interval '7 days' then
    return true;
  else
    return false;
  end if;
end;
$$;

revoke all on function public.check_activity_validity(uuid) from public, anon;
grant execute on function public.check_activity_validity(uuid) to authenticated;

-- Harden touch_user_activity to be more restrictive
create or replace function public.touch_user_activity()
returns void
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

  insert into public.user_activity (user_id, last_active_at, updated_at)
  values (me, now(), now())
  on conflict (user_id)
  do update set
    last_active_at = now(),
    updated_at = now();
end;
$$;

revoke all on function public.touch_user_activity() from public, anon;
grant execute on function public.touch_user_activity() to authenticated;

-- Remove fallback from public_profiles
drop view if exists public.public_profiles;

create view public.public_profiles as
select
  p.id,
  p.first_name,
  p.last_name,
  p.has_last_name,
  p.username,
  p.display_name,
  p.age,
  p.gender,
  p.city,
  p.country,
  p.avatar_url,
  p.photos,
  p.bio,
  p.intention,
  p.looking_for,
  p.hobbies,
  p.pets,
  p.mbti,
  p.religion,
  p.drinking,
  p.smoking,
  p.interests,
  p.prompts,
  case
    when coalesce(pref.show_online_status, true) = false then false
    when exists (
      select 1 from public.presence_sessions ps 
      where ps.user_id = p.id 
        and ps.is_active = true 
        and ps.expires_at > now()
    ) then true
    else false
  end as is_online,
  p.is_verified,
  p.onboarding_completed,
  p.updated_at,
  p.followers_count,
  p.following_count,
  p.matches_count,
  p.profile_likes_count
from public.profiles p
left join public.user_preferences pref on pref.user_id = p.id;

grant select on public.public_profiles to authenticated;
revoke all on public.public_profiles from anon;

comment on view public.public_profiles is
  'Public-safe projection of profiles. Online status derived only from active non-expired sessions; respects show_online_status.';
