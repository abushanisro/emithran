-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 425: Fix "Allendale-Ultrasonics 112 Liter" (and any sibling ultrasonic
-- cleaning tank) miscategorized as a deburring machine — introduce a real,
-- distinct 'cleaning' machine_class (2026-08-07)
--
-- Root cause (traced to source): the "Digital Factory 2026" spreadsheet this app's
-- MHR data is imported from (memory/database/Combined_All_Countries_Database.json)
-- explicitly tags this exact machine under its OWN process group:
--   "Process Goup": "Cleaning", "Process Sequence": "Ultrasonic cleaning",
--   "Machine Name": "Allendale-Ultrasonics 112 Liter"
-- mhr.service.ts's Excel importer has no "Machine Class" column in this spreadsheet
-- format to read from, so it falls back to the "Process Sequence" column verbatim
-- (getCol('machine class', 'machine_class', 'process sequence')) — meaning this row
-- imported with machine_class = the raw string "Ultrasonic cleaning".
--
-- Migration 371 (normalize_mhr_machine_class) then EXPLICITLY, deliberately folded
-- that raw value into the wrong slug:
--   WHEN machine_class ILIKE '%ultrasonic%clean%'  THEN 'deburring'
-- An ultrasonic cleaning tank is a cleaning/degreasing machine, not a material-
-- removal deburring machine — this was a real category error (flagged directly:
-- this exact row surfaced as a selectable "Deburring" machine in the Edit Process
-- Cost dialog, alongside the genuinely correct "Manual Deburr" option), not a
-- one-off data-entry mistake on the tenant's side.
--
-- Fix: introduce a real, distinct 'cleaning' machine_class (matching the source
-- data's own category) instead of folding it into a neighboring, semantically
-- wrong one. Reclassify the affected row(s) by machine_name (machine_class no
-- longer contains "ultrasonic" after 371 overwrote it, so machine_name — never
-- touched by any classification migration — is the only remaining signal).
-- 'deslag' is deliberately left mapped to 'deburring' (untouched by this
-- migration) — removing weld/cut slag is real material-removal finishing work,
-- the same job family as deburring, not a cleaning-tank category error.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Reclassify the live tenant row(s) in mhr_records ────────────────────────
UPDATE mhr_records
SET machine_class = 'cleaning'
WHERE machine_class = 'deburring'
  AND machine_name ILIKE '%ultrasonic%';

-- ── 2. Same defensive fix on mhr_benchmark_rates (no-op if none exist there —
--      migration 367's own cascade for this table never had the bad rule, but a
--      row could still have been added by hand since) ─────────────────────────
UPDATE mhr_benchmark_rates
SET machine_class = 'cleaning'
WHERE machine_class = 'deburring'
  AND machine_name ILIKE '%ultrasonic%';

-- ── 3. Give 'cleaning' a real place in the routing tree, so the reclassified
--      machine is actually reachable/selectable rather than becoming an orphaned
--      class with real rate data nobody can select. 'Post Processing' is the same
--      generic group Deburring/Heat Treatment/Inspection/Testing already live
--      under (migration 369) — Cleaning is a parallel, standalone finishing step,
--      not a sub-step of Deburring. ─────────────────────────────────────────────
INSERT INTO process_calculator_mappings (process_group, process_route, operation, machine_class, lhr_process_group, is_active, display_order)
VALUES ('Post Processing', 'Cleaning', 'Ultrasonic Cleaning', 'cleaning', 'Deburr', true, 427)
ON CONFLICT DO NOTHING;

-- lhr_process_group = 'Deburr' (not left NULL / defaulting to 'Post Processing'):
-- the source spreadsheet's own "Skill Based Labor Rate" for this exact
-- Cleaning/Ultrasonic-cleaning row (USA 39.21, Germany 37.93) is identical to
-- migration 411's real "Manual Deburr Operator" tier (USA 39.21, Germany 37.93)
-- — the two process sequences share the same real wage tier in the source data,
-- not a guess.

-- ── Verification (informational) ───────────────────────────────────────────────
-- SELECT location, machine_name, machine_class FROM mhr_records WHERE machine_name ILIKE '%ultrasonic%';
-- Expected: machine_class = 'cleaning', not 'deburring'.
-- SELECT * FROM process_calculator_mappings WHERE machine_class = 'cleaning';
-- Expected: exactly one row, Post Processing / Cleaning / Ultrasonic Cleaning.
