create table if not exists public.profile_views (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profile_views enable row level security;

drop policy if exists "profile_views_insert_own" on public.profile_views;
create policy "profile_views_insert_own"
  on public.profile_views
  for insert
  with check (viewer_id = auth.uid());

drop policy if exists "profile_views_select_own_profile" on public.profile_views;
create policy "profile_views_select_own_profile"
  on public.profile_views
  for select
  using (profile_id = auth.uid());

create or replace function public.record_profile_view(p_profile_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.uid() is null or auth.uid() = p_profile_id then
    return;
  end if;
  insert into public.profile_views (viewer_id, profile_id)
  values (auth.uid(), p_profile_id);
end;
$$;
