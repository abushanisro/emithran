-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 449: Remove 'Laser Machine Power' hardcoded default — it's mock
-- data, correctly called out (2026-08-08)
--
-- Supersedes migration 448 (run 449 regardless of whether 448 was already
-- run — this is idempotent and simply clears whatever's there).
--
-- 448 defensively re-asserted 'Laser Machine Power' default_value = '6000 W'
-- to fix Cutting Speed/Piercing Time Per Start never auto-filling. That
-- fixed the SYMPTOM but reintroduced exactly the class of bug this whole
-- session has been removing: a static number standing in for real machine
-- data, shown with no disclosure that it's a guess (the field's own "Why:
-- Calculator's own default value" line doesn't say "no real machine
-- selected" — it reads like a resolved fact).
--
-- The real fix (already landed in ProcessCostDialog.tsx, same change as
-- this migration): 'Laser Machine Power' now auto-fills from the REAL
-- selected machine's own name (parseLaserPowerW(selectedMHR?.machineName))
-- when a machine is selected — mirroring exactly how 'Selected Tonnage'
-- already works on the Bending calculator (mhr_records has no numeric power
-- column to prefer, same as it has no populated max_tonnage for most
-- presses — name-parsing is the only real source either way). With no
-- default_value left in the DB, the field now genuinely goes blank when no
-- machine is selected — an honest "enter the real value" prompt, not a
-- guess dressed up as the calculator's own configured constant.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE calculator_fields
SET default_value = NULL
WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Laser Cutting Manufacturing')
  AND field_name = 'Laser Machine Power';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT field_name, field_type, default_value FROM calculator_fields
-- WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Laser Cutting Manufacturing')
-- ORDER BY display_order;
-- Expect 'Laser Machine Power' default_value = NULL.
