#!/usr/bin/env node
// Generates migrations 848 (parts) and 849: promotes the raw materials that were
// staged as JSON rows in machining_reference_data (the old architecture) into
// the real raw_materials table, for every memory/ domain that carried them.
//
// Design (one architecture for every domain):
//   * Core fields every domain shares -> real raw_materials columns
//     (material, material_grade, material_type, cut_code, cost, density, hardness,
//     description, data_source, usa_name, ...). Detected from the header names.
//   * Every other CSV column -> one row of raw_material_properties
//     (raw_material_id, property_key, value_num | value_text, unit, source_version).
//     The unit is read from the header's trailing "(unit)" when present.
//   * Name rule: a material keeps its Source Name. If that name already exists
//     under another group, the record is stored as "<name> (<Group>)" so both
//     records stay (policy 'suffix'). policy 'attach' is for a reference set that
//     raw_materials already holds (plastics, migration 834): the properties attach
//     to the existing row and no duplicate is created.
//   * 849 deletes the JSON rows these domains staged (category 'material').
//
// Run: node backend/migrations/scripts/gen_855_promote_memory_raw_material_domains.js

const fs = require('fs');
const path = require('path');
const { readCsv, sqlStr, sqlNum } = require('./lib/memory-machine-seed');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MEM = path.join(ROOT, 'memory');
const MIG = path.join(__dirname, '..');
const PART_BUDGET = 180000;

const DOMAINS = [
  { key: 'injection_molding', group: 'Plastic Molding', sourceVersion: '2026-Plastic', file: 'Plastic Modeling/materials_final.csv', policy: 'attach', keepJsonRows: true },
  { key: 'forging', group: 'Forging', sourceVersion: '2026-Forging', file: 'Forging/forging_materials.csv', policy: 'suffix' },
  { key: 'additive', group: 'Additive Manufacturing', sourceVersion: '2026-Additive', file: 'Additive Manufacturing/Raw materials.csv', policy: 'suffix' },
  { key: 'composites', group: 'Composites', sourceVersion: '2026-Composites', file: 'Composites/materials.csv', policy: 'suffix' },
  { key: 'pcb', group: 'PCB', sourceVersion: '2026-PCB', file: 'PCBA/raw_materials.csv', policy: 'suffix' },
  // Raw-material masters that were never staged, plus the Die Casting and Casting
  // material tables that the Heena staging wrote as JSON rows.
  { key: 'casting_investment', group: 'Casting Investment', sourceVersion: '2026-CastInvest', file: 'Casting Investment/Raw Material/raw_materials.csv', policy: 'suffix' },
  { key: 'die_casting', group: 'Die Casting', sourceVersion: '2026-DieCasting', file: 'Die Casting/Raw Material/materials_master.csv', policy: 'suffix' },
  { key: 'casting', group: 'Casting', sourceVersion: '2026-Casting', file: 'Casting/Raw Material/materials_FULL_raw_data_v2.csv', policy: 'suffix' },
  { key: 'powder_metal', group: 'Powder Metal', sourceVersion: '2026-PowderMetal', file: 'Powder metal/Raw material/raw_materials.csv', policy: 'suffix' },
  { key: 'rapid_prototyping', group: 'Rapid Prototyping', sourceVersion: '2026-RapidProto', file: 'Rapid prototyping/Raw Materials/raw_materials.csv', policy: 'suffix' },
  { key: 'roto_blow_molding', group: 'Roto & Blow Molding', sourceVersion: '2026-RotoBlow', file: 'Roto & blow molding/Raw materials/raw_materials.csv', policy: 'suffix' },
  { key: 'sheet_plastic', group: 'Sheet Plastic', sourceVersion: '2026-SheetPlastic', file: 'Sheet Plastic/Raw Materials/materials.csv', policy: 'suffix' },
  { key: 'sheet_roll_forming', group: 'Sheet Metal Roll Forming', sourceVersion: '2026-RollForm', file: 'Sheet metal roll forming/Raw Materials/material_master.csv', policy: 'suffix' },
  { key: 'sheet_stretch_forming', group: 'Sheet Metal Stretch Forming', sourceVersion: '2026-StretchForm', file: 'Sheet metal stretch forming/Raw materials/raw_materials_metals.csv', policy: 'suffix' },
  { key: 'sheet_transfer_die', group: 'Sheet Metal Transfer Die', sourceVersion: '2026-TransferDie', file: 'Sheet metal transfer die/Raw Materials/material_master.csv', policy: 'suffix' },
  { key: 'bar_tube_fab', group: 'Bar and Tube Fabrication', sourceVersion: '2026-BarTube', file: 'Bar and tube fab/Raw material/materials.csv', policy: 'suffix' },
  { key: 'assembly_plastic_molding', group: 'Assembly Plastic Molding', sourceVersion: '2026-AssyPlastic', file: 'Assembly plastic molding/Raw Materials/raw_materials_full.csv', policy: 'suffix' },
];

