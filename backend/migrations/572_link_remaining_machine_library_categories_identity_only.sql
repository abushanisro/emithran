-- ============================================================================
-- Migration 572: Link process_route/operation (identity only, NOT
-- machine_class) for the 3 of 4 remaining gap categories that DO have a real
-- (if inactive) process_calculator_mappings row
--
-- Migration 569 deliberately skipped 4 categories as "real gaps" because
-- their process_calculator_mappings row (where one existed at all) was
-- is_active=false with machine_class=NULL — no real cost engine backs them,
-- so 569 didn't want to fabricate a Machine Class badge that implies real
-- costing support. That reasoning still holds for machine_class. But it
-- conflated two separate things: "this process has no real cost engine yet"
-- (true) vs. "this MHR record's Process Route/Operation dropdowns should
-- stay blank" (not required to follow from the first). A live query
-- (2026-08-25) confirms 3 of those 4 categories DO have a real, existing
-- process_calculator_mappings row — just inactive:
--   2 Axis Router  (Cutting)                  -- 9 machines
--   OxyFuel Cut    (Cutting)                   -- 18 machines
--   Tandem Press   (Bending/Floating /Forming) -- 16 machines
-- Only "Cut To Length Line" has no row at all (confirmed, still a true gap
-- with nothing to link).
--
-- This migration ONLY sets process_route/operation (so MHRFormDialog's
-- dropdowns show the real, correct selection instead of blank) — it
-- deliberately does NOT set machine_class and does NOT flip is_active on the
-- process_calculator_mappings rows. Those two remain a separate, later
-- decision: is_active governs whether this operation is offered as a real
-- quoting route across the WHOLE app (route comparison, other MHR records'
-- Operation picker, etc.), and machine_class implies a registered, real
-- ManufacturingProcessEngine exists to cost it — neither is true yet for
-- CNC routing or oxyfuel cutting (CLAUDE.md: "Plasma, Oxyfuel (no cost
-- engine yet)"; CNC Router isn't in the roadmap at all). Flipping either
-- flag now would make these processes appear real for quoting everywhere in
-- the app, not just this dialog — a materially bigger, separate decision.
-- ============================================================================

BEGIN;

UPDATE mhr_records
SET process_route = 'Cutting', operation = '2 Axis Router'
WHERE benchmark_source_key LIKE '2-Axis Router:%' AND process_route IS NULL;

UPDATE mhr_records
SET process_route = 'Cutting', operation = 'OxyFuel Cut'
WHERE benchmark_source_key LIKE 'Oxyfuel Cutting Machine:%' AND process_route IS NULL;

UPDATE mhr_records
SET process_route = 'Bending/Floating /Forming', operation = 'Tandem Press'
WHERE benchmark_source_key LIKE 'Tandem Press:%' AND process_route IS NULL;

COMMIT;
