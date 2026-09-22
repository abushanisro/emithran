// Generator: seeds mhr_records with the real Part Assembly (welding group)
// machines from memory/Part Assembly/Machine/*.csv -- Phase 3 of the
// multi-group MHR/LHR seeding program (Phase 1 Additive Manufacturing/793,
// Phase 2 Assembly/794).
//
// Same 38-column shape and value-mapping discipline as migration 738 (see
// that migration/gen_793's own headers). THREE real source shapes exist
// here (more than 793/794's two), unified into one canonical row shape via
// per-shape extractors so buildRow() itself is shape-agnostic:
//   A. 'transposed3' -- parameter,value,unit (3 columns; the unit lives in
//      its own column instead of the header, e.g. laser_seam_weld_machine.csv).
//   B. 'wideTitle' -- Process,Name,Labor Rate (USD / hr),... header row +
//      1 data row (machine_default_bevel_cutting/finish_grinding/grinding.csv).
//   C. 'wideSnake' -- name,labor_rate_usd_hr,... all-lowercase-snake_case
//      header + 1-5 data rows (wire_brushing_machine.csv, and the 4
//      manual/robotic MIG/spot weld files).
//
// These files were renamed this session from their original aPriori
// filenames (see the earlier rename pass) and had "aPriori Baseline"/
// "aPriori USA" replaced with "eMithran Baseline"/"eMithran USA" in their
// content -- this generator reads their current, already-renamed state.
//
// machine_class collision check (verified directly against MACHINE_REGISTRY/
// classifyMachineRecord, same rigor as 793/794): all 9 candidate slugs
// (bevel_cutting, finish_grinding, grinding, laser_seam_welding,
// manual_mig_welding, manual_spot_welding, robotic_mig_welding,
// robotic_spot_welding, wire_brushing) checked against every
// machineClassKeywords entry and found clear -- no exception needed this
// time (unlike Assembly's Ultrasonic Welding).
//
// process_family: 'weldment' (real, established -- migration 789) for the 6
// genuine welding/weld-prep processes (Laser Seam Welding, Manual/Robotic
// MIG/Spot Welding); the same disclosed 'assembly' value migration 794
// introduced for the 3 real non-welding processes this group also has
// (Bevel Cutting, Finish/Grinding are metal-finishing prep, Wire Brushing is
// surface prep) -- reused, not a third new value, since these are the same
// kind of mechanical-prep step 794's 'assembly' tag already covers.
//
// wage_grade: the REAL per-process value from
// memory/Part Assembly/wage_grade_associations_welding_group.csv (verified
// directly -- 2 - Metal for Bevel Cutting/Finish Grinding/Grinding/Wire
// Brushing, 6 - Metal for the 3 manual/laser welding processes, 5 - Metal
// for the 2 robotic ones).
//
// All 9 real processes have machine data -- no disclosed gap this phase.
//
// landed_machine_cost: same real app convention as 793/794 (floor at 1 when
// the real Machine Price is 0; mhr.service.ts's own Excel-import path).

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MACHINE_DIR = path.join(REPO, 'memory', 'Part Assembly', 'Machine');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '795_seed_part_assembly_mhr_records.sql');

const FILES = [
  { file: 'laser_seam_weld_machine.csv', category: 'Laser Seam Welding', shape: 'transposed3' },
  { file: 'machine_default_bevel_cutting.csv', category: 'Bevel Cutting', shape: 'wideTitle' },
  { file: 'machine_default_finish_grinding.csv', category: 'Finish Grinding', shape: 'wideTitle' },
  { file: 'machine_default_grinding.csv', category: 'Grinding', shape: 'wideTitle' },
  { file: 'wire_brushing_machine.csv', category: 'Wire Brushing', shape: 'wideSnake' },
  { file: 'manual_mig_weld_machines.csv', category: 'Manual MIG Welding', shape: 'wideSnake' },
  { file: 'manual_spot_weld_machines.csv', category: 'Manual Spot Welding', shape: 'wideSnake' },
  { file: 'robotic_mig_weld_machines.csv', category: 'Robotic MIG Welding', shape: 'wideSnake' },
  { file: 'robotic_spot_weld_machines.csv', category: 'Robotic Spot Welding', shape: 'wideSnake' },
];

