#!/usr/bin/env bash
#
# scripts/verify-rls.sh — adversarial Row Level Security verification.
#
# Proves the security property instead of assuming it: every request below is
# made WITHOUT a session, carrying only the public anon key that any visitor
# already has. A correct posture returns ZERO rows for every table.
#
# Usage:
#   ./scripts/verify-rls.sh
#
# Exits 0 when no personal data is reachable anonymously, 2 on misconfiguration,
# and 1 when at least one table leaks.
#
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

# Fall back to .env.local for local runs; CI supplies real environment variables.
if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  ENV_FILE="$ROOT_DIR/.env.local"
  if [[ -f "$ENV_FILE" ]]; then
    if [[ -z "$SUPABASE_URL" ]]; then
      SUPABASE_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
    fi
    if [[ -z "$ANON_KEY" ]]; then
      ANON_KEY="$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
    fi
  fi
fi

if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  echo "ERROR: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set" >&2
  echo "       (or present in $ROOT_DIR/.env.local)" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required" >&2
  exit 2
fi

# Tables that hold personal data. `likes` is included so the check starts
# covering it automatically once M10 creates the table.
TABLES=(
  "profiles"
  "messages"
  "follows"
  # M24 audit tables retained after face/voice verification was removed in M31.
  # They still hold member-scoped historical rows, so an anonymous caller must
  # see zero rows.
  "profile_verifications"
  "profile_photo_checks"
  "matches"
  "reports"
  "blocked_users"
  "likes"
  "notifications"
  "user_roles"
  "admin_audit_log"
  # M19/M22 Moments. The feed and archive are owner-rights VIEWS — they bypass
  # table RLS by design, so the anonymous check here is the only thing that
  # proves their predicate actually gates a caller without a session.
  "moments"
  "moment_likes"
  "moment_comments"
  "moment_feed"
  "moment_archive"
  # M21 moderation enforcement. These name members and measure their behaviour,
  # so an anonymous caller must never see a row. `moderation_secrets` holds the
  # worker bearer token and has no SELECT grant at all.
  "bans"
  "suspensions"
  "moderation_ai_scans"
  "moderation_warnings"
  "moderation_emails"
  "moderation_settings"
  "moderation_secrets"
  # M25 disappearing chat media. The ledger names the match and the sender and
  # is participant-readable only; the bytes live in a private Storage bucket.
  "chat_media"
)

failures=0
checked=0
skipped=0

echo
echo "RLS verification - anonymous read attempts (expected: ZERO rows everywhere)"
echo "project: ${SUPABASE_URL}"
echo

for table in "${TABLES[@]}"; do
  headers="$(curl -s -o /dev/null -D - -X GET \
      "${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1" \
      -H "apikey: ${ANON_KEY}" \
      -H "Authorization: Bearer ${ANON_KEY}" \
      -H "Prefer: count=exact" \
      -H "Range: 0-0" \
      --max-time 20 2>/dev/null)"

  status="$(printf '%s' "$headers" | head -1 | awk '{print $2}')"
  content_range="$(printf '%s' "$headers" | grep -i '^content-range:' | tr -d '\r' | awk '{print $2}')"

  case "$status" in
    404)
      printf '  %-16s SKIP   table does not exist yet\n' "$table"
      skipped=$((skipped + 1))
      continue
      ;;
    401|403)
      printf '  %-16s PASS   HTTP %s - access denied\n' "$table" "$status"
      checked=$((checked + 1))
      continue
      ;;
    "")
      printf '  %-16s FAIL   no response from Supabase\n' "$table"
      failures=$((failures + 1))
      continue
      ;;
  esac

  # "first-last/total" with total > 0 means rows were actually handed to an
  # anonymous caller -> the table is exposed.
  if [[ "$content_range" =~ ^([0-9]+)-([0-9]+)/([0-9]+)$ ]]; then
    total="${BASH_REMATCH[3]}"
    if [[ "$total" != "0" ]]; then
      printf '  %-16s FAIL   %s row(s) readable WITHOUT authentication\n' "$table" "$total"
      failures=$((failures + 1))
    else
      printf '  %-16s PASS   0 rows\n' "$table"
      checked=$((checked + 1))
    fi
  else
    printf '  %-16s PASS   no rows returned (%s)\n' "$table" "${content_range:-empty}"
    checked=$((checked + 1))
  fi
done

echo
if [[ "$failures" -gt 0 ]]; then
  echo "RESULT: FAIL - ${failures} table(s) leak personal data to anonymous callers." >&2
  echo "        Apply supabase/migrations/20261015120000_m6_profiles_rls_lockdown.sql" >&2
  echo "        and 20261015120100_m6_enable_rls_all_tables.sql, then re-run." >&2
  exit 1
fi

echo "RESULT: PASS - ${checked} table(s) verified, ${skipped} skipped, 0 leaks."
exit 0
