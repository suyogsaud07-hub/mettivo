# Production migration runbook — M34 to M41

> **Status:** prepared, not applied. No production database change has been
> made by this document.
>
> **Target:** Supabase project `jnbrgxxwmgotuqejghrw`.
>
> **Repository baseline:** prepared from `522103e`; M40 and M41 must be reviewed
> and committed before use.
>
> **Scope:** apply the pending M34–M39 migrations, then M40 to repair the live
> messaging shape, then M41 to retain blocked history and close the remaining
> request-authority gap. M41 supersedes selected M38/M40 functions. This runbook
> does not change frontend code, tests, or the E2E failures.

---

## 1. Approval and ownership

Production writes require explicit approval from the product owner or release
owner. Record the approver and timestamp before opening the SQL Editor.

| Role | Name | Responsibility |
| --- | --- | --- |
| Approver | ____________________ | Written approval for the production window |
| Operator | ____________________ | Runs one migration at a time and records evidence |
| Observer | ____________________ | Checks the expected output and watches application errors |
| Rollback owner | ____________________ | Decides whether to restore or forward-fix |

Do not proceed if any of these are true:

- approval is verbal only;
- the target project cannot be identified with certainty;
- no recent backup or PITR restore point is available;
- a migration is already running;
- the operator intends to paste `supabase/apply_all.sql` or combine multiple
  migration files.

---

## 2. Non-negotiable rules

1. Apply **one file at a time**, in the order in section 7.
   `M41` is always last; `M40` must run immediately before it. Do not re-run
   `M34` or `M38` after `M40`: they replace the repaired functions with older
   definitions.
2. Use the exact file from the reviewed commit. Do not edit SQL in the editor.
3. Do **not** run `supabase/apply_all.sql` against production. It is a generated
   bundle and defeats the review boundary.
4. Do **not** paste multiple migrations into one SQL Editor execution.
5. Do **not** reset, truncate, drop, or recreate the production database.
6. Do **not** use `service_role` in the browser, a shell, a commit, or a prompt.
7. Do **not** select `admin_settings.value` or print a webhook secret. Use
   boolean checks only.
8. Do **not** continue to the next file after an error. A partial migration is
   still a migration; inspect and converge it first.
9. Do **not** claim a security property from the SQL alone. Prove it with an
   unauthenticated request returning zero rows or an access-denied response.
10. Do **not** run the E2E suite against production as a migration test.

---

## 3. Known starting state

The last read-only audit of the live project found:

- **17 missing expectations out of 141 checked**;
- four missing tables: `conversation_archive`, `donation_contributions`,
  `explore_categories`, `explore_dating_goals`;
- six missing `matches` columns: `kind`, `request_status`, `requested_by`,
  `requested_at`, `responded_at`, `updated_at`;
- seven missing RPCs: `start_conversation`, `conversation_summaries`,
  `conversation_send_state`, `respond_to_conversation_request`,
  `set_conversation_archived`, `explore_more_counts`, `explore_more_feed`.
  The PostgREST probe cannot resolve `start_conversation` or
  `conversation_summaries` with the repository argument names, and the reported
  live failure for those paths is a query against a nonexistent `conversations`
  table / `messages.conversation_id`. "The function exists" is not proof that
  the deployed signature and body are usable;
- `scripts/verify-rls.sh`: **31 tables verified, 0 skipped, 0 leaks**.

These are baseline observations, not permission to skip the preflight in
section 6. Re-run the read-only checks immediately before the window.

A later targeted inspection found the live `matches` table is already split:
`user_a_id` / `user_b_id` are `NOT NULL`, while `user_a` / `user_b` are nullable
legacy mirrors. The deployed `start_conversation()` queries a nonexistent
`conversations` table, and `conversation_summaries()` queries
`messages.conversation_id`. Do not assume the live table is legacy-only; the
M40 preflight below handles either shape.

Important limits of that evidence:

- Schema drift does **not** prove the state of `M37` because `M37` adds no table
  or column. Its grants and policies must be checked explicitly.
- SQL Editor history is not trustworthy. `supabase_migrations.schema_migrations`
  may be absent or stale, and manual SQL Editor runs do not reliably populate it.
  The live schema is the authority.

---

## 4. Preconditions

Before the maintenance window:

- [ ] Written approval is recorded.
- [ ] The correct Supabase project is open, and the project reference matches
      `jnbrgxxwmgotuqejghrw`.
- [ ] Supabase **Database → Backups** shows a recent successful backup and the
      expected PITR window.
- [ ] A logical export of the production database is available if the plan does
      not provide PITR. Store it outside the repository and never commit it.
- [ ] The same seven migrations have been applied successfully to a staging or
      scratch clone, and the post-migration checks in section 8 pass there.
- [ ] At least one `admin` remains in `user_roles`.
- [ ] The deployed frontend commit is recorded. The repository code calls
      `M34`/`M36`/`M38`/`M40` RPCs and reads canonical `matches` columns, so a
      mismatch between deployed code and database is a real outage risk.
- [ ] A low-traffic or maintenance window is agreed. Prefer pausing application
      writes for the whole sequence, and require it for `M36`, `M37`, `M38`, and `M40`.
- [ ] The two approver/operator test accounts for behavioral checks are ready;
      do not use real members' accounts.