// Header -> core raw_materials column. Anything not listed becomes a property.
const CORE = {
  'Source Name': 'material', sourceName: 'material',
  Name: 'material_grade', name: 'material_grade',
  'Material Type': 'material_type', materialType: 'material_type',
  'Cut Code': 'cut_code', cutCode: 'cut_code',
  'Unit Cost (USD / kg)': 'cost', 'cost.unitCostUsdPerKg': 'cost',
  'Cost Units': 'cost_units', 'cost.costUnits': 'cost_units',
  'Base Cost Per Unit (USD)': 'base_cost_per_unit_usd', 'cost.baseCostPerUnitUsd': 'base_cost_per_unit_usd',
  'Density (kg / m^3)': 'density_kg_m3', 'Density (kg/m^3)': 'density_kg_m3', 'physicalProperties.densityKgM3': 'density_kg_m3',
  'Unit Cost (USD/kg)': 'cost', 'Cost Per KG (USD / kg)': 'cost',
  'Material Type Name': 'material_type',
  Hardness: 'hardness', 'physicalProperties.hardness': 'hardness',
  'Hardness System': 'hardness_system', 'physicalProperties.hardnessSystem': 'hardness_system',
  Description: 'description', description: 'description',
  'Data Source': 'data_source', dataSource: 'data_source',
  'USA Name': 'usa_name', usaName: 'usa_name',
};
// Metadata columns that describe the export, not the material.
const SKIP = new Set(['category', 'materialCount']);
const VENDOR_RE = /a\s*priori/i;
const scrub = (v) => (v != null && VENDOR_RE.test(String(v)) ? 'reference export baseline' : v);

