-- =============================================================================
-- M24 — Authenticity verification and strict photo onboarding
-- =============================================================================
-- WHY
--   A dating profile is only worth trusting if the face in the photos belongs to
--   the person behind the account. This migration adds the durable record of
--   that claim:
--
--     * `profile_verifications` — one row per member: did a live face check, a
--       live voice check and a full photo audit pass, and for which gender.
--     * `profile_photo_checks`  — a per-photo audit trail (hash, role, verdict).
--
--   The rules are ENFORCED IN THE DATABASE, not in the wizard. The browser
--   talks straight to PostgREST, so a client-side gate is a suggestion. The
--   `enforce_verification_before_onboarding_trg` trigger is what makes
--   "you cannot publish a profile you have not verified" true: a member's own
--   write that flips `profiles.onboarding_completed` to true is refused unless a
--   complete verification AND a passing check for every saved photo already
--   exist. There is no INSERT/UPDATE policy on either new table, so a member can
--   never write their own verdict — only the secret-gated RPCs below can.
--
-- IDENTITY AND SECRETS
--   The AI itself lives in a server route (`/api/verification/*`), never in the
--   browser. The route holds a shared secret and calls the RPCs here the same
--   way the M21 moderation worker does: the secret is the authorisation
--   boundary, and only the server has it. `auth.uid()` still decides whose row a
--   verification is written to — a forged member id from the browser can never
--   mark somebody else verified. (Both `auth.uid()` and the shared secret are
--   checked; neither alone is trusted.)
--
-- PHOTOS ARE DATA URLS
--   This build stores gallery photos and the avatar inline as `data:` URLs, not
--   in Storage. Only an MD5 hash of each verified URL is kept here, so the audit
--   trail cannot become a second copy of a member's photo library.
--
-- SAFE TO RE-RUN: idempotent — `create table if not exists`, `add column if not
-- exists`, `drop policy if exists` before `create policy`, and `create or
-- replace function` throughout.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. profile_verifications — one row per member
-- ---------------------------------------------------------------------------
create table if not exists public.profile_verifications (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  /** The gender the live face check confirmed. */
  gender           text,
  face_verified    boolean not null default false,
  voice_verified   boolean not null default false,
  photo_verified   boolean not null default false,
  /** MD5 of the live selfie that passed, so later photo checks reuse it. */
  face_ref_hash    text,
  /** Measured median pitch (Hz) from the voice check. Advisory, not a proof. */
  pitch_hz         numeric,
  face_checked_at  timestamptz,
  voice_checked_at timestamptz,
  photo_checked_at timestamptz,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profile_verifications is
  'Per-member authenticity record: face, voice and photo checks. Written only by the secret-gated verification RPCs; readable only by its owner.';

alter table public.profile_verifications enable row level security;

-- Owner may read their own verification status (the wizard shows it).
-- There is deliberately NO insert/update/delete policy: only the definer RPCs
-- write here, so a member cannot award themselves a verification.
drop policy if exists "profile_verifications_select_own" on public.profile_verifications;
create policy "profile_verifications_select_own"
  on public.profile_verifications for select to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_verifications from anon;
grant select on public.profile_verifications to authenticated;

-- ---------------------------------------------------------------------------
-- 2. profile_photo_checks — per-photo audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.profile_photo_checks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  photo_hash    text not null,
  role          text not null check (role in ('gallery', 'avatar')),
  human         boolean not null default false,
  gender_match  boolean not null default false,
  passed        boolean not null default false,
  provider      text,
  model         text,
  score         numeric,
  reasons       jsonb,
  created_at    timestamptz not null default now(),
  unique (user_id, photo_hash)
);

comment on table public.profile_photo_checks is
  'Audit trail of AI photo verdicts. Stores only an MD5 hash of each photo, never the image. Readable by its owner; written only by record_photo_check().';

create index if not exists profile_photo_checks_user_idx
  on public.profile_photo_checks (user_id, role, passed);

alter table public.profile_photo_checks enable row level security;

drop policy if exists "profile_photo_checks_select_own" on public.profile_photo_checks;
create policy "profile_photo_checks_select_own"
  on public.profile_photo_checks for select to authenticated
  using (user_id = auth.uid());

revoke all on public.profile_photo_checks from anon;
grant select on public.profile_photo_checks to authenticated;