- [ ] If donations are enabled, `payment_webhook_secret` is configured. Verify
      only that a non-empty secret exists; never read or print it.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are available
      locally for read-only verification. No `service_role` key is needed.

### Why a write freeze matters

- `M36` creates indexes on `profiles` (not `CONCURRENTLY`), which can block
  writes while they build.
- `M37` revokes privileges before re-granting them, so requests during the run
  can temporarily receive permission errors.
- `M38` adds columns, updates every existing match, sets `NOT NULL`, and updates
  every profile's `matches_count`. A concurrent match insert during the window
  between adding `kind` and setting its default can make the `NOT NULL` step
  fail.
- `M39` adds constraints and a unique index to Explore metadata.
- `M40` backfills both `matches` participant-column families, normalizes pair
  order, classifies existing conversations, and replaces messaging functions.

Do not treat "low traffic" as equivalent to "no writes" for `M38` or `M40`.

---

## 5. Migration manifest

| Order | File | Main objects / changes | Data effect | Main risk | Stop if |
| --- | --- | --- | --- | --- | --- |
| 1 | `20261015500000_m34_message_requests_and_inbox.sql` | `conversation_archive`, archive RPC, two-message trigger, inbox and send-state RPCs | Creates one new table; no backfill | FK requires `matches.id uuid`; trigger replacement | `matches.id` is not `uuid` or archive table conflicts |
| 2 | `20261015510000_m35_verified_donation_leaderboard.sql` | `donation_contributions`, verified-donation writer, refund, leaderboard | Creates one new table; no historical donation backfill | Depends on `M32.admin_settings`; financial data must not be exposed | `admin_settings` or `M32` functions are missing |
| 3 | `20261015520000_m36_explore_more_discovery.sql` | `explore_categories`, eligible-set functions, counts and feed | Seeds seven category rows; adds indexes | Index build/locks; existing category definitions could be overwritten | Required profile columns or prerequisite functions are missing |
| 4 | `20261015530000_m37_admin_security_hardening.sql` | Staff predicate, grants, policies, admin and moderation RPC replacements, indexes | No rows added or deleted; no columns added | Revokes all client grants before narrow re-grants | Fewer than one admin, missing `M32` helpers, or an error after the revokes |
| 5 | `20261015540000_m38_relationship_messaging.sql` | Six `matches` columns, constraints, follow/match reconciliation, request RPCs, three-message cap, inbox replacement | Rewrites every existing match to `kind='match'`; repairs all `profiles.matches_count` | Table locks, long updates, legacy invalid matches, concurrent inserts during `NOT NULL` transition | Any error after columns are added, especially on the `NOT NULL` step |
| 6 | `20261015550000_m39_explore_metadata.sql` | `updated_at`, goal table, admin metadata RPCs, unique title index, Explore function replacements | Seeds three Dating Goals; no profile rows rewritten | Duplicate category titles or a top-level "Serious Relationship" row | Duplicate lower-cased titles or a top-level "Serious Relationship" exists |
| 7 | `20261015560000_m40_live_messaging_compatibility.sql` | Canonical/legacy participant reconciliation, pair normalization, relationship classification, repaired messaging RPCs/triggers/RLS | Backfills participants, classifies existing matches, recomputes romantic counts | Duplicate/reverse rows, missing participants, or legacy/canonical disagreement stop the migration | Preflight raises; do not force it through |
| 8 | `20261015570000_m41_block_history_and_request_authority.sql` | Request-authority repair, stricter accept/reject and send-state, all-history-aware reconciliation, history-preserving block, best-effort notifications | Repairs malformed pending/accepted request rows; closes unrecoverable pending requests as tombstones; retains blocked conversations with any dependent history | A malformed pending request is closed as a tombstone; no match is deleted by the repair | M41 fails after M40 succeeds; do not delete history to force it through |

Dependency order is not optional:

- `M38` depends on `M34` and replaces M34's `conversation_summaries`,
  `conversation_send_state`, and `enforce_message_request_limit`.
- `M39` depends on `M36` and replaces M36's Explore counts and feed.
- `M35` depends on `M32.admin_settings`.
- `M37` depends on the existing `M32` permission helpers.
- `M34` depends on `matches.id` being `uuid`.
- `M40` depends on `M34` for the archive table shape, but creates it defensively.
  `M40` must run after `M38` and must not be followed by `M34`/`M38` re-runs.
- `M41` depends on `M40` and must run immediately after it. It replaces
  `sync_match_for_pair`, `block_member`, `respond_to_conversation_request`,
  `conversation_send_state`, `notify_on_message`, and `notify_on_match`, and
  adds the internal `match_has_retained_history(uuid)` predicate.

---

## 6. Read-only preflight

Run these in the Supabase SQL Editor immediately before the agreed window.
They do not modify data.

### 6.1 Confirm the target and record the baseline

```sql
select
  current_database() as database_name,
  current_user as sql_editor_user,
  now() as checked_at;

select to_regclass('supabase_migrations.schema_migrations') as migration_history;
```

If the history table exists, it is still advisory only:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 20;
```

Record the current row counts for later comparison:

```sql
select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.matches) as matches,
  (select count(*) from public.messages) as messages,
  (select count(*) from public.user_roles) as user_roles;
