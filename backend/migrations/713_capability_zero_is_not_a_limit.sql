-- Migration: a capability of 0 is absent data, not a limit of zero
-- Description: Nulls the thickness-capability zeros that migration 701 imported
--              as asserted limits, and adds constraints so absence can never
--              again be stored as a capability. No capability VALUE is changed
--              or invented -- only 0 becomes NULL.
-- Date: 2026-09-09

-- WHY THIS EXISTS
--
-- Reported symptom: the recommended manufacturing route never changed, however
-- the scenario was edited. Standard Press was always chosen even though cheaper
-- routes were listed.
--
-- Traced to machine selection returning NO candidate for tandem_press, which
-- made that route uncostable (cycle 0) and therefore permanently ineligible for
-- selectRecommendedRoute. The engine blamed missing press_cycle_time_s -- but
-- all four USA tandem presses carry a real one (0.5 / 2 / 2.8 / 3 s). The real
-- cause is here, in capability:
--
--   mhr_records, tandem_press, USA
--     Tandem Press - 1,500kN Press Force   ms=0  ss=0  al=0  cu=0
--     Tandem Press - 3,000kN Press Force   ms=0  ss=0  al=0  cu=0
--     Tandem Press - 5,000kN Press Force   ms=0  ss=0  al=0  cu=0
--     Tandem Press - 7,000kN Press Force   ms=0  ss=0  al=0  cu=0
--
-- A 0 mm thickness limit asserts "this machine cannot process material of any
-- thickness". The fail-closed capability check (P0.7) reads that literally and
-- correctly rejects every candidate -- so the part (SECC 1.5 mm) had no capable
-- tandem press, no selected machine, no cycle time, and no eligible route.
--
-- WHERE THE ZEROS CAME FROM
--
-- sm_reference_data holds 0 for those four machines across all five materials
-- (verified directly). Absence was encoded as 0 at transcription time. Migration
-- 701 then copied it into the typed capability columns, and it guarded force but
-- not thickness:
--
--   max_thickness_ms_mm = COALESCE(m.max_thickness_ms_mm,
--                                  (srd.raw->>'max_thickness_steel_mm')::numeric),
--   ...
--   AND (srd.raw->>'press_force_kn')::numeric > 0     -- force guarded
--                                                      -- thickness NOT guarded
--
-- So the defect is not the join (701 joins on srd.key = m.benchmark_source_key,
-- an exact Category:MachineName composite -- that part is sound) and not the
-- transcription alone. It is that a real "no data" marker was imported as a real
-- limit.
--
-- WHAT THIS MIGRATION DOES, AND DELIBERATELY DOES NOT DO
--
-- Does: turns 0 into NULL on the four thickness-capability columns, so the
-- columns say "unknown" -- which is what the source actually knows -- and adds
-- CHECKs so no future import can store 0 again.
--
-- Does NOT: invent a thickness limit for those machines. NULL still fails the
-- capability check closed, so tandem_press remains unselectable until real
-- capability arrives. That is the correct outcome: a machine whose capability
-- nobody knows must not be quoted. The difference is that the system now says
-- "capability unknown" instead of asserting a false 0 mm ceiling, and the route
-- warning (press-stroke-engine.ts, same change set) now names capability rather
-- than blaming absent cycle-time data that is present.
--
-- THE REAL REMEDY FOR TANDEM, NOT DONE HERE
--
-- sm_reference_data already holds twelve NAMED tandem presses with coherent,
-- physically consistent capability -- Schuler 1150 Ton (7000 kN, ms 90),
-- United Power THD-66 High Speed (658 kN, ms 15), and ten more. Their force
-- tracks the tonnage in their own model designations within about 2 percent
-- (THD-66 = 66 t = 647 kN vs 658; SHS-166 = 1628 kN vs 1654; THD-137 = 1344 kN
-- vs 1365). None of those twelve is in mhr_records. Importing them is a
-- separate, data-complete change and needs its economics columns too, so it is
-- not bundled into this correction.

BEGIN;

-- 1. Absence is NULL, never 0.
--
-- Per column, not per row: a row can legitimately know one material and not
-- another. Standard Press - 1,500kN, for example, has ms=0 (unknown) beside
-- al=112 (real), and only the ms zero should become NULL.

UPDATE mhr_records SET max_thickness_ms_mm = NULL WHERE max_thickness_ms_mm = 0;
UPDATE mhr_records SET max_thickness_ss_mm = NULL WHERE max_thickness_ss_mm = 0;
UPDATE mhr_records SET max_thickness_al_mm = NULL WHERE max_thickness_al_mm = 0;
UPDATE mhr_records SET max_thickness_cu_mm = NULL WHERE max_thickness_cu_mm = 0;

-- Also the generic single-value thickness column, same reasoning.
UPDATE mhr_records SET max_thickness_mm = NULL WHERE max_thickness_mm = 0;

