# Admin database hardening — review package (M37)

Status: **prepared, not applied.** No migration was executed, no data was
deleted or rewritten, and no payment-provider-specific change was made.

Migration: `supabase/migrations/20261015530000_m37_admin_security_hardening.sql`

---

## A. Existing schema and security findings

### Already implemented

The admin control center is substantially built. M37 does **not** duplicate it:

| Area | Existing implementation |
| --- | --- |
| Roles | `public.user_roles`; roles `user`, `moderator`, `support`, `finance`, `admin` |
| Permissions | `public.has_permission(text)`, `admin_me()`, `is_admin()`, `is_staff()` |
| Staff operations | `admin_staff_list()`, `admin_set_role()` |
| Account enforcement | `admin_set_user_status()`, `admin_warn_user()`, legacy `admin_suspend_user()`/`admin_unsuspend_user()` |
| Moderation | `admin_report_queue()`, `admin_resolve_report()`, `admin_apply_moderation_action()` |
| Reporting data | `reports` with evidence, category, target, resolution note/actor/timestamp and action taken |
| Audit | append-only `admin_audit_log`; `admin_audit_list()` admin-only |
| Plans | `subscription_plans` with `features jsonb` and `limits jsonb` |
| Subscriptions | `subscriptions`, manual assignment RPC, Stripe/manual provider field |
| Payments | append-only `payment_events`, `admin_payment_list()`, `admin_payment_summary()`, shared-secret `record_payment_event()` |
| Settings | `admin_settings`, masked `admin_settings_get()`, audited `admin_settings_set()` |
| Campaigns | draft-only `notification_campaigns` and `admin_create_campaign()` |
| Metrics | dashboard, analytics, media, chat, discovery, system health RPCs |
| RLS | enabled on all admin tables; writes only through `SECURITY DEFINER` RPCs |

Payment provider evidence: Stripe is visible in `package.json`, the Stripe
webhook route, donation checkout and `docs/ADMIN_CONTROL_CENTER.md`. Existing
payment tables are provider-neutral (`manual` / `stripe`). **M37 adds no
provider-specific schema or behaviour.** Confirm the live provider choice and
webhook configuration before any Stripe-specific work.

### Findings fixed by M37

| Severity | Finding | Effect |
| --- | --- | --- |
| High | `admin_settings` had a direct `SELECT` grant to `authenticated` | An admin bearer token could read `payment_webhook_secret` through PostgREST, bypassing the masked RPC; that secret also authorises `record_payment_event()` |
| High | `payment_events` granted full-row `SELECT` to finance | Finance could read `payload`, despite M32 intending raw payloads to be admin/SQL-only |
| High | M14's `audit_log_moderators_read` policy survived M32 | Moderators could read the whole audit trail directly while `audit.view` is admin-only |
| High | Moderators could act on other staff through legacy moderation RPCs | A moderator could suspend/warn/moderation-action an admin, finance, support or another moderator |
| High | Report-threshold automation could enforce against staff | A pile of reports could auto-suspend a staff account |
| Medium | Last-super-admin check was not concurrency-safe | Two simultaneous demotions could both pass and leave zero admins |
| Medium | Moderators could enumerate all staff roles through `user_roles` | Staff directory was broader than the admin-only staff console |
| Low | Missing indexes for audit target lookups and report target counts | Slower user-detail and moderation aggregates as data grows |

### Deliberately not added

These are product decisions, not silent scope expansion:

- report assignment/priority/SLA fields and UI;
- entitlement-enforcement helpers beyond the existing `features`/`limits` JSON;
- campaign delivery, refund execution, or any payment-provider integration;
- new tables, columns or destructive rewrites.

---

## B. Schema-change plan

1. Add internal `is_staff_user(uuid)` predicate, executable only by the owner.
2. Revoke all client DML on admin tables; re-grant only required reads.
   - no client grant on `admin_settings`;
   - no `payment_events.payload` grant;
   - select-only on roles, audit, plans, subscriptions, campaigns.
3. Replace the moderator audit policy with `has_permission('audit.view')`.
4. Restrict direct role reads to self or `staff.manage`.
5. Add audit/report indexes.
6. Replace `admin_set_role()` to take a transaction advisory lock before the
   last-admin count.
7. Add staff-target guards to account and moderation RPCs.
8. Add a final guard in `apply_moderation_action()` so automated paths cannot
   enforce against staff; make threshold evaluation report `protected_staff`.
9. Emit a posture report of grants and policies. No data mutation.

Safety properties:

- no `DELETE`, `TRUNCATE`, `DROP TABLE`, or data overwrite;
- no column drops;
- idempotent helpers (`create or replace`, `if not exists`, repeatable grants);
- provider-neutral;
- forward-only.

---

## C. Migration

Path:
`supabase/migrations/20261015530000_m37_admin_security_hardening.sql`

Review focus:

- `revoke all ... from anon, authenticated` followed by narrow grants;
- `grant select (<safe columns>) on public.payment_events` excluding `payload`;
- no `grant select on public.admin_settings`;
- `audit_log_admin_read` policy;
- `user_roles_select_own_or_admin` policy;
- staff guards using `is_staff_user()` and `is_admin()`;
- `pg_advisory_xact_lock(...)` in `admin_set_role()`;
- `apply_moderation_action()` returning `null` for staff unless a super admin
  is acting.