```

### 6.2 Confirm dependencies and critical types

```sql
select
  to_regclass('public.profiles') is not null as profiles_exists,
  to_regclass('public.matches') is not null as matches_exists,
  to_regclass('public.messages') is not null as messages_exists,
  to_regclass('public.follows') is not null as follows_exists,
  to_regclass('public.user_roles') is not null as user_roles_exists,
  to_regclass('public.admin_settings') is not null as admin_settings_exists;

select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('matches', 'messages')
  and column_name in (
    'id', 'match_id', 'user_a', 'user_b', 'sender_id', 'created_at'
  )
order by table_name, ordinal_position;

select
  to_regprocedure('public.pair_should_match(uuid,uuid)') is not null
    as pair_should_match_exists,
  to_regprocedure('public.sync_match_for_pair(uuid,uuid)') is not null
    as sync_match_for_pair_exists,
  to_regprocedure('public.has_permission(text)') is not null
    as has_permission_exists,
  to_regprocedure('public.is_admin()') is not null
    as is_admin_exists,
  to_regprocedure('public.is_moderator()') is not null
    as is_moderator_exists;
```

**Required result:** `matches.id` has `udt_name = uuid`. `M34` creates a foreign
key to that column. If it is `text`, stop; do not apply `M34`.

`messages.match_id` may be `uuid` or `text`; the migrations cast both sides to
text. Do not "fix" it during this window.

### 6.3 `M34` preflight

```sql
select
  to_regclass('public.conversation_archive') as archive_table,
  exists (
    select 1
    from pg_trigger
    where tgname = 'enforce_message_request_limit_trg'
      and not tgisinternal
  ) as request_limit_trigger_exists;
```

If `conversation_archive` already exists, inspect it before running M34:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'conversation_archive'
order by ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.conversation_archive'::regclass;
```

`create table if not exists` does not repair an incompatible pre-existing
table. Stop and investigate if columns, types, or the primary key differ.

### 6.4 `M35` preflight

Check that the M32 settings table exists and that the webhook secret is
configured without revealing it:

```sql
select
  key,
  jsonb_typeof(value) as value_type,
  (value ? 'secret') as has_secret_key,
  nullif(value ->> 'secret', '') is not null as secret_is_nonempty
from public.admin_settings
where key = 'payment_webhook_secret';

select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('admin_settings_get', 'record_payment_event')
order by proname;
```

If donations are disabled, a null secret is not a migration blocker. It is a
blocker for verifying the donation writer end to end. Never print the value.

`M35` does **not** backfill historical donations. Existing Stripe history is
not reconstructed by this migration.

### 6.5 `M36` preflight

If `explore_categories` already exists, inspect and back it up before running
M36. The seed upserts the seven known category IDs and sets `is_active = true`,
so it can overwrite metadata and re-enable a disabled category.

```sql
select id, title, is_active, sort_order
from public.explore_categories
order by sort_order;

select
  column_name,
  data_type,
  udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
  and column_name in (
    'age', 'gender', 'intention', 'interests', 'hobbies', 'pets',
    'looking_for', 'onboarding_completed', 'is_suspended',
    'banned_until', 'last_seen_at', 'is_verified'
  )
order by column_name;
```

If any required column is missing, stop. M36 creates indexes and functions that
reference them.

### 6.6 `M37` preflight

```sql
select role, count(*) as members
from public.user_roles
group by role
order by role;

select count(*) as admin_count
from public.user_roles
where role = 'admin';
```

**Required result:** `admin_count` is at least 1. If it is zero, stop. M37 locks
role changes around a last-admin check, but it does not create an admin. Do not
apply M37 and then discover the console has no super admin.

Record the current grants for a before/after comparison:

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'user_roles', 'admin_audit_log', 'admin_settings',
    'subscription_plans', 'subscriptions', 'payment_events',
    'notification_campaigns'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
```

### 6.7 `M38` preflight

Run this during the write freeze.

```sql
select count(*) as total_matches
from public.matches;

select count(*) as matches_with_messages
from public.matches m
where exists (
  select 1
  from public.messages msg
  where msg.match_id::text = m.id::text
);

select count(*) as legacy_ineligible_matches
from public.matches m
where public.pair_should_match(m.user_a, m.user_b) is not true;

select count(*) as blocked_matches
from public.matches m
where public.is_blocked_pair(m.user_a, m.user_b);
```

If `legacy_ineligible_matches > 0`, stop unless the approver explicitly accepts
that M38 will mark every existing row as `kind = 'match'`. M38 does not delete
or classify those rows. Future follow changes reconcile individual pairs through
`sync_match_for_pair`, but the legacy rows remain until deliberately repaired.

Record the affected pairs privately for review. Do not paste user IDs into chat,
tickets, or logs:

```sql
select
  m.id,
  m.user_a,
  m.user_b,
  public.is_cross_gender(m.user_a, m.user_b) as cross_gender,
  public.is_blocked_pair(m.user_a, m.user_b) as blocked
from public.matches m
where public.pair_should_match(m.user_a, m.user_b) is not true
order by m.created_at;
```

Do not delete these rows in this runbook. A conversation with messages must not
be destroyed because its follow state changed.

### 6.8 `M39` preflight

Run this **after M36 has succeeded**, immediately before M39.

```sql
select
  lower(btrim(title)) as normalized_title,
  array_agg(id order by id) as category_ids,
  count(*) as occurrences
