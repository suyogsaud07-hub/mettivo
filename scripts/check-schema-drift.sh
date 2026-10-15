#!/usr/bin/env bash
#
# scripts/check-schema-drift.sh — is the live project's schema the schema our
# migrations describe?
#
# WHY: migrations in this project are pasted into the Supabase SQL Editor by
# hand, so the repository and the live database can disagree indefinitely
# (RISK_REGISTER.md R-02). That is exactly how `likes` ended up missing and the
# onboarding wizard's nine columns ended up absent while every local test passed.
#
# HOW: the expected schema is DERIVED FROM THE MIGRATION FILES, not hard-coded,
# so this script cannot itself drift. Each expectation is then probed
# read-only over PostgREST.
#
# PRIVACY: probes use `limit=0`, which asks PostgREST to validate a table or
# column and return NO rows. No personal data is ever fetched, printed or
# stored. Only HTTP status codes are inspected.
#
# Usage:
#   ./scripts/check-schema-drift.sh          # human-readable
#   ./scripts/check-schema-drift.sh --quiet  # exit status only
#
# Exits 0 when the live schema matches, 1 on drift, 2 on misconfiguration.
#
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

if [[ -z "$SUPABASE_URL" || -z "$ANON_KEY" ]]; then
  ENV_FILE="$ROOT_DIR/.env.local"
  if [[ -f "$ENV_FILE" ]]; then
    [[ -z "$SUPABASE_URL" ]] && SUPABASE_URL="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
    [[ -z "$ANON_KEY" ]] && ANON_KEY="$(grep -E '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')"
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

# ---------------------------------------------------------------------------
# 1. Derive the expected schema from the migration files.
# ---------------------------------------------------------------------------
# `create table if not exists public.x ( ... )` gives the table list.
# `alter table public.x add column if not exists y` gives table-column pairs.
# `mapfile` is bash 4+; macOS ships bash 3.2, so collect with a read loop.
EXPECTED_TABLES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && EXPECTED_TABLES+=("$line")
done < <(
  grep -rhoE 'create table if not exists public\.[a-z_]+' "$MIGRATIONS_DIR" \
    | sed -E 's/.*public\.//' | sort -u
)

EXPECTED_COLUMNS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && EXPECTED_COLUMNS+=("$line")
done < <(
  grep -rhoE 'alter table public\.[a-z_]+ +add column if not exists [a-z_]+' "$MIGRATIONS_DIR" \
    | sed -E 's/alter table public\.([a-z_]+) +add column if not exists ([a-z_]+)/\1 \2/' \
    | sort -u
)

if [[ "${#EXPECTED_TABLES[@]}" -eq 0 ]]; then
  echo "ERROR: no tables found in $MIGRATIONS_DIR — is the path right?" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# 2. Probe.
# ---------------------------------------------------------------------------
drift=0
checked=0

probe() {
  # $1 = table, $2 = optional column. Prints the HTTP status code.
  local table="$1" column="${2:-}"
  local select_clause="select=*"
  [[ -n "$column" ]] && select_clause="select=${column}"

  curl -s -o /dev/null -w '%{http_code}' -X GET \
    "${SUPABASE_URL}/rest/v1/${table}?${select_clause}&limit=0" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    --max-time 20 2>/dev/null
}

if [[ "$QUIET" -eq 0 ]]; then
  echo
  echo "Schema drift check — does the live project match supabase/migrations/?"
  echo "project: ${SUPABASE_URL}"
  echo
  echo "Tables (${#EXPECTED_TABLES[@]} expected)"
fi

for table in "${EXPECTED_TABLES[@]}"; do
  code="$(probe "$table")"
  checked=$((checked + 1))
  case "$code" in
    200)
      [[ "$QUIET" -eq 0 ]] && printf '  %-22s OK\n' "$table"
      ;;
    404)
      printf '  %-22s MISSING — table does not exist on the live project\n' "$table"
      drift=$((drift + 1))
      ;;
    401|403)
      # RLS/privilege denial still proves the table exists.
      [[ "$QUIET" -eq 0 ]] && printf '  %-22s OK (access denied, but present)\n' "$table"
      ;;
    000|"")
      printf '  %-22s UNREACHABLE — no response from Supabase\n' "$table"
      drift=$((drift + 1))
      ;;
    *)
      printf '  %-22s UNEXPECTED HTTP %s\n' "$table" "$code"
      drift=$((drift + 1))
      ;;
  esac
done

if [[ "${#EXPECTED_COLUMNS[@]}" -gt 0 && "$QUIET" -eq 0 ]]; then
  echo
  echo "Columns added by migrations (${#EXPECTED_COLUMNS[@]} expected)"
fi

for entry in "${EXPECTED_COLUMNS[@]}"; do
  table="${entry%% *}"
  column="${entry##* }"
  # Skip when the table itself is already reported missing.
  table_code="$(probe "$table")"
  if [[ "$table_code" == "404" ]]; then
    [[ "$QUIET" -eq 0 ]] && printf '  %-22s %-22s SKIP (table missing)\n' "$table" "$column"
    continue
  fi

  code="$(probe "$table" "$column")"
  checked=$((checked + 1))
  if [[ "$code" == "200" || "$code" == "401" || "$code" == "403" ]]; then
    [[ "$QUIET" -eq 0 ]] && printf '  %-22s %-22s OK\n' "$table" "$column"
  else
    printf '  %-22s %-22s MISSING (HTTP %s)\n' "$table" "$column" "$code"
    drift=$((drift + 1))
  fi
