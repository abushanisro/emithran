-- ============================================================================
-- Migration: Backfill press_brake max_tonnage from the Machine Library
--            reference export, for exact/near-exact-name matches
-- Purpose: closes the single biggest open gap in this reconciliation --
--          lookup_coverage_gaps id 132 ("60-ton press brake -- no matching
--          mhr_records row anywhere", 121 occurrences historically) turns
--          out to have been mis-scoped: the machine already exists in
--          mhr_records ("SPH-60C (Amada)", India) -- it just has
--          max_tonnage = NULL. The machine_library export (migration
--          505-508) names it with a real press_force_kn=588.4, which is
--          exactly 60.0 metric tons (÷9.80665). Not a new machine, a real
--          backfill.
--
--          12 total exact (case-insensitive) name matches found between
--          this app's NULL-tonnage press_brake rows (all India-location,
--          23 rows total) and the export's 16 named Bend Press Brake
--          machines:
--            11010/15010/18510 (Heller-hydraulic), FBD1253-NT (Amada-
--            Upacting), HFE2204 (Amada-DownActing), HG-1303/2204/5020/8025
--            (Amada), SPH-30C/60C (Amada), and "Autobrake 2000 Model AB1016
--            (Roper Whitney)" (matched to the export's "Autobrake 2000
--            Model: AB1016 (Roper Whitney)" -- punctuation-only difference,
--            same real machine).
--
--          Deliberately EXCLUDED: "Default Bend Brake" (also NULL, also
--          present in the export at press_force_kn=75.0) -- this app's own
--          process_machine_data reconciliation (migration 500) already
--          established that "Default <X>" names are the source tool's own
--          new-part-wizard placeholder naming, not real machine specs; its
--          75kN value is almost certainly the same kind of wizard default,
--          not a real capability worth writing into a live cost record.
--
--          The 11-row India "HG-8025 (Amada)" here is a SEPARATE existing
--          row from the France/E.Europe "HG-8025 (Amada) 800KN Press Brake"
--          NEW row added by migration 491 -- both are the same real machine
--          model at different locations; this migration does not conflict
--          with or duplicate that fix.
--
--          Remaining ~11 NULL press_brake rows (Chicago/Nisshinbo/Salvagnini
--          S4Xe.30/Roper Whitney 10H8/"Press Brake 160T"/the 3 "Shear -
--          ...max thickness" stub rows) have no match in this 16-row export
--          -- left NULL, not guessed.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records SET max_tonnage = 111.76 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = '11010 (Heller-hydraulic)';
UPDATE mhr_records SET max_tonnage = 152.41 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = '15010 (Heller-hydraulic)';
UPDATE mhr_records SET max_tonnage = 187.97 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = '18510 (Heller-hydraulic)';
UPDATE mhr_records SET max_tonnage = 139.19 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'FBD1253-NT (Amada- Upacting)';
UPDATE mhr_records SET max_tonnage = 241.98 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'HFE2204 (Amada- DownActing)';
UPDATE mhr_records SET max_tonnage = 132.56 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'HG-1303 (Amada)';
UPDATE mhr_records SET max_tonnage = 224.34 WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'HG-2204 (Amada)';
UPDATE mhr_records SET max_tonnage = 50.99  WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'HG-5020 (Amada)';
UPDATE mhr_records SET max_tonnage = 81.58  WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'HG-8025 (Amada)';
UPDATE mhr_records SET max_tonnage = 33.0   WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'SPH-30C (Amada)';
-- The 60-ton press brake -- lookup_coverage_gaps id 132, this session's biggest open gap.
UPDATE mhr_records SET max_tonnage = 60.0   WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'SPH-60C (Amada)';
UPDATE mhr_records SET max_tonnage = 40.65  WHERE machine_class = 'press_brake' AND max_tonnage IS NULL AND machine_name = 'Autobrake 2000 Model AB1016 (Roper Whitney)';
