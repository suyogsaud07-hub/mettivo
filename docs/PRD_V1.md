# Mettivo — Product Requirements Document v1

**Status:** v1.0 · Approved scope for the v1 release
**Owner:** Product Owner
**Last updated:** 2026-10-15
**Companion documents:** [`CONSTITUTION.md`](./CONSTITUTION.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`RISK_REGISTER.md`](./RISK_REGISTER.md)

---

## 1. Purpose of this document

This PRD fixes the **scope of v1**: what we are building, who it is for, what is
deliberately excluded, and how we will know it works. Everything in
`ARCHITECTURE.md` and every migration in `supabase/migrations/` exists to serve
the requirements below. Where this document and an implementation convenience
disagree, the [Constitution](./CONSTITUTION.md) wins; where this document and
the roadmap disagree, this document wins.

---

## 2. Product summary

Mettivo is a **mobile-first, installable web app for adults (18+) in Nepal** to
meet people for **long-term dating or friendship**. It is a **serverless-client
architecture**: the browser talks directly to Supabase (PostgreSQL + Auth +
Realtime), and **Row Level Security is the only authorisation boundary**. There
is no application server to enforce anything.

That single architectural fact drives the product's most important quality
attribute: **privacy is enforced by the database, not by the UI.**

### 2.1 The one-sentence promise

> Meet real people nearby, with your private details never leaving the database.

### 2.2 Why this shape

| Decision | Rationale |
| --- | --- |
| No application server | Lowest possible operating cost; nothing to patch or scale. |
| Supabase RLS as the only gate | The frontend is untrusted by definition; the database must be safe on its own. |
| Rule-based matching (no ML in v1) | Deterministic, explainable, testable, and free to run. |
| PWA, not a native app | One codebase, installable, no store review delay. |
| Nepal-first | Local density is what makes a dating product work; global launch is a later problem. |

---

## 3. Target users

### 3.1 Primary persona — "Sujata, 26, Kathmandu"

- Works in an office in Kathmandu, mostly on her phone during commutes.
- Wants a **long-term relationship**, not casual swiping.
- **Privacy-sensitive:** will not sign up anywhere that shows her exact
  location, date of birth, or identity documents to strangers.
- Abandons any product that feels unsafe within the first session.

**Needs:** fast onboarding, credible profiles, control over who can find her,
a visible and reliable way to report or block someone.

### 3.2 Secondary persona — "Bikash, 29, Pokhara"

- New to the city, wants **friendship and activity partners** as much as dating.
- Uses the product in the evening, on a mid-range Android device over mobile
  data, and cares about data cost.

**Needs:** an explicit "here for friendship" signal, low-bandwidth screens,
and notifications that don't require the app to be open.

### 3.3 Non-personas for v1

- Users under 18 — **explicitly out of scope and actively excluded.**
- Users outside Nepal — supported by the schema, not optimised for.
- Enterprise / event / group-dating organisers.

---

## 4. Market scope

| Dimension | v1 decision |
| --- | --- |
| Geography | Nepal first (Kathmandu valley, Pokhara). Schema is country-agnostic. |
| Language | English + Nepali, Hindi, Spanish, French already shipped in `translations.ts`; English and Nepali are launch-supported. |
| Platform | Installable PWA (Android Chrome primary, iOS Safari secondary). |
| Age | **18+ only.** Hard gate. |
| Intent | Dating, friendship, or both — declared during onboarding, respected by matching. |
| Monetisation | **None in v1.** No payments, no ads, no data sale. Explicit non-goal. |
| Regulatory | Nepal Electronic Transactions Act posture; privacy policy and terms shipped under `/privacy` and `/terms`. |

---

## 5. Functional requirements

Requirement IDs are stable and are referenced by the milestone list in §8 and
by test suites.