const snake = (s) => s
  .replace(/\(([^()]*)\)\s*$/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();
const unitOf = (header) => {
  const m = /\(([^()]*)\)\s*$/.exec(header);
  return m ? m[1].trim() : null;
};

const sqlOf = (v) => (typeof v === 'number' ? sqlNum(v) : v == null ? 'NULL' : sqlStr(v));
const parts = [];
const deleteSources = [];
const summary = [];

for (const d of DOMAINS) {
  const { rows, columns } = readCsv(path.join(MEM, d.file));
  const hasSource = columns.some((c) => c === 'Source Name' || c === 'sourceName');
  const coreCols = columns.filter((c) => c in CORE);
  const propCols = columns.filter((c) => !(c in CORE) && !SKIP.has(c));
  const val = (row, h) => {
    const v = row[h];
    if (v === null || v === undefined || String(v).trim() === '') return null;
    return typeof v === 'boolean' ? (v ? 'true' : 'false') : v;
  };

  // Core and property values per source row, the name taken from Source Name
  // (or Name, for a file that has only Name).
  const core = [];
  const props = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(hasSource ? (row['Source Name'] ?? row['sourceName']) : row['Name'] ?? row['name'] ?? '').trim();
    if (!name) throw new Error(`${d.file}: row without a material name`);
    if (seen.has(name)) throw new Error(`${d.file}: duplicate material ${name}`);
    seen.add(name);
    const c = {
      material: name, material_grade: null, material_type: null, cut_code: null, cost: null, cost_units: null,
      base_cost_per_unit_usd: null, density_kg_m3: null, density: null, hardness: null, hardness_system: null,
      description: null, data_source: null, usa_name: null,
    };
    for (const h of coreCols) {
      const target = CORE[h];
      if (target === 'material') continue;
      const v = val(row, h);
      if (target === 'material_grade') { c.material_grade = hasSource ? (v == null ? null : String(v)) : null; continue; }
      if (target === 'data_source') { c.data_source = v == null ? null : scrub(String(v)); continue; }
      if (['cost', 'cut_code', 'base_cost_per_unit_usd', 'density_kg_m3', 'hardness'].includes(target)) {
        c[target] = typeof row[h] === 'number' ? row[h] : null;
        continue;
      }
      c[target] = v == null ? null : String(v);
    }
    if (c.density_kg_m3 != null) c.density = Math.round((c.density_kg_m3 / 1000) * 1000) / 1000;
    if (c.cost != null) c.cost_usa = c.cost;
    if (c.cost != null) c.currency = 'USD';
    core.push(c);
    for (const h of propCols) {
      const v = row[h];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      const key = snake(h);
      if (typeof v === 'number') props.push({ name, key, num: v, txt: null, unit: unitOf(h) });
      else props.push({ name, key, num: null, txt: scrub(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v).trim()), unit: unitOf(h) });
    }
  }

  const coreKeys = ['material', 'material_grade', 'material_type', 'material_group', 'cut_code', 'cost', 'cost_usa', 'cost_units',
    'base_cost_per_unit_usd', 'currency', 'density_kg_m3', 'density', 'hardness', 'hardness_system', 'description', 'data_source', 'usa_name'];
  const coreVals = core.map((c) => `  (${[
    sqlOf(c.material), sqlOf(c.material_grade), sqlOf(c.material_type), sqlOf(d.group), sqlOf(c.cut_code), sqlOf(c.cost), sqlOf(c.cost_usa),
    sqlOf(c.cost_units), sqlOf(c.base_cost_per_unit_usd), sqlOf(c.currency), sqlOf(c.density_kg_m3), sqlOf(c.density),
    sqlOf(c.hardness), sqlOf(c.hardness_system), sqlOf(c.description), sqlOf(c.data_source), sqlOf(c.usa_name),
  ].join(', ')})`);
  const propVals = props.map((p) => `  (${[sqlStr(p.name), sqlStr(p.key), sqlOf(p.num), sqlOf(p.txt), sqlOf(p.unit)].join(', ')})`);

  // The target name is decided in SQL against the live table (see the policy).
  const srcCte = `src AS (
  SELECT v.*,
    ${d.policy === 'suffix'
      ? `CASE WHEN EXISTS (SELECT 1 FROM raw_materials rm WHERE rm.material = v.material AND rm.material_group IS DISTINCT FROM '${d.group}')
         THEN v.material || ' (${d.group})' ELSE v.material END`
      : 'v.material'} AS material_name
  FROM (VALUES
${coreVals.join(',\n')}
  ) AS v(${coreKeys.join(', ')})
)`;
  const insertWhere = d.policy === 'suffix'
    ? 'WHERE NOT EXISTS (SELECT 1 FROM raw_materials rm WHERE rm.material = s.material_name)'
    : 'WHERE NOT EXISTS (SELECT 1 FROM raw_materials rm WHERE rm.material = s.material_name)';
  // A column that is NULL in every row of one VALUES list is typed as text, so
  // each numeric target is cast explicitly, never left to inference.
  const NUMERIC_CORE = new Set(['cut_code', 'cost', 'cost_usa', 'base_cost_per_unit_usd', 'density_kg_m3', 'density', 'hardness']);
  const selectCols = coreKeys.map((c) => {
    if (c === 'material') return 's.material_name';
    return NUMERIC_CORE.has(c) ? `CAST(s.${c} AS NUMERIC)` : `s.${c}`;
  }).join(', ');

  const core_sql = `-- ── ${d.group}: core columns (${core.length} materials, policy ${d.policy})
WITH ${srcCte}
INSERT INTO raw_materials (${coreKeys.join(', ')})
SELECT ${selectCols}
FROM src s
${insertWhere};`;

  const propChunks = [];
  let cur = [], curBytes = 0;
  for (const pv of propVals) {
    const n = Buffer.byteLength(pv) + 2;
    if (curBytes + n > PART_BUDGET && cur.length) { propChunks.push(cur); cur = []; curBytes = 0; }
    cur.push(pv); curBytes += n;
  }
  if (cur.length) propChunks.push(cur);
  const prop_sql = propChunks.map((chunk, i) => `-- ── ${d.group}: properties ${i + 1}/${propChunks.length}
WITH ${srcCte},
props(source_name, property_key, value_num, value_text, unit) AS (VALUES
${chunk.join(',\n')}
)
INSERT INTO raw_material_properties (raw_material_id, property_key, value_num, value_text, unit, source_version)
SELECT t.id, p.property_key, CAST(p.value_num AS NUMERIC), CAST(p.value_text AS TEXT), CAST(p.unit AS TEXT), '${d.sourceVersion}'
FROM props p
JOIN src s ON s.material = p.source_name
JOIN LATERAL (
  SELECT rm.id FROM raw_materials rm
  WHERE rm.material = s.material_name
  ORDER BY (rm.material_group = '${d.group}') DESC
  LIMIT 1
) t ON true
ON CONFLICT (raw_material_id, property_key) DO NOTHING;`);

  parts.push(...[core_sql, ...prop_sql]);
  // Plastic costing still reads one JSON row (GPPS, plastic-reference.service.ts),
  // so its JSON rows stay until that reader moves to raw_material_properties.
  if (!d.keepJsonRows) deleteSources.push(d.sourceVersion);
  summary.push(`--   ${d.group.padEnd(24)} ${String(core.length).padStart(4)} materials, ${String(props.length).padStart(5)} properties, policy ${d.policy}`);
}