from public.explore_categories
group by 1
having count(*) > 1;

select id, title
from public.explore_categories
where lower(btrim(title)) = 'serious relationship';
```

**Required result:** both queries return zero rows. The first would make
`explore_categories_title_key` fail. The second would violate
`explore_categories_no_serious_top_level`. Stop and resolve with a separately
reviewed data fix; do not edit the migration.

If `explore_dating_goals` exists from a partial run, check its duplicates too:

```sql
select category_id, lower(btrim(title)) as normalized_title, count(*)
from public.explore_dating_goals
group by 1, 2
having count(*) > 1;
```

### 6.9 `M40` preflight

Run this **after M34–M39 have succeeded**, immediately before M40.

```sql
select
  count(*) as total_matches,
  count(*) filter (
    where user_a_id is null or user_b_id is null
       or user_a is null or user_b is null
  ) as missing_participants,
  count(*) filter (
    where least(user_a, user_b) <> least(user_a_id, user_b_id)
       or greatest(user_a, user_b) <> greatest(user_a_id, user_b_id)
  ) as participant_disagreements
from public.matches;

select least(user_a_id, user_b_id) as lo,
       greatest(user_a_id, user_b_id) as hi,
       count(*) as occurrences
from public.matches
group by 1, 2
having count(*) > 1;
```

**Required result:** `missing_participants = 0`, `participant_disagreements = 0`,
and the duplicate query returns zero rows. If any check fails, stop. Do not
delete conversations or pick a winner by hand. Consolidate duplicates with a
separately reviewed data fix and preserve all messages/media.

M40 also adds `kind`, `request_status`, `requested_by`, `requested_at`,
`responded_at`, and `updated_at` if they are missing, and it creates
`conversation_archive` if M34 was skipped. It assumes the existing
`user_preferences`, `notifications`, `chat_settings`, `chat_media`,
`match_read_state`, `message_is_alive`, `is_chat_restricted`, and
`is_blocked_pair` objects are present.

---

## 7. Application procedure

### 7.1 Common procedure for every file

1. Open **Supabase dashboard → SQL Editor → New query**.
2. Confirm the project reference and the filename.
3. Paste the **entire** file from the reviewed commit, unchanged.
4. Run once. Do not run a second file in the same execution.
5. Compare the output with the "Expected output" below.
6. Run the targeted checks for that file.
7. Record the start time, end time, operator, output, and any warning.
8. Only then proceed to the next file.

If the SQL Editor times out, disconnects, or is cancelled, assume the file may be
partially applied. Do not continue. Inspect and re-run the same file after the
recovery checks in section 9.

### 7.2 Step 1 — `M34`

File:

```text
supabase/migrations/20261015500000_m34_message_requests_and_inbox.sql
```

Expected output:

```text
conversation_archive | rls_enabled = true | policy_count = 1
```

Targeted checks:

```sql
select
  to_regclass('public.conversation_archive') is not null as table_exists,
  has_table_privilege('anon', 'public.conversation_archive', 'SELECT')
    as anon_can_select,
  has_table_privilege('authenticated', 'public.conversation_archive', 'SELECT')
    as authenticated_can_select;

select tgname
from pg_trigger
where tgrelid = 'public.messages'::regclass
  and tgname = 'enforce_message_request_limit_trg';
```

Expected: `table_exists = true`, `anon_can_select = false`,
`authenticated_can_select = true`, and one trigger row.

Stop if the foreign key to `matches` fails, or if the archive table exists with
a different shape.

### 7.3 Step 2 — `M35`

File:

```text
supabase/migrations/20261015510000_m35_verified_donation_leaderboard.sql
```

Expected output:

```text
donation_contributions | rls_enabled = true | policy_count = 0
```

Targeted checks:

```sql
select
  to_regclass('public.donation_contributions') is not null as table_exists,
  has_table_privilege('anon', 'public.donation_contributions', 'SELECT')
    as anon_can_select,
  has_table_privilege('authenticated', 'public.donation_contributions', 'SELECT')
    as authenticated_can_select,
  has_function_privilege(
    'anon', 'public.donation_leaderboard(integer)', 'EXECUTE'
  ) as anon_can_read_leaderboard;
```

Expected: table exists; both direct table select checks are false; the public
leaderboard function is executable by `anon`. The table is deliberately
RPC-only and has no client table grants. The donation writer and refund
functions are executable by `anon` only because they are gated by the shared
webhook secret; that is intended, not a leak.

Do not create fake donations in production.

### 7.4 Step 3 — `M36`

File:

```text
supabase/migrations/20261015520000_m36_explore_more_discovery.sql
```

Expected output:

```text
explore_categories | 7
```

Targeted checks:

```sql
select id, title, sort_order, is_active
from public.explore_categories
order by sort_order;

select
  has_function_privilege(
    'anon', 'public.explore_more_counts(integer,integer)', 'EXECUTE'
  ) as anon_can_read_counts,
  has_function_privilege(
    'authenticated', 'public.explore_more_counts(integer,integer)', 'EXECUTE'
  ) as authenticated_can_read_counts;
