// Generator: seeds mhr_records with the real Composites machines from
// memory/Composites/Machine/*.csv -- Phase 4 of the multi-group MHR/LHR
// seeding program (Phase 1 Additive Manufacturing/793, Phase 2 Assembly/794,
// Phase 3 Part Assembly/795).
//
// Same 38-column shape and value-mapping discipline as migration 738. All 8
// real source files share one shape (wide, Title Case headers, header row +
// N data rows) -- no transposed files this phase, unlike 795.
//
// machine_class collision check (verified directly against MACHINE_REGISTRY/
// classifyMachineRecord, same rigor as 793/794/795): TWO real collisions
// found this phase (more than any prior phase):
//   'bench_operation' WOULD collide -- the already-registered 'deburring'
//   class lists bare 'Bench' as a machineClassKeywords entry, and hasKeyword
//   \b-anchors at the start of a string, which "bench_operation" satisfies.
//   Renamed to 'composite_bench_operation'.
//   'ultrasonic_cut' WOULD collide -- same shape as migration 794's
//   Ultrasonic Welding finding: the already-registered 'cleaning' class
//   lists bare 'Ultrasonic', and the slug starts with "ultrasonic". Renamed
//   to 'composite_ultrasonic_cut'.
//   Every other candidate slug (autoclave_cure, automated_fiber_placement,
//   automated_tape_layup, hand_layup, mold_preparation, tool_clean) checked
//   against every machineClassKeywords entry and found clear -- note
//   'tool_clean' does NOT collide with 'cleaning's bare 'Clean' keyword,
//   because (like migration 794's weld_clean_up) '_' is a word character in
//   JS/regex \b semantics, so there is no boundary between "tool" and
//   "_clean" for \bclean to anchor on.
//
// process_family: a new, disclosed 'composite' value (not previously used
// anywhere in this column -- no established value fits Composites' real
// processes) for all 8 real processes. Soft ranking signal only (see
// migration 794's own header for why this carries no correctness risk).
//
// wage_grade: the REAL per-process value from
// memory/Composites/wage_grade_associations (6).csv, verified directly (5 -
// Metal for Autoclave Cure/Hand Layup, 6 - Metal for Automated Fiber
// Placement/Automated Tape Layup, 3 - Metal for Bench Operation/Mold
// Preparation/Tool Clean, 4 - Metal for Ultrasonic Cut).
//
// Final Vacuum Bag and Vacuum Bag have NO machine file anywhere in this
// source, and NO wage grade either (both blank in the real associations
// file) -- a real, disclosed gap, not seeded.
//
// machines_hand_layup.csv genuinely has no Direct/Indirect Overhead Rate
// columns at all (verified directly, not a parsing miss) -- those fields,
// and total_machine_hour_rate/mhr_usd_per_hour (which need both to compute),
// are honestly NULL for its 8 rows rather than fabricated.
//
// landed_machine_cost: same real app convention as 793/794/795 (floor at 1
// when the real Machine Price is 0 -- mhr.service.ts's own Excel-import
// path). Applies to all of Bench Operation (4 rows), Mold Preparation (4
// rows), and Tool Clean's 4 "Manual" variants -- every one a real,
// genuinely capital-free manual work area.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MACHINE_DIR = path.join(REPO, 'memory', 'Composites', 'Machine');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '796_seed_composites_mhr_records.sql');

const FILES = {
  'machines_autoclave_cure.csv': 'Autoclave Cure',
  'machines_automated_fiber_placement.csv': 'Automated Fiber Placement',
  'machines_automated_tape_layup.csv': 'Automated Tape Layup',
  'machines_bench_operation.csv': 'Bench Operation',
  'machines_hand_layup.csv': 'Hand Layup',
  'machines_mold_preparation.csv': 'Mold Preparation',
  'machines_tool_clean.csv': 'Tool Clean',
  'machines_ultrasonic_cut.csv': 'Ultrasonic Cut',
};

const WAGE_GRADE = {
  'Autoclave Cure': '5 - Metal', 'Automated Fiber Placement': '6 - Metal', 'Automated Tape Layup': '6 - Metal',
  'Bench Operation': '3 - Metal', 'Hand Layup': '5 - Metal', 'Mold Preparation': '3 - Metal',
  'Tool Clean': '3 - Metal', 'Ultrasonic Cut': '4 - Metal',
};

const MACHINE_CLASS_OVERRIDE = { 'Bench Operation': 'composite_bench_operation', 'Ultrasonic Cut': 'composite_ultrasonic_cut' };

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

