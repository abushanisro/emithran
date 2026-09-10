// Generator: seeds sm_lookup_tooling_component_costs (migration 720's schema)
// from the real progressive-die / stage-tooling component cost catalog —
// memory/sheetmetal/lookuptable/component_standard_costs.json (37 rows,
// real per-component tooling BOM costs: {name, model, sizeMm, costUsd,
// weightKg, machiningHours, wireEdmHours}).
//
// This is the real, sourced replacement for the $0 hard-tooling cost every
// Progressive Die / Tandem Press route previously charged — no engine
// anywhere in this codebase computed a die-tooling cost before this. See
// progressive-die-tooling-engine.ts for how these rows are consumed.
//
// Offline, file-in/file-out — matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const SRC_FILE = path.join(__dirname, '../../../memory/sheetmetal/lookuptable/component_standard_costs.json');
const OUT_SQL = path.join(__dirname, '../720_seed_sheet_metal_tooling_component_costs.sql');

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlNum(v) {
  return v === null || v === undefined ? 'NULL' : String(v);
}

const src = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
if (!Array.isArray(src.rows) || src.rows.length !== src.rowCount) {
  throw new Error(`row count mismatch: file says ${src.rowCount}, array has ${src.rows?.length}`);
}

const valuesSql = src.rows.map((r) => {
  return `(${sqlStr(r.name)}, ${sqlStr(r.model)}, ${sqlNum(r.sizeMm)}, ${sqlNum(r.costUsd)}, ${sqlNum(r.weightKg)}, ${sqlNum(r.machiningHours)}, ${sqlNum(r.wireEdmHours)})`;
}).join(',\n');

const sql = `-- ============================================================================
-- Migration 720: sm_lookup_tooling_component_costs
--
-- Real progressive-die / stage-tooling purchased-component standard costs —
-- staged verbatim from memory/sheetmetal/lookuptable/component_standard_costs.json
-- (${src.rows.length} rows, source: ${src.digitalFactory}). Consumed by
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
${valuesSql}
ON CONFLICT (component_name, COALESCE(model, '')) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT_SQL, sql);
console.log(`Wrote ${OUT_SQL} (${src.rows.length} rows)`);
