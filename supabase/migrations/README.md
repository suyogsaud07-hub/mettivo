# Migrations

Authoritative, idempotent SQL for the Mettivo database. Apply in filename order.

> **Legacy note.** The older top-level `migrations/` directory is superseded by
> this one. Its `reports_blocked_users.sql` is **not executable** (0 of 22
> statements succeed): it calls `uuid_generate_v4()` without creating the
> `uuid-ossp` extension, and it uses `FOR INSERT ... USING`, which PostgreSQL
> rejects — an INSERT policy may only carry `WITH CHECK`. Relocating and fixing
> those files is tracked under M4.
>
> `migrations/onboarding_wizard_columns.sql` was relocated here as file 10; the
> legacy copy is historical only and must not be applied.

## How to apply

There is no migration runner in this project yet, so apply each file by hand:

1. Open the Supabase dashboard → **SQL Editor** → *New query*.
2. Paste the whole file and press **Run**.
3. Confirm the output — the M6 migrations print `NOTICE` lines and finish with a
   posture table.
4. Verify from the terminal:

```bash
./scripts/verify-rls.sh
```

Every file is written to be **re-runnable**: running it twice must produce the
same state and no error.

## Applying order

| # | File | Purpose | Milestone |
| --- | --- | --- | --- |
| 1 | `20261015120000_m6_profiles_rls_lockdown.sql` | Stops anonymous reads of `profiles`; owner-only writes | M6 |
| 2 | `20261015120100_m6_enable_rls_all_tables.sql` | Ensures RLS is on for every personal-data table | M6 |
| 3 | `20261015120200_m6_public_profiles_view.sql` | Allow-listed public projection without `birth_date` | M6 |
| 4 | `20261015130000_m10_likes_and_mutual_matching.sql` | `likes` + `matches`; mutual-match creation | M10 |
| 5 | `20261015140000_m14_admin_and_abuse_controls.sql` | Roles, suspension, rate limiting, audit log | M14 |
| 6 | `20261015150000_m15_privacy_deletion_and_legal.sql` | Data export and account erasure | M15 |
| 7 | `20261015160000_notifications_realtime.sql` | Notification feed + generation triggers | M16 |
| 8 | `20261015170000_moments_feed.sql` | Moments feed, likes, comments | M16 |
| 9 | `20261015180000_game_zone.sql` | Game catalogue and result ledger | M16 |
| 10 | `20261015190000_onboarding_wizard_columns.sql` | Profile columns the 15-step onboarding wizard writes | onboarding |
| 11 | `20261015195000_m4_schema_consolidation.sql` | Reports/blocked_users constraints, FKs, indexes; `follows` primary key | M4 |
| 12 | `20261015210000_m12_blocking_enforcement.sql` | `is_blocked_pair`, block/unblock/unmatch RPCs, `discover_profiles` | M12 |
| 13 | `20261015220000_m8_interest_prompt_catalogue.sql` | Interest categories, interests and prompt catalogue (reference data) | M8 |
| 14 | `20261015230000_m11_messaging.sql` | Participant-only message policy, read state, unread counts | M11 |
| 15 | `20261015240000_m13_moderation_workflow.sql` | Evidence snapshots, moderator triage queue, resolution | M13 |
| 16 | `20261015250000_m7_profile_validation.sql` | 18+ age guard and profile field constraints | M7 |
| 17 | `20261015260000_m15_revoke_birth_date.sql` | Column-level revoke of `profiles.birth_date` + `my_birth_date()` | M15 |
| 43 | `20261015430000_elite_profile_identity.sql` | Split names, canonical unique usernames, availability RPC, canonical MBTI, and Politics removal from public projections | Elite profile |
| 44 | `20261015440000_people_follow_presence.sql` | `last_seen_at` + `touch_presence()` heartbeat, expiring online state in `public_profiles`/`discover_profiles()`, privacy-aware discovery, and a load-more exclusion argument | People discovery |
| 45 | `20261015450000_moments_posts_and_reels.sql` | `moments.content_kind` (post/reel) with a 120s Reel CHECK, a 10-item media cap, `allow_downloads` + `can_download_moment()`/`get_moment_download_url()`, `moderation_status` gating with an author guard and AI-scan demotion, owner-only `moment_saves`, and rebuilt `moment_feed`/`moment_archive` with `save_count`/`saved_by_me` | Moments Posts & Reels |
| 46 | `20261015460000_profiles_readable_columns_regrant.sql` | Re-grants column-level SELECT on every readable `profiles` column to `authenticated` (deny-list: `birth_date`, `banned_until`, `ban_reason`), fixing `42501 permission denied for table profiles` on the dashboard after M15's table-wide revoke left later columns ungranted | Profiles privilege fix |
| 47 | `20261015470000_profile_view_analytics.sql` | RPC-only `profile_viewers` table (unique viewer + `view_count`, RLS with no client grants), `record_profile_view()` (self/blocked filtered, atomic upsert, first-visit `visitor` notification), `profile_view_count()`, owner-derived `profile_view_summary()` and paginated/searchable `list_profile_viewers()` | Profile view analytics |

> The table above lists the milestone-defining migrations; later migrations
> (M16–M31 and the elite profile upgrade) apply in filename order after these.
> The generated `supabase/apply_all.sql` is the authoritative full sequence.

> **Applying to a live project.** Migrations 1–3 are the security boundary: on a
> project where they have not been applied, `profiles` is readable by anyone
> holding the public anon key. Always finish by running `./scripts/verify-rls.sh`.

## Verify your work

Read-only diagnostic — paste into the SQL Editor to inspect the current posture:

```bash
cat scripts/audit-rls.sql
```

Adversarial check — proves an anonymous caller gets nothing:

```bash
./scripts/verify-rls.sh
```

## Rules for new migrations

Enforced by `docs/CONSTITUTION.md`:

- `create table if not exists`, `alter table ... add column if not exists`
- `gen_random_uuid()` — **never** `uuid_generate_v4()` (needs an extension)
- `drop policy if exists` before `create policy`
- `FOR INSERT` policies use `WITH CHECK`, never `USING`
- Enable RLS on every new table, and grant `select` to `authenticated` only
- Never expose `birth_date` on a public surface — add new public columns to
  `public_profiles` deliberately
