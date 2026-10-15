#!/usr/bin/env bash
#
# scripts/build-apply-all.sh — regenerate supabase/apply_all.sql
#
# The single file an operator pastes into the Supabase SQL Editor. Generating it
# rather than maintaining a copy by hand means the bundle cannot drift from
# `supabase/migrations/`, which stays authoritative.
#
# Usage:
#   npm run build:apply-all
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
OUT="$ROOT_DIR/supabase/apply_all.sql"

if ! ls -1 "$MIGRATIONS_DIR"/*.sql >/dev/null 2>&1; then
  echo "ERROR: no .sql files in $MIGRATIONS_DIR" >&2
  exit 1
fi

{
  echo "-- ============================================================================="
  echo "-- Mettivo — complete database bootstrap, in order."
  echo "-- ============================================================================="
  echo "-- PASTE THIS ENTIRE FILE into the Supabase SQL Editor and press Run."
  echo "-- Then press Run a SECOND time to prove idempotency (it must be a no-op)."
  echo "--"
  echo "-- GENERATED FILE — do not edit by hand. \`supabase/migrations/\` is authoritative."
  echo "-- Regenerate with: npm run build:apply-all"
  echo "--"
  echo "-- Verified by tests/database/apply_all.test.ts: applies cleanly in one pass,"
  echo "-- re-applies as a no-op, and leaves every personal-data table unreadable by"
  echo "-- an anonymous caller."
  echo "-- ============================================================================="
  echo

  # Sorted by filename: the migration order IS the timestamp order.
  while IFS= read -r file; do
    echo "-- ############################################################################"
    echo "-- # $(basename "$file")"
    echo "-- ############################################################################"
    echo
    cat "$file"
    echo
    echo
  done < <(ls -1 "$MIGRATIONS_DIR"/*.sql | sort)
} > "$OUT"

echo "wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
