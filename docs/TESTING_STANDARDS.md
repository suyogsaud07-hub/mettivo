# Mettivo Testing Standards

> **Current state (M18).** Unit tests, a database suite, an adversarial security
> suite and a schema audit exist and run in CI. `npm test` runs **179 tests in
> ~8 seconds** with no external services and no secrets:
>
> | Suite | Tests | Covers |
> | --- | --- | --- |
> | `src/lib/matching.test.ts` | 18 | `matchScore`, `explainMatch`, intention affinity, deterministic ranking |
> | `src/lib/helpers.test.ts` | 17 | notification copy/actions/tabs, relative time, flags, game stats |
> | `src/lib/catalogue.test.ts` | 11 | interest normalisation, prompt-answer validation, limits |
> | `src/lib/profile.test.ts` | 13 | age derivation, the 18+ gate, draft validation |
> | `src/lib/env.test.ts` | 10 | environment validation, no key material in health output |
> | `tests/database/migrations.test.ts` | 52 | every migration: RLS, matching, notifications, moments, games, moderation, erasure, onboarding-wizard columns |
> | `tests/database/schema.test.ts` | 8 | M4: RLS coverage, primary keys, FK targets, FK indexes, erasure-safe FKs, no `uuid-ossp` |
> | `tests/database/blocking.test.ts` | 10 | M12: symmetric blocks, like/message refusal, discovery exclusion, unmatch |
> | `tests/database/messaging.test.ts` | 10 | M11: participant-only reads, write scoping, unread counts, read state |
> | `tests/database/moderation.test.ts` | 10 | M13: evidence snapshots, moderator-only triage, resolution + audit |
> | `tests/security/security.test.ts` | 20 | M17: anonymous bypass, privilege escalation, `SECURITY DEFINER` hardening, secrets hygiene, public-surface hygiene |
>
> **Still outstanding:** mocked-Supabase integration tests for the data-access
> modules, Playwright end-to-end journeys (§3.2 and §3.3), and a restore
> rehearsal (`RISK_REGISTER.md` `R-14`).

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

- Route handlers (`/auth/callback`) with mocked Supabase responses: success,
  error exchange, missing code, unexpected throw.
- Data-access modules with a mocked client: verify `error` branches produce a
  user-visible message and never a silent success.

### 3.3 End-to-end — Playwright (one happy path, one safety path)

Critical journey that must never regress:

```
signup → 18+ gate → OAuth callback → /profile (gate)
      → /profile/edit → save → /profile/dashboard (profile renders)
      → /discover → open a chat → send a message (persists after reload)
```

Safety journey:

```
report a user → blocked user disappears from /discover and /chat
```

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
