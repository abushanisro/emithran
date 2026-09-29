#!/usr/bin/env node
// Generates migration 818: seed mhr_records with the real machines of the 11
// remaining memory/Secondary process processes, backfill the capability of the
// 11 CMM rows migration 806 seeded, and give the 11 process catalog rows
// migration 790 created their machine_class.
//
// Same row shape and conventions as gen_806 (CMM Inspection):
//   location        'USA' for every row, as 806 does: these files are the USA
//                   reference export (every labour/overhead rate is the USA
//                   rate). "Machine Manufacturer Location" is where the machine
//                   is BUILT, and goes to manufacturer_country, as in 806. The
//                   value 'Virtual' (Ultrasonic A-Scan / C-Scan) is not a
//                   country, so manufacturer_country is left NULL for it; the
//                   verbatim value stays in specs.machine_manufacturer_location.
//   process_group   'Other Secondary Processes' (the group migration 790 used).
//   MHR             Direct OH + Indirect OH (migration 581). LHR = source labour
//                   rate. wage_grade = the per-process value from
//                   wage_grade_associations.csv (every machine file leaves its
//                   own Wage Grade Name empty).
//   benchmark_source_key '<Process Name>:<Primary ID (Name) | Machine Name>'.
//
// Capability goes into the real mhr_records columns (migration 324) where one
// exists, and ALSO verbatim into specs; process-specific rates/speeds (which the
// cost engine will read) and everything without a column go into specs only.
//
// Run: node backend/migrations/scripts/gen_818_seed_secondary_process_mhr_records.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'memory', 'Secondary process');
const OUT = path.join(__dirname, '..', '818_seed_secondary_process_mhr_records.sql');
const GROUP = 'Other Secondary Processes';
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

// Per process: source file, machine_class, capability columns (real mhr_records
// column <- CSV column), and specs keys (specs key <- CSV column).
const COMMON_SPECS = {
  is_preferred: 'Is Preferred',
  overhead_multiplier: 'Overhead Multiplier',
  machine_manufacturer_location: 'Machine Manufacturer Location',
};
const SCAN_SPECS = {
  surface_scan_rate_mm2_per_s: 'Surface Scan Rate (mm^2 / s)',
  useable_length_mm: 'Useable Length (mm)',
  useable_width_mm: 'Useable Width (mm)',
  useable_height_mm: 'Useable Height (mm)',
  total_overhead_rate_usd_hr: 'Total Overhead Rate (USD / hr)',
  period_overhead_coefficient: 'Period Overhead Coefficient',
};
const SCAN_CAP = { max_x_mm: 'Useable Length (mm)', max_y_mm: 'Useable Width (mm)', max_z_mm: 'Useable Height (mm)' };
const PROCESSES = [
  { name: 'Carton Forming', file: 'carton_forming_machines.csv', cls: 'carton_forming',
    cap: { max_x_mm: 'Max Carton Length (mm)', max_y_mm: 'Max Carton Width (mm)' },
    specs: { max_carton_form_rate_cartons_per_min: 'Max Carton Form Rate (cartons/min)', max_carton_length_mm: 'Max Carton Length (mm)', max_carton_width_mm: 'Max Carton Width (mm)' } },
  { name: 'Carton Sealing', file: 'carton_sealing_machines.csv', cls: 'carton_sealing',
    cap: { max_x_mm: 'Max Carton Length (mm)', max_y_mm: 'Max Carton Width (mm)' },
    specs: { max_carton_seal_rate_cartons_per_min: 'Max Carton Seal Rate (cartons/min)', max_carton_length_mm: 'Max Carton Length (mm)', max_carton_width_mm: 'Max Carton Width (mm)' } },
  { name: 'CT Scan', file: 'ct_scan_machines.csv', cls: 'ct_scan', cap: {}, specs: {} },
  { name: 'Fluorescent Penetrant Testing', file: 'fluorescent_penetrant_testing_machines.csv', cls: 'fluorescent_penetrant_testing', cap: {}, specs: {} },
  { name: 'Hydrostatic Leak Testing', file: 'hydrostatic_leak_testing_machines.csv', cls: 'hydrostatic_leak_testing', cap: {}, specs: {} },
  { name: 'Magnetic Particle Testing', file: 'magnetic_particle_testing_machines.csv', cls: 'magnetic_particle_testing', cap: {}, specs: {} },
  { name: 'Pack & Load', file: 'pack_and_load_machines.csv', cls: 'pack_and_load',
    cap: { max_length_mm: 'Maximum Sealing Length (mm)' },
    specs: { sealing_time_s: 'Sealing Time (s)', maximum_sealing_length_mm: 'Maximum Sealing Length (mm)' } },
  { name: 'Ultrasonic A-Scan', file: 'ultrasonic_a_scan_machines.csv', cls: 'ultrasonic_a_scan', cap: SCAN_CAP, specs: SCAN_SPECS },
  { name: 'Ultrasonic C-Scan', file: 'ultrasonic_c_scan_machines.csv', cls: 'ultrasonic_c_scan', cap: SCAN_CAP, specs: SCAN_SPECS },
  { name: 'Ultrasonic Cleaning', file: 'ultrasonic_cleaning_machines.csv', cls: 'ultrasonic_cleaning',
    cap: { max_x_mm: 'Basket Length (mm)', max_y_mm: 'Basket Width (mm)', max_z_mm: 'Basket Height (mm)' },
    specs: { basket_length_mm: 'Basket Length (mm)', basket_width_mm: 'Basket Width (mm)', basket_height_mm: 'Basket Height (mm)', machine_height_mm: 'Machine Height (mm)' } },
  { name: 'Xray Inspection', file: 'xray_inspection_machines.csv', cls: 'xray_inspection', cap: {},
    specs: { data_source: 'Data Source' } },
];
const CAP_COLS = ['max_x_mm', 'max_y_mm', 'max_z_mm', 'max_length_mm'];

