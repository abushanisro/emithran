// Generator: seeds sm_lookup_tooling_coating_cost (migration 721's schema)
// from the real per-kg tooling coating cost table —
// memory/sheetmetal/lookuptable/coating_cost_table.json (3 rows:
// {coatingCostUsdPerKg, coatingType, toolMaterial}).
//
// Paired with progressive-die-tooling-engine.ts's die-block raw-steel cost,
// which resolves the steel's own $/kg via the SAME real raw_materials
// pipeline already used for part-material costing (grade 'D2' — the only
// tool-steel grade with a real seeded cost, migration 353). The engine
// therefore selects the CVD/D2 row here, not the Nitride/S7 default this
// source data cites elsewhere (sm_reference_data's defaultToolingCoatingType
// = 'Nitride') -- S7 has no real seeded raw-material price anywhere in this
// dataset, so pairing Nitride/S7's rate with D2 steel would mismatch two
// real numbers that were never priced as a pair. See the engine file for
// the full reasoning.
//
// Offline, file-in/file-out — matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const SRC_FILE = path.join(__dirname, '../../../memory/sheetmetal/lookuptable/coating_cost_table.json');
const OUT_SQL = path.join(__dirname, '../721_seed_sheet_metal_tooling_coating_cost.sql');

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
  return `(${sqlStr(r.toolMaterial)}, ${sqlStr(r.coatingType)}, ${sqlNum(r.coatingCostUsdPerKg)})`;
}).join(',\n');

const sql = `-- ============================================================================
-- Migration 721: sm_lookup_tooling_coating_cost
--
-- Real per-kg tooling coating cost — staged verbatim from
-- memory/sheetmetal/lookuptable/coating_cost_table.json (${src.rows.length} rows,
-- source: ${src.digitalFactory}). Consumed by progressive-die-tooling-engine.ts
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
${valuesSql}
ON CONFLICT (tool_material, coating_type) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT_SQL, sql);
console.log(`Wrote ${OUT_SQL} (${src.rows.length} rows)`);
