-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 448: Restore 'Laser Machine Power' default on the Laser Cutting
-- calculator, defensively (2026-08-08)
--
-- Root cause of "Cutting Speed"/"Piercing Time Per Start" never auto-filling
-- in the standalone Laser Cutting cycleTime calculator: ProcessCostDialog.tsx's
-- auto-populate logic parsed laser power EXCLUSIVELY from the selected
-- machine's name (parseLaserPowerW(selectedMHR?.machineName), "NkW" pattern
-- only) — it never read the calculator's own visible 'Laser Machine Power'
-- field at all. With no machine selected in this popup (the same class of
-- gap as 'Selected Tonnage' on the Bending calculator, fixed earlier this
-- session), laserPowerW was always null and the sm_lookup_laser_cut query
-- could never run, regardless of what 'Laser Machine Power' showed.
--
-- That frontend fix (reading the field's own value first) is the real fix
-- and has already landed. This migration is defensive, not the fix itself:
-- migration 014 originally set 'Laser Machine Power' default_value = '6000 W'
-- (a reasonable disclosed placeholder — a 6kW fiber laser is a common
-- mid-range shop machine — not a claim about any specific real machine), but
-- this session has repeatedly found interactive Calculator Builder edits
-- silently wiping a field's configured default (Time Per Stroke, the Cycle
-- Time formula itself). Re-asserting it here costs nothing if it was never
-- touched, and fixes it if it was.
--
-- sm_lookup_laser_cut itself (migration 360) already carries real, complete
-- data across all 4 material buckets (Carbon Steel, Stainless Steel,
-- Aluminium, Brass) × the full thickness range (1-16mm) × power range
-- (500W-15000W) — confirmed by direct inspection, no gaps to research or
-- seed there.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE calculator_fields
SET default_value = '6000 W'
WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Laser Cutting Manufacturing')
  AND field_name = 'Laser Machine Power'
  AND (default_value IS NULL OR default_value = '');

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT field_name, field_type, default_value FROM calculator_fields
-- WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Laser Cutting Manufacturing')
-- ORDER BY display_order;
-- Expect 'Laser Machine Power' default_value = '6000 W'.
