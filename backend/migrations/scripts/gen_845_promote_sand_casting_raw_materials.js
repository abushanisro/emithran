#!/usr/bin/env node
// Generates migration 845: the Sand Casting raw materials from
// memory/Sand casting/Raw Material/raw_materials.csv, as real columns of the
// live raw_materials table (no JSON). Every CSV property has a column.
//
//   1. ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS - one column per CSV
//      property raw_materials does not have yet. Existing columns are reused.
//   2. INSERT the materials not yet present (NOT EXISTS on material). A name
//      already in raw_materials is skipped, never overwritten.
//   3. UPDATE the Sand Casting rows already present, so the new columns are
//      filled for rows an earlier run inserted before the columns existed.
//      Only material_group = 'Sand Casting' rows are touched.
//
// Run: node backend/migrations/scripts/gen_845_promote_sand_casting_raw_materials.js

const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, sqlNum } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Sand casting', 'Raw Material', 'raw_materials.csv');
const OUT = path.join(__dirname, '..', '845_promote_sand_casting_raw_materials.sql');
const GROUP = 'Sand Casting';

// [raw_materials column, how its value is read].
// A string is a CSV header read as text, 'num' reads it as a number, and a
// function computes it. Existing raw_materials columns are reused as they are.
const COLUMNS = [
  ['material',                     'Source Name'],
  ['material_grade',               'Name'],
  ['material_type',                'Material Type'],
  ['material_group',               () => GROUP],
  ['cut_code',                     { header: 'Cut Code', num: true }],
  ['usa_name',                     'USA Name'],
  ['din_name',                     'DIN Name'],
  ['en_name',                      'EN Name'],
  ['gb_name',                      'GB Name'],
  ['jis_name',                     'JIS Name'],
  ['description',                  'Description'],
  ['cost',                         { header: 'Unit Cost (USD / kg)', num: true }],
  ['cost_usa',                     { header: 'Unit Cost (USD / kg)', num: true }],
  ['cost_units',                   'Cost Units'],
  ['base_cost_per_unit_usd',       { header: 'Base Cost Per Unit (USD)', num: true }],
  ['currency',                     () => 'USD'],
  ['density_kg_m3',                { header: 'Density (kg / m^3)', num: true }],
  ['density',                      { header: 'Density (kg / m^3)', gcm3: true }],
  ['heat_of_fusion_j_kg',          { header: 'Heat of Fusion (J / kg)', num: true }],
  ['specific_heat_rt_j_kg_k',      { header: 'Specific Heat RT (J / kg * K)', num: true }],
  ['specific_heat_solidus_j_kg_k', { header: 'Specific Heat at Solidus Temperature (J / kg * K)', num: true }],
  ['thermal_conductivity_w_m_c',   { header: 'Thermal Conductivity (W / m * celsius)', num: true }],
  ['cooling_factor_s_mm',          { header: 'Cooling Factor (s / mm)', num: true }],
  ['hardness',                     { header: 'Hardness', num: true }],
  ['hardness_system',              'Hardness System'],
  ['ejection_temp_c',              { header: 'Ejection Temp (C)', num: true }],
  ['injection_temp_c',             { header: 'Injection Temp (C)', num: true }],
  ['liquidus_temp_c',              { header: 'Liquidus Temp (C)', num: true }],
  ['solidus_temp_c',               { header: 'Solidus Temp (C)', num: true }],
  ['mold_temp_c',                  { header: 'Mold Temp (C)', num: true }],
  ['yield_loss_factor',            { header: 'Yield Loss Factor', num: true }],
  ['data_source',                  { header: 'Data Source', vendorScrub: true }],
];

