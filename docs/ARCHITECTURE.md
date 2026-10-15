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
  components/Logo.tsx         The brand mark + full lockup (see §7)
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
| `/` | static | no — public for everyone, never auto-redirects; its primary CTA opens `/signup` |
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

> ⚠️ **TWO MIGRATIONS ARE UNAPPLIED AND THE DRIFT CHECK FAILS.**
> `./scripts/check-schema-drift.sh` currently reports
> `user_preferences MISSING — table does not exist on the live project`
> (19 tables expected). The repository is ahead of the live database by:
>
> | Migration | Needs applying for |
> | --- | --- |
> | `20261015270000_m16_game_catalog_expansion.sql` | the seven playable mini-games. Until it runs, `record_game_result()` rejects every new game id, so the games render and play but their scores are not saved. |
> | `20261015280000_m17_user_preferences.sql` | chat translation. Until it runs, `/api/translate` cannot read a member's preferred language and the settings row has no table to write to. |
>
> Apply them by pasting `supabase/apply_all.sql` into the Supabase SQL Editor
> twice (the second pass proves idempotency). There is no migration runner
> (§6.4). Everything below marked ✅ was true of the **pre-M16** snapshot.

> ✅ **In sync at the last verified snapshot.** `./scripts/check-schema-drift.sh`
> reported `RESULT: IN SYNC — 42 expectations verified, 0 missing` (18 tables, 24
> added columns), and `./scripts/verify-rls.sh` reports
> `RESULT: PASS - 7 table(s) verified, 0 skipped, 0 leaks`.
>
> The project previously exposed `profiles` to anonymous callers and was missing
> 16 migrations. See `RISK_REGISTER.md` `R-01`/`R-02` for the incident record.

**19 tables exist in the migration set**, including `likes`, `matches`,
`notifications`, `moments`, `moment_likes`, `moment_comments`, `game_catalog`,
`game_results`, `user_preferences`, `user_roles`, `admin_audit_log`,
`rate_limit_counters`, `rate_limit_rules`, `match_read_state`,
`interest_categories`, `interests` and `prompt_catalogue`.

| Table | Status | Key columns |
| --- | --- | --- |
| `profiles` | exists | `id`, `display_name`, `age`, `birth_date`, `gender`, `city`, `country`, `avatar_url`, `photos`, `intention`, `looking_for`, `hobbies`, `pets`, `personality`, `religion`, `politics`, `drinking`, `smoking`, `is_online`, `onboarding_completed`, `followers_count`, `following_count`, `friends_count`, `interests`, `prompts`, `bio`, `height`, `education`, `profession`, `languages_spoken`, `exercise` |
| `messages` | exists | `id`, `match_id`, `sender_id`, `content`, `created_at` |
| `follows` | exists | `follower_id`, `following_id` |
| `matches` | exists (0 rows, unused by code — **columns not yet introspected**) | — |
| `reports` | exists | `id`, `reporter_id`, `reported_user_id`, `reason`, `details`, `status`, `created_at`, `updated_at` |
| `blocked_users` | exists | `id`, `blocker_id`, `blocked_user_id`, `created_at` |
| `user_preferences` | ⚠️ **created by M17, not yet applied** | `user_id`, `preferred_translation_language`, `created_at`, `updated_at` — one row per member, RLS `auth.uid() = user_id` |
| `likes` | ❌ **missing on live** | created by migration 4 (M10) |
| `interests` / `prompts` | ❌ **missing as tables** | currently columns on `profiles` + fixtures in `mockData.ts` |

## 6. Known gaps (as of this revision)

These are recorded so no future change assumes they are solved.

### Open

1. **`migrations/reports_blocked_users.sql` is not executable** (0/22 statements):
   `uuid_generate_v4()` without the `uuid-ossp` extension, and `FOR INSERT ...
   USING` (must be `WITH CHECK`). It now carries a `DO NOT APPLY` header and is
   superseded by migration 11 / the M6 pair.
2. **Suspension only hides a member from discovery.** `discover_profiles()`
   excludes suspended members; whether they should also disappear from the chat
   list and moments is the open product question `PRD_V1.md` Q1.
3. **Alerting is not wired.** Structured, PII-redacted logging, route/global error
   boundaries and a `/api/observability` sink now exist (R-08), so a failure
   leaves durable forensic evidence — but nobody is paged. Closing that needs a
   log-drain threshold or a service such as Sentry, plus a retention decision.
4. **No migration runner.** Migrations are applied by hand in the SQL Editor.
   `scripts/check-schema-drift.sh` derives the expected schema from the migration
   files and diffs it against the live project, and runs in CI.
5. **The data half of the restore rehearsal is unrun.** The rebuild path is
   proven and automated (`tests/database/restore_rehearsal.test.ts`,
   `scripts/restore-rehearsal.sh`); restoring an actual dump needs a scratch
   project. See `RISK_REGISTER.md` `R-14`.
6. **No full-stack end-to-end journey.** The Playwright suite runs real browser
   journeys with Supabase intercepted, deliberately never touching production.
   The signup → chat → reload path needs a staging backend.

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
- ~~`src/app/people/page.tsx` was a placeholder~~ — it shipped as a full-height
  dark div containing only the bottom navigation, with the author's empty JSX
  comment markers still in the source, while being one of the six protected nav
  destinations. It now lists mutual matches with an explicit column allow-list,
  and two E2E tests guard it: one asserts it renders content, and a general one
  fails any protected route that paints only the navigation shell.
- ~~`birth_date` was readable by any signed-in member~~ — revoked at the column
  level (`20261015260000_m15_revoke_birth_date.sql`). Note the naively obvious
  `revoke select (birth_date)` is a **no-op** while a table-wide grant exists; see
  `RISK_REGISTER.md` `R-04`.
- ~~No tests, no CI, no deployment procedure~~ — 339 tests across 20 suites,
  66 browser journeys, a five-step CI gate, and `docs/DEPLOYMENT.md`.

## 7. Brand assets

The logo exists in exactly one React implementation and a small set of derived
binaries. Nothing draws the mark inline except `/offline`, which is deliberate.

| Artefact | Role |
| --- | --- |
| `src/components/Logo.tsx` | The single source of truth in the app. `variant="mark"` for navigation and tight spaces; `variant="lockup"` for the landing hero and any brand statement. |
| `public/logo-mark.svg` | The standalone mark, for anything outside the app (integration assets). Generated icons rasterise from it. |
| `public/icons/*.png` | Manifest icons, the Apple touch icon and the notification badge. |
| `src/app/favicon.ico` | Multi-resolution (16/32/48) tab icon, served by Next from the app directory. |

```bash
npm run generate:icons    # re-rasterise every icon from public/logo-mark.svg
```

Two traps this generator exists to avoid, both of which cost a debugging cycle
the first time:

1. **The favicon must be RGBA.** Next's `.ico` decoder rejects an RGB PNG with
   *"The PNG is not in RGBA format"* and turns every route into a 500 at build
   time. The favicon bitmaps are therefore rasterised with `omitBackground`
   (transparent), while the app icons keep the opaque brand background.
2. **A nested `<svg>` inside the lockup is subject to `preserveAspectRatio`.**
   When the nested viewport did not fit its parent frame, the browser scaled the
   mark down while the sibling `<text>` elements stayed put — the artwork
   silently overlapped the wordmark. The lockup places the mark with an explicit
   `<g transform>` instead, which has no fitting behaviour.

`/offline` inlines the mark rather than importing the component, because that
page is precached and must render with no network and no extra chunk fetch. It
is the one intentional copy; both move together when the brand changes.
