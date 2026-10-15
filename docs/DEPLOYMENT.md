# Mettivo — Deployment & Operations Runbook

**Status:** M18 · Production deployment and infrastructure readiness
**Audience:** whoever deploys, whoever is on call
**Companion documents:** [`PRD_V1.md`](./PRD_V1.md) · [`RISK_REGISTER.md`](./RISK_REGISTER.md) · [`../supabase/migrations/README.md`](../supabase/migrations/README.md)

---

## 0. The one thing to understand first

Mettivo has **no application server**. The browser talks directly to Supabase.
That means **a deployment is two independent things**, and both must be done:

| Half | What ships it | How you verify it |
| --- | --- | --- |
| The **frontend** (Next.js on Vercel) | `git push` to `main` | `npm run build` exits 0 |
| The **database** (Supabase) | **manually**, by pasting SQL | `./scripts/verify-rls.sh` exits 0 |

Pushing the frontend does **not** apply migrations. This is the root cause of
`RISK_REGISTER.md` `R-01` and `R-02`, and the reason `profiles` was readable by
anonymous callers on the live project.

---

## 1. Prerequisites

- Node.js 20 or newer.
- Access to the Supabase project dashboard (SQL Editor).
- Access to the Vercel project (or the equivalent host).

---

## 2. Environment configuration

Exactly **two** variables are required, and both are public by design:

| Variable | Where to find it | Visible to the browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Yes — required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/public | Yes — required |

### Local

```bash
cp .env.local.example .env.local   # if an example exists, otherwise create it
# then fill in the two values
```

`.env.local` is git-ignored (asserted by the test suite).

### Production

Vercel → Project → Settings → Environment Variables → add both for
**Production, Preview and Development**.

### Rules that are not negotiable

1. **The `service_role` key never goes in this project.** Not in `.env.local`,
   not in Vercel, not in a prompt, not in a screenshot. It bypasses RLS, which
   is the entire authorisation model. Server-side administrative work is done in
   the Supabase SQL Editor, where the key is never handled by us.
2. **No other `NEXT_PUBLIC_*` variable may be added** without a privacy review,
   because everything prefixed `NEXT_PUBLIC_` is shipped to every visitor.
   `tests/security` fails the build if any client file reads a non-public
   variable.
3. **HTTPS only.** `describeEnvHealth()` reports a problem if the Supabase URL is
   not `https://`, because the session and the anon key would otherwise travel in
   clear text.

### Verify configuration without leaking it

```bash
curl -s https://<your-deployment>/api/health | jq
```

Expected:

```json
{
  "status": "ok",
  "checks": { "environment": { "configured": true, "missing": [], "problems": [] } },
  "build": { "nodeEnv": "production" },
  "checkedAt": "…"
}
```

A `503` with a non-empty `missing` array names the variable to fix. The endpoint
never returns a value, only presence — a health response is logged in many
places, so it must not be a place a key could leak from.

---

## 3. Applying migrations (the half people forget)

Migrations are applied **by hand**, in filename order, in the Supabase SQL
Editor. There is no migration runner.

### Procedure

1. Supabase dashboard → **SQL Editor** → *New query*.
2. Paste **one file at a time**, in the order below, and press **Run**.
3. Confirm the output. Several migrations print a posture table; a `NOTICE` line
   is normal, an `ERROR` is not.
4. **Re-run the entire set once more.** Every file is written to be re-runnable;
   a second pass must produce the same state and no error. This is the check
   that catches half-applied state.

#### Order

```
 1. 20261015120000_m6_profiles_rls_lockdown.sql
 2. 20261015120100_m6_enable_rls_all_tables.sql
 3. 20261015120200_m6_public_profiles_view.sql
 4. 20261015130000_m10_likes_and_mutual_matching.sql
 5. 20261015140000_m14_admin_and_abuse_controls.sql
 6. 20261015150000_m15_privacy_deletion_and_legal.sql
 7. 20261015160000_notifications_realtime.sql
 8. 20261015170000_moments_feed.sql
 9. 20261015180000_game_zone.sql
10. 20261015190000_onboarding_wizard_columns.sql
11. 20261015195000_m4_schema_consolidation.sql
12. 20261015210000_m12_blocking_enforcement.sql
13. 20261015220000_m8_interest_prompt_catalogue.sql
14. 20261015230000_m11_messaging.sql
15. 20261015240000_m13_moderation_workflow.sql
16. 20261015250000_m7_profile_validation.sql
```

