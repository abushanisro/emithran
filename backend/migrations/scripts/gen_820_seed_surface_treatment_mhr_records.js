#!/usr/bin/env node
// Generates migration 820: seed mhr_records with every machine in
// memory/SurfaceTreatment/Machine/*.csv (USA reference export), the same row
// shape as migrations 806/818, so they appear on HR Rates under process_group
// 'Surface Treatment' and the surface-treatment engine can select them.
//
// Every machine file shares the common rate/economics columns; the remaining,
// process-specific columns (tank/booth/chamber sizes, spray/blast rates,
// plating cost per area, anodizing stage times, ...) are copied verbatim into
// specs under a snake_case key derived from the column name. Where a file has
// a clear work envelope, it also fills the capability columns (migration 324).
// An unmapped or unexpected column fails the generator: nothing is dropped.
//
// Run: node backend/migrations/scripts/gen_820_seed_surface_treatment_mhr_records.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'SurfaceTreatment');
const OUT = path.join(__dirname, '..', '820_seed_surface_treatment_mhr_records.sql');
const GROUP = 'Surface Treatment';
const VENDOR_RE = /a\s*priori/i;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}
const clean = (v) => (VENDOR_RE.test(v) ? 'reference export baseline' : v);
function cell(v) {
  const t = clean(String(v ?? '').trim());
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  return t;
}
function read(rel) {
  const t = parseCsv(fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/^﻿/, ''));
  const columns = t[0].map((h) => h.trim());
  const rows = t.slice(1).map((r) => {
    if (r.length !== columns.length) throw new Error(`${rel}: row has ${r.length} cells for ${columns.length} columns`);
    return Object.fromEntries(columns.map((h, i) => [h, cell(r[i])]));
  });
  return { columns, rows };
}
const sqlStr = (v) => (v === null || v === undefined || String(v).trim() === '' ? 'NULL' : `$str$${String(v).trim()}$str$`);
const sqlNum = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));
const sqlJsonb = (o) => `$jsonb$${JSON.stringify(o)}$jsonb$::jsonb`;
// "Spray Rate (mm^2 / s)" -> spray_rate_mm2_per_s ; "Seal Time (min)" -> seal_time_min
const specKey = (col) => col
  .replace(/\(([^)]*)\)/g, (_, u) => ' ' + u.replace(/\^2/g, '2').replace(/\^3/g, '3').replace(/\s*\/\s*/g, ' per ').replace(/%/g, 'pct').replace(/µ/g, 'u'))
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// file -> process name (surface_treatment_processes.csv), machine_class,
// and the envelope columns that bound the part (length, width, height, weight).
const FILES = [
  ['anodizing_machines.csv', 'Anodize', ['Loadbar Window Length (mm)', 'Loadbar Window Width (mm)', 'Loadbar Window Height (mm)', null]],
  ['bead_blast_machine.csv', 'Bead Blast', [null, null, null, null]],
  ['black_oxide_machines.csv', 'Black Oxide', ['Bath Length (mm)', 'Bath Width (mm)', 'Bath Height (mm)', 'Max Allowable Weight (kg)']],
  ['cadmium_plating_machine.csv', 'Cadmium Plating', [null, null, null, null]],
  ['conveyor_abrasive_finishing_machines.csv', 'Conveyor Abrasive Finishing', [null, 'Conveyor Belt Width (mm)', 'Max Opening Height (mm)', null]],
  ['conveyor_dry_machines.csv', 'Conveyor Dry', [null, 'Opening Width (mm)', 'Max Nesting Height (mm)', null]],
  ['conveyor_oven_cure_machines.csv', 'Conveyor Oven Cure', [null, 'Opening Width (mm)', 'Max Nesting Height (mm)', null]],
  ['conveyor_powder_coating_machines.csv', 'Conveyor Powder Coating', [null, 'Opening Width (mm)', 'Max Nesting Height (mm)', null]],
  ['conveyor_shot_blast_machines.csv', 'Conveyor Shot Blast', [null, 'Opening Width (mm)', 'Max Nesting Height (mm)', null]],
  ['decorative_chrome_machine.csv', 'Decorative Chrome Plating', [null, null, null, null]],
  ['default_loading_area_machine.csv', 'Conveyor Part Loading', ['Loading Area Length (mm)', 'Loading Area Width (mm)', 'Max Nesting Height (mm)', null]],
  ['default_unloading_area_machine.csv', 'Conveyor Part Unloading', ['Unloading Area Length (mm)', 'Unloading Area Width (mm)', 'Max Nesting Height (mm)', null]],
  ['degrease_machines.csv', 'Degrease', ['Conveyor Window Length (mm)', 'Conveyor Window Width (mm)', 'Conveyor Window Height (mm)', 'Conveyor Weight Limit (kg)']],
  ['dot_peen_machines.csv', 'Dot Peen', [null, null, null, null]],
  ['hard_chrome_machine.csv', 'Hard Chrome Plating', [null, null, null, null]],
  ['laser_engraving_machines.csv', 'Laser Engraving', ['Bed Length (mm)', 'Bed Width (mm)', 'Max Height (mm)', 'Max Allowable Weight (kg)']],
  ['manual_paint_machines.csv', 'Manual Paint', ['Useable Length (mm)', 'Useable Width (mm)', 'Useable Height (mm)', null]],
  ['mask_bench_machine.csv', 'Mask-Bench', [null, null, null, null]],
  ['mask_spray_machines.csv', 'Mask-Spray', ['Useable Length (mm)', 'Useable Width (mm)', 'Useable Height (mm)', null]],
  ['nickel_plating_machine.csv', 'Nickel Plating', [null, null, null, null]],
  ['oven_cure_machines.csv', 'Oven Cure', ['Oven Length (mm)', 'Oven Width (mm)', 'Oven Height (mm)', null]],
  ['painting_machines.csv', 'Painting', [null, null, null, null]],
  ['passivation_machines.csv', 'Passivation', ['Machine Window Length (mm)', 'Machine Window Width (mm)', 'Machine Height Limit (mm)', 'Machine Weight Limit (kg)']],
  ['powder_coat_cart_machines.csv', 'Powder Coat Cart', ['Booth Length (mm)', 'Booth Width (mm)', 'Booth Height (mm)', 'Cart Weight Limit (kg)']],
  ['sand_blast_machine.csv', 'Sand Blast', [null, null, null, null]],
  ['screen_printing_machines.csv', 'Screen Printing', [null, null, null, null]],
  ['shot_blast_machines.csv', 'Shot Blast', ['Chamber Length (mm)', 'Chamber Width (mm)', 'Chamber Height (mm)', 'Weight Capacity (kg)']],
  ['shot_peen_machines.csv', 'Shot Peen', [null, null, null, null]],
  ['vibratory_finishing_machines.csv', 'Vibratory Finishing', ['Container Length (mm)', 'Container Width (mm)', 'Container Depth (mm)', 'Weight Limit (kg)']],
  ['wet_coat_line_machines.csv', 'Wet Coat Line', ['Loadbar Window Length (mm)', null, 'Loadbar Window Height (mm)', 'Loadbar Weight Limit (kg)']],
  ['zinc_plating_machines.csv', 'Zinc Plating', [null, null, null, null]],
];
const classOf = (process) => 'surface_' + process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Common columns and the mhr_records column each lands in. Some files spell
// "USD/hr" without spaces; both spellings map.
const BASE = {
  'Labor Rate (USD / hr)': 'labour', 'Labor Rate (USD/hr)': 'labour',
  'Direct Overhead Rate (USD / hr)': 'direct', 'Direct Overhead Rate (USD/hr)': 'direct',
  'Indirect Overhead Rate (USD / hr)': 'indirect', 'Indirect Overhead Rate (USD/hr)': 'indirect',
  'Number of Operators': 'operators', 'Labor Time Standard': 'lts', 'Wage Grade Name': 'grade',
  'Work Center Labor Rate Factor': 'wclrf', 'Setup Time (hr)': 'setup', 'Avg Utilization': 'util',
  'Good Part Yield': 'yield', 'Machine Price (USD)': 'price', 'Machine Length (mm)': 'mlen',
  'Machine Width (mm)': 'mwid', 'Footprint Allowance Factor': 'faf', 'Machine Power (kW)': 'kw',
  'Installation Factor (%)': 'inst', 'Machine Uptime (%)': 'uptime', 'Annual Maintenance Factor (%)': 'maint',
  'Machine Life (yr)': 'life', 'Salvage Value Factor (%)': 'salv', 'Supplies Cost (USD / yr)': 'supplies',
  'Supplies Cost (USD/yr)': 'supplies', 'Machine Manufacturer Location': 'mfr',
  'Name': 'name', 'Description': 'description',
};

