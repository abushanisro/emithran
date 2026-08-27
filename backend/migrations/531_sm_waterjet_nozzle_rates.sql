-- Migration: sm_waterjet_nozzle_rates -- real nozzle-wear cost by grade,
--            promoted from staging (closeout Plan Phase 2b)
-- Purpose: Waterjet costing amortizes abrasive material cost
--          (consumable_prices, migration 362) but has no nozzle-wear cost
--          term at all. Real data (tblWaterjetAbrasiveNozzle export,
--          migration 514) gives 3 nozzle grades with cost and life-in-hours.
--
-- Architectural guardrails applied (same as migration 530):
--   source_ref_id joins back to the exact staged sm_reference_data row;
--   rule_set_version is a stamped label; effective_from/effective_to are
--   nullable and unused today, ready for a future rate change.

CREATE TABLE IF NOT EXISTS sm_waterjet_nozzle_rates (
    id                SERIAL PRIMARY KEY,
    nozzle_grade      TEXT NOT NULL UNIQUE,
    cost_usd          NUMERIC NOT NULL,
    life_hours        NUMERIC NOT NULL,
    source_ref_id     INTEGER REFERENCES sm_reference_data(id),
    rule_set_version  TEXT NOT NULL DEFAULT '2026.08',
    effective_from    DATE,
    effective_to      DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sm_waterjet_nozzle_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON sm_waterjet_nozzle_rates;
CREATE POLICY "Public read" ON sm_waterjet_nozzle_rates FOR SELECT USING (true);

COMMENT ON TABLE sm_waterjet_nozzle_rates IS 'Real nozzle replacement cost (USD) and life (hours) by nozzle grade -- see waterjet-engine.ts. Default grade for costing is Mid-Life until a per-shop nozzle-grade setting exists.';

INSERT INTO sm_waterjet_nozzle_rates (nozzle_grade, cost_usd, life_hours, source_ref_id)
SELECT
  (raw->>'Nozzle Type'),
  (raw->>'Nozzle Cost (USD)')::numeric,
  (raw->>'Nozzle Life (hr)')::numeric,
  id
FROM sm_reference_data
WHERE category = 'lookup_table'
  AND key LIKE 'tblWaterjetAbrasiveNozzle:%'
ON CONFLICT (nozzle_grade) DO NOTHING;

-- Verification:
-- SELECT * FROM sm_waterjet_nozzle_rates ORDER BY cost_usd;
-- Should return 3 rows (Low-Cost/Mid-Life/Premium Composite Carbide).