> Steps 1–3 are the security boundary. On a project where they have not been
> applied, **`profiles` is readable by anyone holding the public anon key.**

### Verify the database

```bash
./scripts/check-schema-drift.sh   # every table/column the migrations describe must exist
./scripts/verify-rls.sh           # anonymous callers must read ZERO rows
```

Both must exit 0. Quote the output before declaring a deploy done — a security
property is proven by an unauthenticated request returning nothing, never by
reading the SQL.

### One-time administrative steps the SQL cannot do for you

| Task | Where | Why |
| --- | --- | --- |
| Enable Realtime for `notifications` | Dashboard → Database → Replication | The migration adds the table to the publication only if it exists |
| Promote the first moderator | SQL Editor: `insert into public.user_roles (user_id, role) values ('<uuid>','moderator');` | There is deliberately no client write path to `user_roles` |
| Confirm PITR retention | Dashboard → Database → Backups | See §6 |

---

## 4. The release gate

Run from a clean tree. **All six must pass**, with output quoted in the release
note:

```bash
npm run verify          # typecheck && lint && test && audit && build
npm run test:e2e        # 11 Chromium journeys (needs the browser installed once)
./scripts/check-schema-drift.sh
./scripts/verify-rls.sh
```

| Gate | Command | Passing looks like |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | prints nothing |
| Lint | `npx eslint .` | `0 errors` |
| Tests | `npm test` | 267 tests pass |
| Production audit | `npm run audit` | `found 0 vulnerabilities` |
| Build | `npm run build` | exits 0 |
| Browser journeys | `npm run test:e2e` | `11 passed` |
| Live schema | `./scripts/check-schema-drift.sh` | `RESULT: IN SYNC` |
| Live RLS | `./scripts/verify-rls.sh` | `RESULT: PASS` |

### Protected UI check (never optional)

```bash
grep -cE "'/notifications'|'/moments'|'/game-zone'" src/app/components/layout/MobileNav.tsx
# must print 3
```

---

## 5. Deploying the frontend

1. Merge to `main`. CI runs the full gate (`.github/workflows/ci.yml`).
2. Vercel builds and promotes automatically.
3. Smoke test, in order:

```
GET  /api/health                 -> 200, status "ok"
GET  /privacy                    -> 200 (no session required)
GET  /terms                      -> 200 (no session required)
     /auth                       -> sign-in renders
     /discover                   -> opens after sign-in
     /chat                       -> conversation list, unread badges
     /notifications              -> owner-built surface still present
     /moments                    -> owner-built surface still present
     /game-zone                  -> owner-built surface still present
```

4. Confirm the PWA still installs (manifest + `sw.js` served `no-store`).

### Rollback

Vercel → Deployments → select the last good deployment → **Promote to
Production**. This rolls back the frontend in seconds.

> **Rolling back the frontend does NOT roll back the database.** Migrations here
> are additive and idempotent by design, so a frontend rollback against a
> migrated database is safe. A *database* rollback is a restore (§6), not a
> `git revert`.

---

## 6. Backups and restore

### What exists

- **Supabase automated backups** — daily on paid plans, with point-in-time
  recovery (PITR) depending on tier.
- **The migrations themselves** — the schema is fully reproducible from
  `supabase/migrations/`. A restore can always rebuild structure; only *data*
  needs the backup.

### Cadence

| Action | Frequency | Owner |
| --- | --- | --- |
| Confirm backups are healthy (Dashboard → Database → Backups) | Monthly | On-call |
| Export a logical dump of personal-data tables | Monthly | On-call |
| **Rehearse a restore into a scratch project** | Quarterly | Lead |

### Logical export (no service key in the repo)