done

# ---------------------------------------------------------------------------
# 3. Functions the UI calls.
# ---------------------------------------------------------------------------
# A table existing proves nothing about the RPCs that operate on it. These are
# probed as an anonymous caller with the argument names the client actually
# sends. NOTE: PostgREST answers 404 both for "no such function" and for "no
# overload matching these arguments", so the payloads below must carry every
# REQUIRED argument name or a healthy function looks missing.
RPC_ZERO="00000000-0000-0000-0000-000000000000"

rpc_probe() {
  # $1 = function name, $2 = JSON body
  curl -s -o /dev/null -w '%{http_code}' -X POST \
    "${SUPABASE_URL}/rest/v1/rpc/$1" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$2" --max-time 20 2>/dev/null
}

RPC_SPECS=(
  "discover_profiles|{}"
  "unread_counts|{}"
  "admin_report_queue|{}"
  "export_my_data|{}"
  "delete_my_account|{}"
  "is_moderator|{}"
  # M15 revokes profiles.birth_date at the column level and exposes the caller's
  # own value through this accessor. It creates no table or column, so without a
  # probe here an unapplied privilege migration would be invisible to this check.
  "my_birth_date|{}"
  "block_member|{\"p_target\":\"${RPC_ZERO}\"}"
  "unblock_member|{\"p_target\":\"${RPC_ZERO}\"}"
  "unmatch_member|{\"p_target\":\"${RPC_ZERO}\"}"
  "is_blocked_pair|{\"a\":\"${RPC_ZERO}\",\"b\":\"${RPC_ZERO}\"}"
  "record_like|{\"target_user\":\"${RPC_ZERO}\",\"is_like_value\":true}"
  "mark_conversation_read|{\"p_match_id\":\"${RPC_ZERO}\"}"
  "admin_resolve_report|{\"p_report_id\":\"${RPC_ZERO}\",\"p_status\":\"dismissed\"}"
  # M21 — universal moderation. `file_report` is the client entry point; the
  # predicates are what every surface reads to show a restriction notice. All are
  # granted to `authenticated` only, so an anonymous caller must be refused.
  "file_report|{\"p_target_user\":\"${RPC_ZERO}\",\"p_category\":\"harassment\"}"
  "my_restrictions|{}"
  "is_chat_restricted|{\"p_user\":\"${RPC_ZERO}\"}"
  "is_video_restricted|{\"p_user\":\"${RPC_ZERO}\"}"
  "admin_apply_moderation_action|{\"p_target_user\":\"${RPC_ZERO}\",\"p_category\":\"harassment\",\"p_scope\":\"chat\"}"
  # Worker RPCs are reachable with the public anon key but gated on the shared
  # worker secret, so the probe's wrong secret must be refused (403). A 404 here
  # would mean the enforcement loop's server side is missing; a 200 would mean
  # the secret gate is broken.
  "claim_moderation_scans|{\"p_secret\":\"probe\"}"
  "claim_moderation_emails|{\"p_secret\":\"probe\"}"
)

if [[ "$QUIET" -eq 0 ]]; then
  echo
  echo "RPCs the UI calls (${#RPC_SPECS[@]} expected)"
fi

for spec in "${RPC_SPECS[@]}"; do
  fn="${spec%%|*}"
  body="${spec#*|}"
  code="$(rpc_probe "$fn" "$body")"
  checked=$((checked + 1))
  case "$code" in
    404)
      printf '  %-24s MISSING — function does not exist (or has different argument names)\n' "$fn"
      drift=$((drift + 1))
      ;;
    401|403)
      # Present and correctly refusing an anonymous caller.
      [[ "$QUIET" -eq 0 ]] && printf '  %-24s OK (anon refused, HTTP %s)\n' "$fn" "$code"
      ;;
    000|"")
      printf '  %-24s UNREACHABLE — no response from Supabase\n' "$fn"
      drift=$((drift + 1))
      ;;
    200)
      # A privileged RPC answering an anonymous caller is a security defect.
      printf '  %-24s !! CALLABLE BY ANON — expected a refusal\n' "$fn"
      drift=$((drift + 1))
      ;;
    *)
      printf '  %-24s present (HTTP %s)\n' "$fn" "$code"
      ;;
  esac
done

echo
if [[ "$drift" -gt 0 ]]; then
  echo "RESULT: DRIFT — ${drift} expectation(s) missing, ${checked} checked." >&2
  echo "        Apply, in filename order:" >&2
  ls -1 "$MIGRATIONS_DIR"/*.sql | sed 's|.*/|          |' >&2
  echo "        Then re-run: ./scripts/check-schema-drift.sh && ./scripts/verify-rls.sh" >&2
  exit 1
fi

echo "RESULT: IN SYNC — ${checked} expectations verified, 0 missing."
exit 0
