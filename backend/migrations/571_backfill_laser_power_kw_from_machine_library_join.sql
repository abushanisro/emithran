-- ============================================================================
-- Migration 571: Backfill power_kw for the 65 machine_library-imported laser
-- machines (Fiber Laser Cutting Machine, 3D Laser Cutting Machine, Laser
-- Cutting Machine categories), via direct join on benchmark_source_key
--
-- Unlike max_tonnage (migration 570) and the other Sheet Metal capability
-- columns, power_kw is NOT decorative for laser — it's the real, load-bearing
-- input to the laser cycle-time calculator. bom-items.service.ts's
-- getCostSummary reads the selected laser machine's mhr_records.power_kw
-- directly (as smLaserPowerW = power_kw * 1000), and feeds it into
-- getLaserParams() -> sm_lookup_laser_cut, which is keyed by material +
-- thickness + laser power. No code change needed here at all — the
-- calculator already consumes real per-machine power; it's purely a data
-- gap. Confirmed live: all 65 of these rows currently have power_kw = NULL,
-- which is exactly what produces the "MISSING_MACHINE_DATA: real laser power
-- not on file" warning (and a $0 cycle time) for any of them today.
--
-- Field choice: power_watts, not machine_power_kw. machine_power_kw is the
-- machine's generic overall electrical draw (chiller, controls, etc. — a
-- bigger, less precise number); power_watts is the laser's actual optical/
-- cutting power (e.g. "6kW Fiber" = 6000W), the same field migration 509
-- already established as the correct semantic source for this exact
-- calculation. All 65 rows across all three categories have a real,
-- populated power_watts value in their linked machine_library.json entry
-- (100% coverage, confirmed live) — this is a complete, not partial, backfill.
-- ============================================================================

BEGIN;

UPDATE mhr_records m
SET power_kw = ROUND(((srd.raw->>'power_watts')::numeric / 1000)::numeric, 3)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class IN ('fiber_laser', 'co2_laser')
  AND m.power_kw IS NULL
  AND (srd.raw->>'power_watts') IS NOT NULL
  AND (srd.raw->>'power_watts')::numeric > 0;

COMMIT;
