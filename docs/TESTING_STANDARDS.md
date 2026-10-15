# Mettivo Testing Standards

> **Current state (M18 + launch checklist).** Every layer of the pyramid exists
> and runs in CI.
>
> `npm test` — **355 tests in ~12 seconds**, no external services, no secrets:
>
> | Suite | Tests | Covers |
> | --- | --- | --- |
> | `src/lib/matching.test.ts` | 18 | `matchScore`, `explainMatch`, intention affinity, deterministic ranking |
> | `src/lib/helpers.test.ts` | 17 | notification copy/actions/tabs, relative time, flags, game stats |
> | `src/lib/catalogue.test.ts` | 11 | interest normalisation, prompt-answer validation, limits |
> | `src/lib/profile.test.ts` | 40 | age derivation, the 18+ gate, draft validation, and the strict per-step onboarding guards (every step blocks when blank, photo minimum message is character-exact) |
> | `src/lib/env.test.ts` | 10 | environment validation, no key material in health output |
> | `src/lib/logger.test.ts` | 11 | R-08: redaction of PII, depth/array/string caps, safe stacks |
> | `src/app/api/observability/route.test.ts` | 7 | R-08: ingestion, re-redaction, size cap, malformed input |
> | `src/lib/translation.test.ts` | 13 | language-code normalisation/validation; picker options mirror the DB check constraint |
> | `src/lib/translation-service.test.ts` | 24 | the translation chain offline: DeepL success/quota, fallback to MyMemory on any DeepL failure, no-key path, both-fail keeps the last error, empty/quota responses, pre-flight rejects, multi-byte chunking |
> | `src/lib/locales.test.ts` | 16 | the language catalogue: one option per code, English + endonym resolved, search by English name / native name / alias, and the invariant that every offered language has strings for every key |
> | `tests/database/migrations.test.ts` | 53 | every migration: RLS, matching, notifications, moments, games (incl. the M16 catalogue), moderation, erasure, onboarding-wizard columns |
> | `tests/database/schema.test.ts` | 8 | M4: RLS coverage, primary keys, FK targets, FK indexes, erasure-safe FKs, no `uuid-ossp` |
> | `tests/database/blocking.test.ts` | 10 | M12: symmetric blocks, like/message refusal, discovery exclusion, unmatch |
> | `tests/database/messaging.test.ts` | 10 | M11: participant-only reads, write scoping, unread counts, read state |
> | `tests/database/moderation.test.ts` | 10 | M13: evidence snapshots, moderator-only triage, resolution + audit |
> | `tests/database/live_shape.test.ts` | 8 | the migration set against the live column types, exercised at runtime |
> | `tests/database/apply_all.test.ts` | 10 | the operator bootstrap applies, re-applies, and leaves zero anon rows |
> | `tests/database/restore_rehearsal.test.ts` | 9 | R-14: a rebuild is structurally identical to the normal path |
> | `tests/integration/auth-callback.test.ts` | 11 | §3.2: the OAuth route — every branch, failing closed |
> | `tests/integration/data-access.test.ts` | 33 | §3.2: every data-access module's error branches surface a message |
> | `tests/security/security.test.ts` | 26 | M17: anonymous bypass, privilege escalation, `SECURITY DEFINER` hardening, secrets hygiene, public-surface hygiene, column-level `birth_date` denial |
>
> `npm run test:e2e` — **72 Chromium journeys in ~45 seconds** (§3.3). The app
> under test points at `e2e.invalid` and every Supabase call is intercepted, so
> they need no secrets and cannot touch real data.
>
> **Still outstanding:** the data half of the restore rehearsal
> (`RISK_REGISTER.md` `R-14`) — it needs a scratch Supabase project and a dump.

## 1. The three gates (mandatory, every change)

Run from a clean tree before claiming anything works:

```bash
npx tsc --noEmit     # zero type errors
npx eslint .         # zero errors (warnings reviewed)
npm run build        # clean production build
```

A change that fails any gate is not finished. `next.config.ts` deliberately sets
**no** `ignoreBuildErrors` — type errors must break the build.

## 2. Security gate (mandatory for any database change)

Security properties are **proven by adversarial request, never by reading code**.

```bash
./scripts/verify-rls.sh
```

