# Mettivo

A mobile-first, installable web app for adults (18+) in Nepal to meet people for
**long-term dating or friendship**.

> **The one architectural fact that matters:** there is no application server.
> The browser talks straight to Supabase (PostgreSQL + Auth + Realtime), so
> **Row Level Security is the only authorisation boundary.** If a policy is
> missing, the data is public — regardless of what the UI does.

---

## Deploy a live link for $0

Vercel Hobby + Supabase Free. No app stores, no paid tiers, no credit card.

**→ [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — "Quick start"**

The short version:

1. Import this repo at <https://vercel.com/new> (framework auto-detects as Next.js).
2. Add two environment variables — `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are **public by design**; never add a
   `service_role` key.
3. **Allow the deployment URL in Supabase → Authentication → URL Configuration.**
   This step is always forgotten and looks like a broken app.
4. Redeploy, then send friends the URL.

### Install it like an app

| Platform | How |
| --- | --- |
| **Android (Chrome)** | An *Install app* banner appears, or ⋮ → *Add to Home screen* |
| **iOS / iPadOS (Safari)** | **Share** → **Add to Home Screen** (must be Safari) |
| **macOS / Windows (Chrome, Edge)** | Install icon in the address bar |

The app is a Progressive Web App: manifest, maskable icons, an offline fallback
and a service worker. Installability is asserted by real browser tests, not
assumed — see `tests/e2e/pwa.spec.ts`.

---

## Local development

```bash
npm install
cp .env.local.example .env.local     # then fill in the two values
npm run dev                          # http://localhost:3000
```

Find both values in the Supabase dashboard → **Project Settings → API**.

### Then bring the database up to date

Migrations are applied **by hand** — pushing the frontend does not touch the
database, which is exactly how the production RLS leak happened.

```bash
pbcopy < supabase/apply_all.sql      # macOS: copies the whole bundle
```

Paste into **Supabase → SQL Editor → Run**, then **Run it again** (every file is
idempotent; the second pass proves nothing was half-applied).

Verify:

```bash
./scripts/check-schema-drift.sh      # RESULT: IN SYNC
./scripts/verify-rls.sh              # RESULT: PASS — zero rows readable anonymously
```

---

## Verify before you ship

```bash
npm run verify        # typecheck && lint && test && audit && build
npm run test:e2e      # browser journeys (first run: npm run test:e2e:install)
```

| Gate | Passing looks like |
| --- | --- |
| `npx tsc --noEmit` | prints nothing |
| `npx eslint .` | `0 errors` |
| `npm test` | 355 tests, 21 files |
| `npm run test:e2e` | 72 Chromium journeys |
| `npm run audit` | `found 0 vulnerabilities` (production) |
| `npm run build` | exits 0 |
| `./scripts/check-schema-drift.sh` | `RESULT: IN SYNC` |
| `./scripts/verify-rls.sh` | `RESULT: PASS` |

Security properties are **proven adversarially**, never inferred from reading
code: `verify-rls.sh` issues real unauthenticated requests and asserts zero rows.
See [docs/TESTING_STANDARDS.md](docs/TESTING_STANDARDS.md).

---

## Documentation

| Document | Read it when |
| --- | --- |
| [docs/CONSTITUTION.md](docs/CONSTITUTION.md) | before writing any code — non-negotiable rules |
| [docs/PRD_V1.md](docs/PRD_V1.md) | deciding what to build |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | adding a route, table or integration |
| [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | while writing code |
| [docs/TESTING_STANDARDS.md](docs/TESTING_STANDARDS.md) | before claiming something works |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | deploying or on call |
| [docs/RISK_REGISTER.md](docs/RISK_REGISTER.md) | before a release or any security change |
| [AGENTS.md](AGENTS.md) | any AI-assisted session |

---

## Layout

```
src/app/          App Router routes (22 routes)
src/app/components/  design system + MobileNav + PWA components
src/lib/          typed data access, matching engine, logger
supabase/migrations/  authoritative, idempotent SQL
supabase/apply_all.sql  the single paste-once bootstrap (generated)
scripts/          verification and operations tooling
tests/            database, security, integration and browser suites
docs/             engineering documentation
```
