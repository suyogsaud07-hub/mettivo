#!/usr/bin/env bash
#
# scripts/restore-rehearsal.sh — R-14: rehearse a restore into a SCRATCH database.
#
# A backup nobody has restored is a hypothesis. This script turns the hypothesis
# into a dated, repeatable procedure: it rebuilds the schema from
# `supabase/apply_all.sql` into a scratch project and verifies the security
# posture of the result.
#
# DELIBERATELY DEFENSIVE
#   * It refuses to run without an explicit RESTORE_DATABASE_URL.
#   * It refuses to run against the production project ref found in .env.local,
#     so a copy-pasted command cannot destroy live data.
#   * It never drops or truncates anything; it only creates and inspects.
#
# Usage:
#   RESTORE_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
#     ./scripts/restore-rehearsal.sh
#
# Then, against the scratch project's API:
#   NEXT_PUBLIC_SUPABASE_URL=https://<scratch-ref>.supabase.co \
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<scratch-anon-key> \
#     ./scripts/verify-rls.sh
#
# Record the date, the measured duration and the result in docs/RISK_REGISTER.md
# under R-14. Until that entry exists, R-14 stays open.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT_DIR/supabase/apply_all.sql"

if [[ -z "${RESTORE_DATABASE_URL:-}" ]]; then
  echo "ERROR: RESTORE_DATABASE_URL is not set." >&2
  echo "       Point it at a SCRATCH project, never at production:" >&2
  echo "       Supabase dashboard -> Project Settings -> Database -> Connection string" >&2
  exit 2
fi

# --- refuse to touch production -------------------------------------------------
# Deliberately evaluated BEFORE the tooling checks: a command aimed at production
# must fail on that fact, not on a missing binary that might be installed later.
PROD_REF=""
ENV_FILE="$ROOT_DIR/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  PROD_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
  # https://<ref>.supabase.co -> <ref>
  PROD_REF="$(printf '%s' "$PROD_URL" | sed -E 's|https?://([^.]+)\..*|\1|')"
fi

if [[ -n "$PROD_REF" && "$RESTORE_DATABASE_URL" == *"$PROD_REF"* ]]; then
  echo "REFUSING TO RUN: RESTORE_DATABASE_URL points at the production project ($PROD_REF)." >&2
  echo "                 Create a scratch Supabase project for rehearsals." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is required (brew install libpq, or the full postgres package)." >&2
  exit 2
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "ERROR: $BUNDLE is missing. Run: npm run build:apply-all" >&2
  exit 2
fi

echo
echo "Restore rehearsal — R-14"
echo "target: ${RESTORE_DATABASE_URL%%:*}://…  (host hidden)"
echo "bundle: $(basename "$BUNDLE") ($(wc -l < "$BUNDLE" | tr -d ' ') lines)"
echo

# --- 1. apply the bundle --------------------------------------------------------
echo "1. Applying the schema bundle…"
started_at="$(date +%s)"

if ! psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$BUNDLE" >/tmp/restore-rehearsal.log 2>&1; then
  echo "   FAILED — see /tmp/restore-rehearsal.log" >&2
  tail -20 /tmp/restore-rehearsal.log >&2
  exit 1
fi

finished_at="$(date +%s)"
elapsed=$((finished_at - started_at))
echo "   OK (${elapsed}s)"
echo "   idempotency: re-running to prove it is a no-op…"

if ! psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$BUNDLE" >/tmp/restore-rehearsal-2.log 2>&1; then
  echo "   FAILED on the second pass — the migration set is not idempotent." >&2
  tail -20 /tmp/restore-rehearsal-2.log >&2
  exit 1
fi
echo "   OK"

# --- 2. verify the posture ------------------------------------------------------
echo
echo "2. Verifying the rebuilt posture…"

table_count="$(psql "$RESTORE_DATABASE_URL" -tA -c \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'")"

rls_missing="$(psql "$RESTORE_DATABASE_URL" -tA -c \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity is not true")"

bad_insert_policies="$(psql "$RESTORE_DATABASE_URL" -tA -c \
  "select count(*) from pg_policies
   where schemaname='public' and cmd='INSERT' and with_check is null")"

unpinned_definers="$(psql "$RESTORE_DATABASE_URL" -tA -c \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
                     where c like 'search_path=%')")"

echo "   tables:                    $table_count"
echo "   tables without RLS:        $rls_missing"
echo "   INSERT policies w/o CHECK: $bad_insert_policies"
echo "   unpinned SECURITY DEFINER: $unpinned_definers"

status=0
[[ "$table_count" -lt 15 ]] && { echo "   FAIL: expected at least 15 tables" >&2; status=1; }
[[ "$rls_missing" != "0" ]] && { echo "   FAIL: a table has RLS disabled" >&2; status=1; }
[[ "$bad_insert_policies" != "0" ]] && { echo "   FAIL: an INSERT policy is missing WITH CHECK" >&2; status=1; }
[[ "$unpinned_definers" != "0" ]] && { echo "   FAIL: a SECURITY DEFINER function has no search_path" >&2; status=1; }

echo
if [[ "$status" -ne 0 ]]; then
  echo "RESULT: FAIL — the rebuild did not produce a safe posture." >&2
  exit 1
fi

cat <<EOF
RESULT: PASS — schema rebuilt in ${elapsed}s and re-applied as a no-op.

NEXT STEPS (both are required before R-14 can be closed):
  1. Restore a data dump into the same scratch project and compare row counts
     for profiles, messages, matches and likes against production.
  2. Point the API check at the scratch project:
       NEXT_PUBLIC_SUPABASE_URL=https://<scratch-ref>.supabase.co \\
       NEXT_PUBLIC_SUPABASE_ANON_KEY=<scratch-anon-key> \\
         ./scripts/verify-rls.sh
  3. Record the date, the ${elapsed}s rebuild time and both results in
     docs/RISK_REGISTER.md under R-14.
EOF

exit 0
