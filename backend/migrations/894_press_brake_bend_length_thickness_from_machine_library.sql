-- ============================================================================
-- Migration 894: press brake bend length + max thickness from the machine library
--
-- Why: machine selection checks a press brake on three things (tonnage, bend
-- length, thickness) but mhr_records only ever got max_tonnage (migrations
-- 510/570). max_length_mm and max_thickness_mm stayed NULL, so the selector
-- skipped the bend-length and thickness checks for every brake and could
-- recommend e.g. SPH-30C (415 mm bend length) for a 600 mm bend.
--
-- Source: memory/Sheetmetal/machine/machine_library.csv, category
-- "Bend Press Brake", columns max_bend_length_mm and
-- max_thickness_steel/stainless_steel/aluminum_mm (all 16 machines carry them).
--
-- max_thickness_mm takes the LOWEST of the three material limits, because the
-- selector compares one thickness for every material. That never passes a
-- brake for a sheet it cannot bend; it can only be conservative for aluminum.
--
-- max_tonnage is also filled (press_force_kn / 9.80665) for the generic
-- "Bend Brake - NNNkN Press Force" rows that 510 did not cover. Only NULL
-- columns are written; a value already on a row is never overwritten.
-- "Default Bend Brake" is excluded, same as migration 510 (wizard
-- placeholder, not a real machine).
--
-- Names match case-insensitively with punctuation removed, so the library
-- name "Autobrake 2000 Model: AB1016 (Roper Whitney)" matches the HR Rates
-- row "Autobrake 2000 Model AB1016 (Roper Whitney)".
-- ============================================================================

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH lib(name, bend_length_mm, steel_mm, ss_mm, al_mm, press_force_kn) AS (
    VALUES
      ('11010 (Heller-hydraulic)',                     3048.0, 15.9, 14.5, 27.8, 1096.0),
      ('15010 (Heller-hydraulic)',                     3048.0, 19.0, 17.3, 33.5, 1494.6),
      ('18510 (Heller-hydraulic)',                     3048.0, 22.2, 20.2, 38.9, 1843.4),
      ('Autobrake 2000 Model: AB1016 (Roper Whitney)', 3098.8,  1.6,  1.5,  2.7,  398.6),
      ('Bend Brake - 1500kN Press Force',              3000.0, 15.0, 15.0, 30.0, 1500.0),
      ('Bend Brake - 2500kN Press Force',              3500.0, 22.0, 20.0, 35.0, 2500.0),
      ('Bend Brake - 800kN Press Force',               1500.0, 10.0,  9.0, 12.0,  800.0),
      ('FBD1253-NT (Amada- Upacting)',                 2997.2, 17.0, 15.5, 29.8, 1365.0),
      ('HFE2204 (Amada- DownActing)',                  4267.2, 22.0, 20.0, 35.0, 2373.0),
      ('HG-1303 (Amada)',                              3110.0, 15.3, 14.0, 26.3, 1300.0),
      ('HG-2204 (Amada)',                              4300.0, 23.0, 20.9, 40.3, 2200.0),
      ('HG-5020 (Amada)',                              2150.0,  8.5,  7.7, 14.8,  500.0),
      ('HG-8025 (Amada)',                              2600.0, 11.1, 10.1, 19.3,  800.0),
      ('SPH-30C (Amada)',                               415.0,  6.4,  5.8, 11.1,  323.6),
      ('SPH-60C (Amada)',                               835.0, 12.7, 11.5, 22.2,  588.4)
  )
  UPDATE mhr_records m
     SET max_length_mm    = COALESCE(m.max_length_mm, lib.bend_length_mm),
         max_thickness_mm = COALESCE(m.max_thickness_mm, LEAST(lib.steel_mm, lib.ss_mm, lib.al_mm)),
         max_tonnage      = COALESCE(m.max_tonnage, ROUND((lib.press_force_kn / 9.80665)::numeric, 2))
    FROM lib
   WHERE m.machine_class = 'press_brake'
     AND regexp_replace(lower(m.machine_name), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(lib.name), '[^a-z0-9]', '', 'g')
     AND (m.max_length_mm IS NULL OR m.max_thickness_mm IS NULL OR m.max_tonnage IS NULL);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'press_brake rows updated from machine library: %', v_updated;
END $$;