```

Expected: exactly seven active categories in the known order, `anon` cannot
execute counts, and `authenticated` can.

Stop if the index build fails, if any required `profiles` column is missing, or
if `explore_categories` already contained extra rows. M36 upserts the seven known
IDs but does not delete unrelated rows, so an eighth active category is a
pre-existing data decision, not something to delete during this window.

### 7.5 Step 4 — `M37`

File:

```text
supabase/migrations/20261015530000_m37_admin_security_hardening.sql
```

Expected output: seven rows, one for each admin table. Table-level
`authenticated_can_select` should be false for `admin_settings` and
`payment_events`; `payment_events` is readable only through column-level safe
grants. All write privileges should be false.

Targeted checks:

```sql
select
  has_table_privilege('authenticated', 'public.admin_settings', 'SELECT')
    as auth_can_read_settings,
  has_table_privilege('authenticated', 'public.payment_events', 'SELECT')
    as auth_can_read_payment_table,
  has_column_privilege(
    'authenticated', 'public.payment_events', 'payload', 'SELECT'
  ) as auth_can_read_payload,
  has_column_privilege(
    'authenticated', 'public.payment_events', 'event_id', 'SELECT'
  ) as auth_can_read_safe_event_id,
  has_table_privilege('authenticated', 'public.admin_audit_log', 'SELECT')
    as auth_can_read_audit,
  has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT')
    as auth_can_write_audit;

select count(*) as admin_count
from public.user_roles
where role = 'admin';
```

Expected: settings false, payment table-level false, payload false, safe
`event_id` true, audit select true, audit insert false, and `admin_count` unchanged
and still at least one.

`has_table_privilege` checks table-level grants. `M37` gives `payment_events`
column-level grants instead of a table-level `SELECT`, so the table-level check
must stay false while safe columns such as `event_id` check true. Do not "fix"
that false result by granting table-level `SELECT`: it would expose `payload`.

If the file fails after the revokes, re-run the entire M37 file immediately.
Do not hand-grant individual tables: the file is the reviewed source of the
final grant state.

### 7.6 Step 5 — `M38`

File:

```text
supabase/migrations/20261015540000_m38_relationship_messaging.sql
```

Expected output: no posture table; the SQL Editor reports success. The update
statements may run for a noticeable time.

Targeted checks:

```sql
select kind, request_status, count(*) as rows
from public.matches
group by 1, 2
order by 1, 2;

select count(*) as null_state_rows
from public.matches
where kind is null or request_status is null;

select count(*) as wrong_match_counts
from public.profiles p
where p.matches_count <> (
  select count(*)::int
  from public.matches m
  where m.kind = 'match'
    and (m.user_a = p.id or m.user_b = p.id)
);

select
  has_column_privilege('authenticated', 'public.matches', 'kind', 'SELECT')
    as authenticated_can_read_kind,
  has_column_privilege('authenticated', 'public.matches', 'request_status', 'SELECT')
    as authenticated_can_read_request_status;
```

Expected: no null state; all existing matches are `kind = 'match'` and
`request_status = 'not_applicable'`; `wrong_match_counts = 0`; the two column
read checks are true.

`M38` intentionally assigns every legacy match the romantic `match` kind. If the
preflight found ineligible matches and the approver accepted them, record them
as known legacy data. Do not delete them here.

Stop if a constraint or `NOT NULL` step fails, or if the SQL Editor cancels.
Re-run the same file only after confirming the columns and constraints are in a
consistent partial state.

### 7.7 Step 6 — `M39`

File:

```text
supabase/migrations/20261015550000_m39_explore_metadata.sql
```

Expected output:

```text
active_categories = 7 | active_goals = 3
```

Targeted checks:

```sql
select
  (select count(*)::int from public.explore_categories where is_active)
    as active_categories,
  (select count(*)::int from public.explore_dating_goals where is_active)
    as active_goals;

select conname
from pg_constraint
where conname = 'explore_categories_no_serious_top_level';

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename = 'explore_categories'
  and indexname = 'explore_categories_title_key';
```

Expected: 7 active categories, 3 active goals, the check constraint exists, and
the unique index exists.

Stop if the unique index fails. Do not rename or delete category rows in the
editor to force it through; fix the data with a reviewed statement and re-run
M39.

### 7.8 Step 7 — `M40` (required before M41)

File:

```text
supabase/migrations/20261015560000_m40_live_messaging_compatibility.sql
```

Expected output: a posture table listing `start_conversation`,
`conversation_summaries`, `conversation_send_state`,
`enforce_message_request_limit`, and `sync_match_for_pair`, all
`security_definer = true` with a pinned `search_path`.

Targeted checks:

```sql
select
  count(*) as total_matches,
  count(*) filter (
    where user_a_id is null or user_b_id is null
       or user_a is null or user_b is null
  ) as missing_participants,
  count(*) filter (
    where user_a <> user_a_id or user_b <> user_b_id
  ) as unsynchronized_pairs,
  count(*) filter (where kind is null or request_status is null) as null_state
from public.matches;

select kind, request_status, count(*) as rows
from public.matches
group by 1, 2
order by 1, 2;

select tgname
from pg_trigger
where tgrelid = 'public.messages'::regclass
  and not tgisinternal
order by tgname;

