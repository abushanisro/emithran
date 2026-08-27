-- ============================================================================
-- Migration: Disambiguate the 12 press-family machine names that were
--   imported twice under the same (machine_name, location) — a real bug,
--   not a data gap.
--
-- Root cause: machine_library.csv legitimately lists 12 real machines twice
--   (once under "Progressive Die Press", once under "Tandem Press" — both
--   categories map to machine_class=NULL, no real engine yet, per
--   CATEGORY_TO_MACHINE_CLASS in memory/sheetmetal/machine/build-mhr-import.mjs).
--   That script's disambiguatedName() helper already appends "(<category>)"
--   to any name shared across categories — but the workbook actually
--   imported into the live DB (2026-08-22T12:26:52 UTC) predates that fix
--   landing in the committed script/regenerated .xlsx (committed ~1hr later
--   in the same session), so the live rows never got disambiguated. The
--   regenerated memory/sheetmetal/machine/generated/usa_machine_library_mhr_import.xlsx
--   already has the correct "(Progressive Die Press)" / "(Tandem Press)"
--   suffixes for these 12 names -- this migration brings the live DB in line
--   with it, id-scoped (not name-scoped) so it can never touch the wrong row.
--
-- Downstream effect confirmed: migration 538 (specs backfill) explicitly
--   skipped these same 24 rows as "ambiguous match, not applied" -- this is
--   the same bug, independently corroborated. Once these rows carry distinct
--   names, a follow-up specs backfill for them becomes possible (not done
--   in this migration -- scope here is the name collision only).
--
-- Category assignment: 4 of the 12 pairs have distinct direct/indirect
--   overhead rates per category in the source CSV, so the live row's own
--   already-imported direct_overhead_rate/indirect_overhead_rate values
--   identify which category each row is (matched against
--   memory/sheetmetal/machine/machine_library.csv, not guessed). The other
--   8 pairs have byte-identical economics between the two categories in the
--   source CSV itself -- both live rows are numerically indistinguishable,
--   so which physical id gets which category label is an arbitrary (id-
--   ascending) but harmless assignment: machine_class is NULL either way
--   (no cost engine reads these rows today), so no calculation changes for
--   either assignment choice. Disclosed here, not silently decided.
--
-- Idempotent: every UPDATE is scoped by primary key id, so re-running this
--   file after it has already applied is a no-op (name already matches).
-- ============================================================================

-- Distinct economics per category (unambiguous assignment):

-- Schuler 1150 Ton: PDP direct=79.56/indirect=25.94, TP direct=72.61/indirect=19.94
UPDATE mhr_records SET machine_name = 'Schuler 1150 Ton (Progressive Die Press)'
WHERE id = '2cd51b8c-573c-471f-8084-8ce400fa4692';
UPDATE mhr_records SET machine_name = 'Schuler 1150 Ton (Tandem Press)'
WHERE id = 'fc425621-9f57-427d-8484-9ac964ad6821';

-- Schuler A2/200 - 360: PDP indirect=18.89, TP indirect=15.89 (direct=55.83 both)
UPDATE mhr_records SET machine_name = 'Schuler A2/200 - 360 (Progressive Die Press)'
WHERE id = 'b9ed2b48-79e5-4c4b-a53a-b998f4c783eb';
UPDATE mhr_records SET machine_name = 'Schuler A2/200 - 360 (Tandem Press)'
WHERE id = '34a4079d-4eeb-4634-a7b4-f0f520c9fde8';

-- United Power SHD-666 Ton: PDP direct=79.41, TP direct=72.84 (indirect=19.03 both)
UPDATE mhr_records SET machine_name = 'United Power SHD-666 Ton (Progressive Die Press)'
WHERE id = '29bec2f9-1860-4237-b02d-4d060b107e44';
UPDATE mhr_records SET machine_name = 'United Power SHD-666 Ton (Tandem Press)'
WHERE id = '4f3352e9-ff03-440e-bc7e-0d51cb37a69b';

