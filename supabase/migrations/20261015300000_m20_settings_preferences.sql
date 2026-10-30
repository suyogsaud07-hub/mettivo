-- =============================================================================
-- M20 · Settings — notification preferences, privacy controls, avatars bucket
-- =============================================================================
-- WHY: `/profile/settings` must be more than a menu of alerts. Three of its
-- groups need somewhere to persist a member's choice:
--
--   * Notifications — which events reach them (matches, messages, likes,
--     moments) and over which channel (in-app push, email).
--   * Privacy Control — whether their online status is shown, whether distance
--     is hidden, and who may see the profile at all.
--   * Change Avatar — a Storage object rather than a base64 data URL, so the
--     image is cached and CDN-served instead of travelling inside every profile
--     row.
--
-- WHY ON `user_preferences` RATHER THAN `profiles`
--   `user_preferences` already exists (M17) as "the table for member-scoped UI
--   choices", with its own policy and its own blast radius. A notification or
--   visibility toggle is exactly that kind of value; adding it to `profiles`
--   would widen the row that every public projection has to reason about.
--
-- HONEST SCOPE NOTE
--   These columns record intent. Wiring `notify_*` into the delivery triggers in
--   `20261015160000_notifications_realtime.sql` and honouring `profile_visibility`
--   / `hide_distance` in discovery is a follow-up that touches those functions;
--   this migration only adds the storage so the settings UI stops pretending.
--
-- SAFE TO RE-RUN: `add column if not exists`, `drop policy if exists` before
-- every `create policy`, `on conflict` on the bucket, and the constraint is
-- dropped before it is re-added. The Storage block is a no-op when the
-- `storage` schema is absent (the PGlite harness does not model it).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Notification preferences
-- ---------------------------------------------------------------------------
-- Every default is "on" except email, which is opt-in: an emailed notification
-- is a bigger step than an in-app one, and defaulting it on would sign members
-- up for mail they never asked for.
alter table public.user_preferences
  add column if not exists notify_new_matches boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_messages boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_likes boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_moments boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_push boolean not null default true;
alter table public.user_preferences
  add column if not exists notify_email boolean not null default false;

comment on column public.user_preferences.notify_new_matches is
  'Show a notification when the member gains a new match.';
comment on column public.user_preferences.notify_messages is
  'Show a notification for a new chat message.';
comment on column public.user_preferences.notify_likes is
  'Show a notification when someone likes the member.';
comment on column public.user_preferences.notify_moments is
  'Show a notification for Moments activity (likes/comments on the member''s posts).';
comment on column public.user_preferences.notify_push is
  'Master switch for in-app/push notifications.';
comment on column public.user_preferences.notify_email is
  'Whether notification emails may be sent. Off by default.';

-- ---------------------------------------------------------------------------
-- 2. Privacy controls
-- ---------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists show_online_status boolean not null default true;
alter table public.user_preferences
  add column if not exists hide_distance boolean not null default false;
alter table public.user_preferences
  add column if not exists profile_visibility varchar(10) not null default 'public';

comment on column public.user_preferences.show_online_status is
  'When false the member is always presented as offline.';
comment on column public.user_preferences.hide_distance is
  'When true the discovery surface omits the member''s distance.';
comment on column public.user_preferences.profile_visibility is
  'Who may see the profile: public | matches | private.';

-- A closed set, mirrored by the UI. `drop ... if exists` first so a re-run
-- cannot fail on the duplicate-constraint error.
alter table public.user_preferences
  drop constraint if exists user_preferences_visibility_set;
alter table public.user_preferences
  add constraint user_preferences_visibility_set
  check (profile_visibility in ('public', 'matches', 'private'));

-- Table-level grants already cover new columns, but re-assert them so a fresh
-- apply on a database with different default privileges is still correct.
grant select, insert, update on public.user_preferences to authenticated;
revoke all on public.user_preferences from anon;

-- ---------------------------------------------------------------------------
-- 3. Storage — the `avatars` bucket
-- ---------------------------------------------------------------------------
-- Guarded on the Storage tables: a PGlite harness or a postgres-only container
-- does not initialise Supabase Storage, so this block is skipped there. Public
-- read (so an <img> can load the object), writes scoped to a `<user-id>/…`
-- folder the uploader owns — the same posture as `moment-media`.
do $storage$
begin
  if to_regclass('storage.buckets') is not null
     and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('avatars', 'avatars', true)
    on conflict (id) do update set public = true;

    execute $p$drop policy if exists "avatars_read" on storage.objects$p$;
    execute $p$create policy "avatars_read"
      on storage.objects for select to authenticated
      using (bucket_id = 'avatars')$p$;

    execute $p$drop policy if exists "avatars_insert_own" on storage.objects$p$;
    execute $p$create policy "avatars_insert_own"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "avatars_update_own" on storage.objects$p$;
    execute $p$create policy "avatars_update_own"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    execute $p$drop policy if exists "avatars_delete_own" on storage.objects$p$;
    execute $p$create policy "avatars_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      )$p$;

    raise notice 'avatars storage bucket ready';
  else
    raise notice 'storage buckets/objects not found - create the avatars bucket in the dashboard';
  end if;
end $storage$;

-- ---------------------------------------------------------------------------
-- Posture report
-- ---------------------------------------------------------------------------
select
  c.relname        as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname = 'user_preferences'
group by c.relname, c.relrowsecurity;