This script issues unauthenticated requests with the public anon key and asserts
that no personal data is returned. It must exit non-zero if any table leaks.
Expected output: every probed table reports zero rows to an anonymous caller.

**A database change is not done until `verify-rls.sh` passes.**

## 3. Test pyramid

### 3.1 Unit tests — Vitest

```bash
npm test          # one-shot
npm run test:watch
```

Everything pure. Already covered:

| Subject | File |
| --- | --- |
| `matchScore`, `getMatchesForUser` | `src/lib/matching.test.ts` |
| Notification copy, deep links, tab scoping, relative time | `src/lib/helpers.test.ts` |
| Country flags, gender icons, game stats, catalogue invariant | `src/lib/helpers.test.ts` |

The matching tests previously found a **real bug**: two profiles with no interests
both produced `0/0 = NaN`, poisoning the whole score. It is now guarded and
pinned by a test.

### 3.1b Database tests — real PostgreSQL, no services

```bash
npm test -- tests/database
```

`tests/database/harness.ts` boots **PGlite** (PostgreSQL compiled to WASM),
creates the base Supabase objects, then applies **every file in
`supabase/migrations` in order**. The migrations themselves are therefore under
test. Assertions currently cover:

- every migration applies **and re-applies** (idempotency),
- RLS is enabled on all 17 personal-data tables,
- no `INSERT` policy is missing `WITH CHECK`,
- anonymous callers read **zero** rows everywhere,
- profile privacy, owner-only writes, `public_profiles` excludes `birth_date`,
- mutual-match creation, no self-likes, matches cannot be forged,
- notification generation from likes/matches/messages/follows/report triage,
- moments aggregates, per-caller `liked_by_me`, content constraints,
- game result validation and ledger scoping,
- moderation: suspension, the privilege guard, rate limiting, audit-log access,
- erasure cascading to every table while other members are untouched.

> ⚠️ **RLS denies by filtering rows — it does not raise.** Assert a **zero
> affected-row count**, not "no exception was thrown". A `try/catch` around a
> blocked `UPDATE`/`DELETE` proves nothing and previously produced a false
> "security breach" report. Blocked `INSERT`s are the exception and *do* raise.
>
> Use the harness helpers: `affectedRows()` for filtered writes, `isRejected()`
> for blocked inserts, `anonReadCount()` for anonymous access.

This suite found a **real defect** the moment it ran: the M6 migration enabled
RLS and installed a SELECT-only baseline, silently making `messages` and
`follows` read-only on a fresh database — chat and follow were dead. Fixed in
`20261015120100_m6_enable_rls_all_tables.sql`.

### 3.2 Integration tests

**Implemented** — `tests/integration/`, 44 tests, `npm test`.

| File | Covers |
| --- | --- |
| `auth-callback.test.ts` | The OAuth route handler with Supabase mocked: missing code, failed exchange, missing user, a brand-new account, an unfinished account, the happy path, an unexpected throw, and a throwing cookie store. Every failure must land somewhere that cannot loop, and a failed exchange must never reach `getUser()`. |
| `data-access.test.ts` | Every data-access module against a mocked client, asserting the property `CONSTITUTION.md` Article 2.7 names: `{ error }` becomes a **user-visible throw**, never a plausible-looking empty result. |

The second file is the important one. "No conversations yet" and "the query
failed" look identical to a member, and only one of them is true — so
`fetchMessages`, `fetchDiscoveryCandidates`, `listBlockedMembers`,
`fetchReportQueue` and `loadCatalogue` all throw rather than returning `[]`.
The one deliberate exception is `fetchUnreadCounts()`, which degrades to no badge
because a missing badge beats an unusable chat list; it is documented in place
and pinned by a test.

### 3.3 End-to-end — Playwright (Chromium)

**Implemented** — `tests/e2e/`, 20 journeys, `npm run test:e2e`.

```bash
npm run test:e2e:install   # once: downloads Chromium into .playwright-browsers/
npm run test:e2e           # starts the dev server itself, then runs the journeys
```

#### Never touch production

The suite is architected so it *cannot* reach the real backend, rather than
relying on discipline:

