// Generator: seeds mhr_records with the real Assembly machines from
// memory/Assembly/Machines/*.csv -- Phase 2 of the multi-group MHR/LHR
// seeding program (Phase 1 was Additive Manufacturing, migration 793).
//
// Same 38-column shape and value-mapping discipline as migration 738 (see
// that migration/gen_793's own headers). Two real source shapes exist here,
// both handled:
//   - "wide" tables, one row per machine (the 9 welding-family files) --
//     header-name variance across files (e.g. "Installation Factor (%)" vs
//     "Installation Percent (%)") handled via a tolerant pick() by column
//     label, same discipline as gen_738's own pick().
//   - "transposed" single-machine files (Field,Value pairs -- the 9
//     manual/bench-tool files: Fay/Fillet/Cap Sealing, Mechanical Assembly,
//     Pick and Place, Rivet, Threaded Insert, Weld Clean Up, Weld Prep).
//
// machine_class collision check (verified directly against MACHINE_REGISTRY
// in default-rates.constants.ts and classifyMachineRecord's hasKeyword
// \b-boundary matching in selector.ts, same rigor as gen_793):
//   'ultrasonic_welding' WOULD collide -- the already-registered 'cleaning'
//   class lists bare 'Ultrasonic' as a machineClassKeywords entry, and
//   hasKeyword's \b anchor matches at the START of a string ('_' counts as a
//   word character, so it only fails to match mid-string). Renamed to
//   'assembly_ultrasonic_welding', which does not begin with "ultrasonic" and
//   so cannot trigger that boundary match.
//   Every other candidate slug (cap_sealing, fay_sealing, fillet_sealing,
//   mechanical_assembly, pick_and_place, rivet, threaded_insert,
//   weld_clean_up, weld_prep, electron_beam_welding, lock_bolt,
//   manual_mig_welding, manual_spot_welding, manual_tig_welding,
//   robotic_mig_welding, robotic_spot_welding, robotic_tig_welding) was
//   checked against every machineClassKeywords entry and found clear.
//
// process_family: 'weldment' (a real, already-established value in this
// column -- see migration 789's own header) for the 9 genuine welding
// processes (Electron Beam/Manual MIG/Manual Spot/Manual TIG/Robotic MIG/
// Robotic Spot/Robotic TIG/Ultrasonic Welding, Weld Clean Up, Weld Prep --
// that is 10, see below) and a new, disclosed 'assembly' value (not
// previously used anywhere in this column -- introduced here, not assumed
// established) for the remaining mechanical/bonding processes (Cap/Fay/
// Fillet Sealing, Lock Bolt, Mechanical Assembly, Pick and Place, Rivet,
// Threaded Insert). This tag is a soft ranking signal only
// (process-plan-generator/ranking/machine-ranker.ts) -- confirmed by grep,
// nothing in the live costing engine reads it -- so an imprecise split here
// carries no correctness risk to any real quote.
//
// wage_grade: the REAL per-process value from
// memory/Assembly/wage_grade_associations (1).csv (verified directly, NOT
// flat like Additive Manufacturing's -- '2 - Metal' for most, '5 - Metal'
// for robotic/EB/laser welding, '6 - Metal' for manual welding, and
// '2 - Plastic' for Ultrasonic Welding specifically, a real distinct grade).
//
// Adhesive Bonding has NO machine file anywhere in this source -- a real,
// disclosed gap (same convention as Additive Manufacturing's Cleaning), not
// seeded here.
//
// landed_machine_cost: same real app convention as migration 793 (floor at
// 1 when the real Machine Price is 0 -- mhr.service.ts's own Excel-import
// path, `Math.max(landedCost, 1)`; the true 0 is preserved in
// machine_price_usd).

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MACHINE_DIR = path.join(REPO, 'memory', 'Assembly', 'Machines');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '794_seed_assembly_mhr_records.sql');

