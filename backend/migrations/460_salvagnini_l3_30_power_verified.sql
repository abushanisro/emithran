-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 460: Salvagnini L3-30 Fiber power confirmed VERIFIED, all 5
-- locations (2026-08-09)
--
-- Context: migration 459 set power_kw=6, capability_source='seed' for all 5
-- Salvagnini L3-30 Fiber rows (India, USA, Germany, Mexico, China) — a
-- disclosed ENGINEERING ESTIMATE from Salvagnini's own documented L3-30
-- launch configuration (Shop Floor Lasers, Oct 2017), explicitly NOT a
-- nameplate/PO reading of any of these specific physical units.
--
-- The user has now personally checked the real nameplate/PO for all 5 of
-- these specific machines and confirmed 6000W (6kW) is correct for every
-- one — explicit, location-by-location confirmation (not a single site's
-- answer generalized to the rest; asked directly and confirmed "All 5").
--
-- power_kw stays 6 (already correct) — this migration only changes
-- capability_source from 'seed' to 'imported', so every downstream
-- consumer (machine-selection/selector.ts's hydrateCapability,
-- deriveCapabilityConfidence, the "ESTIMATED (not verified)" warning/trace
-- text in bom-items.service.ts) now correctly reports this as a real,
-- verified capability — 'verified' confidence, no more disclosed-estimate
-- language, no more "verify before finalizing this quote" warning.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET capability_source = 'imported'
WHERE machine_name = 'Salvagnini L3-30 Fiber'
  AND machine_class = 'fiber_laser'
  AND power_kw = 6
  AND capability_source = 'seed';

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, power_kw, capability_source FROM mhr_records
-- WHERE machine_name = 'Salvagnini L3-30 Fiber';
-- Expect power_kw = 6, capability_source = 'imported' for all 5 rows
-- (India, USA, Germany, Mexico, China).
