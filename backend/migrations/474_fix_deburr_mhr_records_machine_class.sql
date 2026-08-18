-- Root cause of "MHR machine is not selected" for Deburr operations
-- (ProcessCostDialog, reported 2026-08-18):
--
-- process_calculator_mappings correctly requires machine_class = 'deburring'
-- for every Deburr-shaped operation, regardless of which hierarchy group it's
-- filed under:
--   Sheet Metal   / Finishing  / Deburr           -> deburring
--   Post Processing / Deburring / Hand Deburring  -> deburring
--   Post Processing / Deburring / Tumble Deburring -> deburring
--   Post Processing / Deburring / Vibratory Deburring -> deburring
--   Post Processing / Deburring / Robotic Deburring -> deburring
--   Assembly      / Debur      / Manual Debur     -> deburring
--
-- But every mhr_records row actually seeded/entered for deburring work was
-- tagged machine_class = 'manual_assembly' instead (a generic bucket that's
-- correctly used elsewhere for real Assembly-group manual stations —
-- Pick_and_Place / Mechnical_Assembly records under process_group='Assembly'
-- are untouched by this migration and stay 'manual_assembly', which is
-- correct for them).
--
-- The class mismatch is real data, and the app's own class-mismatch guard
-- (ProcessCostDialog.tsx's "clear stale selection when savedMHRRecord belongs
-- to a different machine class" effect, and filteredMHR's withSaved() guard)
-- is working exactly as designed: it refuses to show a wrong-class machine
-- as selected rather than silently misapplying it. That correct refusal is
-- what surfaced as a blank "Select machine" dropdown while the Applied Rates
-- panel still showed the process's last-saved (now-orphaned) machineName/rate
-- from editData — confirmed live: 20 existing process_cost_records rows for
-- Sheet Metal/Deburr are already linked to these mistagged machines.
--
-- Fix: retag the 10 real Deburr-intended mhr_records rows (process_group =
-- 'Deburr') to machine_class = 'deburring', matching what every Deburr
-- mapping actually expects. This does not touch the 8 real Assembly-group
-- manual_assembly rows (process_group = 'Assembly'), which are correctly
-- classed already. Denormalized machine_class snapshots already stored on
-- process_cost_records rows are historical and unaffected — reopening the
-- Process Cost editor re-fetches the live mhr_records row and will resolve
-- correctly once this runs.

UPDATE mhr_records
SET machine_class = 'deburring'
WHERE machine_class = 'manual_assembly'
  AND process_group = 'Deburr';

-- Verify: should return 0 rows before this migration is considered redundant,
-- and the 10 named rows (Manual Deburr / Default Manual Deburr / Default
-- Automated Deburr / Manual Bench Cell - *) after running it should show
-- machine_class = 'deburring'.
-- SELECT id, machine_name, process_group, machine_class, location
-- FROM mhr_records
-- WHERE process_group = 'Deburr' AND machine_class != 'deburring';