// shape: 'wide' (header row + one row per machine) | 'transposed' (Field,Value pairs, 1 machine)
const FILES = [
  { file: 'machine_fay_sealing.csv', category: 'Fay Sealing', shape: 'transposed' },
  { file: 'machine_fillet_sealing.csv', category: 'Fillet Sealing', shape: 'transposed' },
  { file: 'machine_manual_cap_sealing.csv', category: 'Cap Sealing', shape: 'transposed' },
  { file: 'machine_mechanical_assembly.csv', category: 'Mechanical Assembly', shape: 'transposed' },
  { file: 'machine_pick_and_place.csv', category: 'Pick and Place', shape: 'transposed' },
  { file: 'machine_rivet.csv', category: 'Rivet', shape: 'transposed' },
  { file: 'machine_threaded_insert.csv', category: 'Threaded Insert', shape: 'transposed' },
  { file: 'machine_weld_clean_up.csv', category: 'Weld Clean Up', shape: 'transposed' },
  { file: 'machine_weld_prep.csv', category: 'Weld Prep', shape: 'transposed' },
  { file: 'machines_electron_beam_welding.csv', category: 'Electron Beam Welding', shape: 'wide' },
  { file: 'machines_lock_bolt.csv', category: 'Lock Bolt', shape: 'wide' },
  { file: 'machines_manual_mig_welding.csv', category: 'Manual MIG Welding', shape: 'wide' },
  { file: 'machines_manual_spot_welding (1).csv', category: 'Manual Spot Welding', shape: 'wide' },
  { file: 'machines_manual_tig_welding.csv', category: 'Manual TIG Welding', shape: 'wide' },
  { file: 'machines_robotic_mig_welding.csv', category: 'Robotic MIG Welding', shape: 'wide' },
  { file: 'machines_robotic_spot_welding.csv', category: 'Robotic Spot Welding', shape: 'wide' },
  { file: 'machines_robotic_tig_welding.csv', category: 'Robotic TIG Welding', shape: 'wide' },
  { file: 'machines_ultrasonic_welding.csv', category: 'Ultrasonic Welding', shape: 'wide' },
];

const WAGE_GRADE = {
  'Cap Sealing': '2 - Metal', 'Electron Beam Welding': '5 - Metal', 'Fay Sealing': '2 - Metal',
  'Fillet Sealing': '2 - Metal', 'Lock Bolt': '2 - Metal', 'Manual MIG Welding': '6 - Metal',
  'Manual Spot Welding': '6 - Metal', 'Manual TIG Welding': '6 - Metal', 'Mechanical Assembly': '2 - Metal',
  'Pick and Place': '2 - Metal', 'Rivet': '2 - Metal', 'Robotic MIG Welding': '5 - Metal',
  'Robotic Spot Welding': '5 - Metal', 'Robotic TIG Welding': '5 - Metal', 'Threaded Insert': '2 - Metal',
  'Ultrasonic Welding': '2 - Plastic', 'Weld Clean Up': '2 - Metal', 'Weld Prep': '2 - Metal',
};

const WELDMENT = new Set([
  'Electron Beam Welding', 'Manual MIG Welding', 'Manual Spot Welding', 'Manual TIG Welding',
  'Robotic MIG Welding', 'Robotic Spot Welding', 'Robotic TIG Welding', 'Ultrasonic Welding',
  'Weld Clean Up', 'Weld Prep',
]);

const MACHINE_CLASS_OVERRIDE = { 'Ultrasonic Welding': 'assembly_ultrasonic_welding' };

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlNum(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}
function snakeCase(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
// Case/spelling-tolerant field pick, same convention as gen_738's pick().
function pick(obj, ...names) {
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  return undefined;
}

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'currency_code', 'country_code',
  'source_type', 'process_family', 'process_group', 'operators', 'setup_time_hr', 'press_cycle_time_s',
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
  'good_part_yield', 'manufacturer_country', 'benchmark_source_key',
];