-- ---------------------------------------------------------------------------
-- 3. record_verification — the face/voice verdict writer (secret-gated)
-- ---------------------------------------------------------------------------
-- `p_kind` is 'face' or 'voice'. The member id is passed by the server route
-- AFTER it has validated the caller's access token, and the shared secret is
-- required on top of that, so neither a browser-supplied id nor a browser
-- request can reach this.
create or replace function public.record_verification(
  p_secret        text,
  p_user_id       uuid,
  p_kind          text,
  p_passed        boolean,
  p_gender        text default null,
  p_provider      text default null,
  p_model         text default null,
  p_score         numeric default null,
  p_face_ref_hash text default null,
  p_pitch_hz      numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_complete boolean;
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  -- `auth.uid()` must equal the subject when a member session is present. The
  -- server route calls with the member's own bearer token, so this holds; an
  -- operator/backfill with no session is allowed through on the secret alone.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot verify another member' using errcode = '42501';
  end if;

  if p_kind not in ('face', 'voice') then
    raise exception 'Unknown verification kind' using errcode = '22023';
  end if;

  -- A failed check clears the flag rather than recording a pass.
  if p_kind = 'face' then
    insert into public.profile_verifications (user_id, gender, face_verified, face_ref_hash, face_checked_at, updated_at)
    values (p_user_id, p_gender, coalesce(p_passed, false), p_face_ref_hash, now(), now())
    on conflict (user_id) do update set
      gender          = coalesce(excluded.gender, public.profile_verifications.gender),
      face_verified   = coalesce(p_passed, false),
      face_ref_hash   = case when coalesce(p_passed, false) then excluded.face_ref_hash else public.profile_verifications.face_ref_hash end,
      face_checked_at = now(),
      verified_at     = null,
      updated_at      = now();
  else
    insert into public.profile_verifications (user_id, voice_verified, pitch_hz, voice_checked_at, updated_at)
    values (p_user_id, coalesce(p_passed, false), p_pitch_hz, now(), now())
    on conflict (user_id) do update set
      voice_verified   = coalesce(p_passed, false),
      pitch_hz         = p_pitch_hz,
      voice_checked_at = now(),
      verified_at      = null,
      updated_at       = now();
  end if;

  -- Completion is derived, never asserted by the caller.
  select (face_verified and voice_verified and photo_verified)
    into v_complete
    from public.profile_verifications where user_id = p_user_id;

  update public.profile_verifications
     set verified_at = case when v_complete then now() else null end
   where user_id = p_user_id;

  -- `profiles.is_verified` is the public signal; it mirrors the record.
  update public.profiles
     set is_verified = coalesce(v_complete, false), updated_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'kind', p_kind,
    'passed', coalesce(p_passed, false),
    'complete', coalesce(v_complete, false)
  );
end;
$$;

revoke all on function public.record_verification(text, uuid, text, boolean, text, text, text, numeric, text, numeric)
  from public, anon;
grant execute on function public.record_verification(text, uuid, text, boolean, text, text, text, numeric, text, numeric)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. record_photo_check — the per-photo verdict writer (secret-gated)
-- ---------------------------------------------------------------------------
create or replace function public.record_photo_check(
  p_secret       text,
  p_user_id      uuid,
  p_photo_url    text,
  p_role         text,
  p_human        boolean,
  p_gender_match boolean,
  p_passed       boolean,
  p_face_ref_hash text default null,
  p_provider     text default null,
  p_model        text default null,
  p_score        numeric default null,
  p_reasons      jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash     text;
  v_complete boolean;
  v_gallery  int;
  v_avatar   int;
begin
  if not public.worker_secret_ok(p_secret) then
    raise exception 'Worker access required' using errcode = '42501';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Cannot verify another member' using errcode = '42501';
  end if;

  if p_role not in ('gallery', 'avatar') then
    raise exception 'Unknown photo role' using errcode = '22023';
  end if;

  if p_photo_url is null or length(p_photo_url) = 0 then
    raise exception 'A photo is required' using errcode = '22023';
  end if;

  -- A photo can only be judged against the selfie that already passed the live
  -- face check. The hash is supplied by the server route from the same selfie,
  -- so a member cannot swap in a different reference face between steps.
  if not exists (
    select 1 from public.profile_verifications
     where user_id = p_user_id and face_verified
       and (p_face_ref_hash is null or face_ref_hash = p_face_ref_hash)
  ) then
    raise exception 'A verified live selfie is required before photos can be checked'
      using errcode = '42501';
  end if;

  v_hash := md5(p_photo_url);

  insert into public.profile_photo_checks
      (user_id, photo_hash, role, human, gender_match, passed, provider, model, score, reasons)
  values
      (p_user_id, v_hash, p_role, coalesce(p_human, false), coalesce(p_gender_match, false),
       coalesce(p_passed, false), p_provider, p_model, p_score, p_reasons)
  on conflict (user_id, photo_hash) do update set
      role         = excluded.role,
      human        = excluded.human,
      gender_match = excluded.gender_match,
      passed       = excluded.passed,
      provider     = excluded.provider,
      model        = excluded.model,
      score        = excluded.score,
      reasons      = excluded.reasons,
      created_at   = now();

  -- Photo verification needs exactly the audit the trigger will demand: at least
  -- four passing gallery photos and one passing avatar.
  select count(*) filter (where role = 'gallery' and passed),
         count(*) filter (where role = 'avatar' and passed)
    into v_gallery, v_avatar
    from public.profile_photo_checks
   where user_id = p_user_id;

  update public.profile_verifications
     set photo_verified = (coalesce(v_gallery, 0) >= 4 and coalesce(v_avatar, 0) >= 1),
         photo_checked_at = now(),
         verified_at = null,
         updated_at = now()
   where user_id = p_user_id;

  select (face_verified and voice_verified and photo_verified)
    into v_complete
    from public.profile_verifications where user_id = p_user_id;

  update public.profile_verifications
     set verified_at = case when v_complete then now() else null end
   where user_id = p_user_id;

  update public.profiles
     set is_verified = coalesce(v_complete, false), updated_at = now()
   where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'passed', coalesce(p_passed, false),
    'gallery', coalesce(v_gallery, 0),
    'avatar', coalesce(v_avatar, 0),
    'complete', coalesce(v_complete, false)
  );
