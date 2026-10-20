# Mettivo — Risk Register

**Status:** Living document · reviewed at every milestone boundary
**Owner:** Lead Architect
**Last reviewed:** 2026-10-15
**Scoring:** Likelihood × Impact, each `1`–`5`. Exposure = L×I. `🔴 ≥15`, `🟠 8–14`, `🟡 4–7`, `🟢 ≤3`.
**Companion documents:** [`PRD_V1.md`](./PRD_V1.md) · [`CONSTITUTION.md`](./CONSTITUTION.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## 1. How to use this register

1. Every risk has a stable ID (`R-nn`), an owner, and a **concrete** mitigation
   that a person can execute — not "be more careful".
2. A risk may only be marked **Closed** with evidence (a command, its output, or
   a test name). "We fixed it" is not evidence.
3. When a risk materialises, it becomes an **incident**: add an entry to §6 with
   the date, the blast radius, and the remediation.
4. New risks are added, never renumbered.

---

## 2. Live risk summary

| ID | Risk | L | I | Exposure | Status |
| --- | --- | --- | --- | --- | --- |
| `R-01` | RLS not enforced on the live project — personal data readable anonymously | 1 | 5 | 🟡 5 | **CLOSED 2026-10-15** |
| `R-02` | Migrations applied by hand; live schema drifts from the repository | 2 | 4 | 🟠 8 | **MITIGATED** — in sync, CI-monitored; still applied by hand |
| `R-03` | Client is the UX layer, database is the only gate — one missing policy exposes a table | 3 | 5 | 🔴 15 | Open · mitigated |
| `R-04` | `birth_date` exposed on a public surface | 1 | 4 | 🟡 4 | **CLOSED 2026-10-15** — revoked at the column level |
| `R-05` | Minors can register; age gate is self-attested and clamped | 1 | 5 | 🟡 5 | **MITIGATED** — gate can no longer be bypassed; policy Q1 open |
| `R-06` | Blocking stored but not enforced server-side | 1 | 3 | 🟢 3 | **CLOSED 2026-10-15** (M12) |
| `R-07` | Suspended members remain discoverable | 1 | 3 | 🟢 3 | **CLOSED 2026-10-15** (M12) |
| `R-08` | No observability — production failures are invisible | 2 | 3 | 🟡 6 | **MITIGATED** — app layer done; no alert routing yet |
| `R-09` | Dev-tooling advisories with no fix break a naive audit gate | 3 | 2 | 🟡 6 | Mitigated |
| `R-10` | Service worker pins clients to a stale bundle | 2 | 3 | 🟡 6 | Mitigated |
| `R-11` | Account deletion misses a table added later | 2 | 4 | 🟠 8 | Mitigated by test |
| `R-12` | Protected owner-built UI (Notifications/Moments/Games) removed by a refactor | 1 | 5 | 🟡 5 | Mitigated by test **and by browser journey** |
| `R-13` | Rate limiting bypassed by writing through a definer function that forgot the guard | 3 | 3 | 🟡 9 | Open |
| `R-14` | Single-region database, no verified restore procedure | 1 | 5 | 🟡 5 | Partly rehearsed — schema rebuild proven; **data restore still unverified** |
| `R-15` | Onboarding drop-off at 16 steps | 4 | 3 | 🟠 12 | Open — product |
| `R-16` | Passwordless/OAuth account takeover via callback handling | 2 | 5 | 🟠 10 | Mitigated by review |
| `R-17` | Unbounded storage growth (moments media, game ledger) | 3 | 2 | 🟡 6 | Open |

---

## 3. Risk detail

### `R-01` — RLS not enforced on the live project 🔴

| | |
| --- | --- |
| **Likelihood** | 5 — it is happening now |
| **Impact** | 5 — real identities, locations and dates of birth exposed |
| **Owner** | Lead Architect (remediation), Product Owner (execution) |

**Description.** The migrations in `supabase/migrations/` have never been applied
to the live Supabase project. An unauthenticated request carrying only the public
anon key returns a real row from `profiles`.

**Evidence (2026-10-15).**

```
$ ./scripts/verify-rls.sh
  profiles         FAIL   1 row(s) readable WITHOUT authentication
  likes            SKIP   table does not exist yet
RESULT: FAIL - 1 table(s) leak personal data to anonymous callers.
```

The exposed column set includes `birth_date`, which `CONSTITUTION.md` Article 1.4
forbids outright.

**Mitigation.** Apply, in order, in the Supabase SQL Editor:

```
20261015120000_m6_profiles_rls_lockdown.sql
20261015120100_m6_enable_rls_all_tables.sql
20261015120200_m6_public_profiles_view.sql
20261015130000_m10_likes_and_mutual_matching.sql
20261015140000_m14_admin_and_abuse_controls.sql
20261015150000_m15_privacy_deletion_and_legal.sql
20261015160000_notifications_realtime.sql
20261015170000_moments_feed.sql
20261015180000_game_zone.sql
20261015190000_onboarding_wizard_columns.sql
```

Then `./scripts/verify-rls.sh` must exit 0.

**CLOSED 2026-10-15.** The operator applied `supabase/apply_all.sql` in the
Supabase SQL Editor (0 errors). Verification, run immediately afterwards:

```
$ ./scripts/verify-rls.sh
  profiles         PASS   no rows returned (*/0)
  messages         PASS   no rows returned (*/0)
  follows          PASS   no rows returned (*/0)
  matches          PASS   HTTP 401 - access denied
  reports          PASS   no rows returned (*/0)
  blocked_users    PASS   no rows returned (*/0)
  likes            PASS   HTTP 401 - access denied

RESULT: PASS - 7 table(s) verified, 0 skipped, 0 leaks.
(exit 0)
```

`profiles` previously reported `FAIL 1 row(s) readable WITHOUT authentication`;
it now reports zero rows. The exposure was real and is now gone.

**Residual control.** `tests/database` and `tests/database/live_shape.test.ts`
pin the property on a real PostgreSQL so it cannot silently return.

---

### `R-02` — Hand-applied migrations drift from the repository 🟠

| | |
| --- | --- |
| **Likelihood** | 2 — drift is now detected automatically |
| **Impact** | 4 — features fail at runtime, schema is unknowable from the repo |

**Description.** There is no migration runner. Files are pasted into the SQL
Editor by hand, so the repository and the live database can disagree
indefinitely, and half-applied state is likely.

**Evidence of the original exposure.** Before remediation, the live project was
missing 16 migrations: `likes` returned HTTP 404, all nine onboarding-wizard
columns returned HTTP 400, and the M13 evidence columns did not exist.

**MITIGATED 2026-10-15.**

```
$ ./scripts/check-schema-drift.sh
RESULT: IN SYNC — 42 expectations verified, 0 missing.
(exit 0)
```

Additionally verified by probing, as an anonymous caller, all 13 RPCs the UI
calls (`discover_profiles`, `block_member`, `unblock_member`, `unmatch_member`,
`is_blocked_pair`, `record_like`, `unread_counts`, `mark_conversation_read`,
`admin_report_queue`, `admin_resolve_report`, `export_my_data`,
`delete_my_account`, `is_moderator`): every one is present and returns HTTP 401
to an anonymous caller.

**Status is MITIGATED rather than Closed** because the root cause — manual
application — remains. The compensating controls are:
1. `scripts/check-schema-drift.sh` derives the expected schema from the
   migration files themselves and diffs it against the live project.
2. It runs in CI on every push to `main` (skipped when secrets are absent), so
   divergence is visible the day it appears.
3. `supabase/apply_all.sql` is a generated, verified single-pass bundle.

The residual risk is that a developer merges a migration and does not apply it
until CI reports drift. Closing this properly requires a migration runner or a
deployment step, which is not in v1 scope.

---

### `R-03` — One missing RLS policy exposes a table 🔴

**Description.** With no application server, a table created without RLS is
public to anyone holding the anon key. This is the failure mode that produced
`R-01`.

**Mitigation (in place).**
- `tests/database` asserts RLS is enabled on **all** personal-data tables and
  that no `INSERT` policy omits `WITH CHECK`.
- The test harness mirrors Supabase's default grants
  (`alter default privileges ... to anon, authenticated`) so a zero-row
  assertion proves **RLS filtered the rows**, not that a GRANT was missing.
- `tests/security` §1 additionally asserts `anon` *holds* `SELECT` on the core
  tables, so the zero-row result cannot be vacuous.
- `scripts/verify-rls.sh` proves it adversarially against the live project.

**Residual.** A new table added without a test entry still slips through; the
`tests/database` table list is the control, and it must be extended whenever a
migration adds a table.

---

### `R-04` — `birth_date` on a public surface 🟡

**Description.** Article 1.4 forbids exposing dates of birth. RLS on `profiles`
lets ANY signed-in member read ANY other member's row — deliberate, because
discovery depends on it — so `birth_date` was readable by every member.

**CLOSED 2026-10-15.**

The previously recorded fix — `revoke select (birth_date) on public.profiles
from authenticated, anon` — **does not work**, and this was discovered by testing
it rather than trusting it:

```
create role app_user; create table t (a int, b int);
grant select on t to app_user;
revoke select (b) on t from app_user;
-- as app_user:  select b from t   ->   ALLOWED
```

A table-wide SELECT grant covers every column and a column-level REVOKE cannot
subtract from it. Supabase grants table-wide SELECT to `anon` and
`authenticated` by default, so M15's commented-out statement would have shipped a
security control that protected nothing.

The working form is a table-wide revoke followed by a column re-grant, in
`20261015260000_m15_revoke_birth_date.sql`:

- `revoke select on public.profiles from anon, authenticated`
- `grant select (<every column except birth_date>) on public.profiles to authenticated`
  — the list is generated from the catalogue, so a future column is readable by
  default rather than silently locking the app out of it
- `revoke select on public.profiles from anon` — anonymous access is now denied
  **structurally**, not merely by an RLS filter
- `my_birth_date()` — a SECURITY DEFINER function returning only the caller's own
  date of birth, so the onboarding wizard can still prefill the field

Verified by `tests/security` §6 (6 tests): no column-level SELECT for anon or
authenticated · anon has no table-wide SELECT · an authenticated member reading
a `birth_date` is refused with *permission denied* · every other column is still
readable · `my_birth_date()` returns only the caller's own value and refuses
anonymous callers · the owner keeps SELECT, which `export_my_data()` needs.

Two client reads were the prerequisite and were fixed first: `profile/dashboard`
now renders the derived `age` and selects an explicit allow-list, and the wizard
does the same while fetching its date of birth through `my_birth_date()`.
`loadOwnProfile()` (`select('*')`, imported by nothing) was deleted.

---

### `R-05` — Minors can register 🔴

**Description.** The 18+ gate is a **self-attested checkbox** on `/auth` and
`/signup`. Step 3 of the wizard then computes age as `Math.max(18, calculated)`,
so a 15-year-old's real date of birth is stored and **silently displayed as
18**, with no validation on the step or at submit.

**Impact.** Legal exposure in Nepal, safeguarding failure, and the specific harm
the Constitution's tone assumes we are preventing.

**Mitigation.**
1. Reject any date of birth that computes to under 18 — do not clamp.
2. Refuse to persist `birth_date` when it fails the gate.
3. Keep the checkbox as a second, independent confirmation.
4. Add a database-level `check` constraint on `profiles.age >= 18`.

**Owner:** Lead Architect + Product. Pending explicit product direction per the
PRD's "user instruction wins" rule (`Q1`/§10).

---

### `R-06` — Blocking not enforced server-side 🟠

**Description.** `blocked_users` rows are written and read by the report page
and the chat room, but discovery, the chat list, `record_like` and message
delivery do not consult them. A blocked member can still like, match and
message.

**Mitigation (M12).** Centralise on a `public.is_blocked_pair(a, b)`
`SECURITY DEFINER` helper, then:
- raise in `record_like` when the pair is blocked;
- exclude blocked pairs in the discovery function;
- reject message inserts whose participants are blocked (trigger + RLS);
- add `unmatch_member()` to clear a match and both decisions.

**Verified by** new `tests/database` cases asserting zero visible rows and
raised errors for a blocked pair.

---

### `R-07` — Suspended members remain discoverable 🟡

**Description.** M14 blocks a suspended member's writes, but `public_profiles`
does not expose or filter `is_suspended`, so they stay in the discovery pool.

**Mitigation.** Pending product decision on whether suspension is
"read-only" or "hidden". Default recommendation: hide. Once decided, filter in
the M12 discovery function.

---

### `R-08` — No observability 🟡

**Description.** There was no error reporting, no structured logging, and no
alerting. A production failure was discovered by a member complaining, and a
render-time throw produced a blank screen with no trace anywhere.

**MITIGATED 2026-10-15 — application layer complete.**

| Piece | Where |
| --- | --- |
| Route and root error boundaries, both reporting | `src/app/error.tsx`, `src/app/global-error.tsx` |
| Structured one-JSON-object-per-line logging | `src/lib/logger.ts` |
| **PII redaction on every emitted field** | `redact()` — keys matching `email`, `phone`, `birth`, `bio`, `token`, `*_key`, … become `[redacted]`; arrays, depth and string length are capped; stacks are never serialised |
| Client reporter, bounded to 5 reports per page load | `src/lib/report-error.ts` |
| Ingestion sink with size cap, **re-redaction** and rate limiting | `src/app/api/observability/route.ts` |
| Configuration probe | `/api/health` |
| Tests | `src/lib/logger.test.ts`, `src/app/api/observability/route.test.ts` — 18 |

Redaction is the security-relevant half: a log line is a copy of personal data
that lives outside the database, outside RLS, and outside every deletion path
the product has. The ingestion route re-redacts because the sender is a browser.

**Residual — why this is Mitigated, not Closed.** Nobody is paged. A failure now
leaves durable, redacted, greppable forensic evidence, but detection is still a
human noticing. Closing it needs alert routing (a log-drain threshold, or a
service such as Sentry) and a retention decision — both infrastructure choices
rather than code. `docs/DEPLOYMENT.md` §7 has the triage runbook.

---

### `R-14` — No verified restore procedure 🟡

**Description.** Supabase point-in-time recovery is finite, and no restore had
ever been rehearsed. A bad migration or a deletion bug was unrecoverable in
practice.

**PARTLY REHEARSED 2026-10-15 — the schema half is now proven and automated.**

`tests/database/restore_rehearsal.test.ts` (9 tests) rebuilds the database from
nothing and asserts the result is **structurally identical** to the normal
development path — same tables, columns, types, nullability, constraints, RLS
policies, functions and indexes — across two independent databases:

```
A: every migration applied file by file   (the development path)
B: supabase/apply_all.sql                 (the recovery path)
```

It also repeats the rebuild against the live column types. If those ever
diverge, a restore produces a database the test suite has never seen; that is
the failure this catches. `CONSTITUTION.md` Article 3.12 is therefore
*demonstrated*, not assumed.

**Still open:** restoring real **data**. That needs a scratch Supabase project
and a dump, neither of which can be created from inside this repository.
`scripts/restore-rehearsal.sh` automates it and refuses to run against the
production ref; run it, then record here:

- the date of the rehearsal,
- the measured rebuild time,
- row-count parity for `profiles`, `messages`, `matches`, `likes`,
- the `./scripts/verify-rls.sh` result against the scratch project.

Likelihood drops to 1 because the rebuild path is exercised on every CI run;
impact stays 5 because the data itself is still not recoverable on paper.

---

### `R-09` — Dev-tooling advisories vs. the audit gate 🟡

| | |
| --- | --- |
| **Likelihood** | 3 — known and recurring |
| **Impact** | 2 — dev-only tooling, not shipped |

**Description.** `npm audit --audit-level=high` reports 5 high advisories in
dev-only tooling (`braces` via `micromatch` → `fast-glob` →
`@next/eslint-plugin-next`) with **no fix available**. A full-tree gate could
never go green, so the team would disable it.

**Mitigation (in place).** The gate is scoped to production dependencies:
`npm audit --omit=dev --audit-level=high` → **0 vulnerabilities**. A
shipped-dependency advisory still fails the build. `.github/dependabot.yml`
opens grouped weekly PRs plus immediate security updates.

**Residual.** The dev advisory is accepted, recorded here, and re-evaluated when
upstream ships a fix.

---

### `R-10` — Stale service worker 🟡

**Description.** A cached service worker can pin a client to an old bundle,
so a security fix never reaches the user.

**Mitigation (in place).** `/sw.js` is served with
`Cache-Control: no-cache, no-store, must-revalidate` and
`Service-Worker-Allowed: /` (`next.config.ts`).

---

### `R-11` — Erasure misses a table added later 🟠

**Description.** `delete_my_account()` must cascade to every table referencing
the member. A new table without `on delete cascade` silently retains personal
data after erasure.

**Mitigation.** `tests/database` exercises erasure end-to-end and asserts other
members are untouched; new tables must be added to that test. Enforced as a
review checklist item in `CONSTITUTION.md` Article 3.

---

### `R-12` — Protected owner-built UI removed by a refactor 🟠

**Description.** `MobileNav` carries six destinations, three of them
owner-added (`notifications`, `moments`, `games`). A "simplification" that drops
one is a critical regression.

**Mitigation.** `tests/security` §5 and the AGENTS.md grep gate assert all three
route literals are present; the three route pages are asserted to exist.

---

### `R-13` — Rate limiting bypassed via a definer function 🟡

**Description.** `enforce_abuse_controls()` is attached to `messages`, `likes`
and `reports`. Any new write path added through a `SECURITY DEFINER` function
that forgets to call it is unlimited.

**Mitigation.** New definer write paths must attach the guard; `tests/database`
asserts suspension and rate limiting for each existing path. Extend the test
matrix whenever a write RPC is added.

---

### `R-15` — Onboarding drop-off at 16 steps 🟠

**Description.** Sixteen screens before the first profile is a long funnel; the
product's value is not visible until discovery.

**Mitigation.** Progress bar and per-step back navigation are in place. Product
instrumentation of step completion is a v1.1 item.

---

### `R-16` — OAuth callback handling 🟠

**Description.** The `/auth/callback` route exchanges a code for a session
server-side. A mishandled error path or an open redirect would be an account
takeover vector.

**Mitigation.** Reviewed; the route uses `@supabase/ssr` cookie exchange and
rejects a missing code. Integration tests with a mocked client are required by
`TESTING_STANDARDS.md` §3.2 and remain outstanding.

---

### `R-17` — Unbounded storage growth 🟡

**Description.** Moments media is stored inline (base64) and the game ledger is
append-only, so both grow without bound.

**Mitigation (M18).** Retention policy for resolved reports and old game rows;
move media to Supabase Storage with a size cap. Not v1-blocking.

---

## 4. Accepted risks

| ID | Risk | Accepted by | Rationale |
| --- | --- | --- | --- |
| `R-09` | Dev-tooling advisory, no fix available | Lead Architect | Dev-only; not shipped to users; gated production tree is clean. |
| `R-04` (partial) | `birth_date` readable by signed-in members | Lead Architect | Required by the current dashboard implementation; scheduled for removal. |

---

## 5. Closed risks

| ID | Closed on | Evidence |
| --- | --- | --- |
| `R-01` | 2026-10-15 | `./scripts/verify-rls.sh` exits **0**: `RESULT: PASS - 7 table(s) verified, 0 skipped, 0 leaks.` `profiles` moved from `FAIL 1 row(s) readable` to `PASS no rows returned`. |
| `R-06` | 2026-10-15 | M12 enforces blocking in the database (`is_blocked_pair`, `block_member`, `discover_profiles`, a message-delivery trigger). `tests/database/blocking.test.ts` — 10 tests, including refusal to like, to deliver, and to appear in discovery, in both directions. |
| `R-07` | 2026-10-15 | `discover_profiles()` excludes suspended members; asserted in `tests/database/blocking.test.ts`. The product question (`PRD_V1` Q1) of whether to hide them anywhere else remains open, but discovery is closed. |
| `R-18` | 2026-10-15 | Supabase default privileges were not mirrored in the test harness, so anonymous zero-row assertions on migration-created tables proved only that a GRANT was missing. Fixed; `tests/security` §1 pins the grant so the assertion cannot be vacuous again. |
| `R-19` | 2026-10-15 | The 15-step wizard wrote nine columns that existed only in the legacy `migrations/` directory, so onboarding failed at step 15. Relocated to `supabase/migrations/20261015190000_onboarding_wizard_columns.sql` and pinned by `tests/database`. |
| `R-20` | 2026-10-15 | Discovery read `profiles` with `select('*')`, shipping `birth_date`, `politics` and `religion` for every candidate. Both feeds now go through the allow-listed `discover_profiles()`; pinned by `tests/security` §5. |
| `R-21` | 2026-10-15 | Three M17 security tests were red and two were vacuous (a no-op write and an empty-table assertion). Fixed and falsification-tested. |
| `R-22` | 2026-10-15 | Every signed-in member could read every private message and the whole follow graph — the M6 baseline used `auth.uid() is not null` as the SELECT policy, and the M6 tests only checked anonymous access. Replaced with participant-only policies (M11); pinned by `tests/database/messaging.test.ts`. |
| `R-23` | 2026-10-15 | `supabase/apply_all.sql` failed on the live project with `operator does not exist: text = uuid`: the harness declared `messages.match_id` as `text`, the live project declares it `uuid`. All seven comparisons now cast both sides. Fixed under `R-02`'s new `createLiveLikeDb()` harness, which mirrors the live column types. |

---

## 6. Incident log

| Date | Incident | Blast radius | Remediation | Follow-up |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Anonymous read of `profiles` on the live project (`R-01`) | At least 1 real profile row, including `birth_date` | **RESOLVED 2026-10-15** — `supabase/apply_all.sql` applied in the Supabase SQL Editor (0 errors). `./scripts/verify-rls.sh` now exits 0 with `profiles PASS — no rows returned`. | `R-01` closed. `R-02` stays mitigated until a migration runner exists. |

---

## 7. Review cadence

- **Every milestone boundary:** re-score the open items.
- **Every release:** `R-01`, `R-02`, `R-05` must be re-evaluated before the
  release gate in `PRD_V1.md` §7 can be signed off.
- **Any security change:** add or update an entry here in the same commit.
