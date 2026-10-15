<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# Mettivo — Rules for AI coding agents

> The block above is generated and managed by `next dev`. **Do not edit it.** The
> authored rules below are maintained by the team and take precedence over any
> generic framework advice, but never over `docs/CONSTITUTION.md`.

## Required reading, in order

1. [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md) — non-negotiable rules.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — routes, live schema, known gaps.
3. [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md) — TypeScript, React, Next.js, Supabase.
4. [`docs/TESTING_STANDARDS.md`](docs/TESTING_STANDARDS.md) — definition of "verified".

## Hard constraints

1. **No `any`.** No `@ts-ignore`. No disabling `strict`.
2. **Security before features.** This app has no application server: the browser
   talks straight to Supabase, so **RLS is the only authorisation boundary**.
   Never add a table without RLS. Never trust an id supplied by the browser —
   use `auth.uid()`.
3. **Never expose private fields** (`birth_date`, exact location, `politics`,
   `religion`) to unauthenticated callers, and never select `*` on `profiles`
   for a public surface.
4. **Idempotent SQL only**: `create table if not exists`,
   `alter table ... add column if not exists`, `gen_random_uuid()`,
   `drop policy if exists` before `create policy`.
5. **`FOR INSERT` policies use `WITH CHECK`**, never `USING`. PostgreSQL rejects
   `USING` on an INSERT policy.
6. **A bare `.update()` is a data-loss bug.** Use `.upsert(..., { onConflict: 'id' })`
   when the row may not exist.
7. **Loading states must always terminate.** `setLoading(false)` belongs in a
   `finally`.
8. **Work one milestone at a time, in roadmap order.** Do not start a later
   milestone while an earlier one is unfinished, and do not silently expand scope.
9. **Never commit secrets.** Only `NEXT_PUBLIC_*` values may be client-visible.
   The Supabase `service_role` key must never appear in `src/`, a commit, or a
   prompt.

## Before you say "done"

Run all three, from a clean tree, and quote the result:

```bash
npx tsc --noEmit     # must print nothing
npx eslint .         # must report 0 errors
npm run build        # must exit 0
```

If your change touched the database, also run:

```bash
./scripts/verify-rls.sh
```

## Reporting style

State facts with evidence. `tsc` exits 0, `eslint` reports 0 errors, and
`next build` exits 0 — quote them. Never claim a security property from reading
code; prove it with an unauthenticated request that returns zero rows.

---

# ⛔ PROTECTED UI — DO NOT REMOVE

The product owner maintains custom navigation and interface elements by hand.
**These are first-class features, not scaffolding. Deleting, commenting out,
hiding, or "simplifying away" any of them is a critical regression.**

## Protected navigation buttons

`src/app/components/layout/MobileNav.tsx` must always keep all six destinations:

| Label key | Route | Status |
| --- | --- | --- |
| `t('discover')` | `/discover` | core |
| `t('people')` | `/people` | core |
| **`t('notifications')`** | **`/notifications`** | **owner-added · protected** |
| **`t('moments')`** | **`/moments`** | **owner-added · protected** |
| **`t('games')`** | **`/game-zone`** | **owner-added · protected** |
| `t('profile')` | `/profile/dashboard` | core |

## Protected route pages

- `src/app/notifications/page.tsx`
- `src/app/moments/page.tsx`
- `src/app/game-zone/page.tsx`

## Rules

1. **Never delete or reorder these entries.** You may *add* to them.
2. **Never remove the route pages** they point at.
3. When editing a layout, header, or nav file, re-read it first and make
   **additive** changes only. If a refactor would drop one of these, stop and
   ask instead.
4. **Wiring them to real data is allowed and encouraged** — replacing an
   `alert()` with a real handler, or mock data with a Supabase query, is exactly
   the intended direction. Removing the affordance is not.
5. Keep the `i18n` keys working: every locale in `src/lib/translations.ts` must
   keep `notifications`, `moments` and `games`, or the nav labels will fall back
   to raw keys.
6. After touching any protected file, verify the buttons are still present:

```bash
grep -cE "'/notifications'|'/moments'|'/game-zone'" src/app/components/layout/MobileNav.tsx   # must be 3
```

