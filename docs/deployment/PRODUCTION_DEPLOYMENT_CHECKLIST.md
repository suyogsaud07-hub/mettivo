# METTIVO Production Deployment Safety Checklist

**Status:** NOT READY FOR PRODUCTION DEPLOYMENT  
**Last Updated:** 2026-11-02  
**Required:** ALL items must be checked before production migration execution

## 1. Identity Verification
- [ ] Production project confirmed: `jnbrgxxwmgotuqejghrw` (dating-platform-db)
- [ ] Staging project confirmed: `eiqgdwcmutzwxrdtjxab` (mettivo-staging)
- [ ] CLI linked to correct project for the operation
- [ ] Environment files verified (production/staging separated)
- [ ] No accidental fallback to production credentials

## 2. Schema & Migration Readiness
- [ ] Current production schema snapshot reviewed
- [ ] Migration history from `supabase_migrations.schema_migrations` inspected
- [ ] M34-M41 compatibility verified against production schema
- [ ] All migrations present in `supabase/apply_all.sql` in correct order
- [ ] apply_all.sql tested on clean DB and live-shaped DB
- [ ] Migration idempotency verified

## 3. Backup & Recovery (MANDATORY)
- [ ] Recent recoverable backup exists for production database
- [ ] Backup/PITR window verified and documented
- [ ] Restoration procedure tested or documented with evidence
- [ ] Recovery time objective (RTO) established
- [ ] Rollback plan documented
- [ ] **Backup reference ID/timestamp recorded**: _____

## 4. Staging Validation
- [ ] Staging deployed and tested
- [ ] Migrations applied successfully to staging
- [ ] Messaging tests pass on staging
- [ ] Blocking/history retention tests pass
- [ ] RLS/security tests pass
- [ ] Application smoke tests pass

## 5. Security & Testing
- [ ] All tests pass (956/956)
- [ ] TypeScript compilation passes
- [ ] Build succeeds
- [ ] RLS policies verified
- [ ] RPC permissions reviewed
- [ ] No secrets in repository

## 6. Approval & Execution
- [ ] Deployment plan reviewed
- [ ] Explicit human approval obtained
- [ ] Deployment operator identified: _____
- [ ] Execution time logged: _____
- [ ] Post-deployment validation completed
- [ ] Evidence recorded in deployment evidence log

**BLOCKER:** Do not proceed if any item is unchecked. Production deployment requires ALL items checked with evidence.
