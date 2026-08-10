-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 450: Backfill real, verified mhr_records.power_kw for the seeded
-- laser fleet — the real machine-capability source going forward (2026-08-08)
--
-- Root cause of the "6000 W" mock and the machine-name-parsing fallbacks
-- (bom-items.service.ts's Laser Cut cost/cycle-time resolution, selector.ts's
-- hydrateCapability, ProcessCostDialog.tsx's calculator popup): mhr_records
-- already has a real `power_kw` column (migration 324, "laser power /
-- spindle power") — it was just never populated for the laser fleet
-- migrations 179/183/337/338 actually seeded, even though EVERY one of
-- those rows already discloses its real wattage plainly in its own
-- machine_name (e.g. 'Fiber Laser 6kW', commodity_code 'SM-LASER-6KW').
-- This migration transcribes that already-real, already-sourced number into
-- the structured column it belongs in — it is not fabricating anything, and
-- it changes NO row whose power_kw is already set (real imported/admin data
-- always wins, never overwritten).
--
-- Only WHERE machine_class = 'fiber_laser' AND power_kw IS NULL — scoped to
-- known commodity_codes so this can never touch a non-laser or ambiguous
-- row. 'SM-LASER-CO2' (migration 152, "CO2 Laser Cutter (1500×3000)") is
-- deliberately excluded: no wattage is disclosed anywhere for it, and this
-- migration does not guess one.
--
-- capability_source is set to 'seed' only where it's currently NULL/unset —
-- a real 'imported' provenance (an actual Excel import or admin edit) is
-- never downgraded by this backfill.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET power_kw = CASE commodity_code
  WHEN 'SM-LASER-6KW' THEN 6
  WHEN 'SM-LASER-2KW' THEN 2
  WHEN 'SM-LASER-2K'  THEN 2
  WHEN 'SM-LASER-4K'  THEN 4
  WHEN 'SM-LASER-6K'  THEN 6
END,
capability_source = COALESCE(capability_source, 'seed')
WHERE machine_class = 'fiber_laser'
  AND commodity_code IN ('SM-LASER-6KW', 'SM-LASER-2KW', 'SM-LASER-2K', 'SM-LASER-4K', 'SM-LASER-6K')
  AND power_kw IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, commodity_code, power_kw, capability_source
-- FROM mhr_records WHERE machine_class = 'fiber_laser' ORDER BY commodity_code, location;
-- Expect power_kw populated (6/2/2/4/6) for every row above except
-- 'SM-LASER-CO2', which stays NULL — a real, disclosed gap, not a bug.