function buildRow(obj, categoryLabel, machineClass) {
  const direct = Number(pick(obj, 'Direct Overhead Rate (USD / hr)'));
  const indirect = Number(pick(obj, 'Indirect Overhead Rate (USD / hr)'));
  const total = (Number.isFinite(direct) && Number.isFinite(indirect)) ? Math.round((direct + indirect) * 100) / 100 : null;
  const laborRate = pick(obj, 'Labor Rate (USD / hr)');
  const realPrice = Number(pick(obj, 'Machine Price (USD)'));
  // landed_machine_cost: see this generator's own header -- real price where
  // positive, else the app own real floor-at-1 convention (mhr.service.ts).
  const landedCost = Number.isFinite(realPrice) && realPrice > 0 ? realPrice : 1;
  const wageGrade = pick(obj, 'Wage Grade Name') ?? WAGE_GRADE[categoryLabel] ?? null;
  const processFamily = WELDMENT.has(categoryLabel) ? 'weldment' : 'assembly';

  return [
    sqlStr(machineClass), sqlStr('USA'), sqlStr(obj['Name']), sqlStr('USD'), sqlStr('US'),
    sqlStr('BENCHMARK'), sqlStr(processFamily), sqlStr('Assembly'),
    sqlNum(pick(obj, 'Number of Operators')), sqlNum(pick(obj, 'Setup Time (hr)')), 'NULL',
    sqlNum(landedCost), sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
    sqlNum(total), sqlNum(total), sqlNum(laborRate), sqlNum(laborRate), sqlNum(laborRate),
    sqlNum(pick(obj, 'Work Center Labor Rate Factor')), sqlNum(pick(obj, 'Labor Time Standard')),
    sqlStr(wageGrade), sqlNum(pick(obj, 'Machine Price (USD)')),
    sqlNum(pick(obj, 'Machine Length (mm)')), sqlNum(pick(obj, 'Machine Width (mm)')),
    sqlNum(pick(obj, 'Footprint Allowance Factor')), sqlNum(pick(obj, 'Machine Power (kW)')),
    sqlNum(pick(obj, 'Machine Life (yr)')),
    sqlNum(pick(obj, 'Installation Factor (%)', 'Installation Percent (%)')),
    sqlNum(pick(obj, 'Machine Uptime (%)')),
    sqlNum(pick(obj, 'Annual Maintenance Factor (%)', 'Annual Maintenance Percent (%)')),
    sqlNum(pick(obj, 'Salvage Value Factor (%)', 'Salvage Value Percent (%)')),
    sqlNum(pick(obj, 'Supplies Cost (USD / yr)')), sqlNum(pick(obj, 'Avg Utilization')),
    sqlNum(pick(obj, 'Good Part Yield')), sqlStr(pick(obj, 'Machine Manufacturer Location')),
    sqlStr(`${categoryLabel}:${obj['Name']}`),
  ];
}

const rows = [];
const counts = {};
for (const { file, category, shape } of FILES) {
  const fullPath = path.join(MACHINE_DIR, file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing source file: ${fullPath}`);
  const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
  const machineClass = MACHINE_CLASS_OVERRIDE[category] || snakeCase(category);
  let n = 0;

  if (shape === 'transposed') {
    const obj = {};
    for (const [k, v] of table.slice(1).map((r) => [r[0]?.trim(), r[1]])) {
      if (k) obj[k] = v;
    }
    rows.push(buildRow(obj, category, machineClass));
    n = 1;
  } else {
    const header = table[0].map((h) => h.trim());
    const seen = new Set();
    for (const r of table.slice(1)) {
      const obj = {};
      header.forEach((h, i) => { obj[h] = r[i]; });
      const name = (obj['Name'] || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      obj['Name'] = name;
      rows.push(buildRow(obj, category, machineClass));
      n++;
    }
  }
  counts[category] = n;
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
const countLines = Object.entries(counts).map(([c, n]) => `--   ${c.padEnd(24)} ${n} machines`).join('\n');

const sql = `-- ============================================================================
-- Migration 794: Seed mhr_records with the real Assembly machines
-- (Phase 2 of the multi-group MHR/LHR seeding program)
-- ============================================================================
-- Generated by scripts/gen_794_seed_assembly_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Assembly/Machines/*.csv (18 real per-category files).
--
${countLines}
--
-- ${rows.length} real machine rows total. Adhesive Bonding has no machine file
-- anywhere in this source -- a real, disclosed gap, not seeded.
--
-- Same 38-column shape/value-mapping discipline as migration 738/793.
-- process_family: 'weldment' (real, already-established value -- see
-- migration 789) for the 10 genuine welding processes; a new, disclosed
-- 'assembly' value for the 8 mechanical/bonding ones -- see the generator
-- script own header for the full collision-check and family-mapping
-- rationale. wage_grade is the REAL per-process value (not flat) from
-- memory/Assembly/wage_grade_associations, verified directly.
--
-- machine_class: 'Ultrasonic Welding' -> 'assembly_ultrasonic_welding'
-- (deliberate exception -- the natural slug would collide with the already-
-- registered 'cleaning' class own 'Ultrasonic' keyword; see this generator
-- script own header for the exact \\b-boundary reasoning). Every other
-- category keeps its natural snake_case slug, checked clear.
-- ============================================================================

INSERT INTO mhr_records (
  ${COLUMNS.join(', ')}
) VALUES
${valuesSql}
;

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${rows.length} rows to ${OUT_SQL}`);
console.log(counts);
