-- Migration: Sheet Metal catalog duplicate + 2-Axis Router machine_class wiring
-- Description: Closes the two defects found while auditing all 24 live Sheet
--              Metal operations that are genuinely defects. Deactivates one
--              true duplicate catalog row, and wires machine_class on the
--              2-Axis Router machines so they are capability-checked instead of
--              reached only by keyword. No capability VALUE is invented.
-- Date: 2026-09-09

-- WHAT WAS AUDITED
--
-- All 24 active Sheet Metal rows in process_calculator_mappings, plus the
-- machine rows behind them, were compared against
-- memory/sheetmetal/process/structured/process_routes.json.
--
-- That file is NOT treated as authoritative here, and this migration does not
-- follow its is_active flags. Its own header says it is a best-effort UI
-- export captured 2026-08-22 whose op count does not reconcile to the page it
-- came from. Those flags are stale for every process that shipped after that
-- date -- the file marks Std Press, Tandem Press, Turret Press, OxyFuel Cut,
-- Plasma Cut and Shearing inactive, all of which migrations 608 and 697-702
-- activated on purpose when their real cost engines landed. Following it would
-- have deactivated most of the working sheet-metal routing.
--
-- So only claims corroborated INDEPENDENTLY of that snapshot are acted on here.

BEGIN;

-- 1. One genuine duplicate: Waterjet Cutting exists twice.
--
-- Two active rows, identical machine_class (waterjet) AND identical
-- calculator_id (37a8bb8c-...), differing only in process_route:
--
--   route "Cutting"        created 2026-06-13   <- keep
--   route "Sheet Cutting"  created 2026-06-15   <- duplicate
--
-- Same class plus same calculator means these cannot produce different costing
-- behaviour; the second is a redundant offer of the same operation. This is
-- corroborated independently of the snapshot is_active flags: the duplication
-- is visible in the live table itself, and this specific pair was already
-- recorded as a known duplicate when the taxonomy was built.
--
-- Deactivated, not deleted: the row may carry history, and deactivating is
-- reversible. Deactivating is always permitted by chk_machine_class_required.

UPDATE process_calculator_mappings
   SET is_active = false,
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND operation = 'Waterjet Cutting'
   AND process_route = 'Sheet Cutting'
   AND is_active = true;

-- 2. Wire machine_class on the 2-Axis Router machines.
--
-- All 45 mhr_records rows whose benchmark_source_key starts "2-Axis Router:"
-- (9 of them USA) carry machine_class = NULL. The consequence is not that the
-- router is absent from quoting -- it is worse than that. Capability-based
-- machine selection filters on machine_class and so finds no candidate, while
-- MHR rate resolution matches these rows by keyword instead
-- (default-rates.constants.ts, router_2axis.machineClassKeywords =
-- 2-Axis Router / 2 Axis Router). The sm-router route therefore quotes
-- "2 Axis Router - 18,000 RPM" at a real 20.95 per hour having never passed a
-- capability check.
--
-- The class name is not guessed. Three independent sources agree:
--   - process_calculator_mappings already maps operation "2 Axis Router" to
--     machine_class router_2axis;
--   - default-rates.constants.ts registers router_2axis with exactly the two
--     keywords above;
--   - already-wired sibling rows in this same table establish the convention
--     "N Axis Router" -> n_axis_router (3 Axis Router -> 3_axis_router,
--     5 Axis Router -> 5_axis_router).

UPDATE mhr_records
   SET machine_class = 'router_2axis'
 WHERE machine_class IS NULL
   AND benchmark_source_key LIKE '2-Axis Router:%';

-- 3. Import the router capability that genuinely exists, and only that.
--
-- sm_reference_data holds real bed dimensions for all 9 USA routers
-- (bed_length_mm / bed_width_mm / bed_height_mm) plus max_rpm_rev_min and
-- machine_power_kw. It holds NO thickness field of any kind for this category
-- -- verified across all 9 keys: the union of their fields contains no
-- thickness key at all.
--
-- So thickness stays NULL, and no thickness limit is asserted for these
-- machines. Wiring the class does not by itself make the router quote
-- correctly; what it fixes is that machine selection now evaluates these rows
-- at all, instead of the route inheriting a machine name purely from keyword
-- rate resolution with no capability step. The thickness gap stays real and
-- reported rather than inferred.
--
-- Separately and independently, sm_lookup_router_cut covers only the Aluminum
-- and Copper families (8 rows, all 350.52 m/min), so a steel part has no
-- router cutting speed either -- which is why sm-router reports a cycle of 0
-- and stays dataComplete=false for the SECC parts in this deployment. Both
-- gaps are real and reported; neither is filled by inference.

