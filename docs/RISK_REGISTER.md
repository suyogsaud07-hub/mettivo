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
| `R-01` | RLS not enforced on the live project — personal data readable anonymously | 5 | 5 | 🔴 25 | **OPEN · MATERIALISED** |
| `R-02` | Migrations applied by hand; live schema drifts from the repository | 5 | 4 | 🔴 20 | **OPEN · MATERIALISED** |
| `R-03` | Client is the UX layer, database is the only gate — one missing policy exposes a table | 3 | 5 | 🔴 15 | Open · mitigated |
| `R-04` | `birth_date` exposed on a public surface | 3 | 4 | 🟠 12 | Open · partly mitigated |
| `R-05` | Minors can register; age gate is self-attested and clamped | 3 | 5 | 🔴 15 | Open |
| `R-06` | Blocking stored but not enforced server-side | 4 | 3 | 🟠 12 | Open, in progress (M12) |
| `R-07` | Suspended members remain discoverable | 3 | 3 | 🟡 9 | Open — pending product decision `Q1` |
| `R-08` | No observability — production failures are invisible | 4 | 3 | 🟠 12 | Open (M18) |
| `R-09` | Dev-tooling advisories with no fix break a naive audit gate | 3 | 2 | 🟡 6 | Mitigated |
| `R-10` | Service worker pins clients to a stale bundle | 2 | 3 | 🟡 6 | Mitigated |
| `R-11` | Account deletion misses a table added later | 2 | 4 | 🟠 8 | Mitigated by test |
| `R-12` | Protected owner-built UI (Notifications/Moments/Games) removed by a refactor | 2 | 5 | 🟠 10 | Mitigated by test |
| `R-13` | Rate limiting bypassed by writing through a definer function that forgot the guard | 3 | 3 | 🟡 9 | Open |
| `R-14` | Single-region database, no verified restore procedure | 2 | 5 | 🟠 10 | Open (M18) |
| `R-15` | Onboarding drop-off at 15 steps | 4 | 3 | 🟠 12 | Open — product |
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

Then `./scripts/verify-rls.sh` must exit 0. **Status stays OPEN until that
command exits 0 and the output is quoted in the register.**

**Residual control.** `tests/database` proves the migrations produce zero-row
anonymous access on a real PostgreSQL, so the fix is believed correct — but
"believed" is not "verified" (`TESTING_STANDARDS.md` §5).

---

### `R-02` — Hand-applied migrations drift from the repository 🔴

| | |
| --- | --- |
| **Likelihood** | 5 — already the case |
| **Impact** | 4 — features fail at runtime, schema is unknowable from the repo |

**Description.** There is no migration runner. Files are pasted into the SQL
Editor by hand, so the repository and the live database can disagree
indefinitely, and half-applied state is likely.

**Evidence.** `likes` returns HTTP 404 on the live project; all nine onboarding
wizard columns return HTTP 400. Both exist in the repository.

**Mitigation (M4/M18).**
1. `scripts/check-schema-drift.sh` — probes the live PostgREST schema read-only
   and diffs it against the tables/columns the migrations create. PII-free:
   it uses `limit=0` column probes and never retrieves rows.
2. Run it in CI on `main` (skipped when secrets are absent) so drift is visible
   the day it appears.
3. A documented single-pass apply procedure in `docs/DEPLOYMENT.md`, with an
   idempotency re-run as step 2.

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

### `R-04` — `birth_date` on a public surface 🟠

**Description.** Article 1.4 forbids exposing dates of birth. `birth_date` is
readable by any signed-in member through `profiles`, and is part of `R-01`'s
anonymous leak.

**Mitigation.**
- `public_profiles` (M6) is an allow-list that excludes `birth_date`; discovery
  now reads it, with `tests/security` §5 pinning that.
- `profile/dashboard` still renders the raw date, so the column-level revoke
  (`revoke select (birth_date) on public.profiles from authenticated, anon`) is
  sequenced after that page renders stored `age` instead. Tracked in M15/M7.

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

### `R-08` — No observability 🟠

**Description.** There is no error reporting, no structured logging, and no
alerting. A production failure is discovered by a user complaining.

**Mitigation (M18).** Error-boundary reporting hook, a `/api/health` route that
verifies env configuration, and a documented log-triage runbook.

---

### `R-09` — Dev-tooling advisories vs. the audit gate 🟡

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

### `R-14` — No verified restore procedure 🟠

**Description.** Supabase free/pro point-in-time recovery is finite, and no
restore has been rehearsed. A bad migration or a deletion bug is unrecoverable
in practice.

**Mitigation (M18).** Documented backup cadence, a read-only export procedure,
and a **rehearsed** restore into a scratch project with the date recorded. Until
rehearsed, this stays open.

---

### `R-15` — Onboarding drop-off at 15 steps 🟠

**Description.** Fifteen screens before the first profile is a long funnel; the
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
| `R-18` | 2026-10-15 | Supabase default privileges were not mirrored in the test harness, so anonymous zero-row assertions on migration-created tables proved only that a GRANT was missing. Fixed; `tests/security` §1 pins the grant so the assertion cannot be vacuous again. |
| `R-19` | 2026-10-15 | The 15-step wizard wrote nine columns that existed only in the legacy `migrations/` directory, so onboarding failed at step 15. Relocated to `supabase/migrations/20261015190000_onboarding_wizard_columns.sql` and pinned by `tests/database`. |
| `R-20` | 2026-10-15 | Discovery read `profiles` with `select('*')`, shipping `birth_date`, `politics` and `religion` for every candidate. Now reads `public_profiles`; pinned by `tests/security` §5. |
| `R-21` | 2026-10-15 | Three M17 security tests were red and two were vacuous (a no-op write and an empty-table assertion). Fixed and falsification-tested. |

---

## 6. Incident log

| Date | Incident | Blast radius | Remediation | Follow-up |
| --- | --- | --- | --- | --- |
| 2026-10-15 | Anonymous read of `profiles` on the live project (`R-01`) | At least 1 real profile row, including `birth_date` | **Not yet remediated** — migrations must be applied | Track `R-01` to closure; re-probe after applying |

---

## 7. Review cadence

- **Every milestone boundary:** re-score the open items.
- **Every release:** `R-01`, `R-02`, `R-05` must be re-evaluated before the
  release gate in `PRD_V1.md` §7 can be signed off.
- **Any security change:** add or update an entry here in the same commit.
