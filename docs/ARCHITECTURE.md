# Mettivo Architecture

## 1. Stack

| Layer | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router, Turbopack default) | 16.4.0 |
| UI | React | 19.3.0 |
| Language | TypeScript (`strict: true`) | 5.x |
| Styling | Tailwind CSS v4 via `@tailwindcss/turbopack` + inline styles | 4.3.3 |
| Backend | Supabase (PostgreSQL + Auth + Realtime + RLS) | — |
| Supabase client | `@supabase/supabase-js` (browser, anon key) | 2.117.3 |
| Server auth | `@supabase/ssr` (cookie-based, for the OAuth callback) | 0.12.7 |
| Delivery | PWA — installable manifest + service worker | — |

**There is no application server.** The browser talks directly to Supabase. All
authorisation is enforced by **Row Level Security in PostgreSQL**. This is the
single most important architectural fact in the codebase: if an RLS policy is
missing or permissive, the data is public, regardless of what the UI does.

## 2. Directory map

```
src/
  app/
    layout.tsx              Root layout: metadata, PWA tags, LanguageProvider, SW registrar
    page.tsx                Landing page + auth-based routing
    globals.css             Tailwind import + Mettivo design tokens
    auth/
      page.tsx              OAuth / email OTP / phone OTP sign-in (18+ gate)
      callback/route.ts     Server route: exchanges OAuth code for a session
    signup/page.tsx         Registration (mirrors auth)
    discover/
      page.tsx              Discovery feed (age/gender/online filters)
      mettivo_live/page.tsx Voice-card live list
    chat/
      page.tsx              Conversation list (derived from messages)
      [matchId]/page.tsx    Chat room: send, realtime, report, block
    profile/
      page.tsx              Onboarding gate (routes to edit / dashboard)
      edit/page.tsx         Profile create + edit (upsert, sets onboarding_completed)
      dashboard/page.tsx    Profile view, completion score, stats
      settings/page.tsx     Settings, language, cache, sign-out
      stats/                followers, following, friends, interests, matches, photos
    people/page.tsx         (placeholder — see Known gaps)
    moments, game-zone, notifications, report, offline
    components/
      ui/                   Button, Card, Input, Modal, Avatar, Badge, UserList
      layout/               MobileNav (used), Header + AppShell (unused)
      InstallButton.tsx     PWA install (native prompt + iOS fallback)
      ServiceWorkerRegistrar.tsx
  context/LanguageContext.tsx   useSyncExternalStore-backed i18n
  lib/
    supabase.ts             Browser client (module-level env assertion)
    types.ts                Shared DB row types
    matching.ts             Rule-based scoring engine
    mockData.ts             Demo fixtures (INTERESTS, PROMPTS, MOCK_USERS)
    translations.ts         en / ne / hi / es / fr
    theme.ts
supabase/migrations/        Authoritative idempotent SQL
scripts/                    Verification tooling
docs/                       This documentation
```

## 3. Routes (22)

| Route | Type | Auth required |
| --- | --- | --- |
| `/` | static | no (redirects if signed in) |
| `/auth`, `/signup` | static | no |
| `/auth/callback` | **dynamic** (route handler) | no |
| `/discover`, `/discover/mettivo_live` | static shell, client-fetched | yes |
| `/chat` | static shell | yes |
| `/chat/[matchId]` | **dynamic** | yes |
| `/profile` | static shell | yes |
| `/profile/dashboard`, `/profile/edit`, `/profile/settings` | static shell | yes |
| `/profile/stats/*` (6 routes) | static shell | yes |
| `/moments`, `/game-zone`, `/notifications`, `/people`, `/report` | static shell | yes |
| `/offline` | static | no (PWA fallback) |

## 4. Authentication flow

```
/auth  ──OAuth──────────►  provider  ──►  /auth/callback (route handler)
                                               │ exchangeCodeForSession()
                                               │ read profiles.onboarding_completed
                    ┌──────────────────────────┴───────────────────┐
                    ▼                                              ▼
             /profile (onboarding gate)                     /discover
             ├─ no session ─► /auth
             ├─ not onboarded ─► /profile/edit ──save──► /profile/dashboard
             └─ onboarded ─► /profile/dashboard
```

Session persistence is handled by `supabase-js` in the browser
(`localStorage`); the server route uses `@supabase/ssr` cookies.

## 5. Live database schema

Verified by probing the live project read-only on **2026-10-15**, after the
migration set was applied.

> ✅ **In sync.** `./scripts/check-schema-drift.sh` reports
> `RESULT: IN SYNC — 42 expectations verified, 0 missing` (18 tables, 24 added
> columns), and `./scripts/verify-rls.sh` reports
> `RESULT: PASS - 7 table(s) verified, 0 skipped, 0 leaks`.
>
> The project previously exposed `profiles` to anonymous callers and was missing
> 16 migrations. See `RISK_REGISTER.md` `R-01`/`R-02` for the incident record.

**18 tables exist**, including `likes`, `matches`, `notifications`, `moments`,
`moment_likes`, `moment_comments`, `game_catalog`, `game_results`, `user_roles`,
`admin_audit_log`, `rate_limit_counters`, `rate_limit_rules`,
`match_read_state`, `interest_categories`, `interests` and `prompt_catalogue`.

