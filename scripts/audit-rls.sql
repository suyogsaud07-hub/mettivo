-- =============================================================================
-- scripts/audit-rls.sql — READ-ONLY Row Level Security diagnostic
-- =============================================================================
-- Paste into the Supabase SQL Editor. Creates nothing, changes nothing.
-- Use this before and after applying the M6 migrations to see the exact posture.
-- =============================================================================

-- 1. Is RLS on, and how many policies does each table have?
select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  c.relforcerowsecurity                       as rls_forced,
  count(p.policyname)                         as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
       on p.schemaname = 'public'
      and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relrowsecurity asc, c.relname;

-- 2. Every policy in detail. `roles` is the key column: if it contains `anon`
--    or `public`, anonymous visitors are affected by that policy.
select
  tablename,
  policyname,
  cmd                                          as command,
  array_to_string(roles, ',')                  as applies_to_roles,
  coalesce(qual, '-')                          as using_expression,
  coalesce(with_check, '-')                    as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 3. RED FLAGS — policies that grant access to anonymous visitors.
select
  tablename,
  policyname,
  cmd,
  array_to_string(roles, ',') as applies_to_roles
from pg_policies
where schemaname = 'public'
  and (roles && array['anon','public']::name[])
order by tablename, cmd;

-- 4. Broken policy shapes: an INSERT policy can never carry an expression.
--    If `with_check_expression` is '-' on an INSERT policy, inserts are not
--    actually gated.
select tablename, policyname, cmd, coalesce(with_check, '-') as with_check_expression
from pg_policies
where schemaname = 'public'
  and cmd = 'INSERT'
  and with_check is null
order by tablename, policyname;
