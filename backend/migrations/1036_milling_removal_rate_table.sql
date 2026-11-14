-- ============================================================================
-- Migration 1036: the milling material removal rates as a lookup table
-- ============================================================================
-- The removal rate each milling calculator divides a volume by was a table in
-- the cost engine's source (MILLING_MRR). It is data: one rate per material
-- class, for carbide tooling, the eMithran baseline. It is staged here as
-- tblMillingRemovalRate so it is read, shown and changed like every other
-- lookup, and the engine holds no rate of its own.
--
-- memory/Machining has no removal-rate table and its milling table has no
-- aluminium rows, so these are the baseline values, not reference values.
--
-- Idempotent: the row is inserted once and never overwritten.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, notes, raw)
VALUES (
  'lookup_table', 'USA', '2026-03', 'tblMillingRemovalRate', '7',
  'eMithran baseline: milling material removal rate per material class, carbide tooling (was MILLING_MRR in cost-machining-engine.ts)',
  '[
    {"MaterialClass": "aluminum",     "RemovalRateMm3PerMin": 60000},
    {"MaterialClass": "mild_steel",   "RemovalRateMm3PerMin": 12000},
    {"MaterialClass": "stainless",    "RemovalRateMm3PerMin": 5000},
    {"MaterialClass": "titanium",     "RemovalRateMm3PerMin": 3000},
    {"MaterialClass": "copper_alloy", "RemovalRateMm3PerMin": 40000},
    {"MaterialClass": "tool_steel",   "RemovalRateMm3PerMin": 3000},
    {"MaterialClass": "plastic",      "RemovalRateMm3PerMin": 150000}
  ]'::jsonb
)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
