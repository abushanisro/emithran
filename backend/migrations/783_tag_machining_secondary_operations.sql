-- ============================================================================
-- Migration 783: Tag the 7 real, wired Machining secondary-operation
-- process_taxonomy rows with machining_route_role = 'secondary_operation'
-- (Phase 2 of the Machining re-architecture plan, Section H.3)
-- ============================================================================
-- These 7 real station categories already have their own dedicated,
-- tested cost functions in cost-cnc-engine.ts (computeJigBoreLine,
-- computeDeepHoleLine [Gun Drill + Deep Bore Machine], computeCylindrical
-- GrindingLine, computeInternalGrindingLine, computeJigGrindLine,
-- computeKeywayBroachingLine [Broach]) and their own dedicated MHRRateInput
-- field + MHR_RATE_MACHINE_CLASSES entry — confirmed live in this worktree's
-- committed history, not the concurrent peer session's uncommitted work.
--
-- This is purely additive metadata for discovery/reporting completeness
-- (Section G.8 of the plan): these classes do NOT need machining_route_role
-- for their own rate resolution (each already resolves via its own named
-- field, independent of any role-based discovery query) — this only lets
-- a future "list all real secondary Machining operations" query work off
-- process_taxonomy the same way primary_milling/primary_turning/inspection
-- already do. No cost/routing/capability behavior changes as a result of
-- this migration.
--
-- Idempotent: every UPDATE re-derives the same result on rerun.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

UPDATE process_taxonomy SET machining_route_role = 'secondary_operation'
 WHERE process_group = 'Machining' AND process_name IN (
   'Gun Drill', 'Deep Bore Machine', 'Cylindrical Grinder',
   'Jig Bore', 'Jig Grind', 'Internal Grinder', 'Broach'
 );

COMMIT;

-- Verification (run manually after):
-- SELECT machining_route_role, count(*), array_agg(process_name ORDER BY process_name)
-- FROM process_taxonomy WHERE process_group = 'Machining' GROUP BY machining_route_role;
-- Expect: primary_milling=3, primary_turning=5, inspection=2, secondary_operation=7, NULL=26.
