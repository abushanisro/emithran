-- ============================================================================
-- Migration 581: Canonical MHR = Direct OH + Indirect OH (documentation only)
--
-- Decision (2026-08-27): Machine Hour Rate (MHR) is defined as Total Overhead
-- = Direct Overhead Rate + Indirect Overhead Rate, permanently — not the
-- migration 580 bottom-up machine-economics calculation (calculated_mhr_usd_hr
-- stays reference-only, never authoritative for MHR or live costing), and not
-- a freely-typed manual override independent of the two overhead fields.
--
-- mhr.service.ts's create()/update() now derive total_machine_hour_rate (and
-- keep manual_mhr_value in lockstep with it) from direct_overhead_rate +
-- indirect_overhead_rate on every write, FX-converting the USD overhead sum
-- into this record's local currency. machine-selection/selector.ts's
-- pickRate() is UNCHANGED — it already reads total_machine_hour_rate first,
-- so it automatically inherits the corrected value with no code change there.
--
-- No data migration needed: audited live (2026-08-27) before writing this —
-- of 294 mhr_records rows, 281 (all migration-564-imported rows) already have
-- total_machine_hour_rate = direct_overhead_rate + indirect_overhead_rate
-- exactly (zero drift). The remaining 13 are the pre-2026-07-13 seed rows
-- with a real, deliberately-entered total_machine_hour_rate (e.g. Press Brake
-- 160T = 1500, Fiber Laser 2kW = 1800) but no Direct/Indirect breakdown ever
-- captured — a documented gap, not touched by this migration or by
-- mhr.service.ts's update() (which preserves an existing total rather than
-- deriving $0 when a row has no real overhead data on file at all). This
-- migration only updates column documentation to reflect the decision.
-- ============================================================================

COMMENT ON COLUMN mhr_records.total_machine_hour_rate IS
  'Canonical Machine Hour Rate (2026-08-27): Direct Overhead Rate + Indirect Overhead Rate, converted to this row''s local currency. Authoritative for live quote costing (machine-selection/selector.ts''s pickRate()). Derived by mhr.service.ts on every create/update -- never independently entered. 13 pre-2026-07-13 seed rows are a documented exception: no Direct/Indirect breakdown was ever captured for them, so their existing value is preserved rather than zeroed (see migration 581).';

COMMENT ON COLUMN mhr_records.manual_mhr_value IS
  'Kept in lockstep with total_machine_hour_rate by mhr.service.ts (same canonical Direct+Indirect derivation) -- a legacy fallback column read by pickRate() only when total_machine_hour_rate is unset. Not independently editable since 2026-08-27.';

COMMENT ON COLUMN mhr_records.calculated_mhr_usd_hr IS
  'Bottom-up machine-hour-rate ESTIMATE from real machine economics (price, life, salvage, maintenance, installation, supplies, uptime, utilization) -- independent of Direct/Indirect OH. Reference/validation only (2026-08-27 decision): never authoritative for MHR, never read by live costing. NULL when required inputs are missing, never fabricated.';
