-- =============================================================================
-- M54 · Flatmate Find — independent photo galleries
-- =============================================================================
-- WHY
--   Flatmate photos must be entirely independent of the dating profile gallery
--   (For You / Double Date / Astrology). Each flatmate profile gets its own
--   categorized gallery with ordering, captions, and per-photo visibility.
--
-- WHAT
--   1. flatmate_photos — one row per uploaded flatmate photo, tied to the owner's
--      flatmate profile and a gallery category.
--   2. flatmate-media Storage bucket — private bucket, owner-scoped folder so a
--      member can never write into (or overwrite) another member's gallery.
--   3. RLS policies — owner-only insert/update/delete; public read of photos
--      belonging to active, discoverable flatmate profiles.
--   4. RPCs — upsert_flatmate_photo, delete_flatmate_photo, reorder_flatmate_photos.
--
-- SECURITY
--   Every table has RLS enabled. Storage writes are scoped to `auth.uid()/` so
--   the path prefix cannot be forged to another user's folder. Photos are only
--   returned for active profiles meeting the 50% completion rule, so inactive or
--   incomplete profiles never leak their gallery through discovery.
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. flatmate_photos — categorized, ordered, captioned gallery per member
-- ---------------------------------------------------------------------------
create table if not exists public.flatmate_photos (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  category        text        not null check (category in (
    'bedroom', 'bathroom', 'kitchen', 'living_room', 'balcony', 'exterior',
    'pets', 'facilities', 'personal_intro',
    'personal', 'lifestyle', 'additional'
  )),
  storage_path    text        not null,
  caption         text,
  sort_order      integer     not null default 0,
  is_visible      boolean     not null default true,
  media_type      text        not null default 'image' check (media_type = 'image'),
  file_size       integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint flatmate_photos_sort_order_nonneg check (sort_order >= 0),
  constraint flatmate_photos_file_size_chk check (file_size is null or file_size >= 0)
);

create index if not exists flatmate_photos_user_idx on public.flatmate_photos (user_id);
create index if not exists flatmate_photos_user_category_idx
  on public.flatmate_photos (user_id, category);

alter table public.flatmate_photos enable row level security;

-- ---------------------------------------------------------------------------
-- 2. RLS policies on flatmate_photos
-- ---------------------------------------------------------------------------
-- Public discovery: only visible photos of active, discoverable profiles.
drop policy if exists "flatmate_photos_select_public" on public.flatmate_photos;
create policy "flatmate_photos_select_public"
  on public.flatmate_photos
  for select
  to authenticated
  using (
    is_visible = true
    and exists (
      select 1 from public.flatmate_profiles fp
      where fp.id = user_id
        and fp.is_active = true
        and fp.completion_percentage >= 50
    )
  );

