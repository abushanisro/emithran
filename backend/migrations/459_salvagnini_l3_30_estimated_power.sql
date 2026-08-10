-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 459: Disclosed ESTIMATED power for Salvagnini L3-30 Fiber
-- (2026-08-09) — explicit user decision, not a default policy change
--
-- Context: two research passes this session found no way to VERIFY this
-- machine's real power (no nameplate/PO access, no OEM cutting-speed table
-- for any Salvagnini L3-30 config). The user explicitly asked to fill in a
-- disclosed estimate anyway rather than leave Laser Cutting fully blocked,
-- so Cutting Speed/Piercing Time Per Start can resolve — as long as it is
-- NEVER shown as equivalent to a verified nameplate reading.
--
-- Value used: 6 kW. Source: Shop Floor Lasers / Techgen Media (Oct 3, 2017)
-- covering the Salvagnini L3-30 launch specifically: "The Salvagnini L3-30
-- fiber laser features... a 6-kW resonator, serving as a complement to the
-- company's 2-kW, 3-kW and 4-kW product lines." This is the real, sourced,
-- documented LAUNCH/baseline configuration for the L3-30 model specifically
-- (distinct from the unrelated, older L1Xe 2kW line migration 458 already
-- disproved for this machine) — the best available estimate for an L3-30
-- unit when its own nameplate/PO isn't accessible, but still NOT a reading
-- of this specific physical unit, which could be any of L3-30's real
-- 3/4/6/8/8-E5/10kW configs.
--
-- Marked capability_source = 'seed' (mhr_records' existing real column,
-- already used everywhere else in this app for exactly this distinction —
-- see machine-selection/selector.ts's hydrateCapability and its own comment
-- naming this exact machine as the reason power is never inferred from a
-- name at calculation time). 'seed' means "real, sourced, but not this
-- specific unit's own verified record" — selector.ts already renders this
-- as "Capability from model seed data — verify against machine plate" and
-- folds it into 'derived' (never 'verified') confidence everywhere that
-- capabilityConfidence is read. bom-items.service.ts's OWN saved-machine
-- power lookup (a separate, more direct query — see its own code comment)
-- is updated alongside this migration to read and disclose the same flag,
-- since it does not go through selector.ts's capability pipeline.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE mhr_records
SET power_kw = 6,
    capability_source = 'seed'
WHERE machine_name = 'Salvagnini L3-30 Fiber'
  AND machine_class = 'fiber_laser'
  AND power_kw IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, power_kw, capability_source FROM mhr_records
-- WHERE machine_name = 'Salvagnini L3-30 Fiber';
-- Expect power_kw = 6, capability_source = 'seed' for all 5 rows (India, USA,
-- Germany, Mexico, China).