-- 2. Make it impossible to store absence as a capability again.
--
-- This is the guard migration 701 lacked. A capability column is either unknown
-- (NULL) or a real positive limit -- never 0.

ALTER TABLE mhr_records
  DROP CONSTRAINT IF EXISTS ck_mhr_thickness_capability_positive;

ALTER TABLE mhr_records
  ADD CONSTRAINT ck_mhr_thickness_capability_positive
  CHECK (
    (max_thickness_ms_mm IS NULL OR max_thickness_ms_mm > 0)
    AND (max_thickness_ss_mm IS NULL OR max_thickness_ss_mm > 0)
    AND (max_thickness_al_mm IS NULL OR max_thickness_al_mm > 0)
    AND (max_thickness_cu_mm IS NULL OR max_thickness_cu_mm > 0)
    AND (max_thickness_mm    IS NULL OR max_thickness_mm    > 0)
  );

-- 3. The physical invariant, recorded but NOT enforced against existing rows.
--
-- Aluminium is softer than mild steel, so a press that can form 90 mm of steel
-- cannot be limited to 20 mm of aluminium. One live row violates this:
--
--   standard_press / USA / "Standard Press - 3,000kN Press Force"
--     max_thickness_ms_mm = 90, max_thickness_al_mm = 20
--
-- That row is the machine currently selected and quoted for real parts, and its
-- values come from the Standard Press block of sm_reference_data, which is
-- independently suspect: within that block Schuler 1150 Ton (a 1150-tonne
-- press) carries 658 kN while United Power THD-66 (a 66-tonne press) carries
-- 20000 kN -- and those two values are exactly each other's. Twelve of twelve
-- machines shared with the Tandem Press block disagree on capability, eleven of
-- them while price AND cycle time match, which is the signature of a
-- misassignment during transcription rather than of two different machines.
--
-- The correct repair is re-transcription from the licensed source, not
-- inference: the right aluminium limit for that press is not derivable from
-- what is on file without guessing. So the constraint goes in as NOT VALID --
-- it blocks any NEW row that breaks the invariant, leaves the existing row
-- untouched and visible, and can be VALIDATEd once the block is re-imported.
ALTER TABLE mhr_records
  DROP CONSTRAINT IF EXISTS ck_mhr_aluminium_not_below_steel;

ALTER TABLE mhr_records
  ADD CONSTRAINT ck_mhr_aluminium_not_below_steel
  CHECK (
    max_thickness_al_mm IS NULL
    OR max_thickness_ms_mm IS NULL
    OR max_thickness_al_mm >= max_thickness_ms_mm
  ) NOT VALID;

COMMENT ON CONSTRAINT ck_mhr_thickness_capability_positive ON mhr_records IS
  'A thickness capability is unknown (NULL) or a real positive limit, never 0. Migration 701 imported 0 from sm_reference_data as an asserted limit, which made four USA tandem presses read as incapable of any material and silently removed the Tandem Press route from selection. Migration 713.';

COMMENT ON CONSTRAINT ck_mhr_aluminium_not_below_steel ON mhr_records IS
  'Aluminium is softer than mild steel, so its thickness limit cannot be lower. NOT VALID on purpose: one existing standard_press row (Standard Press - 3,000kN, ms 90 / al 20) violates it, and its source block is suspected misassigned. VALIDATE this constraint once that block is re-transcribed. Migration 713.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. No capability column stores 0 any more. Expected: 0.
--
--   SELECT count(*) FROM mhr_records
--    WHERE max_thickness_ms_mm = 0 OR max_thickness_ss_mm = 0
--       OR max_thickness_al_mm = 0 OR max_thickness_cu_mm = 0
--       OR max_thickness_mm = 0;
--
-- 2. The four tandem presses now say "unknown" rather than "zero".
--
--   SELECT machine_name, max_thickness_ms_mm, max_thickness_ss_mm,
--          max_thickness_al_mm, max_thickness_cu_mm
--     FROM mhr_records
--    WHERE machine_class = 'tandem_press' AND location = 'USA'
--    ORDER BY machine_name;
--
-- 3. The invariant violation is still visible and still exactly one row.
--
--   SELECT machine_class, location, machine_name,
--          max_thickness_ms_mm, max_thickness_al_mm
--     FROM mhr_records
--    WHERE max_thickness_al_mm IS NOT NULL
--      AND max_thickness_ms_mm IS NOT NULL
--      AND max_thickness_al_mm < max_thickness_ms_mm;
--
-- 4. A new row cannot reintroduce a zero (expected: constraint violation).
--
--   -- UPDATE mhr_records SET max_thickness_ms_mm = 0
--   --  WHERE machine_class = 'tandem_press' AND location = 'USA' LIMIT 1;