end;
$$;

revoke all on function public.record_photo_check(text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb)
  from public, anon;
grant execute on function public.record_photo_check(text, uuid, text, text, boolean, boolean, boolean, text, text, text, numeric, jsonb)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The enforcement trigger: no unverified profile can be published
-- ---------------------------------------------------------------------------
create or replace function public.enforce_verification_before_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v          record;
  v_gallery  int;
  v_avatar   int;
begin
  -- Only the transition to completed is gated, and only for the member's own
  -- browser write. Operator/backfill writes carry no session (auth.uid() null)
  -- and members already onboarded before this migration keep editing normally.
  if new.onboarding_completed is not true then
    return new;
  end if;

  if tg_op = 'UPDATE' and coalesce(old.onboarding_completed, false) then
    return new;
  end if;

  if auth.uid() is null or auth.uid() <> new.id then
    return new;
  end if;

  select * into v from public.profile_verifications where user_id = new.id;
  if not found
     or not coalesce(v.face_verified, false)
     or not coalesce(v.voice_verified, false)
     or not coalesce(v.photo_verified, false) then
    raise exception 'Finish face, voice and photo verification before publishing your profile.'
      using errcode = '23514';
  end if;

  -- The avatar actually being saved must be one that passed...
  if new.avatar_url is null or new.avatar_url = '' or not exists (
    select 1 from public.profile_photo_checks c
     where c.user_id = new.id and c.role = 'avatar' and c.passed and c.photo_hash = md5(new.avatar_url)
  ) then
    raise exception 'Your profile picture has not been verified.'
      using errcode = '23514';
  end if;

  -- ...and every gallery photo being saved must have passed too.
  if exists (
    select 1 from unnest(coalesce(new.photos, '{}'::text[])) as p(url)
     where not exists (
       select 1 from public.profile_photo_checks c
        where c.user_id = new.id and c.role = 'gallery' and c.passed and c.photo_hash = md5(p.url)
     )
  ) then
    raise exception 'Every gallery photo must be verified before publishing.'
      using errcode = '23514';
  end if;

  select count(*) filter (where role = 'gallery' and passed),
         count(*) filter (where role = 'avatar' and passed)
    into v_gallery, v_avatar
    from public.profile_photo_checks
   where user_id = new.id;

  if coalesce(v_gallery, 0) < 4 or coalesce(v_avatar, 0) < 1 then
    raise exception 'At least four verified gallery photos and one verified profile picture are required.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_verification_before_onboarding_trg on public.profiles;
create trigger enforce_verification_before_onboarding_trg
  before insert or update on public.profiles
  for each row execute function public.enforce_verification_before_onboarding();

-- ---------------------------------------------------------------------------
-- 6. get_my_verification — the member's own status, for the wizard UI
-- ---------------------------------------------------------------------------
create or replace function public.get_my_verification()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v from public.profile_verifications where user_id = auth.uid();

  return jsonb_build_object(
    'gender', v.gender,
    'face_verified', coalesce(v.face_verified, false),
    'voice_verified', coalesce(v.voice_verified, false),
    'photo_verified', coalesce(v.photo_verified, false),
    'complete', coalesce(v.face_verified, false) and coalesce(v.voice_verified, false) and coalesce(v.photo_verified, false),
    'verified_at', v.verified_at
  );
end;
$$;

revoke all on function public.get_my_verification() from public, anon;
grant execute on function public.get_my_verification() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Posture report
-- ---------------------------------------------------------------------------
do $$
declare
  rls_on boolean;
begin
  select relrowsecurity into rls_on from pg_class where oid = 'public.profile_verifications'::regclass;
  raise notice 'M24 profile_verifications RLS: %', coalesce(rls_on, false);

  select relrowsecurity into rls_on from pg_class where oid = 'public.profile_photo_checks'::regclass;
  raise notice 'M24 profile_photo_checks RLS: %', coalesce(rls_on, false);
end;
$$;
