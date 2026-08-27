-- ============================================================================
-- Migration 540: Drop confirmed-dead session-variable RLS policies
--
-- Phase 0 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). These policies key off
-- current_setting('app.current_user_id'/'app.user_role', true) — a Postgres
-- session GUC that NOTHING in the NestJS backend (backend/src) ever sets
-- (verified via repo-wide grep, zero hits for 'app.current_user_id' or
-- 'app.user_role' anywhere in application code). current_setting(..., true)
-- returns NULL when unset, so `user_id::text = NULL` and
-- `current_setting('app.user_role', true) = 'admin'` can never be true —
-- these are dead, not merely suspected dead.
--
-- Dropped before Phase 2 adds new org-scoped policies on the same tables
-- (boms, projects) so the next person reading pg_policies isn't misled by
-- inert leftovers layered in from database/migrations/000_consolidated_
-- production_schema.sql and 001_production_optimization.sql.
--
-- projects's "users_own_projects_v2" is the more consequential one to
-- remove: it included an unconditional admin bypass
-- (current_setting('app.user_role', true) = 'admin') with no ownership
-- check at all — also confirmed dead by the same grep, but worth calling
-- out explicitly since "dead" here means "this specific bypass never had a
-- code path that could trigger it", not "this was intentionally inert".
-- ============================================================================

DROP POLICY IF EXISTS "users_own_boms" ON boms;
DROP POLICY IF EXISTS "users_own_projects" ON projects;
DROP POLICY IF EXISTS "users_own_projects_v2" ON projects;