// Table + columns (first part).
const header = `-- ============================================================================
-- Migration 855: memory/ raw materials as real columns and raw_material_properties
-- ============================================================================
-- Generated by scripts/gen_855_promote_memory_raw_material_domains.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Domains (the materials that were staged as JSON rows in machining_reference_data):
${summary.join('\n')}
--
-- Core fields -> raw_materials columns. Every other source column -> one row of
-- raw_material_properties. Name rule: 'suffix' stores a colliding name as
-- "<name> (<Group>)"; 'attach' attaches to the existing reference row.
--
-- Run every part in order: part 1 creates the table; each later part is
-- idempotent (ON CONFLICT DO NOTHING / NOT EXISTS). Migration 856 deletes the
-- JSON rows, and runs after every part of this migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS raw_material_properties (
  raw_material_id UUID NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  property_key    TEXT NOT NULL,
  value_num       NUMERIC,
  value_text      TEXT,
  unit            TEXT,
  source_version  VARCHAR(20) NOT NULL,
  PRIMARY KEY (raw_material_id, property_key)
);
CREATE INDEX IF NOT EXISTS raw_material_properties_source_idx ON raw_material_properties (source_version);

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS usa_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS cost_units VARCHAR(50),
  ADD COLUMN IF NOT EXISTS base_cost_per_unit_usd DECIMAL(12,4);

`;

// Split the generated statements into parts of bounded size.
const groups = [];
let g = [], gBytes = 0;
for (const stmt of parts) {
  const n = Buffer.byteLength(stmt) + 2;
  if (gBytes + n > PART_BUDGET && g.length) { groups.push(g); g = []; gBytes = 0; }
  g.push(stmt); gBytes += n;
}
if (g.length) groups.push(g);

const BASE = '855_promote_memory_raw_materials';
for (const old of fs.readdirSync(MIG).filter((n) => n.startsWith(`${BASE}_part`))) fs.unlinkSync(path.join(MIG, old));
groups.forEach((gp, i) => {
  const body = gp.join('\n\n');
  const text = (i === 0 ? header : `-- Migration 855 part ${i + 1} of ${groups.length}\n\n`) + body + '\n';
  fs.writeFileSync(path.join(MIG, `${BASE}_part${i + 1}of${groups.length}.sql`), text, 'utf8');
});

const sources = deleteSources.map((s) => `'${s}'`).join(', ');
fs.writeFileSync(path.join(MIG, '856_remove_memory_raw_material_json_staging.sql'), `-- ============================================================================
-- Migration 856: remove the memory/ raw materials staged as JSON
-- ============================================================================
-- Migration 855 moved these materials into raw_materials and raw_material_properties.
-- This deletes only the old JSON rows: category 'material' under the source
-- versions of the domains 848 promoted. Lookups, variables, processes, operations
-- and wage grades are not touched.
--
-- Run after every part of 855. Idempotent: a second run deletes nothing.
-- ============================================================================

DELETE FROM machining_reference_data
WHERE category = 'material'
  AND source_version IN (${sources});

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0):
--   SELECT count(*) FROM machining_reference_data
--   WHERE category = 'material' AND source_version IN (${sources});
`, 'utf8');

console.log(`Wrote ${groups.length} part(s) of 848 and 849.`);
console.log(summary.join('\n'));
