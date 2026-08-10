-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 461: Fix "Manual Deburr"'s mistagged machine_class (2026-08-09)
--
-- mhr_records id 66953544-b3e1-4ebe-ba20-7a6e53e7a1c8 ("Manual Deburr", USA,
-- $14.13/hr) has machine_class='manual_assembly' — but its own machine_name
-- ("Manual Deburr"), commodity_code ("Deburr"), and process_group ("Deburr")
-- all agree it's a deburring resource. 'manual_assembly' is a stray/wrong
-- tag from data entry, not a real classification — confirmed by three
-- independent, consistent real fields disagreeing with only the one column.
--
-- This is exactly why a real saved Deburring line silently lost its ⭐/
-- alternatives machine picker (confirmed live, 2026-08-09): the machine-
-- selection pool (selector.ts's classifyMachineRecord) already reclassifies
-- this row correctly via its real commodity_code ("Deburr" → 'deburring',
-- Tier 1) regardless of the wrong raw tag, but ProcessCostService's own
-- deriveMachineFields() — used only when SAVING a process_cost_records row —
-- read machine_class straight off this same wrong raw column, with no such
-- reclassification. The two disagreed (live pool: 'deburring', saved row:
-- 'manual_assembly'), so the saved row could never find its own live
-- counterpart to attach the picker to. Fixing the source data here closes
-- the gap for every future save referencing this machine, not just the one
-- BOM item already hand-corrected via the process-costs API.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET machine_class = 'deburring'
WHERE id = '66953544-b3e1-4ebe-ba20-7a6e53e7a1c8'
  AND machine_name = 'Manual Deburr'
  AND machine_class = 'manual_assembly';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, machine_name, commodity_code, process_group, machine_class
-- FROM mhr_records WHERE id = '66953544-b3e1-4ebe-ba20-7a6e53e7a1c8';
-- Expect machine_class = 'deburring'.
