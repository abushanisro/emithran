-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 372: Fix process_cost_records rows where process_group was corrupted
-- to hold a machine_class value (e.g. "Group: fiber_laser" instead of "Sheet Metal")
--
-- Root cause: app/(dashboard)/projects/[id]/bom/[bomId]/items/[itemId]/
-- manufacturing-intelligence/page.tsx had two call sites (handleOpenEditProc's
-- dialog prefill, and the bulk auto-save-all-lines flow) that set:
--   processGroup: line.machineClass || line.process
-- i.e. it stored the AI cost engine's machine_class key ('fiber_laser') directly
-- as the process_group, instead of deriving the real domain group ('Sheet Metal').
-- That has now been fixed in the frontend (both sites use
-- deriveProcessGroupFromMachineClass(line.machineClass) instead).
--
-- This migration is the one-time data catch-up: any existing process_cost_records
-- row whose process_group is actually one of our known machine_class slugs is
-- unambiguously corrupted (process_group should NEVER equal a machine_class value
-- — they are different columns in different tables with different vocabularies),
-- so it's safe to detect and repair precisely, no guessing required.
--
-- Idempotent: scoped to rows currently matching a known machine_class value; once
-- repaired, process_group holds a real group name and no longer matches, so
-- re-running this migration is a no-op.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Repair + diagnostic (repair happens inside the same PL/pgSQL block as the
-- GET DIAGNOSTICS call so the row count is actually captured — a bare UPDATE
-- followed by a separate DO block would not see its row count) ────────────────
DO $$
DECLARE
  repaired_count INTEGER;
  still_unmatched INTEGER;
BEGIN
  UPDATE process_cost_records
  SET process_group = CASE
    WHEN process_group IN ('fiber_laser','co2_laser','plasma','waterjet','press_brake','turret_punch','roll_forming','deep_draw','band_saw')
      THEN 'Sheet Metal'
    WHEN process_group IN ('cnc_lathe','cnc_lathe_live','cnc_mill_turn','cnc_3ax_vmc','cnc_4ax_vmc','cnc_5ax_mc','grinding','drill_press','tapping','edm')
      THEN 'Machining'
    WHEN process_group IN ('welding','manual_assembly','adhesive_bonding','electrical_assembly')
      THEN 'Assembly'
    WHEN process_group IN ('cmm','ndt_test','heat_treat_furnace','anodize','powder_coat','plating','chem_treatment','laser_marking','deburring')
      THEN 'Post Processing'
    WHEN process_group IN ('injection_molding','thermoforming','blow_molding','extrusion','rotational_molding','rubber_molding','compression_molding')
      THEN 'Plastic & Rubber'
    ELSE process_group
  END
  WHERE process_group IN (
    'fiber_laser','co2_laser','plasma','waterjet','press_brake','turret_punch','roll_forming','deep_draw','band_saw',
    'cnc_lathe','cnc_lathe_live','cnc_mill_turn','cnc_3ax_vmc','cnc_4ax_vmc','cnc_5ax_mc','grinding','drill_press','tapping','edm',
    'welding','manual_assembly','adhesive_bonding','electrical_assembly',
    'cmm','ndt_test','heat_treat_furnace','anodize','powder_coat','plating','chem_treatment','laser_marking','deburring',
    'injection_molding','thermoforming','blow_molding','extrusion','rotational_molding','rubber_molding','compression_molding'
  );

  GET DIAGNOSTICS repaired_count = ROW_COUNT;

  -- Diagnostic (non-fatal): confirms how many rows were repaired and whether the
  -- corresponding (processGroup, processRoute, operation) triple now resolves to a
  -- real process_calculator_mappings row (if not, the operation/route string itself
  -- is still an AI-engine label like "Laser Cutting" that doesn't match a specific
  -- manual-hierarchy operation like "Fiber Laser Cut" — expected for some legacy
  -- rows; use "Re-select from hierarchy" in the dialog to pick the exact operation)
  SELECT COUNT(*) INTO still_unmatched
  FROM process_cost_records pcr
  WHERE pcr.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM process_calculator_mappings m
      WHERE m.process_group = pcr.process_group
        AND m.process_route = pcr.process_route
        AND m.operation = pcr.operation
    );

  RAISE NOTICE
    'Migration 372: repaired % row(s) with a machine_class stored as process_group. % active row(s) still have no exact (group/route/operation) match in process_calculator_mappings — use "Re-select from hierarchy" in the dialog for those.',
    repaired_count, still_unmatched;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, process_group, process_route, operation FROM process_cost_records
-- WHERE process_group IN ('fiber_laser','press_brake','cnc_3ax_vmc' /* etc */);
-- Expected: 0 rows.