// Columns raw_materials does not have yet, with their types.
const NEW_COLUMN_TYPES = {
  usa_name: 'VARCHAR(255)', din_name: 'VARCHAR(255)', en_name: 'VARCHAR(255)', gb_name: 'VARCHAR(255)', jis_name: 'VARCHAR(255)',
  description: 'TEXT', cost_units: 'VARCHAR(50)', base_cost_per_unit_usd: 'DECIMAL(12,4)',
  heat_of_fusion_j_kg: 'DECIMAL(14,2)', specific_heat_rt_j_kg_k: 'DECIMAL(12,2)', specific_heat_solidus_j_kg_k: 'DECIMAL(12,2)',
  thermal_conductivity_w_m_c: 'DECIMAL(10,3)', cooling_factor_s_mm: 'DECIMAL(10,4)',
  ejection_temp_c: 'DECIMAL(8,2)', injection_temp_c: 'DECIMAL(8,2)', liquidus_temp_c: 'DECIMAL(8,2)', solidus_temp_c: 'DECIMAL(8,2)',
  yield_loss_factor: 'DECIMAL(6,3)', data_source: 'TEXT',
};

const VENDOR_RE = /a\s*priori/i;
const scrub = (v) => (v != null && VENDOR_RE.test(String(v)) ? 'reference export baseline' : v);

const { rows } = readCsv(SRC);
const seen = new Set();
const valueOf = (row, spec) => {
  if (typeof spec === 'function') return spec();
  if (typeof spec === 'string') {
    const v = row[spec];
    return v == null || String(v).trim() === '' ? null : String(v).trim();
  }
  const v = row[spec.header];
  if (spec.num) return typeof v === 'number' ? v : null;
  if (spec.gcm3) return typeof v === 'number' ? Math.round((v / 1000) * 1000) / 1000 : null;
  if (spec.vendorScrub) return v == null ? null : scrub(String(v).trim());
  throw new Error(`bad column spec for ${spec.header}`);
};
const sqlOf = (v) => (typeof v === 'number' ? sqlNum(v) : v == null ? 'NULL' : sqlStr(v));

const cols = COLUMNS.map(([c]) => c);
const tuples = rows.map((row) => {
  const name = row['Source Name'];
  if (!name) throw new Error(`raw material row without a Source Name: ${row['Name']}`);
  if (seen.has(name)) throw new Error(`duplicate Source Name in source: ${name}`);
  seen.add(name);
  return `  (${COLUMNS.map(([, spec]) => sqlOf(valueOf(row, spec))).join(', ')})`;
});

const newCols = cols.filter((c) => c in NEW_COLUMN_TYPES);
const alter = newCols.map((c) => `  ADD COLUMN IF NOT EXISTS ${c} ${NEW_COLUMN_TYPES[c]}`).join(',\n');
const updateSet = cols.filter((c) => c !== 'material').map((c) => `  ${c} = v.${c}`).join(',\n');

const sql = `-- ============================================================================
-- Migration 845: Sand Casting raw materials as real raw_materials columns
-- ============================================================================
-- Generated by scripts/gen_845_promote_sand_casting_raw_materials.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Sand casting/Raw Material/raw_materials.csv (${rows.length} materials).
-- Every CSV property is a real column, no JSON. Added columns:
--   ${newCols.join(', ')}
--
-- 1. Adds the new columns (IF NOT EXISTS; existing columns are reused).
-- 2. Inserts the materials not yet present. A name already in raw_materials
--    is SKIPPED, never overwritten.
-- 3. Fills the new columns on Sand Casting rows already present, so an earlier
--    run is brought up to date. Only material_group = '${GROUP}' is touched.
--
-- Idempotent: a second run changes nothing.
-- ============================================================================

-- ── 1. columns
ALTER TABLE raw_materials
${alter};

-- ── 2. insert missing materials
INSERT INTO raw_materials (${cols.join(', ')})
SELECT v.${cols.join(', v.')}
FROM (VALUES
${tuples.join(',\n')}
) AS v(${cols.join(', ')})
WHERE NOT EXISTS (
  SELECT 1 FROM raw_materials rm WHERE rm.material = v.material
);

-- ── 3. fill the new columns on Sand Casting rows already present
UPDATE raw_materials rm
SET
${updateSet}
FROM (VALUES
${tuples.join(',\n')}
) AS v(${cols.join(', ')})
WHERE rm.material = v.material AND rm.material_group = '${GROUP}';

NOTIFY pgrst, 'reload schema';

-- Verify (run manually after):
--   SELECT count(*) FROM raw_materials WHERE material_group = '${GROUP}';
--   Names skipped (already present in another group) are listed by
--   scripts/845_verify_skipped_names.sql.
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${rows.length} materials, ${newCols.length} new columns`);