select count(*) as wrong_match_counts
from public.profiles p
where p.matches_count <> (
  select count(*)::int
  from public.matches m
  where m.kind = 'match'
    and (m.user_a_id = p.id or m.user_b_id = p.id)
);
```

Expected:

- `missing_participants = 0`, `unsynchronized_pairs = 0`, `null_state = 0`;
- every row is classed as `match`, `mutual_follow`, `request`, or `closed`, with
  a valid `request_status`;
- `enforce_message_request_limit_trg`, `notify_on_message_trg`,
  `reject_blocked_message_trg`, and `require_message_participation_trg` exist;
- `wrong_match_counts = 0`;
- previously romantic `kind='match'` rows that are not opposite-gender mutual
  follows have been reclassified rather than deleted.

Do not re-run `M34` or `M38` after this step. If M40 stops on its preflight
error, resolve the data with a reviewed statement first; do not edit the
migration in the SQL Editor.

### 7.9 Step 8 — `M41` (required last)

File:

```text
supabase/migrations/20261015570000_m41_block_history_and_request_authority.sql
```

Expected output: no error. M41 repairs malformed request rows, replaces the
request/block/notification functions and the pair reconciler, and performs no
destructive table change. The data repair deletes no match. The block reconciler
may remove a match only when all five dependent-history tables are empty.

Invariant enforced by M41:

- a **pending** request must have a participant as `requested_by`; if no valid
  requester can be recovered, the row is retained as a closed tombstone;
- an **accepted** request may have `requested_by = null` when historical
  attribution cannot be recovered, provided the conversation remains usable;
- an accepted request with a non-null, non-participant requester is cleared to
  `requested_by = null`, not closed solely for that reason.

Targeted checks:

```sql
select
  count(*) filter (
    where request_status = 'pending'
      and (
        requested_by is null
        or requested_by not in (user_a_id, user_b_id)
      )
  ) as malformed_pending_requests,
  count(*) filter (
    where request_status = 'accepted'
      and requested_by is not null
      and requested_by not in (user_a_id, user_b_id)
  ) as malformed_accepted_attributions
from public.matches
where kind = 'request';

select proname, prosecdef, proconfig
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'match_has_retained_history',
    'block_member',
    'respond_to_conversation_request',
    'conversation_send_state',
    'notify_on_message',
    'notify_on_match'
  )
order by proname;
```

Expected: both counts are `0`; every function is `security_definer = true` with
a pinned `search_path` where applicable. An accepted request with a null
requester is valid and must not be counted.

Behavioral checks with approved accounts:

- A blocks B after messages exist. The `matches` row must remain with
  `kind='closed'` and `status='closed'`, messages and `chat_media` must survive,
  and new sends and request responses must be refused.
- Repeat the block case when the conversation has `chat_media`,
  `conversation_archive`, `chat_settings`, or `match_read_state` rows but no
  message row. The match must also remain closed, with all four rows intact.
- A pending request with a null `requested_by` must be refused by both
  participants. If no valid sender can recover it, M41 closes it as a tombstone.
- An accepted request with `requested_by = null` must remain accepted and usable.

Do not delete messages, media, archive, settings, receipts, or `matches` rows to
make M41 pass.

---

## 8. Post-migration verification

### 8.1 Schema drift

From the repository, with the production public env values loaded:

```bash
./scripts/check-schema-drift.sh
```

Expected:

```text
RESULT: IN SYNC — 141 expectations verified, 0 missing.
```

The exact count is tied to the current migration set. The requirement is
`0 missing`, not merely a successful exit.

### 8.2 Existing RLS suite

```bash
./scripts/verify-rls.sh
```

Expected:

```text
RESULT: PASS - 31 table(s) verified, 0 skipped, 0 leaks.
```

This script does not yet include the four new tables. Section 8.3 is mandatory
and is not optional evidence.

### 8.3 New-table anonymous probes

Use only the public anon key. The expected result is an access-denied response,
not a successful empty response.

```bash
set -euo pipefail
: "${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?set NEXT_PUBLIC_SUPABASE_ANON_KEY}"

for table in \
  conversation_archive \
  donation_contributions \
  explore_categories \
  explore_dating_goals
do
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1" \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    --max-time 20)"
  printf '%-28s %s\n' "$table" "$code"
done
```

Expected: `401` or `403` for every table. A `200` is a failure, even if the
response body is `[]`; zero rows from an ungranted table is not proven by an
empty result.

### 8.4 Anonymous RPC probes

The probes must send the argument names the functions require. An empty `{}`
body produces a misleading `404` for a healthy function with required arguments.

```bash
set -euo pipefail
: "${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?set NEXT_PUBLIC_SUPABASE_ANON_KEY}"

ZERO_UUID='00000000-0000-0000-0000-000000000000'
RPC_SPECS=(
  "start_conversation|{\"p_target\":\"${ZERO_UUID}\"}"
  "conversation_summaries|{}"
  "conversation_send_state|{\"p_match_id\":\"${ZERO_UUID}\"}"
  "respond_to_conversation_request|{\"p_match_id\":\"${ZERO_UUID}\",\"p_accept\":true}"
  "set_conversation_archived|{\"p_match_id\":\"${ZERO_UUID}\",\"p_archived\":true}"
  "explore_more_counts|{\"p_min_age\":18,\"p_max_age\":99}"
  "explore_more_feed|{\"p_category_id\":\"coffee-food\",\"p_goal\":null,\"p_cursor\":null,\"p_limit\":12,\"p_min_age\":18,\"p_max_age\":99,\"p_exclude_ids\":[]}"
)

