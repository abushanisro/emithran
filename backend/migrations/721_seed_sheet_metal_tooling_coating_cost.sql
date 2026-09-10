-- ============================================================================
-- Migration 721: sm_lookup_tooling_coating_cost
--
-- Real per-kg tooling coating cost — staged verbatim from
-- memory/sheetmetal/lookuptable/coating_cost_table.json (3 rows,
-- source: USA reference export). Consumed by progressive-die-tooling-engine.ts
-- alongside the real per-kg heat-treat cost (sm_reference_data
-- 'stdHeatTreatCostPerKgProgDie') to price die-block finishing cost from the
-- real die-block weight.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_tooling_coating_cost (
  id                        SERIAL PRIMARY KEY,
  tool_material             VARCHAR(20) NOT NULL,
  coating_type              VARCHAR(30) NOT NULL,
  coating_cost_usd_per_kg   NUMERIC NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_lookup_tooling_coating_cost_key
  ON sm_lookup_tooling_coating_cost (tool_material, coating_type);

ALTER TABLE sm_lookup_tooling_coating_cost ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_lookup_tooling_coating_cost_read ON sm_lookup_tooling_coating_cost;
CREATE POLICY sm_lookup_tooling_coating_cost_read ON sm_lookup_tooling_coating_cost FOR SELECT USING (true);

INSERT INTO sm_lookup_tooling_coating_cost
  (tool_material, coating_type, coating_cost_usd_per_kg)
VALUES
($str$S7$str$, $str$Nitride$str$, 0.23),
($str$S7$str$, $str$Teflon$str$, 0.41),
($str$D2$str$, $str$CVD$str$, 3.4)
ON CONFLICT (tool_material, coating_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