### 5.1 Accounts and onboarding

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-A1` | A visitor can sign up with OAuth (Google, Facebook, X, Discord) or email/phone OTP. | Must |
| `FR-A2` | A visitor must affirmatively confirm they are 18 or older before an account is created. | Must |
| `FR-A3` | After first sign-in, a member must complete a **16-step onboarding wizard** before reaching discovery. | Must |
| `FR-A4` | The wizard captures: display name, avatar, gender, pronouns, date of birth, location, height/build, intention, orientation/preferences, personality, optional religion, hobbies, pets, lifestyle, education/profession, spoken languages, and bio. | Must |
| `FR-A5` | Age is **derived** from date of birth and stored as `age`. `birth_date` is never exposed on a public surface. | Must |
| `FR-A6` | Onboarding state is persisted; an interrupted wizard resumes without loss of profile data. | Should |
| `FR-A7` | A member may sign out, and the session is cleared locally. | Must |

### 5.2 Profiles

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-P1` | A member can view and edit their own profile at any time. | Must |
| `FR-P2` | Writes are owner-scoped: `auth.uid()` matches the row, enforced by RLS `WITH CHECK`. | Must |
| `FR-P3` | A profile upsert works whether or not the row already exists (never a bare `update()`). | Must |
| `FR-P4` | A member can delete their own account and all associated data. | Must |
| `FR-P5` | A member can export their own data. | Should |
| `FR-P6` | Public surfaces read an **allow-listed projection** (`public_profiles`), never `select *`. | Must |

### 5.3 Discovery and matching

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-D1` | A member sees other onboarded, online members, filterable by age and gender. | Must |
| `FR-D2` | Candidates already liked/passed are removed from the feed. | Must |
| `FR-D3` | Blocked and blocking members are removed from the feed, and their profiles are unreadable. | Must |
| `FR-D4` | Suspended members are removed from the feed. | Must |
| `FR-D5` | Candidates whose intentions are incompatible are filtered out. | Must |
| `FR-D6` | Remaining candidates are ranked by a **deterministic** score (same inputs → same order). | Must |
| `FR-D7` | A member can like or pass; the decision is final and idempotent. | Must |
| `FR-D8` | A mutual like creates exactly one match, even under simultaneous likes. | Must |
| `FR-D9` | A member can unmatch; the match and both like decisions are removed and neither can be re-liked by accident. | Should |

### 5.4 Messaging

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-M1` | Matched members can exchange one-to-one text messages. | Must |
| `FR-M2` | Messages persist and survive a reload. | Must |
| `FR-M3` | New messages appear without a manual refresh (Realtime). | Must |
| `FR-M4` | A member sees an unread count per conversation. | Must |
| `FR-M5` | Sends are sender-scoped: a member cannot send as someone else. | Must |
| `FR-M6` | A blocked pair cannot exchange messages in either direction. | Must |
| `FR-M7` | A failed send is surfaced to the member and is retryable; the composer never silently discards text. | Must |

### 5.5 Safety and moderation

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-S1` | A member can report another member with a reason and optional details. | Must |
| `FR-S2` | A member can block another member; blocking is bidirectional in effect. | Must |
| `FR-S3` | Reports are triaged by moderators with status `pending → reviewed/dismissed/actioned`. | Must |
| `FR-S4` | A moderator can suspend and unsuspend a member, with an audit trail. | Must |
| `FR-S5` | A moderator cannot be promoted by any client-side path; roles live in `user_roles` with no write policy. | Must |
| `FR-S6` | Abuse-sensitive writes are rate-limited server-side. | Should |
| `FR-S7` | A suspended member cannot write (post, like, message, report), but the failure is user-visible. | Must |
| `FR-S8` | Report resolution notifies the reporter. | Should |

### 5.6 Engagement surfaces (protected — see AGENTS.md)

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-E1` | **Notifications**: per-member feed generated automatically from follows, likes, matches, messages and report triage; live via Realtime; mark-read and delete. | Must |
| `FR-E2` | **Moments**: a social feed where a member can share a moment, like and comment. | Must |
| `FR-E3` | **Games**: a game-zone catalogue with per-member results and stats. | Must |
| `FR-E4` | All six bottom-nav destinations remain present and functional at all times. | Must |

### 5.7 Privacy, legal and lifecycle

| ID | Requirement | Priority |
| --- | --- | --- |
| `FR-L1` | A privacy policy and terms are reachable without authentication. | Must |
| `FR-L2` | No personal data is readable by an anonymous caller. | Must |
| `FR-L3` | Account deletion cascades to every table that references the member. | Must |
| `FR-L4` | Personal data is exported in a portable machine-readable format on request. | Should |

---

## 6. Non-functional requirements