const WAGE_GRADE = {
  'Bevel Cutting': '2 - Metal', 'Finish Grinding': '2 - Metal', 'Grinding': '2 - Metal',
  'Laser Seam Welding': '6 - Metal', 'Manual MIG Welding': '6 - Metal', 'Manual Spot Welding': '6 - Metal',
  'Robotic MIG Welding': '5 - Metal', 'Robotic Spot Welding': '5 - Metal', 'Wire Brushing': '2 - Metal',
};
const WELDMENT = new Set(['Laser Seam Welding', 'Manual MIG Welding', 'Manual Spot Welding', 'Robotic MIG Welding', 'Robotic Spot Welding']);

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
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// Each extractor maps one raw source row/object to the SAME canonical shape,
// so buildRow() is shape-agnostic. `undefined`/null pass straight through to
// sqlNum/sqlStr, never guessed.
function extractTransposed3(table) {
  const obj = {};
  for (const [k, v] of table.slice(1).map((r) => [r[0]?.trim(), r[1]])) if (k) obj[k] = v;
  return {
    name: obj['Name'], laborRate: obj['Labor Rate'], direct: obj['Direct Overhead Rate'], indirect: obj['Indirect Overhead Rate'],
    operators: obj['Number of Operators'], setupTimeHr: obj['Setup Time'], wclrf: obj['Work Center Labor Rate Factor'],
    laborTimeStandard: obj['Labor Time Standard'], wageGrade: obj['Wage Grade Name'], machinePrice: obj['Machine Price'],
    machineLength: obj['Machine Length'], machineWidth: obj['Machine Width'], footprint: obj['Footprint Allowance Factor'],
    machinePower: obj['Machine Power'], machineLife: obj['Machine Life'], installPct: obj['Installation Factor'],
    uptimePct: obj['Machine Uptime'], maintPct: obj['Annual Maintenance Factor'], salvagePct: obj['Salvage Value Factor'],
    supplies: obj['Supplies Cost'], avgUtil: obj['Avg Utilization'], goodYield: obj['Good Part Yield'],
    mfrLoc: obj['Machine Manufacturer Location'],
  };
}
function extractWideTitle(header, r) {
  const obj = {}; header.forEach((h, i) => { obj[h] = r[i]; });
  return {
    name: obj['Name'], laborRate: obj['Labor Rate (USD / hr)'], direct: obj['Direct Overhead Rate (USD / hr)'],
    indirect: obj['Indirect Overhead Rate (USD / hr)'], operators: obj['Number of Operators'], setupTimeHr: obj['Setup Time (hr)'],
    wclrf: obj['Work Center Labor Rate Factor'], laborTimeStandard: obj['Labor Time Standard'], wageGrade: obj['Wage Grade Name'],
    machinePrice: obj['Machine Price (USD)'], machineLength: obj['Machine Length (mm)'], machineWidth: obj['Machine Width (mm)'],
    footprint: obj['Footprint Allowance Factor'], machinePower: obj['Machine Power (kW)'], machineLife: obj['Machine Life (yr)'],
    installPct: obj['Installation Factor (%)'], uptimePct: obj['Machine Uptime (%)'], maintPct: obj['Annual Maintenance Factor (%)'],
    salvagePct: obj['Salvage Value Factor (%)'], supplies: obj['Supplies Cost (USD / yr)'], avgUtil: obj['Avg Utilization'],
    goodYield: obj['Good Part Yield'], mfrLoc: obj['Machine Manufacturer Location'],
  };
}
function extractWideSnake(header, r) {
  const obj = {}; header.forEach((h, i) => { obj[h] = r[i]; });
  return {
    name: obj['name'], laborRate: obj['labor_rate_usd_hr'], direct: obj['direct_overhead_rate_usd_hr'],
    indirect: obj['indirect_overhead_rate_usd_hr'], operators: obj['number_of_operators'], setupTimeHr: obj['setup_time_hr'],
    wclrf: obj['work_center_labor_rate_factor'], laborTimeStandard: obj['labor_time_standard'], wageGrade: obj['wage_grade_name'],
    machinePrice: obj['machine_price_usd'], machineLength: obj['machine_length_mm'], machineWidth: obj['machine_width_mm'],
    footprint: obj['footprint_allowance_factor'], machinePower: obj['machine_power_kw'], machineLife: obj['machine_life_yr'],
    installPct: obj['installation_factor_pct'], uptimePct: obj['machine_uptime_pct'], maintPct: obj['annual_maintenance_factor_pct'],
    salvagePct: obj['salvage_value_factor_pct'], supplies: obj['supplies_cost_usd_yr'], avgUtil: obj['avg_utilization'],
    goodYield: obj['good_part_yield'], mfrLoc: obj['machine_manufacturer_location'],
  };
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

function buildRow(c, categoryLabel, machineClass) {
  const direct = num(c.direct), indirect = num(c.indirect);
  const total = (direct != null && indirect != null) ? Math.round((direct + indirect) * 100) / 100 : null;
  const realPrice = num(c.machinePrice);
  const landedCost = realPrice != null && realPrice > 0 ? realPrice : 1;
  const wageGrade = (c.wageGrade && String(c.wageGrade).trim()) ? c.wageGrade : (WAGE_GRADE[categoryLabel] ?? null);
  const processFamily = WELDMENT.has(categoryLabel) ? 'weldment' : 'assembly';

  return [
    sqlStr(machineClass), sqlStr('USA'), sqlStr(c.name), sqlStr('USD'), sqlStr('US'),
    sqlStr('BENCHMARK'), sqlStr(processFamily), sqlStr('Part Assembly'),
    sqlNum(c.operators), sqlNum(c.setupTimeHr), 'NULL',
    sqlNum(landedCost), sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
    sqlNum(total), sqlNum(total), sqlNum(c.laborRate), sqlNum(c.laborRate), sqlNum(c.laborRate),
    sqlNum(c.wclrf), sqlNum(c.laborTimeStandard), sqlStr(wageGrade), sqlNum(c.machinePrice),
    sqlNum(c.machineLength), sqlNum(c.machineWidth), sqlNum(c.footprint), sqlNum(c.machinePower),
    sqlNum(c.machineLife), sqlNum(c.installPct), sqlNum(c.uptimePct), sqlNum(c.maintPct),
    sqlNum(c.salvagePct), sqlNum(c.supplies), sqlNum(c.avgUtil), sqlNum(c.goodYield),
    sqlStr(c.mfrLoc), sqlStr(`${categoryLabel}:${c.name}`),
  ];
}

const rows = [];
const counts = {};
for (const { file, category, shape } of FILES) {
  const fullPath = path.join(MACHINE_DIR, file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing source file: ${fullPath}`);
  const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
  const machineClass = snakeCase(category);
  let n = 0;

  if (shape === 'transposed3') {
    rows.push(buildRow(extractTransposed3(table), category, machineClass));
    n = 1;
  } else {
    const header = table[0].map((h) => h.trim());
    const extractor = shape === 'wideTitle' ? extractWideTitle : extractWideSnake;
    const seen = new Set();
    for (const r of table.slice(1)) {
      const c = extractor(header, r);
      const name = (c.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      c.name = name;
      rows.push(buildRow(c, category, machineClass));
      n++;
    }
  }
  counts[category] = n;
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
const countLines = Object.entries(counts).map(([c, n]) => `--   ${c.padEnd(24)} ${n} machines`).join('\n');

const sql = `-- ============================================================================
-- Migration 795: Seed mhr_records with the real Part Assembly (welding
-- group) machines (Phase 3 of the multi-group MHR/LHR seeding program)
-- ============================================================================
-- Generated by scripts/gen_795_seed_part_assembly_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Part Assembly/Machine/*.csv (9 real per-category files,
-- three real source shapes -- see this generator script own header).
--
${countLines}
--
-- ${rows.length} real machine rows total. All 9 real Part Assembly processes have
-- machine data -- no disclosed gap this phase.
--
-- Same 38-column shape/value-mapping discipline as migration 738/793/794.
-- process_family: 'weldment' for the 5 genuine welding processes, the same
-- disclosed 'assembly' value migration 794 introduced for the 4 mechanical-
-- prep processes (Bevel Cutting, Finish Grinding, Grinding, Wire Brushing).
-- wage_grade is the REAL per-process value from
-- memory/Part Assembly/wage_grade_associations_welding_group.csv, verified
-- directly. machine_class: no collision found against MACHINE_REGISTRY for
-- any of the 9 natural snake_case slugs -- no exception needed this phase.
--
-- REMINDER (see migration 794 own header): mhr_records has no unique
-- constraint on (machine_class, machine_name) -- do not run this migration
-- more than once.
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
