# Mettivo Constitution

The non-negotiable rules of this codebase. When a shortcut, a deadline, or an AI
suggestion conflicts with anything below, **this document wins**.

Mettivo handles dating profiles for adults in Nepal. The data is sensitive:
identity, location, photos, religion, politics, and safety reports. Treat every
design decision as if a real person's safety depends on it — because it does.

---

## Article 1 — Security is not a milestone

1. **No personal data is readable by anonymous users.** Every table holding
   personal data must have Row Level Security enabled and must not be readable
   through the public anon key without a session.
2. **`auth.uid()` is the only source of identity.** Never trust a user id sent
   from the browser, a query string, or a request body.
3. **Writes are owner-scoped.** `INSERT`/`UPDATE`/`DELETE` must verify
   `auth.uid()` against the row's owner column via `WITH CHECK`, never `USING`.
4. **Never expose `birth_date`.** Derive and display `age`. Exact dates of birth
   enable identity theft and are not needed to render a profile.
5. **Secrets never enter the repository.** Only `NEXT_PUBLIC_*` values may be
   client-visible. The Supabase `service_role` key must never appear in `src/`,
   a commit, a prompt, or a screenshot.

## Article 2 — Correctness over cleverness

6. **`any` is forbidden.** Use precise types, `unknown` plus narrowing, or a
   generic. The only accepted escape is a documented `// eslint-disable-next-line`
   with a written justification.
7. **Errors are handled, never swallowed.** Every network or database call
   either handles `{ error }`, or is wrapped in `try/catch/finally`, and surfaces
   a user-visible message. Silent failure is a bug.
8. **Loading states always terminate.** Any `setLoading(true)` must have a
   guaranteed path to `false` — use `finally`.
9. **No infinite redirects.** A guard that redirects must redirect to a state
   that does not redirect back.

## Article 3 — The database is the source of truth

10. **Every schema change ships as an idempotent migration** in
    `supabase/migrations/`, using `create table if not exists`,
    `alter table ... add column if not exists`, `gen_random_uuid()` (never
    `uuid_generate_v4()`, which needs an extension), and
    `drop policy if exists` before `create policy`.
11. **A migration must be re-runnable.** Running it twice must be a no-op, not
    an error. Migrations are applied by hand in the Supabase SQL Editor today, so
    half-applied state is a real risk.
12. **Migrations in the repo must be executable.** If a migration cannot run on
    a clean database, the repository cannot rebuild the product.

## Article 4 — Verification is mandatory

13. **Nothing is "done" until all three gates pass**, from a clean tree:
    `npx tsc --noEmit`, `npx eslint .`, `npm run build`.
14. **Security claims require adversarial evidence.** "RLS is enabled" is proven
    by issuing an unauthenticated request and observing zero rows — see
    `scripts/verify-rls.sh`. Never assert a security property from reading code.
15. **Zero broken imports, zero invalid JSX, zero unused-module errors.** The
    build is the contract.

## Article 5 — Method

16. **One milestone at a time, in roadmap order.** Finish the current milestone
    before starting the next. Partially-built features are liabilities.
17. **Definition of Done** — all five must hold:
    - behaviour implemented and reachable from the UI,
    - types complete, no `any`,
    - three gates green,
    - migrations idempotent and applied,
    - verification evidence recorded in the commit message.
18. **Leave the tree cleaner than you found it.** No dead code, no
    commented-out blocks, no placeholder `{/* ... content ... */}` shipped as a
    finished page.

---

### Amendments

This constitution changes only by an explicit, written decision recorded here
with its date and rationale.
