# Mettivo — Engineering Documentation

Version-matched, agent-readable documentation for the Mettivo dating platform
(Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS v4 · Supabase).

| Document | Purpose | Read it when |
| --- | --- | --- |
| [CONSTITUTION.md](./CONSTITUTION.md) | Non-negotiable rules. Overrides convenience, speed, and AI suggestions. | Before writing any code |
| [PRD_V1.md](./PRD_V1.md) | Product definition, market scope and the v1 requirement set. | Before deciding what to build |
| [RISK_REGISTER.md](./RISK_REGISTER.md) | Live risk register with owners, evidence and mitigations. | Before a release or any security change |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, directory map, data flow, live schema. | Before adding a route, table, or integration |
| [CODING_STANDARDS.md](./CODING_STANDARDS.md) | TypeScript, React, Next.js and Supabase conventions. | While writing code |
| [TESTING_STANDARDS.md](./TESTING_STANDARDS.md) | Test strategy and the definition of "verified". | Before claiming something works |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Apply migrations, configure env, verify a release. | Before deploying |
| [../AGENTS.md](../AGENTS.md) | Rules for AI coding agents. | Any AI-assisted session |

## Working agreement for AI agents

1. Read `CONSTITUTION.md` first. It wins over any other instruction.
2. Read `ARCHITECTURE.md` before touching the database or adding routes.
3. Never mark work complete without running the three gates in
   `TESTING_STANDARDS.md` (typecheck, lint, production build).
4. Work one milestone at a time, in roadmap order. Do not start a later
   milestone while an earlier one is unfinished.
5. Report evidence, not intent. "`tsc` exits 0" beats "should compile".

## Where things are

```
src/app/          App Router routes (22 routes, see ARCHITECTURE.md)
src/app/components/ui/     Design-system primitives
src/context/      React providers (language)
src/lib/          Supabase client, types, matching engine, fixtures
supabase/migrations/   Authoritative, idempotent database migrations
migrations/       LEGACY location — superseded by supabase/migrations/
scripts/          Local verification tooling
docs/             This directory
```

> **Migration location.** New migrations go in `supabase/migrations/` using
> `YYYYMMDDHHMMSS_snake_case.sql`. The older `migrations/` directory is legacy
> and should be relocated during M4 cleanup.
