-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 406: Correct Hole Extrusion (Burring)'s LHR process_group (2026-08-05)
--
-- Migration 404 originally inserted process_group = 'Machining' for this row —
-- wrong: burring is a sheet-metal forming op, same labor-skill group as Press
-- Brake/Turret Punch/Deburring/Waterjet ('Sheet Metal' in LHR_GROUP,
-- bom-items.service.ts::resolveLHRRates), not the drilling/tapping-adjacent
-- 'Machining' group. The 404 file itself has been corrected to insert
-- 'Sheet Metal' directly — this migration is a safety net only, in case 404
-- was already run against this DB with the old value before the fix. Safe to
-- run even if 404 (corrected version) already inserted the right value —
-- this UPDATE is then a no-op.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_calculator_mappings
SET process_group = 'Sheet Metal'
WHERE machine_class = 'hole_forming'
  AND operation = 'Hole Extrusion (Burring)'
  AND process_group <> 'Sheet Metal';

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT process_group, process_route, operation, machine_class FROM process_calculator_mappings
--   WHERE machine_class = 'hole_forming';
