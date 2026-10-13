-- ============================================================================
-- Migration 903: CT Scan and Xray Inspection time per part
-- Purpose: both processes had machines and rates but no inspection time, so
--          they were always a gap. The Countries data export lists
--          constantInspectTimeMins and inspectTimeMinsPerWeight for them,
--          with identical values in all 14 files, so they are not regional.
--          Stored on the machine row specs and read by the secondary engine.
-- Sources: memory/Countries data/*_XML_Data_.csv, rows named Default:
--            CT Scan          constant 1 min, 0.02 min per kg
--            Xray Inspection  constant 3 min, 0.2 min per kg
--          A second Xray row named XrayMachine (2 min, 0.04 per kg) has no
--          machine of that name in memory/Secondary process, so it is not used.
-- Units: the export states none. Weight is taken as kg, the unit of the
--        staged part weight, as confirmed by the owner on 2026-10-14.
-- Run once in the SQL editor. Aborts if a machine row is missing.
-- ============================================================================
DO $$
DECLARE
  n INT;
BEGIN
  UPDATE mhr_records
     SET specs = specs || jsonb_build_object(
           'constant_inspect_time_min', 1,
           'inspect_time_min_per_kg', 0.02,
           'inspect_time_source', 'memory/Countries data CT Scan Default; weight unit taken as kg')
   WHERE machine_class = 'ct_scan' AND machine_name = 'Default';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'no ct_scan machine named Default'; END IF;

  UPDATE mhr_records
     SET specs = specs || jsonb_build_object(
           'constant_inspect_time_min', 3,
           'inspect_time_min_per_kg', 0.2,
           'inspect_time_source', 'memory/Countries data Xray Inspection Default; weight unit taken as kg')
   WHERE machine_class = 'xray_inspection' AND machine_name = 'Default';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'no xray_inspection machine named Default'; END IF;
END $$;