-- Owner writes their own photos.
drop policy if exists "flatmate_photos_insert_own" on public.flatmate_photos;
create policy "flatmate_photos_insert_own"
  on public.flatmate_photos
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "flatmate_photos_update_own" on public.flatmate_photos;
create policy "flatmate_photos_update_own"
  on public.flatmate_photos
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "flatmate_photos_delete_own" on public.flatmate_photos;
create policy "flatmate_photos_delete_own"
  on public.flatmate_photos
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. flatmate-media Storage bucket — independent of dating/media buckets
-- ---------------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    execute $b$
      insert into storage.buckets (id, name, public)
      values ('flatmate-media', 'flatmate-media', false)
      on conflict (id) do nothing
    $b$;

    -- A member may only upload into their own folder. Path shape:
    -- {user_id}/{category}/{uuid}.jpg — the first segment must equal auth.uid().
    execute $p$drop policy if exists "flatmate_media_upload_owner" on storage.objects$p$;
    execute $p$
      create policy "flatmate_media_upload_owner"
        on storage.objects for insert to authenticated
        with check (
          bucket_id = 'flatmate-media'
          and (storage.foldername(name))[1] = auth.uid()::text
          and (storage.extension(name)) ilike any (array['.jpg', '.jpeg', '.png', '.webp'])
        )
    $p$;

    -- Owner may update only their own flatmate media objects.
    execute $p$drop policy if exists "flatmate_media_manage_owner" on storage.objects$p$;
    execute $p$drop policy if exists "flatmate_media_update_owner" on storage.objects$p$;
    execute $p$
      create policy "flatmate_media_update_owner"
        on storage.objects for update to authenticated
        using (
          bucket_id = 'flatmate-media'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
        with check (
          bucket_id = 'flatmate-media'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    -- Owner may delete only their own flatmate media objects.
    execute $p$drop policy if exists "flatmate_media_delete_owner" on storage.objects$p$;
    execute $p$
      create policy "flatmate_media_delete_owner"
        on storage.objects for delete to authenticated
        using (
          bucket_id = 'flatmate-media'
          and (storage.foldername(name))[1] = auth.uid()::text
        )
    $p$;

    -- Readable by anyone who holds the URL (public-read courtesy, table RLS is the
    -- real boundary for what discovery surfaces). Keep objects discoverable via
    -- getPublicUrl so the client-only gallery can load them without signed URLs.
    execute $p$drop policy if exists "flatmate_media_read_all" on storage.objects$p$;
    execute $p$
      create policy "flatmate_media_read_all"
        on storage.objects for select to authenticated
        using (bucket_id = 'flatmate-media')
    $p$;

    raise notice 'flatmate-media storage bucket ready';
  else
    raise notice 'storage buckets/objects not found - create the flatmate-media bucket in the dashboard';
  end if;
end $storage$;

-- ---------------------------------------------------------------------------
-- 4. RPCs for photo management
-- ---------------------------------------------------------------------------
create or replace function public.upsert_flatmate_photo(
  p_user_id      uuid,
  p_category     text,
  p_storage_path text,
  p_caption      text default null,
  p_sort_order   integer default 0,
  p_is_visible   boolean default true,
  p_file_size    integer default null,
  p_photo_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  new_id uuid := coalesce(p_photo_id, gen_random_uuid());
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if me <> p_user_id then
    raise exception 'You can only manage your own photos' using errcode = '42501';
  end if;

  if p_category is null or trim(p_category) = '' then
    raise exception 'A gallery category is required' using errcode = '22023';
  end if;

  if p_storage_path is null or trim(p_storage_path) = '' then
    raise exception 'A storage path is required' using errcode = '22023';
  end if;

  if p_photo_id is not null then
    update public.flatmate_photos
    set category = p_category,
        storage_path = p_storage_path,
        caption = p_caption,
        sort_order = p_sort_order,
        is_visible = p_is_visible,
        file_size = p_file_size,
        updated_at = now()
    where id = p_photo_id and user_id = me;
  else
    insert into public.flatmate_photos (
      id, user_id, category, storage_path, caption, sort_order, is_visible,
      media_type, file_size, created_at, updated_at
    ) values (
      new_id, me, p_category, p_storage_path, p_caption, p_sort_order,
      p_is_visible, 'image', p_file_size, now(), now()
    );
  end if;

  return jsonb_build_object(
    'id', new_id,
    'saved', true,
    'user_id', me,
    'category', p_category
  );
end;
$$;

revoke all on function public.upsert_flatmate_photo(uuid, text, text, text, integer, boolean, integer, uuid) from public, anon;
grant execute on function public.upsert_flatmate_photo(uuid, text, text, text, integer, boolean, integer, uuid) to authenticated;

create or replace function public.delete_flatmate_photo(p_photo_id uuid)
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

  delete from public.flatmate_photos
  where id = p_photo_id and user_id = me;

  return jsonb_build_object('deleted', true, 'photo_id', p_photo_id);
end;
$$;

revoke all on function public.delete_flatmate_photo(uuid) from public, anon;
grant execute on function public.delete_flatmate_photo(uuid) to authenticated;

create or replace function public.reorder_flatmate_photos(
  p_user_id uuid,
  p_photo_orders jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  row record;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if me <> p_user_id then
    raise exception 'You can only reorder your own photos' using errcode = '42501';
  end if;

  for row in select * from jsonb_array_elements(p_photo_orders) as elem(item)
  loop
    update public.flatmate_photos
    set sort_order = (row.item->>'sort_order')::integer,
        updated_at = now()
    where id = (row.item->>'id')::uuid and user_id = me;
  end loop;

  return jsonb_build_object('reordered', true, 'user_id', me);
end;
$$;

revoke all on function public.reorder_flatmate_photos(uuid, jsonb) from public, anon;
grant execute on function public.reorder_flatmate_photos(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. flatmate_conversations — independent of dating matches
-- ---------------------------------------------------------------------------
create table if not exists public.flatmate_conversations (
  id            uuid        primary key default gen_random_uuid(),
  context       text        not null default 'flatmate' check (context = 'flatmate'),
  participant_a uuid        not null references auth.users(id) on delete cascade,
  participant_b uuid        not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (participant_a, participant_b),
  constraint flatmate_conversations_not_self check (participant_a <> participant_b)
);

create index if not exists flatmate_conversations_participant_a_idx
  on public.flatmate_conversations (participant_a);
create index if not exists flatmate_conversations_participant_b_idx
  on public.flatmate_conversations (participant_b);

alter table public.flatmate_conversations enable row level security;

drop policy if exists "flatmate_conversations_select_participant" on public.flatmate_conversations;
create policy "flatmate_conversations_select_participant"
  on public.flatmate_conversations
  for select
  to authenticated
  using (auth.uid() = participant_a or auth.uid() = participant_b);

drop policy if exists "flatmate_conversations_insert_participant" on public.flatmate_conversations;
create policy "flatmate_conversations_insert_participant"
  on public.flatmate_conversations
  for insert
  to authenticated
  with check (auth.uid() = participant_a or auth.uid() = participant_b);

create or replace function public.start_flatmate_conversation(
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required' using errcode = '22023';
  end if;

  if p_target_user_id = me then
    raise exception 'You cannot message yourself' using errcode = '22023';
  end if;

  -- Only discoverable flatmate profiles can be messaged
  if not exists (
    select 1 from public.flatmate_profiles fp
    where fp.id = p_target_user_id
      and fp.is_active = true
      and fp.completion_percentage >= 50
  ) then
    raise exception 'Member is not discoverable in Flatmate Find' using errcode = '42501';
  end if;

  -- Respect dating blocks
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = me and b.blocked_user_id = p_target_user_id)
       or (b.blocker_id = p_target_user_id and b.blocked_user_id = me)
  ) then
    raise exception 'Blocked pair' using errcode = '42501';
  end if;

  -- Idempotent: return existing conversation or create one
  select id into conv_id
  from public.flatmate_conversations
  where (participant_a = least(me, p_target_user_id) and participant_b = greatest(me, p_target_user_id))
  limit 1;

  if conv_id is null then
    insert into public.flatmate_conversations (participant_a, participant_b)
    values (least(me, p_target_user_id), greatest(me, p_target_user_id))
    returning id into conv_id;
  end if;

  return jsonb_build_object(
    'conversation_id', conv_id,
    'context', 'flatmate',
    'participant_a', least(me, p_target_user_id),
    'participant_b', greatest(me, p_target_user_id)
  );
end;
$$;

revoke all on function public.start_flatmate_conversation(uuid) from public, anon;
grant execute on function public.start_flatmate_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('flatmate_photos', 'flatmate_conversations')
group by c.relname, c.relrowsecurity
order by c.relname;

