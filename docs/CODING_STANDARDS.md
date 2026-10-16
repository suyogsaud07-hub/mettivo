# Mettivo Coding Standards

Enforced by `npx tsc --noEmit`, `npx eslint .`, and `npm run build`. Anything
here that a tool can enforce should also be a lint rule.

## 1. TypeScript

**No `any`.** Ever. Use one of:

```ts
// Narrowing instead of any
} catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
}

// unknown at the boundary, narrowed immediately
function parseRow(input: unknown): MessageRow | null {
  if (typeof input !== 'object' || input === null) return null;
  ...
}
```

Other rules:

- `strict` is on — never disable it, never add `@ts-ignore` (use
  `@ts-expect-error` with a reason if you truly must).
- Type **contracts**, not implementations: exported functions get explicit
  return types; props are `interface`s in the same file.
- Prefer `interface` for object shapes, `type` for unions and aliases.
- Model optionality honestly: `string | null` when the database column is
  nullable. Supabase returns `null`, not `undefined`.
- Put shared row types in `src/lib/types.ts`. Do not redeclare them per page.

## 2. React

- **Rules of Hooks are absolute.** No hooks after an early `return`, no
  conditional hooks. A modal that returns `null` when closed must call every
  hook *before* that return.
- `'use client'` is required in any module that uses state, effects, refs,
  context, or browser APIs. Add it to presentational components that keep state
  (`Avatar`, `Modal`) even when a client parent currently imports them.
- **Effects must terminate.** Any `setLoading(true)` needs a `finally` that sets
  it false. Guard every async effect with an `isMounted`/`cancelled` flag so
  unmounted components do not set state.
- **External state uses `useSyncExternalStore`**, not `useEffect` + `setState`.
  See `src/context/LanguageContext.tsx` for the pattern.
- **Never compute random or time-dependent values during render** — they cause
  hydration mismatches. Derive pseudorandom values deterministically from an id
  (see `tagFor()` in `discover/mettivo_voice/page.tsx`).
- Always provide `key` on list items; a stable id, never a bare index for
  dynamic lists.

## 3. Next.js 16 (App Router)

> This version differs from older training data. The bundled docs live at
> `node_modules/next/dist/docs/` — read them before using an unfamiliar API.

- `params` and `searchParams` are **Promises**. In a client component unwrap with
  `use(params)`; in a server component `await` them:
  ```ts
  export default function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);        // client component
  }
  ```
- `cookies()`, `headers()`, `draftMode()` are **async** — always `await`.
- A route with no dynamic segment must not receive or destructure `matchId`.
- `middleware` is now `proxy`; the `eslint` key in `next.config.ts` is removed.
- Route handlers export `GET`/`POST` and return `NextResponse`; wrap the body in
  `try/catch` and return an explicit status:
  ```ts
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  ```
- Validate everything entering a route handler. Never forward raw user input into
  a query.

## 4. Supabase data access

- Import the single browser client: `import { supabase } from '@/lib/supabase'`.
- **Always inspect `error`.** Supabase resolves with `{ data, error }`; it does
  not throw on Postgres errors:
  ```ts
  const { data, error } = await supabase.from('messages').select('id, content').eq('match_id', matchId);
  if (error) { console.error('load messages:', error.message); setError('Could not load this conversation.'); return; }
  ```
- Use `.maybeSingle()` for rows that may legitimately be absent. `.single()`
  treats "zero rows" as an *error*.
- Use `.upsert(payload, { onConflict: 'id' })` when a row may not exist yet. A
  bare `.update()` affects zero rows and reports **success** — a silent data-loss
  bug.
- Select explicit columns (`select('id, display_name')`) rather than `*` on any
  table holding private fields; `*` leaks `birth_date` and `politics`.
- Wrap every write in `try/catch/finally` and surface a user-visible error.
  `alert()` is discouraged — prefer inline `role="alert"` messages.

## 5. Styling

- Design tokens live in `src/app/globals.css` (`--met-bg`, `--met-gold`, …). Use
  them rather than inventing new hex values.
- Tailwind v4 is wired through the Turbopack loader; a new utility class is
  available with no config file. Do not add `tailwind.config.js`.
- Inline styles are acceptable and widely used in this codebase for
  page-specific layout; keep the shared primitives in `components/ui/`.

## 6. Files, naming, imports

- Components: `PascalCase.tsx`. Utilities: `camelCase.ts`. Routes: Next.js
  conventions (`page.tsx`, `layout.tsx`, `route.ts`).
- Use the `@/*` alias (→ `src/*`) for cross-directory imports;
  `@/app/components/ui/...` is the established path for shared components.
- Prefer relative imports only for siblings within the same folder.
- Delete dead code rather than commenting it out.

## 7. Commit messages

```
<type>: <imperative summary>

Why the change was needed, and what the observable effect is.

Verified: tsc 0 errors · eslint 0 errors · next build exit 0
```

`type` ∈ `feat | fix | docs | chore | refactor | test | perf | security`.