const rows = [];
const counts = {};
for (const [file, categoryLabel] of Object.entries(FILES)) {
  const fullPath = path.join(MACHINE_DIR, file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing source file: ${fullPath}`);
  const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
  const header = table[0].map((h) => h.trim());
  const idx = (label) => header.findIndex((h) => h === label);
  const iName = idx('Name');
  const iLabor = idx('Labor Rate (USD / hr)');
  const iDirect = idx('Direct Overhead Rate (USD / hr)'); // -1 for Hand Layup -- genuinely absent, not a bug
  const iIndirect = idx('Indirect Overhead Rate (USD / hr)');
  const iOperators = idx('Number of Operators');
  const iSetup = idx('Setup Time (hr)');
  const iWclrf = idx('Work Center Labor Rate Factor');
  const iLts = idx('Labor Time Standard');
  const iWageGrade = idx('Wage Grade Name');
  const iPrice = idx('Machine Price (USD)');
  const iLength = idx('Machine Length (mm)');
  const iWidth = idx('Machine Width (mm)');
  const iFootprint = idx('Footprint Allowance Factor');
  const iPower = idx('Machine Power (kW)');
  const iLife = idx('Machine Life (yr)');
  const iInstall = idx('Installation Factor (%)');
  const iUptime = idx('Machine Uptime (%)');
  const iMaint = idx('Annual Maintenance Factor (%)');
  const iSalvage = idx('Salvage Value Factor (%)');
  const iSupplies = idx('Supplies Cost (USD / yr)');
  const iUtil = idx('Avg Utilization');
  const iYield = idx('Good Part Yield');
  const iMfrLoc = idx('Machine Manufacturer Location');
  if (iName === -1 || iLabor === -1) throw new Error(`${file}: unexpected header shape`);

  const machineClass = MACHINE_CLASS_OVERRIDE[categoryLabel] || snakeCase(categoryLabel);
  const seen = new Set();
  let n = 0;
  for (const r of table.slice(1)) {
    const name = (r[iName] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const direct = iDirect === -1 ? null : num(r[iDirect]);
    const indirect = iIndirect === -1 ? null : num(r[iIndirect]);
    const total = (direct != null && indirect != null) ? Math.round((direct + indirect) * 100) / 100 : null;
    const laborRate = r[iLabor];
    const realPrice = iPrice === -1 ? null : num(r[iPrice]);
    const landedCost = realPrice != null && realPrice > 0 ? realPrice : 1;
    const rowWageGrade = iWageGrade !== -1 && r[iWageGrade] && r[iWageGrade].trim() ? r[iWageGrade] : (WAGE_GRADE[categoryLabel] ?? null);

    rows.push([
      sqlStr(machineClass), sqlStr('USA'), sqlStr(name), sqlStr('USD'), sqlStr('US'),
      sqlStr('BENCHMARK'), sqlStr('composite'), sqlStr('Composites'),
      sqlNum(r[iOperators]), sqlNum(r[iSetup]), 'NULL',
      sqlNum(landedCost), sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
      sqlNum(total), sqlNum(total), sqlNum(laborRate), sqlNum(laborRate), sqlNum(laborRate),
      sqlNum(r[iWclrf]), sqlNum(r[iLts]), sqlStr(rowWageGrade), sqlNum(iPrice === -1 ? null : r[iPrice]),
      sqlNum(r[iLength]), sqlNum(r[iWidth]), sqlNum(r[iFootprint]), sqlNum(r[iPower]), sqlNum(r[iLife]),
      sqlNum(r[iInstall]), sqlNum(r[iUptime]), sqlNum(r[iMaint]), sqlNum(r[iSalvage]), sqlNum(r[iSupplies]),
      sqlNum(r[iUtil]), sqlNum(r[iYield]), sqlStr(iMfrLoc === -1 ? null : r[iMfrLoc]),
      sqlStr(`${categoryLabel}:${name}`),
    ]);
    n++;
  }
  counts[categoryLabel] = n;
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
const countLines = Object.entries(counts).map(([c, n]) => `--   ${c.padEnd(26)} ${n} machines`).join('\n');

const sql = `-- ============================================================================
-- Migration 796: Seed mhr_records with the real Composites machines
-- (Phase 4 of the multi-group MHR/LHR seeding program)
-- ============================================================================
-- Generated by scripts/gen_796_seed_composites_mhr_records.js -- do not
-- hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Composites/Machine/*.csv (8 real per-category files).
--
${countLines}
--
-- ${rows.length} real machine rows total. Final Vacuum Bag and Vacuum Bag have no
-- machine file anywhere in this source, and no wage grade either -- a real,
-- disclosed gap, not seeded.
--
-- Same 38-column shape/value-mapping discipline as migration 738/793-795.
-- process_family: a new, disclosed 'composite' value (no established value
-- fits) for all 8 real processes -- see the generator script own header.
-- wage_grade is the REAL per-process value, verified directly.
--
-- machine_class: TWO real collisions found and fixed this phase --
-- 'Bench Operation' -> 'composite_bench_operation' (would collide with the
-- registered 'deburring' class own bare 'Bench' keyword) and
-- 'Ultrasonic Cut' -> 'composite_ultrasonic_cut' (same shape as migration
-- 794's Ultrasonic Welding finding -- collides with 'cleaning' own
-- 'Ultrasonic' keyword). See the generator script own header for the exact
-- \\b-boundary reasoning. Every other category keeps its natural slug.
--
-- machines_hand_layup.csv genuinely has no Direct/Indirect Overhead Rate
-- columns -- those fields (and the totals derived from them) are honestly
-- NULL for its 8 rows, not fabricated.
--
-- REMINDER: mhr_records has no unique constraint on (machine_class,
-- machine_name) -- do not run this migration more than once.
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