// Every CSV column must end up somewhere: a mapped mhr_records column, a
// capability column, or specs. The generator fails on an unmapped column.
const BASE_MAPPED = new Set([
  'Primary ID (Name)', 'Machine Name', 'Other ID (Description)', 'Labor Rate (USD / hr)',
  'Direct Overhead Rate (USD / hr)', 'Indirect Overhead Rate (USD / hr)', 'Number of Operators',
  'Labor Time Standard', 'Wage Grade Name', 'Work Center Labor Rate Factor', 'Setup Time (hr)',
  'Avg Utilization', 'Good Part Yield', 'Machine Price (USD)', 'Machine Length (mm)', 'Machine Width (mm)',
  'Footprint Allowance Factor', 'Machine Power (kW)', 'Installation Factor (%)', 'Machine Uptime (%)',
  'Annual Maintenance Factor (%)', 'Machine Life (yr)', 'Salvage Value Factor (%)', 'Supplies Cost (USD / yr)',
]);

const wage = read('wage_grade_associations.csv');
const gradeFor = (p) => {
  const g = wage.rows.find((r) => r['Process Name'] === p)?.['Wage Grade Name'];
  if (!g) throw new Error(`No wage grade for "${p}" in wage_grade_associations.csv`);
  return g;
};

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'machine_description', 'currency_code', 'country_code',
  'source_type', 'process_group', 'operators', 'setup_time_hr',
  'landed_machine_cost',
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
  ...CAP_COLS, 'capability_source', 'specs', 'benchmark_source_key',
];