Use the Supabase dashboard's **Database → Backups → Download**, or
`pg_dump` with the connection string from *Project Settings → Database*. The
connection string contains a password: treat it as a secret, keep it out of
`.env.local`, and never commit or paste it into a prompt.

### Restore rehearsal (this is the part that matters)

A backup nobody has restored is a hypothesis, not a backup.

**The schema half is automated and runs in CI.**
`tests/database/restore_rehearsal.test.ts` rebuilds the database and asserts it
is structurally identical to the normal development path — same tables, columns,
types, constraints, policies, functions and indexes.

**The data half needs a scratch project.** Run:

```bash
RESTORE_DATABASE_URL='postgresql://postgres:<pw>@db.<scratch-ref>.supabase.co:5432/postgres' \
  ./scripts/restore-rehearsal.sh
```

The script refuses to run if the URL matches the production ref in `.env.local`,
applies `supabase/apply_all.sql` to the scratch database, re-applies it to prove
idempotency, and verifies the resulting posture (every table RLS-enabled, no
`INSERT` policy missing `WITH CHECK`, no unpinned `SECURITY DEFINER`).

Then:

1. Restore a data dump into the same scratch project.
2. Compare row counts for `profiles`, `messages`, `matches` and `likes`.
3. Point the API checks at the scratch project:
   `NEXT_PUBLIC_SUPABASE_URL=https://<scratch-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<scratch-anon-key> ./scripts/verify-rls.sh`
4. Record the date, the measured time and both results in
   `RISK_REGISTER.md` `R-14`.

Until step 4 has happened, `R-14` stays open.

---

## 7. Incident runbook — suspected data exposure

Trigger: a report that personal data was visible without authorisation, or
`./scripts/verify-rls.sh` exiting non-zero.

1. **Confirm and scope, without fetching data.**

   ```bash
   ./scripts/verify-rls.sh
   ```

   The script uses `count=exact` with `Range: 0-0`, so it learns *how many* rows
   are exposed and never retrieves one.

2. **Contain.** If a table is leaking, apply the matching migration immediately
   (`20261015120000_m6_profiles_rls_lockdown.sql` is almost always the one).
   Applying is idempotent and safe under load.

3. **Prove containment.** Re-run `./scripts/verify-rls.sh` and quote the output.

4. **Assess.** Determine exposure window, which columns, how many rows.

5. **Record.** Add an entry to `RISK_REGISTER.md` §6 (Incident log).

6. **Follow up.** Fix the test gap that let it through. `R-01` existed for as
   long as it did because the suite asserted anonymous zero-rows only for
   migration-created tables where the GRANT happened to be missing.

### Where application errors go (R-08)

| Signal | Lands in |
| --- | --- |
| A render-time throw in a route | `app/error.tsx` → `POST /api/observability` |
| A throw in the root layout | `app/global-error.tsx` → same |
| A caught error in client code | `reportException()` → same |
| The sink itself | one JSON line on stdout: `{"level":"error","event":…,"context":{…},"timestamp":…}` |

Triage by grepping the platform's log output for `"level":"error"` and grouping
on `event` — the identifiers are stable (`app.route_error`, `app.global_error`,
`client.exception`). The browser is capped at **5 reports per page load**, so a
render loop cannot flood the pipeline.

**Every field is redacted twice** — once in the browser, once in the route —
against a key list covering `email`, `phone`, `birth`, `bio`, `answer`, `token`,
`*_key`, `authorization`, `cookie` and more. Values come through as
`[redacted]`; arrays, nesting depth and string length are capped; stack traces
are never serialised. If you extend the context, add the key to `SENSITIVE_KEY`
in `src/lib/logger.ts` and it is covered.

---

## 8. Known operational constraints

| Constraint | Consequence |
| --- | --- |
| No migration runner | A deploy can ship code the database cannot satisfy. `check-schema-drift.sh` is the compensating control. |
| No application server | Any authorisation logic that is not in RLS does not exist. |
| No observability | See `RISK_REGISTER.md` `R-08`. Until error reporting lands, a production failure is discovered by a member. |
| Single region | Latency for members far from the project region; no failover. |
| Free-tier PITR is limited | `R-14` stays open until a restore is rehearsed. |