-- United Power SHS-666 Ton: PDP direct=79.41, TP direct=72.84 (indirect=15.99 both)
UPDATE mhr_records SET machine_name = 'United Power SHS-666 Ton (Progressive Die Press)'
WHERE id = '779b831c-0776-4d82-bf2e-a22b5d27244e';
UPDATE mhr_records SET machine_name = 'United Power SHS-666 Ton (Tandem Press)'
WHERE id = '44f914c2-9de4-468e-826a-376a3c661659';

-- Identical economics in both categories (arbitrary id-ascending assignment,
-- disclosed above -- machine_class is NULL for both rows either way):

-- Default Press
UPDATE mhr_records SET machine_name = 'Default Press (Progressive Die Press)'
WHERE id = '09f6184f-9ca8-4b9c-81db-49bfda9c6125';
UPDATE mhr_records SET machine_name = 'Default Press (Tandem Press)'
WHERE id = '4a4646f1-4574-450f-aab0-68819f4ed0d9';

-- Schuler TSD 2000
UPDATE mhr_records SET machine_name = 'Schuler TSD 2000 (Progressive Die Press)'
WHERE id = '2d5363a9-b38f-421e-acd7-1ad848cb8d7c';
UPDATE mhr_records SET machine_name = 'Schuler TSD 2000 (Tandem Press)'
WHERE id = 'ffb2c8e7-9a20-4481-a3dd-82e19653c5f5';

-- United Power SHD-220 Ton
UPDATE mhr_records SET machine_name = 'United Power SHD-220 Ton (Progressive Die Press)'
WHERE id = '07dd03a0-26ee-441a-bd0a-18827e8d3040';
UPDATE mhr_records SET machine_name = 'United Power SHD-220 Ton (Tandem Press)'
WHERE id = 'd127b707-c397-4a40-8a44-966ba33b0422';

-- United Power SHD-400 Ton
UPDATE mhr_records SET machine_name = 'United Power SHD-400 Ton (Progressive Die Press)'
WHERE id = '50689051-d991-4e86-acc1-7bd14f204729';
UPDATE mhr_records SET machine_name = 'United Power SHD-400 Ton (Tandem Press)'
WHERE id = '5ef635f5-c517-4017-8dda-9a5a188bc38f';

-- United Power SHS-166 Ton
UPDATE mhr_records SET machine_name = 'United Power SHS-166 Ton (Progressive Die Press)'
WHERE id = 'd5c19490-e426-439d-9b6a-37dce2669d86';
UPDATE mhr_records SET machine_name = 'United Power SHS-166 Ton (Tandem Press)'
WHERE id = 'f3eee2e6-3e8d-453b-bbe9-dc0e0351ced9';

-- United Power THD-137 High Speed
UPDATE mhr_records SET machine_name = 'United Power THD-137 High Speed (Progressive Die Press)'
WHERE id = '1db98d61-87bf-4641-ba06-eff6ac15e642';
UPDATE mhr_records SET machine_name = 'United Power THD-137 High Speed (Tandem Press)'
WHERE id = 'a76eaae5-06f1-439b-9040-ea2d42ac0dfa';

-- United Power THD-333 High Speed
UPDATE mhr_records SET machine_name = 'United Power THD-333 High Speed (Progressive Die Press)'
WHERE id = '8cb3f10b-053e-43fd-8d09-56aaafde16f9';
UPDATE mhr_records SET machine_name = 'United Power THD-333 High Speed (Tandem Press)'
WHERE id = '991fee51-d597-47b3-8881-fded218ba0ad';

-- United Power THD-66 High Speed
UPDATE mhr_records SET machine_name = 'United Power THD-66 High Speed (Progressive Die Press)'
WHERE id = '2b7eed5c-031f-4436-88d0-99c8c6d561fa';
UPDATE mhr_records SET machine_name = 'United Power THD-66 High Speed (Tandem Press)'
WHERE id = '869131f6-bd8d-4578-b223-5f3d7bc2e0b9';
