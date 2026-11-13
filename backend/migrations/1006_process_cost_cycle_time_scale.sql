-- ============================================================================
-- Migration 1006: process_cost_records.cycle_time keeps four decimals of a second
-- ============================================================================
-- A casting's share of a large furnace's melt is a few milliseconds of machine time. NUMERIC(12,2) seconds held it as 0.00, which the
-- cycle_time > 0 check refuses, so the route could not be applied ("no cycle time"). Four decimals keep it; the engine's floor follows the
-- scale (engine-kernel persistableCycleSec, MIN_PERSISTABLE_CYCLE_SEC 0.0001 s). No view depends on the column. Idempotent.
-- ============================================================================

ALTER TABLE process_cost_records ALTER COLUMN cycle_time TYPE numeric(12,4);

NOTIFY pgrst, 'reload schema';