const processRows = read('surface_treatment_processes.csv').rows;
const processes = processRows.map((r) => r['Process Name']);
// A machine file can carry another process's default machine (zinc_plating_
// machines.csv holds "Default Zinc Nickel Plating", the Zinc Nickel Plating
// default). Such a row belongs to the process that names it as its default.
const processOfDefault = new Map(processRows.filter((r) => r['Default Machine']).map((r) => [String(r['Default Machine']), r['Process Name']]));
const wage = read('surface_treatment_wage_grades.csv').rows;
const gradeFor = (p) => {
  const g = wage.find((r) => r['Process Name'] === p)?.['Wage Grade Name'];
  if (!g) throw new Error(`No wage grade for "${p}"`);
  return g;
};

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'machine_description', 'currency_code', 'country_code',
  'source_type', 'process_group', 'operators', 'setup_time_hr', 'landed_machine_cost',
  'direct_overhead_rate', 'indirect_overhead_rate',
  'benchmark_direct_overhead_rate_usd_hr', 'benchmark_indirect_overhead_rate_usd_hr',
  'total_machine_hour_rate', 'mhr_usd_per_hour',
  'usd_labor_rate_per_hr', 'benchmark_labor_rate_usd_hr', 'usd_lhr_total',
  'work_center_labor_rate_factor', 'labor_time_standard', 'wage_grade',
  'machine_price_usd', 'machine_length_mm', 'machine_width_mm',
  'footprint_allowance_factor', 'machine_power_kw', 'machine_life_yr',
  'installation_factor_pct', 'machine_uptime_pct', 'annual_maintenance_factor_pct',
  'salvage_value_factor_pct', 'supplies_cost_per_year', 'avg_utilization',
  'good_part_yield', 'manufacturer_country',
  'max_x_mm', 'max_y_mm', 'max_z_mm', 'max_workpiece_weight_kg',
  'capability_source', 'specs', 'benchmark_source_key',
];