for spec in "${RPC_SPECS[@]}"; do
  rpc="${spec%%|*}"
  body="${spec#*|}"
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${rpc}" \
    -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$body" --max-time 20)"
  printf '%-36s %s\n' "$rpc" "$code"
done
```

Expected: `401`/`403` for the authenticated-only RPCs. A `404` means the
function is missing or the argument names do not match. A `200` means an
unauthenticated caller reached it; stop.

Do not send a real donation secret to `record_verified_donation` or
`refund_donation` in a shell history. Those functions are intentionally
anon-executable but secret-gated.

### 8.5 Admin privilege proof

Run in the SQL Editor:

```sql
select
  has_table_privilege('anon', 'public.admin_settings', 'SELECT') as anon_settings,
  has_table_privilege('authenticated', 'public.admin_settings', 'SELECT') as auth_settings,
  has_column_privilege(
    'authenticated', 'public.payment_events', 'payload', 'SELECT'
  ) as auth_payload,
  has_table_privilege('authenticated', 'public.admin_audit_log', 'INSERT') as auth_audit_insert;
```

Expected: all false. This is a privilege check, not a row-level proof. Complete
the role matrix in section 8.7 with real signed-in staff accounts.

### 8.6 Data integrity

Compare with the counts recorded in section 6.1. The expected changes are only:

- `matches` gains six relationship columns; M38 then M40 classify existing
  rows without deleting conversations;
- `profiles.matches_count` is recomputed first by M38 and again by M40 from
  canonical participant columns;
- M41 may close a blocked conversation with history or a malformed pending
  request as a tombstone; it must not delete a match that owns messages, media,
  archive, settings, or receipts. A truly history-free match may still be
  removed by the existing block semantics;
- `conversation_archive`, `donation_contributions`, `explore_categories`, and
  `explore_dating_goals` are created;
- `explore_categories` has seven active seed rows;
- `explore_dating_goals` has three active seed rows.

No migration in this set should delete a message or a profile.

### 8.7 Functional checks with approved accounts

Run these against staging first. On production, use only approved internal test
accounts and avoid creating fake financial rows.

#### M40/M41 messaging matrix

| Scenario | Expected |
| --- | --- |
| A starts a conversation with B without following | `kind=request`, `request_status=pending`, `requested_by=A` |
| A follows B one-way, then starts a conversation | same pending request; a follow is optional |
| A sends three messages while pending | succeeds |
| A sends a fourth while pending | rejected with `42501` and no row inserted |
| B replies while pending | request becomes accepted in the same transaction; the cap lifts |
| B rejects through `respond_to_conversation_request` | `request_status=rejected`; tombstone remains; A cannot send or silently reopen |
| A and B mutually follow, cross-gender, not blocked | romantic `kind=match`, notification generated, counts increment once |
| A and B mutually follow, same gender | `kind=mutual_follow`, chat allowed, not counted as a romantic match |
| A blocks B after messages exist | conversation retained as `closed`; chat unavailable; messages and media not destroyed |
| A pending request has `requested_by = null` | accept/reject refused; send-state cannot advertise sending; M41 recovers from the first valid sender or closes it as a tombstone |
| An accepted request has `requested_by = null` | remains accepted and usable; M41 does not close it and the runbook query does not flag it |
| A blocks B with media/archive/settings/receipts but no messages | conversation retained as `closed`; all dependent rows survive |
| A archives a conversation | only A's inbox hides it; B's inbox is unchanged |
| Existing conversation has messages before M40 | messages remain readable; only relationship metadata/classification changes |
| Legacy and canonical participant columns both exist | both pairs stay synchronized on every write |
| A reverse duplicate pair is inserted directly | rejected by the unique unordered-pair index |

#### M36/M39 Explore matrix

- Exactly seven active categories.
- Dating Goals opens three goals, not a fourth top-level category.
- `friendship`, `serious`, and `casual` map to stored intentions
  `friendship`, `dating`, and `both`.
- Counts and feed use the same eligible set; a blocked, suspended, already-liked,
  already-matched, or onboarding-incomplete profile never appears.
- No `birth_date`, religion, politics, email, or exact-location field appears in
  feed output.
- Disabling a goal/category through an admin metadata RPC removes it from the
  normal read path without deleting the row.

#### M37 staff matrix

| Caller | Expected |
| --- | --- |
| `anon` | no admin table rows; privileged RPCs refused |
| ordinary member | `admin_me()` only; no admin tables or privileged RPCs |
| support | permitted console reads; no audit/settings/payments/staff management |
| finance | safe payment columns only; no raw `payload`, audit, settings, or moderation |
| moderator | reports and ordinary-member actions; no staff targets, audit, settings, payments, or role management |
| admin | full console; masked settings; no webhook secret in any response; audit read allowed |
| moderator targets another staff member | `42501`, no enforcement row |
| admin demotes the last admin | denied |
| two concurrent last-admin demotions | at least one admin remains |

### 8.8 Application smoke checks

After the database verification, check the deployed frontend against the
recorded commit:

```text
GET  /api/health                 -> 200, status "ok"
GET  /privacy                    -> 200 without a session
GET  /terms                      -> 200 without a session
     /auth                       -> sign-in renders
     /discover                   -> loads after sign-in
     /chat                       -> inbox loads; no PGRST202 for M34/M38 RPCs
     /explore-more               -> seven categories; no RPC schema-cache error
     /notifications              -> protected surface still present
     /moments                    -> protected surface still present
     /game-zone                  -> protected surface still present