1. `playwright.config.ts` starts the dev server with
   `NEXT_PUBLIC_SUPABASE_URL=https://e2e.invalid.supabase.co`. Next.js does not
   let `.env.local` override an already-set variable, so this wins.
2. `tests/e2e/fixtures.ts` intercepts every `auth/v1` and `rest/v1` call and
   serves deterministic fixtures.

If an interception is ever missed, the request fails harmlessly against
`e2e.invalid` instead of creating real accounts or reading real profiles.

#### What is covered

| Journey | Why it exists |
| --- | --- |
| 18+ gate is inert until confirmed | `R-05`; the container is `pointer-events: none` |
| A forced click still refuses | the handler guard, not just the CSS, is what protects a minor |
| Confirming unlocks the providers | the gate must be passable by an adult |
| Onboarding: minor refused, adult submitted | the wizard must reject, never clamp the age |
| Interests + prompts travel in the payload | M8 wiring end to end |
| Discovery renders a candidate, block removes it | `R-06` |
| All six nav destinations present | `R-12`, owner-built navigation |
| Each owner-built route renders | `R-12` |
| Offline fallback, legal pages | public surfaces |
| `/api/health` returns `ok` | M18 configuration probe |
| Manifest + `no-store` service worker | `R-10` |
| Manifest meets the install criteria | zero-cost distribution: name, `start_url`, `display: standalone`, 192 + 512 icons, maskable |
| Every icon exists at the size it claims | PNG dimensions are **decoded from the bytes**, because a mislabelled icon is the most common reason no install prompt appears |
| Manifest, theme colour and iOS touch icon are linked | `apple-mobile-web-app-capable` + `apple-touch-icon` are what make iOS "Add to Home Screen" produce a standalone app |
| A service worker registers and takes control | `NEXT_PUBLIC_ENABLE_SW=true` in the E2E web server, since `next dev` disables it by default |
| The offline page and manifest are precached | offline support is a claim until the cache is inspected |
| `/people` renders real content | it shipped as an empty scaffold behind a protected nav entry |
| **No protected route renders a bare nav shell** | the general form of the bug above: any route that returns 200 and paints the nav but no content of its own |

The full browser signup → chat → reload journey in the original plan needs a
real backend to create an account and persist a message; it is deliberately not
simulated here, because a mocked version would assert the mock rather than the
product. It belongs in the post-launch smoke checklist or against a dedicated
staging project.

## 4. Database / RLS negative tests

For every table, assert the *denial*, not just the success path:

| Assertion | Expected |
| --- | --- |
| Anonymous `select` on `profiles` | 0 rows |
| Anonymous `select` on `messages`, `follows`, `matches`, `reports`, `blocked_users` | 0 rows |
| User A cannot `update` user B's profile row | error / 0 rows affected |
| User A cannot `insert` a message with `sender_id = B` | policy violation |
| User A cannot read a report filed by B about C | 0 rows |
| Blocked user cannot send a message | rejected |
| Deleted account's data is gone | all rows removed (cascade) |

## 5. Vocabulary

- **Verified** — the gates above passed locally, with output quoted.
- **Tested** — an automated test covers it and runs in CI.
- **Believed** — no evidence. Do not use this word in a status report.

## 6. CI

`.github/workflows/ci.yml` runs on every push and pull request to `main`:

| Step | Command | Needs secrets? |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | no |
| Lint | `npm run lint` | no |
| Audit | `npm run audit` | no — registry only |
| Test | `npm test` | no — PGlite is in-process |
| Build | `npm run build` | no |

A second job runs `./scripts/verify-rls.sh` against the **live** Supabase project
on pushes to `main`, and **skips itself automatically** when
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` repository secrets
are absent — so forks and local runs stay green.

Run the whole gate locally with one command:

```bash
npm run verify      # typecheck && lint && test && audit && build
```

**M17 audit gate.** `npm run audit` runs `npm audit --omit=dev --audit-level=high`
and is a failing CI step. It is scoped to **production** dependencies on purpose:
the only open advisories are in dev-only build tooling (`braces` via
`eslint-config-next`) and report *"no fix available"*, so a full-tree gate could
never go green. A shipped-dependency advisory must fail the build.
`.github/dependabot.yml` opens grouped weekly update PRs (and immediate security
updates) to keep both trees current.
