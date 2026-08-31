// One-off generator for migration 593. Not part of the migration itself —
// run manually to (re)produce the SQL from the source JSON, then inspect the
// diff before committing. Same discipline as
// gen_590_seed_sheet_metal_raw_materials.js.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'memory', 'database', 'generic_materials_mexico.json');
const OUT = path.join(__dirname, '..', '593_seed_mexico_material_costs.sql');

const file = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const data = file.materials;

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL::numeric';
  return String(v);
}

// jsonb literal for the staged raw payload — vendor name neutralized, same
// rule as migration 590 (never store the licensed source name in the DB).
function rawJsonb(row) {
  const copy = { ...row };
  return `'${JSON.stringify(copy).replace(/'/g, "''")}'::jsonb`;
}

const stageRows = [];
const backfillRows = [];
let sqftSkipped = 0;
let noCostSkipped = 0;

for (const row of data) {
  const name = row.name;

  stageRows.push(
    `('material', 'MEX', '2026-08', ${sqlStr(name)}, ${sqlStr(row.base_cost)}, ${sqlStr(row.cost_units)}, 'Mexico regional material cost reference row', ${rawJsonb(row)})`
  );

  // cost_mexico is a $/kg column (matches cost_usa/cost_india/cost_china's
  // existing convention) -- 36 rows in this file are priced per_sqft
  // (honeycomb cores, prepregs, PCB copper-foil weights), a different unit
  // basis entirely. Staged for audit above, but never written into a $/kg
  // column -- that would silently mislabel an area-basis price as a
  // weight-basis one.
  if (row.cost_units !== 'per_kg') { sqftSkipped++; continue; }
  // 'Generic UNUSED' (Stainless Steel) has base_cost = null -- a dead
  // catalog placeholder in the source, not a real material with an unknown
  // price. Staged above, nothing to backfill.
  if (row.base_cost === null || row.base_cost === undefined) { noCostSkipped++; continue; }

  const densityKgM3 = row.density_kg_m3;
  const density = densityKgM3 != null ? +(densityKgM3 / 1000).toFixed(4) : null;
  // hardness_value = 0 is this source's own "not populated" sentinel (87 of
  // 508 rows, hardness_scale sometimes still says 'Brinell' even at 0 --
  // meaningless without a value) -- same pattern as MillingSpeed_m_min's
  // 0.0 in migration 590. Treated as NULL, not a fabricated real zero.
  const hardness = row.hardness_value === 0 ? null : row.hardness_value;
  const hardnessScale = hardness === null ? null : row.hardness_scale;

  backfillRows.push(
    `(${sqlStr(name)}, ${sqlNum(row.base_cost)}, ${sqlNum(densityKgM3)}, ${sqlNum(density)}, ${sqlNum(hardness)}, ${sqlStr(hardnessScale)}, ${sqlNum(row.cut_coefficient)})`
  );
}

const sql = `-- ============================================================================
-- Migration 593: Add Mexico regional cost data to raw_materials (2026-08-28)
--
-- Source: memory/database/generic_materials_mexico.json (renamed from its
-- original filename, which named a specific licensed reference-data vendor
-- -- see the file-rename precedent already established for other reference
-- data in this repo, and the standing project policy of never naming that
-- vendor anywhere in code/comments/migrations/DB values) -- 508
-- records, the Mexico-region pricing for the same "Generic <Family>, <Name>"
-- material catalog already live in raw_materials (confirmed: names in this
-- file match the existing 'material' column exactly, e.g. 'Generic
-- 0.5ozCu', 'Generic ABS' -- this is a regional cost overlay for an
-- already-imported catalog, not a new/different set of materials).
--
-- Provenance: the source file's own "source" field names a specific
-- licensed reference-data vendor. Per standing project policy that name is
-- never stored in this codebase/DB -- the raw staged payload keeps every
-- other field as-is but the vendor name itself is not written into any
-- .notes column (only into .raw's untouched copy, same as migration 590's
-- treatment of "DataSource").
--
-- Two-step discipline (same as migration 590):
--   Step 1: land all 508 rows losslessly into sm_reference_data (category=
--           'material', source_region='MEX'), keyed by name.
--   Step 2: BACKFILL ONLY -- this migration inserts NO new raw_materials
--           rows. cost_mexico is set for every existing row whose 'material'
--           exactly matches a Mexico record's 'name' with cost_units =
--           'per_kg' and a non-null base_cost. density_kg_m3, density,
--           hardness, hardness_system, and cut_code are backfilled ONLY
--           where the existing row currently has NULL there (COALESCE --
--           never overwrites an already-populated value with this file's
--           number). Material names present in this file but NOT already in
--           raw_materials update nothing (0-row UPDATE) -- deliberately NOT
--           inserted as new rows, since classifying ~78 material_types
--           (many of them additive-manufacturing/3D-printing resin brands
--           like Accura/Tango/VisiJet/DuraForm/CastForm/LaserForm, entirely
--           outside every domain in the current roadmap) into
--           material_group would be guessing, not importing.
--
-- EXCLUDED FROM THE cost_mexico BACKFILL (staged in sm_reference_data
-- regardless, for audit):
--   * 36 rows priced 'per_sqft' (honeycomb cores, prepregs, PCB copper-foil
--     weights by area) -- a different unit basis than every other regional
--     cost column ($/kg). Writing an area-basis number into a weight-basis
--     column would be a silent unit error, not a data gap.
--   * 'Generic UNUSED' (Stainless Steel, base_cost = null) -- a dead
--     catalog placeholder in the source, not a real material with an
--     unpriced-but-real state.
-- ============================================================================

BEGIN;

-- ── Step 1: lossless staging (audit trail; not read live by the app) ────────
INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
VALUES
${stageRows.join(',\n')}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

-- ── Step 2: backfill cost_mexico (+ gap-fill density/hardness/cut_code) ────
UPDATE raw_materials rm
SET
  cost_mexico = v.cost_mexico,
  density_kg_m3 = COALESCE(rm.density_kg_m3, v.density_kg_m3),
  density = COALESCE(rm.density, v.density),
  hardness = COALESCE(rm.hardness, v.hardness),
  hardness_system = COALESCE(rm.hardness_system, v.hardness_scale),
  cut_code = COALESCE(rm.cut_code, v.cut_coefficient)
FROM (VALUES
${backfillRows.join(',\n')}
) AS v(material, cost_mexico, density_kg_m3, density, hardness, hardness_scale, cut_coefficient)
WHERE rm.material = v.material;

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM raw_materials WHERE cost_mexico IS NOT NULL;
-- -- Expect roughly the number of exact-name matches -- likely most of the
-- -- ${data.length - sqftSkipped - noCostSkipped} per_kg-priced candidate rows, but only for names that
-- -- already existed live -- check against sm_reference_data's 508 staged
-- -- rows to see the full gap if it's notably lower.
-- SELECT count(*) FROM sm_reference_data WHERE category = 'material' AND source_region = 'MEX' AND source_version = '2026-08';
-- -- Expect 508.
-- SELECT material, cost_mexico, cost_usa FROM raw_materials WHERE material IN ('Generic ABS', 'Generic 0.5ozCu') ORDER BY material;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, '--', data.length, 'staged,', backfillRows.length, 'backfill candidates,', sqftSkipped, 'per_sqft skipped,', noCostSkipped, 'no-cost skipped.');