| ID | Requirement | Target | Verified by |
| --- | --- | --- | --- |
| `NFR-1` | No type errors, no `any`, strict mode on. | 0 errors | `npx tsc --noEmit` |
| `NFR-2` | No lint errors. | 0 errors | `npx eslint .` |
| `NFR-3` | Production build succeeds. | exit 0 | `npm run build` |
| `NFR-4` | Every migration applies **and re-applies** on a clean database. | idempotent | `tests/database` |
| `NFR-5` | Anonymous callers read zero rows from every personal-data table. | 0 rows | `./scripts/verify-rls.sh` |
| `NFR-6` | No production-dependency vulnerabilities. | 0 high/critical | `npm run audit` |
| `NFR-7` | Protected navigation and routes never regress. | 6 nav entries, 3 routes | `tests/security` + grep gate |
| `NFR-8` | First meaningful paint on mid-range Android over 3G. | < 3 s | manual, per release |
| `NFR-9` | The app shell loads offline. | `/offline` served | manual, per release |
| `NFR-10` | No secret in `src/`, a commit, or a prompt. | 0 findings | `tests/security` §4 |

---

## 7. Release gate (definition of done)

v1 ships only when **all** of the following hold, with quoted evidence:

1. `npx tsc --noEmit` → 0 errors.
2. `npx eslint .` → 0 errors.
3. `npm test` → all suites pass.
4. `npm run audit` → 0 production vulnerabilities.
5. `npm run build` → exit 0.
6. `./scripts/verify-rls.sh` → exit 0 against the **live** project.
7. Every migration in `supabase/migrations/` applied to the live project, in
   order, and re-run once to prove idempotency.
8. The six bottom-nav destinations verified present, plus the three protected
   routes reachable.

> **Gate 6/7 are currently failing on the live project.** See
> `RISK_REGISTER.md` risks `R-01` and `R-02`.

---

## 8. Milestone scope map

| Milestone | Theme | Requirements |
| --- | --- | --- |
| M0 | Product definition & scope | this document |
| M4 | Supabase schema consolidation | `NFR-4`, `FR-P3` |
| M6 | RLS lockdown | `FR-L2`, `NFR-5` |
| M7 | Full profile management | `FR-P1`–`FR-P6`, `FR-A7` |
| M8 | Interest & prompt catalogue | `FR-D6`, `FR-A4` |
| M9 | Rule-based recommendation engine | `FR-D1`–`FR-D6` |
| M10 | Likes & mutual matching | `FR-D7`, `FR-D8` |
| M11 | Real-time one-to-one messaging | `FR-M1`–`FR-M7` |
| M12 | Server-side blocking & unmatching | `FR-D3`, `FR-M6`, `FR-S2`, `FR-D9` |
| M13 | Reporting & moderation workflow | `FR-S1`, `FR-S3`, `FR-S4`, `FR-S8` |
| M14 | Admin panel & abuse controls | `FR-S5`–`FR-S7` |
| M15 | Privacy, deletion & legal | `FR-L1`, `FR-L3`, `FR-L4` |
| M16 | Engagement surfaces | `FR-E1`–`FR-E3` |
| M17 | Security & privacy testing | `NFR-5`, `NFR-10` |
| M18 | Production deployment & infra readiness | §7 release gate |

---

## 9. Explicit non-goals for v1

Recorded so they are not silently added:

1. **No application server, no edge functions** — this is an architectural
   commitment, not a temporary state.
2. **No machine-learned matching.** Scoring stays deterministic and testable.
3. **No payments, subscriptions, or ads.**
4. **No video or voice calling.** The discovery screen has record/call
   affordances; they are not part of the v1 contract.
5. **No native iOS/Android app.**
6. **No image moderation pipeline.** Photos are stored as-is; moderation is
   human and report-driven.
7. **No group chat, no events, no communities.**
8. **No web push notifications** in v1 (in-app + Realtime only).

---

## 10. Open product questions

Tracked so an engineer does not have to invent an answer:

| # | Question | Owner | Blocking? |
| --- | --- | --- | --- |
| Q1 | Should a **suspended** member remain visible in discovery, or be hidden? | Product | Yes — affects `FR-D4` |
| Q2 | Should blocking also hide the blocker from the blocked member's search, or only vice versa? | Product | No — default is symmetric |
| Q3 | Retention period for `admin_audit_log` and resolved reports. | Product + Legal | No |
| Q4 | Is ethnicity/caste a supported profile field? Currently excluded for safety. | Product | No |
| Q5 | Nepali-language launch: is the `ne` translation complete enough to default? | Product | Yes for launch |

---

## 11. Amendments

Changes to v1 scope are recorded here with date and rationale.

| Date | Change | Rationale |
| --- | --- | --- |
| 2026-10-15 | v1.0 created. | M0 formalisation. |