const onDisk = fs.readdirSync(path.join(SRC, 'Machine')).filter((f) => f.endsWith('.csv')).sort();
const listed = new Set(FILES.map((f) => f[0]));
const missingFromTable = onDisk.filter((f) => !listed.has(f));
if (missingFromTable.length) throw new Error(`Machine files not mapped: ${missingFromTable.join(', ')}`);

const rows = [];
const report = [];
for (const [file, process, env] of FILES) {
  if (!processes.includes(process)) throw new Error(`${file}: process "${process}" not in surface_treatment_processes.csv`);
  const rel = `Machine/${file}`;
  const t = read(rel);
  for (const c of env) if (c && !t.columns.includes(c)) throw new Error(`${rel}: envelope column "${c}" missing`);
  const specCols = t.columns.filter((c) => !(c in BASE));
  const seen = new Set();
  const counts = new Map();
  for (const m of t.rows) {
    const name = m['Name'] == null ? null : String(m['Name']);
    const rowProcess = processOfDefault.get(name) ?? process;
    const cls = classOf(rowProcess);
    const grade = gradeFor(rowProcess);
    counts.set(rowProcess, (counts.get(rowProcess) ?? 0) + 1);
    if (!name) throw new Error(`${rel}: row without a Name`);
    if (seen.has(name)) throw new Error(`${rel}: duplicate machine name ${name}`);
    seen.add(name);
    const get = (k) => { const col = Object.keys(BASE).find((c) => BASE[c] === k && c in m); return col ? m[col] : null; };
    const direct = get('direct');
    const indirect = get('indirect');
    if (typeof direct !== 'number' || typeof indirect !== 'number') throw new Error(`${rel} ${name}: missing overhead rate`);
    const mhr = Math.round((direct + indirect) * 100) / 100; // MHR = Direct + Indirect (migration 581)
    const labour = get('labour');
    const price = get('price');
    const loc = get('mfr');
    const specs = { source: `memory/SurfaceTreatment/${rel}` };
    for (const c of specCols) specs[specKey(c)] = m[c];
    const cap = env.map((c) => (c ? m[c] : null));
    const hasCap = cap.some((v) => typeof v === 'number' && v > 0);
    rows.push([
      sqlStr(cls), sqlStr('USA'), sqlStr(name), sqlStr(get('description')), sqlStr('USD'), sqlStr('US'),
      sqlStr('BENCHMARK'), sqlStr(GROUP),
      sqlNum(get('operators')), sqlNum(get('setup')),
      sqlNum(typeof price === 'number' && price > 0 ? price : null),
      sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
      sqlNum(mhr), sqlNum(mhr),
      sqlNum(labour), sqlNum(labour), sqlNum(labour),
      sqlNum(get('wclrf')), sqlNum(get('lts')), sqlStr(get('grade') || grade),
      sqlNum(price), sqlNum(get('mlen')), sqlNum(get('mwid')),
      sqlNum(get('faf')), sqlNum(get('kw')), sqlNum(get('life')),
      sqlNum(get('inst')), sqlNum(get('uptime')), sqlNum(get('maint')),
      sqlNum(get('salv')), sqlNum(get('supplies')), sqlNum(get('util')), sqlNum(get('yield')),
      sqlStr(loc === 'Virtual' ? null : loc),
      ...cap.map((v) => sqlNum(typeof v === 'number' && v > 0 ? v : null)), sqlStr(hasCap ? 'imported' : null),
      sqlJsonb(specs), sqlStr(`${rowProcess}:${name}`),
    ]);
  }
  for (const [p, n] of counts) report.push({ process: p, cls: classOf(p), n, grade: gradeFor(p), specs: specCols.map(specKey) });
}