UPDATE mhr_records m
   SET max_x_mm  = COALESCE(m.max_x_mm, (srd.raw->>'bed_length_mm')::numeric),
       max_y_mm  = COALESCE(m.max_y_mm, (srd.raw->>'bed_width_mm')::numeric),
       max_z_mm  = COALESCE(m.max_z_mm, (srd.raw->>'bed_height_mm')::numeric),
       capability_source = COALESCE(m.capability_source, 'imported')
  FROM sm_reference_data srd
 WHERE srd.key = m.benchmark_source_key
   AND srd.category = 'machine'
   AND m.machine_class = 'router_2axis'
   AND srd.key LIKE '2-Axis Router:%'
   AND (srd.raw->>'bed_length_mm') IS NOT NULL
   AND (srd.raw->>'bed_length_mm')::numeric > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- DELIBERATELY NOT DONE, AND WHY
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A. Material Stock / No Cost Feature are NOT deactivated.
--
-- Both are active with machine_class = NULL, which looks like a defect and was
-- first written up here as one, on the strength of migration 608 stating that
-- chk_machine_class_required requires a non-NULL machine_class on any active
-- row. That statement is an oversimplification: the constraint has FOUR named
-- exemptions (migration 369, extended by 617), and migration 617 added
-- process_route = 'Material Usage' specifically for these two rows and
-- activated them on purpose, recording that they are
--
--   "a non-machine routing/material marker, zero cost by design ... the exact
--    same kind of thing as the 'Raw Material' exemption ... a missing
--    exemption, not a reason to fabricate a fake machine_class"
--
-- So their current state is correct by design. Deactivating them would revert
-- 617, and redefining the constraint without its exemptions would break the
-- Raw Material, Packing & Delivery and General/General rows it protects.
--
-- B. The 24 unwired press rows are NOT wired.
--
-- The same NULL-machine_class audit surfaced 12 "Tandem Press" and 12
-- "Progressive die" rows -- the real named machines, Schuler 1150 Ton, United
-- Power THD-66 High Speed and so on -- also carrying machine_class = NULL.
-- Those are NOT wired here, because migration 608 records that as an explicit
-- user decision rather than an oversight:
--
--   "Per explicit user decision, these 12 machines are EXCLUDED from this
--    migration entirely -- no machine_class assigned, no physics backfilled --
--    until the duplicate rows and contradictory specs are reconciled against
--    the original source screenshots."
--
-- Reversing that needs the same explicit decision, so it stays untouched. Two
-- findings worth recording for when that decision is revisited, since both
-- narrow the original concern:
--
--   a) The contradiction is in the STANDARD Press block, not the Tandem Press
--      block. The Tandem Press entries are internally coherent -- for example
--      Tandem Press:Schuler 1150 Ton is press_force_kn 7000 with steel 90 mm
--      and aluminium 112 mm, and THD-66 is 658 kN with steel 15 / aluminium 19.
--      Aluminium sits above steel in every case, which is the physical
--      invariant ck_mhr_aluminium_not_below_steel encodes and which the one
--      violating standard_press row breaks.
--   b) Migration 713 states in its header that these twelve machines are absent
--      from mhr_records. That was wrong, and this audit corrected it -- they
--      are present, with real rates and real benchmark_source_keys. They were
--      invisible to a machine_class query precisely because the class is NULL.
--      The outstanding work is wiring plus capability import, not import of
--      missing rows.
--
-- C. No CO2 laser cutting data is seeded.
--
-- sm-co2-laser reports a cycle of 0 and stays dataComplete=false. That is
-- correct by design, not a defect to close here: migration 457 added the
-- laser_technology axis to sm_lookup_laser_cut and deliberately seeded ZERO
-- co2 rows, having found no published CO2 cutting-speed table meeting the
-- sourcing bar. The accompanying code change makes the route report that
-- recorded gap instead of blaming a phantom resolver bug.

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. Waterjet Cutting is offered exactly once. Expected: 1 row, route Cutting.
--
--   SELECT operation, process_route, is_active FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation = 'Waterjet Cutting'
--      AND is_active = true;
--
-- 2. The router rows are classed, with real bed dims and still-NULL thickness.
--    Expected: 9 USA rows, max_x_mm/max_y_mm populated, all thickness NULL.
--
--   SELECT machine_name, machine_class, max_x_mm, max_y_mm, max_z_mm,
--          max_thickness_ms_mm, max_thickness_al_mm
--     FROM mhr_records
--    WHERE machine_class = 'router_2axis' AND location = 'USA'
--    ORDER BY machine_name;
--
-- 3. The press exclusion is intact and only the router left the NULL set.
--    Expected: 12 Tandem Press, 12 Progressive die, 8 NULL-operation CTL rows,
--    and NO "2 Axis Router" rows.
--
--   SELECT operation, count(*) FROM mhr_records
--    WHERE machine_class IS NULL AND location = 'USA'
--    GROUP BY operation ORDER BY operation;
--
-- 4. The constraint still carries all four exemptions (unchanged by this
--    migration -- confirm it was not touched).
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'chk_machine_class_required';
