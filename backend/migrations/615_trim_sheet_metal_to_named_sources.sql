-- ============================================================================
-- Migration 615: Trim Sheet Metal to process_operations.json/
-- process_machine_data.json's canonical names
-- ============================================================================
-- Explicit user reversal (2026-09-01) of the earlier "keep all 67, even if
-- not in the json" decision (migration 613's own header) -- confirmed
-- after being told this removes live mapping rows for real, Phase-1-
-- registered engines with no match in the named files: Tapping, Deburr/
-- Edge Finish, Press Brake route's Bend/Form/Press Brake Bend, Hole
-- Extrusion (Burring), plus Raw Material's 9 shapes, Inspect/Dimensional
-- Inspect, and Powder Coat/Paint/Anodize (Surface Treatment). Explicitly
-- reconfirmed by the user knowing this.
--
-- Keep set = the 24 canonical process_operations.json/
-- process_machine_data.json family names (case-insensitive exact match)
-- plus the two aliases already established this session (Waterjet
-- Cutting -> Waterjet Cut; Laser Puch -> Laser Punch, a known live typo,
-- migration 569). CTL, Shear, User-Defined Process are in the canonical
-- list but don't exist as live Sheet Metal rows at all -- nothing to
-- keep/delete for those, included here only for completeness/
-- documentation.
--
-- Two explicit, user-approved EXCEPTIONS beyond the named files, found
-- via this migration's own pre-flight check: "Co2 Laser Cutting" (24 real
-- CO2 laser machines in mhr_records -- a genuinely different cutting
-- technology from fiber laser, not covered by process_operations.json at
-- all) and "Shearing" (10 real shear machines -- the canonical family
-- name in the file is "Shear", a different literal string). Both kept
-- specifically because they have real backing machine-catalog data, not
-- because they're in the named files.
--
-- Same safety pattern as migration 613: full backup first, pre-flight
-- check against mhr_records.canonical_process_id (migration 611) before
-- touching process_taxonomy, since that FK has no ON DELETE clause.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  blocking_count INTEGER;
BEGIN
  SELECT count(*) INTO blocking_count
  FROM mhr_records mr
  JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id
  WHERE pt.process_group = 'Sheet Metal'
    AND lower(pt.process_name) NOT IN (
      '2 axis router', '2 roll bending', '3 roll bending', '3d laser', '4 roll bending',
      'bend brake', 'ctl', 'deslag', 'fiber laser cut', 'generic press', 'laser cut',
      'laser punch', 'material stock', 'no cost feature', 'oxyfuel cut', 'plasma cut',
      'plasma punch', 'progressive die', 'shear', 'std press', 'tandem press', 'turret press',
      'user-defined process', 'waterjet cut', 'waterjet cutting', 'laser puch', 'co2 laser cutting', 'shearing'
    );
  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'Migration 615 aborted: % mhr_records row(s) are linked (via canonical_process_id) to a Sheet Metal process_taxonomy row this migration would delete. Run: SELECT mr.id, mr.machine_name, pt.process_name FROM mhr_records mr JOIN process_taxonomy pt ON pt.id = mr.canonical_process_id WHERE pt.process_group = ''Sheet Metal'' AND lower(pt.process_name) NOT IN (''2 axis router'',''2 roll bending'',''3 roll bending'',''3d laser'',''4 roll bending'',''bend brake'',''ctl'',''deslag'',''fiber laser cut'',''generic press'',''laser cut'',''laser punch'',''material stock'',''no cost feature'',''oxyfuel cut'',''plasma cut'',''plasma punch'',''progressive die'',''shear'',''std press'',''tandem press'',''turret press'',''user-defined process'',''waterjet cut'',''waterjet cutting'',''laser puch'',''co2 laser cutting'',''shearing''); -- to see which, then decide.', blocking_count;
  END IF;
END $$;

CREATE TABLE process_calculator_mappings_backup_615 AS
  SELECT * FROM process_calculator_mappings WHERE process_group = 'Sheet Metal';
CREATE TABLE process_taxonomy_backup_615 AS
  SELECT * FROM process_taxonomy WHERE process_group = 'Sheet Metal';

DELETE FROM process_calculator_mappings
WHERE process_group = 'Sheet Metal'
  AND lower(operation) NOT IN (
    '2 axis router', '2 roll bending', '3 roll bending', '3d laser', '4 roll bending',
    'bend brake', 'ctl', 'deslag', 'fiber laser cut', 'generic press', 'laser cut',
    'laser punch', 'material stock', 'no cost feature', 'oxyfuel cut', 'plasma cut',
    'plasma punch', 'progressive die', 'shear', 'std press', 'tandem press', 'turret press',
    'user-defined process', 'waterjet cut', 'waterjet cutting', 'laser puch', 'co2 laser cutting', 'shearing'
  );

DELETE FROM process_taxonomy
WHERE process_group = 'Sheet Metal'
  AND lower(process_name) NOT IN (
    '2 axis router', '2 roll bending', '3 roll bending', '3d laser', '4 roll bending',
    'bend brake', 'ctl', 'deslag', 'fiber laser cut', 'generic press', 'laser cut',
    'laser punch', 'material stock', 'no cost feature', 'oxyfuel cut', 'plasma cut',
    'plasma punch', 'progressive die', 'shear', 'std press', 'tandem press', 'turret press',
    'user-defined process', 'waterjet cut', 'waterjet cutting', 'laser puch', 'co2 laser cutting', 'shearing'
  );

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Sheet Metal ~22, Injection Molding 3.
-- SELECT operation FROM process_calculator_mappings WHERE process_group = 'Sheet Metal' ORDER BY operation;
--
-- To restore, if ever needed:
-- INSERT INTO process_calculator_mappings SELECT * FROM process_calculator_mappings_backup_615 ON CONFLICT DO NOTHING;
-- INSERT INTO process_taxonomy SELECT * FROM process_taxonomy_backup_615 ON CONFLICT DO NOTHING;
-- (re-run migration 609's operations/aliases seed afterward to restore the child rows for the restored parents)