const rows = [];
const report = [];
for (const p of PROCESSES) {
  const rel = `machines/${p.file}`;
  const t = read(rel);
  const specMap = { ...COMMON_SPECS, ...p.specs };
  const mapped = new Set([...BASE_MAPPED, ...Object.values(specMap), ...Object.values(p.cap)]);
  const unmapped = t.columns.filter((c) => !mapped.has(c));
  if (unmapped.length) throw new Error(`${rel}: unmapped column(s) ${unmapped.join(', ')}`);
  for (const col of [...Object.values(specMap), ...Object.values(p.cap)]) {
    if (!t.columns.includes(col)) throw new Error(`${rel}: expected column "${col}" not present`);
  }
  const nameCol = t.columns.includes('Primary ID (Name)') ? 'Primary ID (Name)' : 'Machine Name';
  const grade = gradeFor(p.name);
  const seen = new Set();
  const locations = new Set();
  for (const m of t.rows) {
    const name = m[nameCol] == null ? null : String(m[nameCol]);
    if (!name) throw new Error(`${rel}: row without a machine name`);
    if (seen.has(name)) throw new Error(`${rel}: duplicate machine name ${name}`);
    seen.add(name);
    const direct = m['Direct Overhead Rate (USD / hr)'];
    const indirect = m['Indirect Overhead Rate (USD / hr)'];
    if (typeof direct !== 'number' || typeof indirect !== 'number') throw new Error(`${rel} ${name}: missing overhead rate`);
    const mhr = Math.round((direct + indirect) * 100) / 100; // canonical MHR = Direct + Indirect (migration 581)
    const labour = m['Labor Rate (USD / hr)'];
    const price = m['Machine Price (USD)'];
    const loc = m['Machine Manufacturer Location'];
    locations.add(loc);
    const specs = { source: `memory/Secondary process/${rel}` };
    for (const [k, c] of Object.entries(specMap)) specs[k] = m[c] ?? null;
    const cap = CAP_COLS.map((c) => (p.cap[c] ? m[p.cap[c]] : null));
    const hasCap = cap.some((v) => typeof v === 'number');
    rows.push([
      sqlStr(p.cls), sqlStr('USA'), sqlStr(name), sqlStr(m['Other ID (Description)']), sqlStr('USD'), sqlStr('US'),
      sqlStr('BENCHMARK'), sqlStr(GROUP),
      sqlNum(m['Number of Operators']), sqlNum(m['Setup Time (hr)']),
      sqlNum(typeof price === 'number' && price > 0 ? price : null),
      sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
      sqlNum(mhr), sqlNum(mhr),
      sqlNum(labour), sqlNum(labour), sqlNum(labour),
      sqlNum(m['Work Center Labor Rate Factor']), sqlNum(m['Labor Time Standard']),
      sqlStr(m['Wage Grade Name'] || grade),
      sqlNum(price), sqlNum(m['Machine Length (mm)']), sqlNum(m['Machine Width (mm)']),
      sqlNum(m['Footprint Allowance Factor']), sqlNum(m['Machine Power (kW)']), sqlNum(m['Machine Life (yr)']),
      sqlNum(m['Installation Factor (%)']), sqlNum(m['Machine Uptime (%)']),
      sqlNum(m['Annual Maintenance Factor (%)']), sqlNum(m['Salvage Value Factor (%)']),
      sqlNum(m['Supplies Cost (USD / yr)']), sqlNum(m['Avg Utilization']), sqlNum(m['Good Part Yield']),
      sqlStr(loc === 'Virtual' ? null : loc),
      ...cap.map(sqlNum), sqlStr(hasCap ? 'imported' : null),
      sqlJsonb(specs), sqlStr(`${p.name}:${name}`),
    ]);
  }
  report.push({ process: p.name, cls: p.cls, machines: t.rows.length, grade, locations: [...locations].join('/'),
    cap: Object.entries(p.cap).map(([k, v]) => `${k}<-${v}`).join(', ') || '-', specs: Object.keys(specMap).join(', ') });
}

// CMM capability backfill for the 806 rows.
const cmm = read('machines/cmm_inspection_machines.csv');
const cmmVals = cmm.rows.map((m) => `  (${sqlStr(`CMM Inspection:${m['Primary ID (Name)']}`)}, ${sqlNum(m['Bed Length (mm)'])}, ${sqlNum(m['Bed Width (mm)'])}, ${sqlNum(m['Bed Height (mm)'])}, ${sqlNum(m['Max Allowable Mass (kg)'])})`);

const header = report.map((r) => `--   ${r.process.padEnd(30)} ${r.cls.padEnd(30)} ${String(r.machines).padStart(2)} machine(s)  wage ${r.grade}  mfr location ${r.locations}`).join('\n');
const capNotes = report.map((r) => `--   ${r.cls}: columns ${r.cap}\n--     specs keys: ${r.specs}`).join('\n');
const catVals = PROCESSES.map((p) => `  (${sqlStr(p.name)}, ${sqlStr(p.cls)})`).join(',\n');