const noMachine = processes.filter((p) => !report.some((r) => r.process === p));
const header = report.map((r) => `--   ${r.process.padEnd(28)} ${r.cls.padEnd(38)} ${String(r.n).padStart(2)} machine(s)  wage ${r.grade}`).join('\n');
const specNotes = report.map((r) => `--   ${r.cls}: ${r.specs.join(', ')}`).join('\n');
const catVals = report.map((r) => `  (${sqlStr(r.process)}, ${sqlStr(r.cls)})`).join(',\n');

const sql = `-- ============================================================================
-- Migration 820: Seed mhr_records with the real Surface Treatment machines
-- ============================================================================
-- Generated by scripts/gen_820_seed_surface_treatment_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/SurfaceTreatment/Machine/*.csv (USA reference export).
-- ${rows.length} machines, ${report.length} machine classes, process_group ${GROUP}:
${header}
--
-- Processes with NO machine file in the reference (not seeded, disclosed):
--   ${noMachine.join(', ')}
--
-- Same row shape as migrations 806 and 818: location USA, MHR = Direct OH +
-- Indirect OH (migration 581), LHR = the source labour rate, wage grade from
-- surface_treatment_wage_grades.csv when the machine row leaves it empty,
-- benchmark_source_key = Process:Machine (HR Rates groups by it). The work
-- envelope fills max_x/max_y/max_z_mm and max_workpiece_weight_kg where the
-- file has one; every process-specific column is copied verbatim to specs:
${specNotes}
--
-- Statements are independent and idempotent; run them one at a time.
-- ============================================================================

-- ── 0. specs was dropped by migration 563 and is restored by 814a; added here as
-- well so this file runs on its own. No-op when the column exists.
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS specs JSONB;

-- ── 1. Machines. Skips any (machine_class, location, machine_name) present.
INSERT INTO mhr_records (
  ${COLUMNS.join(', ')}
)
SELECT v.* FROM (VALUES
${rows.map((r) => `  (${r.join(', ')})`).join(',\n')}
) AS v(${COLUMNS.join(', ')})
WHERE NOT EXISTS (
  SELECT 1 FROM mhr_records m
  WHERE m.machine_class = v.machine_class
    AND m.location = v.location
    AND lower(trim(m.machine_name)) = lower(trim(v.machine_name))
);

-- ── 2. Catalog rows migration 790 seeded with no machine_class. Only rows whose
--      machine_class is still NULL are touched (the rows migration 791 wired to
--      the surface_treatment class are left as they are).
UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
${catVals}
) AS v(process_name, machine_class)
WHERE pt.process_group = '${GROUP}'
  AND pt.process_name = v.process_name
  AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class,
    updated_at    = now()
FROM (VALUES
${catVals}
) AS v(operation, machine_class)
WHERE pcm.process_group = '${GROUP}'
  AND pcm.operation = v.operation
  AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

-- Verify: SELECT machine_class, count(*) FROM mhr_records
-- WHERE process_group = '${GROUP}' AND benchmark_source_key IS NOT NULL GROUP BY 1 ORDER BY 1;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${rows.length} machines in ${report.length} classes`);
console.log(`no machine file: ${noMachine.join(', ')}`);
for (const r of report) console.log(`${r.cls}: ${r.n} | ${r.specs.join(', ')}`);
