# Administrative control center

The `/admin` console is an operator surface for Mettivo. It is not a separate
application and it has no service-role key: every privileged read and write goes
through a `SECURITY DEFINER` RPC that re-checks `auth.uid()` and
`has_permission(...)` inside PostgreSQL.

## Access model

`user_roles` is the only source of authority.

| Role | Intended use |
| --- | --- |
| `admin` | Super admin. Full console, staff, plans, settings, audit and system. |
| `moderator` | Reports, account enforcement, content moderation, campaign drafts. |
| `support` | Read member accounts and subscriptions. No bans, refunds or settings. |
| `finance` | Payments, subscriptions and analytics. No moderation or security. |
| `user` | No console access. |

Permissions are declared once in `public.has_permission(text)` in migration
`20261015480000_m32_admin_control_center.sql`. The sidebar reads
`admin_me().permissions`; the RPCs independently enforce the same names.

M37 hardens the table layer behind those RPCs:

- `admin_settings` has **no client SELECT grant**. `admin_settings_get()` is the
  only read path and masks the webhook secret as `{ configured: boolean }`.
- `payment_events.payload` is not granted to any client role. Finance can read
  reconciliation columns; raw payload review stays in the SQL Editor.
- `admin_audit_log` direct reads require `audit.view` (admin only). The M14
  moderator policy was removed.
- Direct `user_roles` reads return the caller's own role, or every role for a
  super admin.
- Moderators cannot suspend, warn, or moderation-action another staff account.
  Automated report thresholds also skip staff. A super admin may still act.
- Role changes take an advisory lock before the last-super-admin check, so two
  concurrent demotions cannot leave zero admins.

## Bootstrap the first super admin

Registration must never grant staff access. Sign the intended operator up
normally, then run this in the Supabase SQL Editor (which bypasses RLS as the
database owner):

```sql
-- Replace with the operator account. Confirm exactly one row is returned first.
select id, email from auth.users where email = 'owner@example.com';

insert into public.user_roles (user_id, role, granted_by)
select id, 'admin', id
from auth.users
where email = 'owner@example.com'
on conflict (user_id) do update
  set role = 'admin',
      granted_at = now(),
      granted_by = excluded.granted_by;

-- Verify
select r.user_id, u.email, r.role, r.granted_at
from public.user_roles r
join auth.users u on u.id = r.user_id
where r.role = 'admin';
```

Do not add an `INSERT`/`UPDATE` policy to `user_roles`. Later role changes are
made through **Staff & permissions** and are audited. The database refuses to
demote the last super admin, and an admin cannot demote themselves.

## Environment variables

Set these in the hosting provider for Production, Preview and Development.
Only `NEXT_PUBLIC_*` values may be client-visible.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (public). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key (public; RLS is the boundary). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | for payments UI | Stripe.js public key. |
| `STRIPE_SECRET_KEY` | for payments | Server-only checkout / Stripe API calls. |
| `STRIPE_WEBHOOK_SECRET` | for payments | Stripe signing secret **and** the shared secret for `record_payment_event`. |
| `RESEND_API_KEY` | optional | Moderation/safety email delivery. |
| `MODERATION_EMAIL_FROM` | optional | Verified sender for moderation email. |

Never set `SUPABASE_SERVICE_ROLE_KEY` for this application. It is not read by
`src/`, and introducing it would bypass the authorisation model.

### Store the webhook secret in the database

The webhook route verifies the Stripe signature, then calls
`record_payment_event(p_secret, ...)`. The RPC compares `p_secret` with the value
stored in `admin_settings`. Set **the same value** as
`STRIPE_WEBHOOK_SECRET` in the SQL Editor:

```sql
update public.admin_settings
set value = jsonb_build_object('secret', 'whsec_replace_with_the_real_value'),
    updated_at = now()
where key = 'payment_webhook_secret';
```

The secret is never returned by the API: `admin_settings_get()` reports only
`{ "configured": true | false }`, and the UI cannot edit it.

## Stripe webhook

Endpoint:

```
POST https://<your-domain>/api/admin/stripe/webhook
```

Subscribe the endpoint to the events the route handles:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `charge.refunded`

Behaviour:

1. The raw body is verified with `STRIPE_WEBHOOK_SECRET`. Invalid signatures
   return `400` and nothing is written.
2. Known events are written once to `payment_events` (unique `event_id`).
   Re-delivery returns `{ duplicate: true }` and does not double-count revenue.
3. A subscription is updated only when the event carries `user_id`,
   `plan_code` and an allowed status. The plan code must exist in
   `subscription_plans`. Allowed statuses are `trialing`, `active`, `past_due`,
   `canceled` and `expired`.
4. Unsupported Stripe statuses are recorded in the ledger but do not change a
   subscription. `incomplete_expired` maps to `expired`.
5. The stored payload is a minimal pseudonymous summary: event id/type, Stripe
   object ids, plan, amount, currency and status. Billing addresses, card data
   and full receipts are discarded.

**Metadata is required.** The future subscription Checkout creation route must
set `metadata.user_id` and `metadata.plan_code` (and
`subscription_data.metadata` for subscription events). Without them the event is
recorded but no subscription is linked. `client_reference_id` is accepted as a
`user_id` fallback.

There is deliberately **no subscription Checkout creation route yet**. The
Subscriptions page can create draft plans and assign a subscription manually for
support/reconciliation. Do not enable the `subscriptions` feature flag until
checkout, webhook and prices are verified.

## What is intentionally not implemented

| Area | Status | Why |
| --- | --- | --- |
| Refund execution | Not available | Requires a reviewed Stripe refund workflow; the console only shows ledger totals. |
| Bulk campaign delivery | Drafts only | No email/push provider, consent or unsubscribe flow is wired for marketing. |
| Storage usage | Unavailable | Storage metrics are not exposed by the current integration. |
| Video frame scanning | Partial | Moderation scans the first image; video frames are not sampled. |
| Private message reading | Not available | Chat page exposes aggregates only. |
| Self-service staff signup | Not available | The first admin is bootstrapped with SQL. |

Unavailable data is shown as unavailable. The console does not fabricate
metrics, revenue or delivery status.

## Operational checks

```bash
npx tsc --noEmit
npx eslint .
./scripts/verify-rls.sh        # when the database changed
npm test
npm run build
```

Inside the console, **System health** reports row counts, open reports, failed
payment events, the last payment/audit timestamps, rate limits and environment
variable presence. Presence is not proof of delivery: send a real Stripe test
event and a real moderation email before launch.

## Deployment and rollback

1. Apply migrations with `npm run build:apply-all`, then run the Supabase
   migration in order. Migrations are idempotent and forward-only.
2. Deploy the build.
3. Bootstrap the first admin with the SQL above.
4. Configure the Stripe endpoint and secret, then send a test event.
5. Roll back by deploying the previous build. Database changes are additive;
   dropping the new tables is not required for a code rollback.
6. Rotate a leaked secret in the host first, then re-run the `admin_settings`
   update with the new value.

## Audit and retention

Every privileged mutation writes to `admin_audit_log`. The table is append-only
for the application: no `UPDATE`/`DELETE` grant exists. Audit reads require the
`audit.view` permission, which only `admin` holds.
