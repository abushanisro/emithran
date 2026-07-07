-- Migration 339: Add IM-specific machine spec columns for aPriori-style selection.
-- Adds tie-bar spacing, shot capacity (grams), and mold daylight to mhr_records.
-- All columns nullable — existing records unaffected until seeded.

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS tie_bar_x_mm        INTEGER,
  ADD COLUMN IF NOT EXISTS tie_bar_y_mm        INTEGER,
  ADD COLUMN IF NOT EXISTS shot_capacity_grams INTEGER,
  ADD COLUMN IF NOT EXISTS min_mold_height_mm  INTEGER,
  ADD COLUMN IF NOT EXISTS max_mold_height_mm  INTEGER;

-- Seed for named Arburg Allrounder models
UPDATE mhr_records SET
  tie_bar_x_mm = 280, tie_bar_y_mm = 250, shot_capacity_grams = 56,
  min_mold_height_mm = 150, max_mold_height_mm = 370,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*370|allrounder.*370'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 370, tie_bar_y_mm = 320, shot_capacity_grams = 115,
  min_mold_height_mm = 200, max_mold_height_mm = 450,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*570|allrounder.*570'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 470, tie_bar_y_mm = 420, shot_capacity_grams = 300,
  min_mold_height_mm = 250, max_mold_height_mm = 580,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*1020|allrounder.*1020'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 570, tie_bar_y_mm = 500, shot_capacity_grams = 630,
  min_mold_height_mm = 300, max_mold_height_mm = 680,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*1600|allrounder.*1600'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 620, tie_bar_y_mm = 520, shot_capacity_grams = 900,
  min_mold_height_mm = 350, max_mold_height_mm = 730,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*2000|allrounder.*2000'
  AND tie_bar_x_mm IS NULL;

-- Generic kN patterns for unknown IM machines
UPDATE mhr_records SET
  tie_bar_x_mm = 320, tie_bar_y_mm = 280, shot_capacity_grams = 100,
  min_mold_height_mm = 160, max_mold_height_mm = 390,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'injection\s*mol.*500\s*kN|500\s*kN.*injection'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 470, tie_bar_y_mm = 420, shot_capacity_grams = 280,
  min_mold_height_mm = 250, max_mold_height_mm = 580,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'injection\s*mol.*1[,.]?000\s*kN|1[,.]?000\s*kN.*injection'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 620, tie_bar_y_mm = 520, shot_capacity_grams = 900,
  min_mold_height_mm = 350, max_mold_height_mm = 730,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'injection\s*mol.*2[,.]?000\s*kN|2[,.]?000\s*kN.*injection'
  AND tie_bar_x_mm IS NULL;

UPDATE mhr_records SET
  tie_bar_x_mm = 800, tie_bar_y_mm = 700, shot_capacity_grams = 2500,
  min_mold_height_mm = 460, max_mold_height_mm = 1000,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'injection\s*mol.*5[,.]?000\s*kN|5[,.]?000\s*kN.*injection'
  AND tie_bar_x_mm IS NULL;

-- Milacron Power Line (80–100T range used in US shops)
-- Specs: Milacron Power Line 935/800 datasheet; tie-bar 430×380mm, shot 180g
UPDATE mhr_records SET
  tie_bar_x_mm = 430, tie_bar_y_mm = 380, shot_capacity_grams = 180,
  min_mold_height_mm = 220, max_mold_height_mm = 480,
  capability_source = COALESCE(capability_source, 'seed'),
  capability_version = COALESCE(capability_version, 1),
  capability_updated_at = now()
WHERE machine_name ~* 'milacron.*power\s*line|power\s*line.*milacron|power\s*line\s*[89][0-9][0-9]'
  AND tie_bar_x_mm IS NULL;