| Table | Status | Key columns |
| --- | --- | --- |
| `profiles` | exists | `id`, `display_name`, `age`, `birth_date`, `gender`, `city`, `country`, `avatar_url`, `photos`, `intention`, `looking_for`, `hobbies`, `pets`, `personality`, `religion`, `politics`, `drinking`, `smoking`, `is_online`, `onboarding_completed`, `followers_count`, `following_count`, `friends_count`, `interests`, `prompts`, `bio`, `height`, `education`, `profession`, `languages_spoken`, `exercise` |
| `messages` | exists | `id`, `match_id`, `sender_id`, `content`, `created_at` |
| `follows` | exists | `follower_id`, `following_id` |
| `matches` | exists (0 rows, unused by code — **columns not yet introspected**) | — |
| `reports` | exists | `id`, `reporter_id`, `reported_user_id`, `reason`, `details`, `status`, `created_at`, `updated_at` |
| `blocked_users` | exists | `id`, `blocker_id`, `blocked_user_id`, `created_at` |
| `likes` | ❌ **missing on live** | created by migration 4 (M10) |
| `interests` / `prompts` | ❌ **missing as tables** | currently columns on `profiles` + fixtures in `mockData.ts` |

## 6. Known gaps (as of this revision)

These are recorded so no future change assumes they are solved.

### Open

1. **`migrations/reports_blocked_users.sql` is not executable** (0/22 statements):
   `uuid_generate_v4()` without the `uuid-ossp` extension, and `FOR INSERT ...
   USING` (must be `WITH CHECK`). It now carries a `DO NOT APPLY` header and is
   superseded by migration 11 / the M6 pair.
2. **`src/app/people/page.tsx` is a placeholder** and is linked from the matches screen.
3. **`birth_date` is still readable by any signed-in member** via `profiles`.
   `M15` tracks revoking it (`revoke select (birth_date) ...`) once
   `profile/dashboard` renders the stored `age` instead of the raw date.
4. **Suspension only hides a member from discovery.** `discover_profiles()`
   excludes suspended members; whether they should also disappear from the chat
   list and moments is the open product question `PRD_V1.md` Q1.
5. **No observability.** No error reporting or structured logging. `/api/health`
   reports configuration only.
6. **No migration runner.** Migrations are applied by hand in the SQL Editor.
   `scripts/check-schema-drift.sh` derives the expected schema from the migration
   files and diffs it against the live project, and runs in CI.
7. **Integration and end-to-end test layers are missing.**
   `TESTING_STANDARDS.md` §3.2 (mocked-Supabase client tests) and §3.3
   (Playwright journeys) are still outstanding; the database layer is covered.

### Resolved

- ~~`profiles` SELECT world-readable~~ — fixed in `supabase/migrations/` (M6),
  **applied to live on 2026-10-15**, and blocked from regressing by
  `tests/database` + `tests/security`. `./scripts/verify-rls.sh` exits 0.
- ~~16 migrations unapplied on the live project~~ — applied via
  `supabase/apply_all.sql`; `./scripts/check-schema-drift.sh` reports
  `IN SYNC — 42 expectations verified, 0 missing`.
- ~~Every signed-in member could read every private message and the whole follow
  graph~~ — the M6 baseline used `auth.uid() is not null` as the SELECT policy on
  both `messages` and `follows`, and the M6 tests only ever checked *anonymous*
  access, so it was invisible. Replaced by participant-only policies in
  `20261015230000_m11_messaging.sql`; pinned by `tests/database/messaging.test.ts`.
- ~~Blocking was stored but not enforced~~ — `is_blocked_pair()`, `block_member`,
  `unblock_member`, `unmatch_member` and `discover_profiles()` enforce it in the
  database (`20261015210000_m12_blocking_enforcement.sql`); pinned by
  `tests/database/blocking.test.ts`.
- ~~The 18+ gate was self-attested and silently clamped~~ — `calculateAge` no
  longer clamps, the wizard refuses an under-18 date of birth at the step that
  collects it, and `profiles_age_adult` is the database backstop. Pinned by
  `src/lib/profile.test.ts`.
- ~~Interests and prompts were hard-coded string literals~~ — the catalogue is
  reference data (`20261015220000_m8_interest_prompt_catalogue.sql`) validated at
  the boundary by `src/lib/catalogue.ts`.
- ~~`src/lib/matching.ts` was imported by nothing~~ — the engine is wired into
  discovery through `discover_profiles()` + `rankCandidates`, and is
  deterministic and explainable.
- ~~Reporting had no evidence and no triage queue~~ — `20261015240000_m13_moderation_workflow.sql`
  adds the snapshot trigger, `admin_report_queue()` and `admin_resolve_report()`.
- ~~`migrations/onboarding_wizard_columns.sql` aborts on `comment on column`~~ —
  the file used valid `comment on table` syntax; it has been relocated to
  `supabase/migrations/20261015190000_onboarding_wizard_columns.sql` and is now
  under test, which closed the real defect: nine wizard columns were absent from
  the authoritative migration chain.
- ~~Discovery read `profiles` with `select('*')`~~ — `src/app/discover/page.tsx`
  now reads only the allow-listed `discover_profiles()` RPC, and
  `mettivo_live` reads the allow-listed `public_profiles` view. Pinned by
  `tests/security/security.test.ts` §5.
- ~~`follows` had no primary key and four foreign keys were unindexed~~ — found
  by `tests/database/schema.test.ts` (M4) and fixed in
  `20261015195000_m4_schema_consolidation.sql`.
- ~~No tests, no CI, no deployment procedure~~ — 179 tests across 11 suites, a
  five-step CI gate, and `docs/DEPLOYMENT.md`.
