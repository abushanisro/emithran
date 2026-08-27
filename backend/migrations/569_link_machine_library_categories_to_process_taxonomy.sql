-- ============================================================================
-- Migration 569: Link machine_library.json Category to the real Process
-- taxonomy for the 11 (of 15) Sheet Metal categories with an unambiguous
-- live match
--
-- Context: mhr_records imported from machine_library.json (the "clean Excel
-- pipeline" import) carry benchmark_source_key = '<category>:<machine name>'
-- (e.g. 'Bend Press Brake:Salvagnini P2X-2050') but process_route/operation
-- were never populated on ANY of the 281 rows — confirmed by a live query
-- (2026-08-24): every row across all 15 categories has process_route IS NULL
-- and operation IS NULL, regardless of whether machine_class was already
-- backfilled. That's why MHRFormDialog's Process Route/Operation dropdowns
-- came up empty when editing an existing machine_library-sourced machine —
-- there was no real data to hydrate them from, not a frontend bug.
--
-- Mapping source: a live read of process_calculator_mappings (Sheet Metal
-- group, 68 rows) cross-referenced against the 15 real machine_library.json
-- category names — not a guessed string-similarity match. For 6 of these 11
-- categories, machine_class was ALREADY backfilled (some earlier migration)
-- and is 100% consistent across every row in that category; those already-set
-- classes are trusted as-is and simply matched back to their real operation
-- row (Bend Press Brake, Deslag Machine, Fiber Laser Cutting Machine, Laser
-- Cutting Machine, Turret Press (Punch Press), Waterjet Cutting Machine). The
-- other 5 (3 Roll Bender, 4 Roll Bender, 3D Laser Cutting Machine,
-- Progressive Die Press, Laser Punch / Punch Press) had machine_class = NULL
-- but resolve unambiguously to one real, active process_calculator_mappings
-- row apiece.
--
-- Where an operation NAME is itself duplicated across routes with the SAME
-- machine_class (a known live data-quality issue — see
-- memory/sheetmetal/process/README.md's "known_duplicate_operations"), the
-- non-"Sheet Cutting" / more specific route was preferred (e.g. Laser Cutting
-- route's "Fiber Laser Cut" over Sheet Cutting's "Fiber laser Cutting";
-- Cutting route's "Waterjet Cutting" over Sheet Cutting's duplicate) — this
-- choice only affects which display string is stored, never machine_class,
-- since every duplicate pair checked shares the identical machine_class.
--
-- "Laser Punch / Punch Press" -> operation 'Laser Puch' is a live typo (the
-- correctly-spelled 'Laser Punch' row exists but is_active=false) — stored
-- as-is because it's the real, only ACTIVE row; not silently corrected here
-- since renaming a live operation string is a separate, reviewed decision.
--
-- Explicitly NOT touched (real gaps, not fabricated) — 51 machines across 4
-- categories with no live, active process_calculator_mappings row to link to:
--   2-Axis Router (9)          - live row exists but is_active=false, no machine_class
--   Cut To Length Line (8)     - no live row at all (roadmap: not_modeled)
--   Oxyfuel Cutting Machine (18) - live row exists but is_active=false, no machine_class (CLAUDE.md: "no cost engine yet")
--   Tandem Press (16)          - no live row at all currently
-- These stay process_route/operation/machine_class = NULL until a real
-- Operation is added/activated for them — a separate, deliberate decision.
-- ============================================================================

BEGIN;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = '3 Roll Bending', machine_class = COALESCE(machine_class, 'roll_forming')
WHERE benchmark_source_key LIKE '3 Roll Bender:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = '4 Roll Bending', machine_class = COALESCE(machine_class, 'roll_forming')
WHERE benchmark_source_key LIKE '4 Roll Bender:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Laser Cutting', operation = '3D Laser', machine_class = COALESCE(machine_class, 'fiber_laser')
WHERE benchmark_source_key LIKE '3D Laser Cutting Machine:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = 'Bend Brake', machine_class = COALESCE(machine_class, 'press_brake')
WHERE benchmark_source_key LIKE 'Bend Press Brake:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Finishing', operation = 'Deslag', machine_class = COALESCE(machine_class, 'deburring')
WHERE benchmark_source_key LIKE 'Deslag Machine:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Laser Cutting', operation = 'Fiber Laser Cut', machine_class = COALESCE(machine_class, 'fiber_laser')
WHERE benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Sheet Cutting', operation = 'Co2 Laser Cutting', machine_class = COALESCE(machine_class, 'co2_laser')
WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = 'Laser Puch', machine_class = COALESCE(machine_class, 'turret_punch')
WHERE benchmark_source_key LIKE 'Laser Punch / Punch Press:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = 'Progressive die', machine_class = COALESCE(machine_class, 'press_brake')
WHERE benchmark_source_key LIKE 'Progressive Die Press:%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Bending/Floating /Forming', operation = 'Turret Press', machine_class = COALESCE(machine_class, 'turret_punch')
WHERE benchmark_source_key LIKE 'Turret Press (Punch Press):%' AND process_route IS NULL;

UPDATE mhr_records SET process_route = 'Cutting', operation = 'Waterjet Cutting', machine_class = COALESCE(machine_class, 'waterjet')
WHERE benchmark_source_key LIKE 'Waterjet Cutting Machine:%' AND process_route IS NULL;

COMMIT;
