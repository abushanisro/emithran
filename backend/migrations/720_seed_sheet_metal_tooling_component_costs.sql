-- ============================================================================
-- Migration 720: sm_lookup_tooling_component_costs
--
-- Real progressive-die / stage-tooling purchased-component standard costs —
-- staged verbatim from memory/sheetmetal/lookuptable/component_standard_costs.json
-- (37 rows, source: USA reference export). Consumed by
-- progressive-die-tooling-engine.ts to price the real hard-tooling BOM
-- (pierce punches, die buttons, retainers, tapping units, guide pins, ...)
-- for Progressive Die / Tandem Press routes — every prior route charged
-- exactly $0 for this because no cost engine existed at all, not because
-- the real data didn't exist.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_tooling_component_costs (
  id                SERIAL PRIMARY KEY,
  component_name    VARCHAR(100) NOT NULL,
  model             VARCHAR(50),
  size_mm           NUMERIC,
  cost_usd          NUMERIC NOT NULL,
  weight_kg         NUMERIC,
  machining_hours   NUMERIC,
  wire_edm_hours    NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- COALESCE(model, '') so the single-row components (model IS NULL, e.g.
-- 'dieButton') are still protected against a duplicate insert the same way
-- the multi-model ones are (e.g. 'guidePinAssy' has 3 real model rows) --
-- a bare UNIQUE(component_name, model) would let every NULL-model row
-- collide as "distinct" and silently admit duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS sm_lookup_tooling_component_costs_key
  ON sm_lookup_tooling_component_costs (component_name, COALESCE(model, ''));

ALTER TABLE sm_lookup_tooling_component_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_lookup_tooling_component_costs_read ON sm_lookup_tooling_component_costs;
CREATE POLICY sm_lookup_tooling_component_costs_read ON sm_lookup_tooling_component_costs FOR SELECT USING (true);

INSERT INTO sm_lookup_tooling_component_costs
  (component_name, model, size_mm, cost_usd, weight_kg, machining_hours, wire_edm_hours)
VALUES
($str$bendCamUnit$str$, $str$lessThan10inches$str$, NULL, 1700, 89, 0.5, 0.5),
($str$camStripperSpool$str$, NULL, NULL, 40, 0.25, NULL, NULL),
($str$camUnit$str$, $str$1000Series$str$, 1000, 13400, 543, NULL, NULL),
($str$camUnit$str$, $str$1200Series$str$, 1200, 17535.6, 733, NULL, NULL),
($str$camUnit$str$, $str$150Series$str$, 190, 1700, 89, NULL, NULL),
($str$camUnit$str$, $str$300Series$str$, 400, 3500, 222, NULL, NULL),
($str$camUnit$str$, $str$600Series$str$, 600, 7700, 307, NULL, NULL),
($str$camUnit$str$, $str$800Series$str$, 800, 10500, 422, NULL, NULL),
($str$coilSpring$str$, NULL, NULL, 15, NULL, NULL, NULL),
($str$counterSinkRetainerStandard$str$, NULL, NULL, 75, 3, NULL, NULL),
($str$counterSinkStandard$str$, NULL, NULL, 125, 0.5, NULL, NULL),
($str$dieButton$str$, NULL, NULL, 125, 0.5, NULL, NULL),
($str$gasSpring$str$, NULL, NULL, 75, 0.25, NULL, NULL),
($str$gasSpringFlanged$str$, NULL, NULL, 125, 0.25, NULL, NULL),
($str$guidePinAssy$str$, $str$large$str$, 76.2, 480, 20, NULL, NULL),
($str$guidePinAssy$str$, $str$medium$str$, 63.5, 400, 15, NULL, NULL),
($str$guidePinAssy$str$, $str$small$str$, 50.8, 360, 10, NULL, NULL),
($str$keeperBlock$str$, NULL, NULL, 50, 1, NULL, NULL),
($str$partExitSensor$str$, NULL, NULL, 206, NULL, NULL, NULL),
($str$piercePunchRetainerStandard$str$, NULL, NULL, 75, 3, NULL, NULL),
($str$piercePunchStandard$str$, NULL, NULL, 125, 0.5, NULL, NULL),
($str$pilotPin$str$, NULL, NULL, 5, NULL, NULL, NULL),
($str$pitchSensor$str$, NULL, NULL, 75, NULL, NULL, NULL),
($str$shavePunchStandard$str$, NULL, NULL, 125, 0.5, NULL, NULL),
($str$shutterPinAssy$str$, NULL, NULL, 8, NULL, NULL, NULL),
($str$stamp$str$, NULL, NULL, 100, 0.25, NULL, NULL),
($str$startPin$str$, NULL, NULL, 10, 0.13, NULL, NULL),
($str$stockLifterBushing$str$, NULL, NULL, 35, 0.13, NULL, NULL),
($str$stockLifterPin$str$, NULL, NULL, 46, 0.13, NULL, NULL),
($str$stripperGuidePinAssy$str$, NULL, NULL, 100, 2, NULL, NULL),
($str$stripperPinAssy$str$, NULL, NULL, 5, 0.13, NULL, NULL),
($str$tappingUnit$str$, NULL, NULL, 10379, 10, NULL, NULL),
($str$tappingUnitIncrementalCosts$str$, NULL, NULL, 7784.25, 1, NULL, NULL),
($str$tappingUnitTravelCostPerMM$str$, NULL, NULL, 6.02, NULL, NULL, NULL),
($str$tapStandard$str$, NULL, NULL, 15, 0.05, NULL, NULL),
($str$thrustKey$str$, NULL, NULL, 6, NULL, NULL, NULL),
($str$wearPlate$str$, NULL, NULL, 10, 0.13, NULL, NULL)
ON CONFLICT (component_name, COALESCE(model, '')) DO NOTHING;

NOTIFY pgrst, 'reload schema';
