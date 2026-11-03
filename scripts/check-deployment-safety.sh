#!/usr/bin/env bash
# METTIVO Deployment Safety Check
# Prevents accidental production deployment without verification

set -euo pipefail

echo "=== METTIVO DEPLOYMENT SAFETY CHECK ==="

# Check for production project reference
if grep -q "jnbrgxxwmgotuqejghrw" .env.local 2>/dev/null; then
    echo "WARNING: .env.local references PRODUCTION project"
fi

# Check for staging
if grep -q "eiqgdwcmutzwxrdtjxab" .env.staging.local 2>/dev/null; then
    echo "OK: .env.staging.local references STAGING project"
fi

# Verify apply_all.sql exists
if [ -f "supabase/apply_all.sql" ]; then
    echo "OK: apply_all.sql exists"
else
    echo "ERROR: apply_all.sql missing"
    exit 1
fi

# Check git status
if [ -n "$(git diff --name-only)" ]; then
    echo "INFO: Uncommitted changes present"
fi

echo "=== SAFETY CHECK COMPLETE ==="
echo "REMINDER: Production deployment requires manual approval and checklist completion"