After review, regenerate the single-file bundle:

```bash
npm run build:apply-all
```

Apply only through the normal reviewed deployment process. Do not paste into a
production SQL Editor as part of this review step.

---

## D. Role-based test plan

### Automated tests

Run:

```bash
npx vitest run tests/database/admin_control_center.test.ts \
  tests/database/moderation.test.ts \
  tests/database/moderation_system.test.ts
npx tsc --noEmit
npx eslint .
npm run build
./scripts/verify-rls.sh   # requires deployed project env
```

`tests/database/admin_control_center.test.ts` now covers:

- direct `admin_settings` read denied;
- direct `payment_events.payload` read denied for admin and finance;
- finance can read safe payment columns;
- moderator/support direct audit reads return zero rows;
- direct role reads return self only for support/moderator, all for admin;
- moderator cannot change/warn/suspend/moderation-action staff;
- report thresholds return `protected_staff`;
- existing M32 permission, secret, payment, role and audit tests remain green.

### Manual matrix

| Caller | Expected |
| --- | --- |
| anon | all admin tables zero rows; privileged RPCs denied; wrong webhook secret denied |
| user | `admin_me()` only; no admin tables; no privileged RPC |
| support | user list/detail and subscription view; no audit, settings, payments, staff management, moderation writes |
| finance | payments/subscriptions/analytics; safe payment columns only; no raw payload, audit, settings, moderation |
| moderator | reports, queue, account enforcement on ordinary members; no staff targets, audit, settings, payments, role management |
| admin | full console; audit read; masked settings; no webhook secret; raw payload via SQL Editor only |

Additional manual checks:

1. A moderator attempts to suspend an admin, finance, support and another
   moderator — every attempt must fail with `42501`.
2. A super admin can still suspend/restore another staff account; the action is
   written to `admin_audit_log`.
3. Demote the last super admin — denied.
4. Two concurrent `admin_set_role()` demotions of the two remaining admins — one
   must fail; at least one admin remains.
5. Send a Stripe test event after rotating the secret — valid event accepted,
   wrong secret rejected, duplicate event id idempotent.
6. Try direct PostgREST reads:
   - `admin_settings?select=value` → permission denied;
   - `payment_events?select=payload` → permission denied;
   - `admin_audit_log?select=*` as moderator → zero rows;
   - `user_roles?select=*` as moderator → own row only.
7. Apply the full migration set twice — second run must be a clean no-op.

---

## E. Rollback plan

M37 is additive and least-privilege. A code rollback does not require a database
rollback, and no application code depends on the new objects.

If a database rollback is required:

1. Stop admin-console writes.
2. Deploy the previous application build (unchanged by M37).
3. Apply a separately reviewed rollback migration that restores the prior
   function bodies, policies and grants from M14/M25/M32. Do **not** drop tables
   or delete rows.
4. Drop only the M37-added indexes and internal helper if they are not used by
   the restored definitions.
5. Rotate the Stripe webhook secret if there is any suspicion the old direct
   `admin_settings` grant was exercised.
6. Re-run the full database/security suite and `./scripts/verify-rls.sh`.

Rolling back reopens the original findings. It should be an incident decision,
not a routine deployment step.

Data rollback: none required. M37 deletes no rows and adds no columns.

---

## F. App-side authorization checklist

- [x] The `/admin` layout gates navigation by `admin_me().permissions`, but this
      is UX only. Every page must still rely on RPC enforcement.
- [x] Admin data access goes through `src/lib/admin-console.ts` RPCs.
- [x] No `src/` call reads `admin_settings`, `payment_events`, `admin_audit_log`,
      `user_roles`, `subscription_plans`, `subscriptions` or
      `notification_campaigns` directly.
- [x] `admin_settings_get()` is the only settings read path; the UI must never
      receive or display the webhook secret.
- [x] `payment_events.payload` is never selected by browser code.
- [x] Role changes use `admin_set_role()`; registration never inserts
      `user_roles`.
- [x] Account actions use audited RPCs, never direct profile updates.
- [x] Webhook writes remain server-side and use `STRIPE_WEBHOOK_SECRET` plus
      `record_payment_event()`.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` is read by `src/`.
- [ ] Future admin pages must add the matching `AdminPermission` and rely on the
      database check, not only on hidden navigation.
- [ ] Any future direct table read must be reviewed against M37's grants; adding
      a column-level read for `payment_events` must exclude `payload`.
- [ ] Any new privileged mutation must re-check `auth.uid()` and
      `has_permission(...)` inside PostgreSQL and write an audit entry.

---

## Verification record

Prepared migration and tests only; no database apply was performed.

Local verification after implementation:

- `npx vitest run tests/database/admin_control_center.test.ts tests/database/moderation.test.ts tests/database/moderation_system.test.ts` — 3 files, 58 tests passed.
- `npx tsc --noEmit` — pending final gate.
- `npx eslint .` — pending final gate.
- `npm run build` — pending final gate.
- `./scripts/verify-rls.sh` — requires a deployed project and was not run as part
  of this review.