const sql = `-- ============================================================================
-- Migration 818: Seed mhr_records with the real Secondary process machines
-- ============================================================================
-- Generated by scripts/gen_818_seed_secondary_process_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Secondary process/machines/*.csv (USA reference export;
-- machines/India is not staged here). ${rows.length} machines, 11 new machine classes:
${header}
--
-- Same row shape as migration 806 (CMM Inspection): location USA on every row
-- (the file is the USA export; every rate in it is a USA rate), process_group
-- ${GROUP}, MHR = Direct OH + Indirect OH (migration 581), LHR = the
-- source labour rate, wage_grade from wage_grade_associations.csv (every
-- machine file leaves its own Wage Grade Name empty). Machine Manufacturer
-- Location is where the machine is built and goes to manufacturer_country, as
-- in 806; the value Virtual (Ultrasonic A-Scan and C-Scan) is not a country, so
-- manufacturer_country stays NULL there and the verbatim value is kept in
-- specs.machine_manufacturer_location.
--
-- mhr_records.machine_class has no CHECK constraint or enum (migration 693
-- audit), so no constraint is extended. Capability goes to the real migration
-- 324 columns where one exists (and verbatim to specs as well); rates, speeds
-- and everything else without a column go to specs only:
${capNotes}
-- Common specs keys on every row: source, is_preferred, overhead_multiplier,
-- machine_manufacturer_location.
--
-- No cost engine reads these classes yet. Statements are independent and
-- idempotent; run them one at a time in the SQL editor.
-- ============================================================================

-- ── 0. specs was dropped by migration 563 and is restored by 814a; added here as
-- well so this file runs on its own. No-op when the column exists.
ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS specs JSONB;

-- ── 1. New machines. Skips any (machine_class, location, machine_name) present.
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

-- ── 2. Capability of the ${cmmVals.length} CMM rows migration 806 seeded (matched by
--      benchmark_source_key). Bed Length/Width/Height -> max_x/max_y/max_z,
--      Max Allowable Mass -> max_workpiece_weight_kg. Only NULL columns are filled.
UPDATE mhr_records m
SET max_x_mm                = COALESCE(m.max_x_mm, v.max_x_mm),
    max_y_mm                = COALESCE(m.max_y_mm, v.max_y_mm),
    max_z_mm                = COALESCE(m.max_z_mm, v.max_z_mm),
    max_workpiece_weight_kg = COALESCE(m.max_workpiece_weight_kg, v.max_workpiece_weight_kg),
    capability_source       = COALESCE(m.capability_source, 'imported')
FROM (VALUES
${cmmVals.join(',\n')}
) AS v(benchmark_source_key, max_x_mm, max_y_mm, max_z_mm, max_workpiece_weight_kg)
WHERE m.machine_class = 'cmm'
  AND m.benchmark_source_key = v.benchmark_source_key
  AND (m.max_x_mm IS NULL OR m.max_y_mm IS NULL OR m.max_z_mm IS NULL OR m.max_workpiece_weight_kg IS NULL);

-- ── 3. Catalog rows migration 790 seeded (machine_class NULL). Only
--      machine_class is set (plus updated_at on the mapping rows). is_active and
--      roadmap_status are NOT touched: the mapping rows stay inactive, which the
--      chk_machine_class_required CHECK allows with or without a machine_class.
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
    updated_at = NOW()
FROM (VALUES
${catVals}
) AS v(operation, machine_class)
WHERE pcm.process_group = '${GROUP}'
  AND pcm.operation = v.operation
  AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT machine_class, count(*) FROM mhr_records
-- WHERE process_group = '${GROUP}' AND location = 'USA' GROUP BY 1 ORDER BY 1;
--   expect ${report.map((r) => `${r.cls} ${r.machines}`).join(', ')}, cmm 11
-- SELECT machine_name, max_x_mm, max_y_mm, max_z_mm, max_workpiece_weight_kg
-- FROM mhr_records WHERE machine_class = 'cmm' ORDER BY machine_name;
-- SELECT process_name, machine_class, roadmap_status FROM process_taxonomy
-- WHERE process_group = '${GROUP}' ORDER BY display_order;
-- SELECT operation, machine_class, is_active FROM process_calculator_mappings
-- WHERE process_group = '${GROUP}' ORDER BY display_order;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log(`Wrote ${path.relative(ROOT, OUT)}: ${rows.length} machines, ${cmmVals.length} CMM capability rows`);
for (const r of report) console.log(`  ${r.cls}: ${r.machines} (wage ${r.grade}, mfr ${r.locations}) cap[${r.cap}] specs[${r.specs}]`);
