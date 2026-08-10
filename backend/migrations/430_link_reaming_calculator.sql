-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 430: Link the orphaned Reaming calculator (2026-08-07)
--
-- 'Machining - Reaming' (calculators/030_machining_reaming_calculator.sql) has
-- a real, complete calculator (spindle RPM, drill-tip constant, machining
-- time, full cost breakdown) — but its process_calculator_mappings row
-- (migration 024, re-inserted 344) was only ever seeded with a descriptive
-- calculator_name string ('Drilling Calculator'), never a real calculator_id.
-- The interactive "Edit Process Cost" calculator popup for Reaming has shown
-- an empty "Choose a calculator" ever since — same symptom class as
-- Inspection before migration 049, fixed the same way.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_calculator_mappings
SET calculator_id = (SELECT id FROM calculators WHERE name = 'Machining - Reaming' LIMIT 1)
WHERE process_group = 'Machining'
  AND process_route = 'Drilling'
  AND operation = 'Reaming'
  AND calculator_id IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT process_group, process_route, operation, calculator_id
--   FROM process_calculator_mappings WHERE operation = 'Reaming';
-- Expected: calculator_id populated, matching calculators.id WHERE name = 'Machining - Reaming'.