```

Protected navigation check:

```bash
grep -cE "'/notifications'|'/moments'|'/game-zone'" \
  src/app/components/layout/MobileNav.tsx
# must print 3
```

Watch the Supabase API logs and browser console for `PGRST202`,
`Could not find the function`, `42501`, and unexpected `500` responses. If the
deployed commit is older than the database shape, a normal 404/400 from an
unmigrated client is possible; do not "fix" it by weakening grants.

---

## 9. Failure and recovery

### 9.1 General rule

Stop at the first error. Do not run the next migration. Do not attempt an
untested manual repair. Record:

- filename and statement that failed;
- exact error code and message;
- current transaction state (committed, partial, or unknown);
- object inventory from the checks below.

### 9.2 Per-file recovery

| Failed file | First action | Do not |
| --- | --- | --- |
| `M34` | Check whether `conversation_archive` exists and whether its FK is valid. Re-run the same file if the shape is correct. | Do not change `matches.id` or create a second archive table. |
| `M35` | Confirm `admin_settings` and M32 helpers exist, then re-run the same file. | Do not insert donation rows manually to "test" it. |
| `M36` | Confirm the required `profiles` columns exist, inspect partial category rows, then re-run the same file. | Do not delete categories to force the seed. |
| `M37` | Re-run the entire M37 file immediately to restore the revoke/grant posture. | Do not hand-grant a single table and leave a partial posture. |
| `M38` | Inspect `matches` columns, defaults, null counts, and constraints. Re-run the same file if the partial state is consistent. | Do not set `kind`/`request_status` manually across the table without review, and do not drop messages. |
| `M39` | Inspect duplicate titles and the goal seed. Resolve data with a reviewed statement, then re-run M39. | Do not remove the check/unique constraint. |
| `M40` | Read the raised preflight message. Resolve missing participants, duplicates, or legacy/canonical disagreements with a reviewed data fix, then re-run M40. | Do not drop the unique pair index, null out participants, or delete messages to force it through. |
| `M41` | Confirm M40 completed, then re-run M41. Inspect any tombstone it created and verify no match, message, media, archive, settings or receipt row was deleted. | Do not restore the M23 match-deleting block behavior or delete history to force the repair. |

### 9.3 Database rollback

There are no down migrations in this repository. `git revert` is not a database
rollback, and `supabase/apply_all.sql` is not a rollback tool.

- `M34`, `M35`, `M36`, and `M39` are additive; a failed run is normally fixed by
  correcting data or prerequisites and re-running the same file.
- `M37` changes grants and function bodies. A botched run is fixed by re-running
  M37 to convergence. Rolling it back would reopen the known security findings.
- `M38` and `M40` change every existing match and every profile's match count.
  A restore is the only clean rollback after either commits. There is no
  reviewed down migration, and dropping the new columns would break the new
  RPCs. Never roll back by re-running M34/M38 after M40.
- `M41` is forward-fix only. Re-running it is safe; reverting it would restore
  the match-deleting block behavior and the null-requester acceptance gap.

Use a PITR restore only when data is corrupted, a security boundary is broken, or
a forward fix cannot converge. A restore loses writes made after the restore
point. The restore must be rehearsed; do not restore production tables
piecemeal.

---

## 10. Completion checklist

- [ ] All eight files applied once, in order, with no unrecorded error.
- [ ] `M34` archive table exists and the request-limit trigger is installed.
- [ ] `M35` donation table exists, is RPC-only, and no historical rows were
      invented.
- [ ] `M36` has seven active categories.
- [ ] `M37` admin grants and policies match section 7.5; at least one admin
      remains.
- [ ] `M38` ran as the temporary schema step and is not re-run after M40.
- [ ] `M39` has three active goals and the unique/check constraints.
- [ ] `M40` has no null state, synchronized participant pairs, correct romantic
      counts, and all four message write guards installed.
- [ ] `M41` leaves zero malformed pending requests and zero accepted requests
      with an invalid non-null requester; accepted null attribution is allowed.
- [ ] `M41` preserves messages/media/archive/settings/receipts when a
      conversation is blocked, including when it has no message rows.
- [ ] `./scripts/check-schema-drift.sh` reports `IN SYNC`.
- [ ] `./scripts/verify-rls.sh` reports `PASS`.
- [ ] The four new tables return `401`/`403` to an anonymous PostgREST request.
- [ ] Application smoke checks pass.
- [ ] The deployed commit and migration completion time are recorded.
- [ ] Any known legacy matches or follow-up data cleanup are assigned an owner.

## 11. Evidence record

| Time (UTC) | File / step | Operator | Result | Evidence location |
| --- | --- | --- | --- | --- |
| | Preflight | | | |
| | `M34` | | | |
| | `M35` | | | |
| | `M36` | | | |
| | `M37` | | | |
| | `M38` | | | |
| | `M39` | | | |
| | `M40` | | | |
| | `M41` | | | |
| | Schema drift | | | |
| | RLS checks | | | |
| | App smoke | | | |

Final status: **not applied** until the table above is completed and the
approver signs off.
