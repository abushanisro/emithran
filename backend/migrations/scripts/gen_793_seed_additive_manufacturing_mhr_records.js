// Generator: seeds mhr_records with the real Additive Manufacturing machines
// from memory/Additive Manufacturing/Machine/*.csv -- Phase 1 of the
// multi-phase MHR/LHR seeding program (memory/ has real per-machine
// economics for 11 groups; this migration covers only Additive
// Manufacturing, per the user's own confirmed "one group at a time"
// sequencing).
//
// Same 38-column INSERT list and value-mapping discipline as migration 738
// (the Machining precedent -- see that migration/generator's own header for
// the full rationale), adapted from JSON source files to this domain's real
// CSV shape. Two duplicate files exist per machine category (a bare name and
// a "(1)" copy) -- confirmed byte-identical; only the canonical (non-"(1)")
// filename is read.
//
// machine_class collision check (same discipline as gen_738's 3 documented
// exceptions, verified directly against MACHINE_REGISTRY in
// default-rates.constants.ts and classifyMachineRecord in selector.ts before
// choosing every slug below):
//   'cleaning' is ALREADY a registered Post-Processing machine_class
//   (Ultrasonic/Cleaning/Clean/Degreas keywords) -- Additive Manufacturing
//   has no machine file for its own "Cleaning" process anyway (disclosed gap,
//   same as migration 790), so this collision never materializes here, but is
//   recorded as the reason 'cleaning' must never be used if that process ever
//   gets real machine data later.
//   Every other candidate slug (breakoff, powder_loading, sieving,
//   manual_tool_base_removal, power_tool_base_removal, laser_sintering,
//   metal_sintering, part_curing, printing, resin_curing) was checked against
//   every machineClassKeywords entry in MACHINE_REGISTRY for a \b-boundary
//   substring match and found clear -- none collide.
//
// process_family = 'additive', the real value already used for this same
// domain elsewhere in this column (migration 789's own header confirms it as
// an established sibling value, alongside sheet_metal/milled/turned/
// plastic_molded/casting/forging/extrusion/weldment); also present in
// machine-ranker.ts's UNIVERSAL_PROCESS_FAMILIES precedent style, though
// 'additive' itself is family-exact rather than universal.
//
// location='USA'/currency_code='USD'/country_code='US'/source_type='BENCHMARK':
// every row's own Labor Rate is the same flat 38.94 USD/hr Digital Factory
// baseline used across every other file in this same source, i.e. real, but a
// benchmark reference rate, not a customer-negotiated one -- identical
// convention to migration 738's own Machining rows.
//
// wage_grade: '2 - Casting', the real, single value every Additive
// Manufacturing process maps to in memory/Additive Manufacturing/
// wage_grade_associations (5).csv (verified directly, not guessed).

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MACHINE_DIR = path.join(REPO, 'memory', 'Additive Manufacturing', 'Machine');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '793_seed_additive_manufacturing_mhr_records.sql');

const FILES = {
  'machine_manual_breakoff_with_hand_tools.csv': 'Breakoff',
  'machine_electric_trolley_loader_2m_lift_height.csv': 'Powder Loading',
  'machine_manual_hand_tools.csv': 'Manual Tool Base Removal',
  'machine_oscillating_power_tool_300w.csv': 'Power Tool Base Removal',
  'machine_vibratory_compact_sieve_500mm_diameter.csv': 'Sieving',
  'machines_laser_sintering.csv': 'Laser Sintering',
  'machines_metal_sintering.csv': 'Metal Sintering',
  'machines_part_curing.csv': 'Part Curing',
  'machines_printing.csv': 'Printing',
  'machines_resin_curing.csv': 'Resin Curing',
};

const WAGE_GRADE = '2 - Casting';

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
const seenNames = {}; // per-category dedup, in case a category is split across future files
for (const [file, categoryLabel] of Object.entries(FILES)) {
  const fullPath = path.join(MACHINE_DIR, file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing source file: ${fullPath}`);
  const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
  const header = table[0].map((h) => h.trim());
  const idx = (label) => header.findIndex((h) => h === label);
  const iName = idx('Name');
  const iLabor = idx('Labor Rate (USD / hr)');
  const iDirect = idx('Direct Overhead Rate (USD / hr)');
  const iIndirect = idx('Indirect Overhead Rate (USD / hr)');
  const iOperators = idx('Number of Operators');
  const iSetup = idx('Setup Time (hr)');
  const iWclrf = idx('Work Center Labor Rate Factor');
  const iLts = idx('Labor Time Standard');
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

  const machineClass = snakeCase(categoryLabel);
  const key = categoryLabel;
  seenNames[key] = seenNames[key] || new Set();

  for (const r of table.slice(1)) {
    const name = (r[iName] || '').trim();
    if (!name || seenNames[key].has(name)) continue;
    seenNames[key].add(name);

    const direct = r[iDirect] !== undefined ? Number(r[iDirect]) : null;
    const indirect = r[iIndirect] !== undefined ? Number(r[iIndirect]) : null;
    const total = (Number.isFinite(direct) && Number.isFinite(indirect)) ? Math.round((direct + indirect) * 100) / 100 : null;
    const laborRate = r[iLabor];
    const realPrice = Number(r[iPrice]);
    // Real landed cost is 0 for a genuinely capital-free manual process
    // (e.g. Breakoff's hand tools) -- but positive_machine_cost's own live
    // CHECK (landed_machine_cost > 0) cannot store that literal truth.
    // Floored at 1, matching this app's OWN real, already-live convention for
    // exactly this case -- mhr.service.ts's Excel-import path does
    // `landed_machine_cost: Math.max(landedCost, 1)` (line ~1486), not an
    // invented fractional placeholder. machine_price_usd right below keeps
    // the true 0 value; this field alone carries the schema floor.
    const landedCost = Number.isFinite(realPrice) && realPrice > 0 ? realPrice : 1;

    rows.push([
      sqlStr(machineClass),
      sqlStr('USA'),
      sqlStr(name),
      sqlStr('USD'),
      sqlStr('US'),
      sqlStr('BENCHMARK'),
      sqlStr('additive'),
      sqlStr('Additive Manufacturing'),
      sqlNum(r[iOperators]),
      sqlNum(r[iSetup]),
      'NULL', // press_cycle_time_s -- not applicable to AM
      // landed_machine_cost: NOT NULL + CHECK(>0) on this table since its
      // original creation (003_create_mhr_table.sql), never relaxed by any
      // later migration (verified directly against every migration that
      // touches this table, not assumed) -- the real Machine Price (USD)
      // value wherever it is positive, else the app own real floor-at-1
      // convention from mhr.service.ts's Excel import path (see above).
      sqlNum(landedCost),
      sqlNum(direct),
      sqlNum(indirect),
      sqlNum(direct),
      sqlNum(indirect),
      sqlNum(total),
      sqlNum(total),
      sqlNum(laborRate),
      sqlNum(laborRate),
      sqlNum(laborRate),
      sqlNum(r[iWclrf]),
      sqlNum(r[iLts]),
      sqlStr(WAGE_GRADE),
      sqlNum(r[iPrice]),
      sqlNum(r[iLength]),
      sqlNum(r[iWidth]),
      sqlNum(r[iFootprint]),
      sqlNum(r[iPower]),
      sqlNum(r[iLife]),
      sqlNum(r[iInstall]),
      sqlNum(r[iUptime]),
      sqlNum(r[iMaint]),
      sqlNum(r[iSalvage]),
      sqlNum(r[iSupplies]),
      sqlNum(r[iUtil]),
      sqlNum(r[iYield]),
      sqlStr(iMfrLoc !== -1 ? r[iMfrLoc] : null),
      sqlStr(`${categoryLabel}:${name}`),
    ]);
  }
}

const byCategory = {};
for (const [file, cat] of Object.entries(FILES)) byCategory[cat] = (byCategory[cat] || 0);
for (const r of rows) {
  const cat = r[7].replace(/^\$str\$|\$str\$$/g, ''); // unused placeholder, category counted below instead
}
const counts = {};
{
  let i = 0;
  for (const [file, categoryLabel] of Object.entries(FILES)) {
    const fullPath = path.join(MACHINE_DIR, file);
    const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
    const header = table[0].map((h) => h.trim());
    const iName = header.findIndex((h) => h === 'Name');
    const names = new Set(table.slice(1).map((r) => (r[iName] || '').trim()).filter(Boolean));
    counts[categoryLabel] = names.size;
  }
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
const countLines = Object.entries(counts).map(([c, n]) => `--   ${c.padEnd(26)} ${n} machines`).join('\n');

const sql = `-- ============================================================================
-- Migration 793: Seed mhr_records with the real Additive Manufacturing
-- machines (Phase 1 of the multi-group MHR/LHR seeding program)
-- ============================================================================
-- Generated by scripts/gen_793_seed_additive_manufacturing_mhr_records.js --
-- do not hand-edit, re-run the generator and diff instead.
--
-- Source: memory/Additive Manufacturing/Machine/*.csv (10 real per-category
-- files; each category also has a "(1)" duplicate file, confirmed
-- byte-identical, which is not read).
--
${countLines}
--
-- ${rows.length} real machine rows total.
--
-- Same 38-column shape and value-mapping discipline as migration 738 (the
-- Machining precedent): direct/indirect overhead, machine price/dimensions/
-- power/life/install/uptime/maintenance/salvage/supplies/utilization/yield
-- all map 1:1 from their real source column. total_machine_hour_rate =
-- direct + indirect (no dedicated total column in source, same fallback
-- formula 738 uses). location/currency/country/source_type are the flat
-- USA/USD/US/BENCHMARK convention this whole source already uses uniformly
-- (every row own Labor Rate is the same 38.94 USD/hr Digital Factory
-- baseline). wage_grade is the real, single value every Additive
-- Manufacturing process maps to (wage_grade_associations, verified, not
-- guessed). manufacturer_country is the real per-machine value (varies:
-- USA/Germany/Virtual), never assumed uniform.
--
-- Breakoff/Manual Tool Base Removal/Power Tool Base Removal/Powder Loading/
-- Sieving each have exactly 1 real machine on file (single-station
-- processes) -- not a gap, the real shape of the source data.
--
-- Cleaning and No Cost Feature are NOT seeded here: Cleaning has no machine
-- file anywhere in this source (a real, disclosed gap, same as every other
-- undetailed process this session has left honestly unseeded); No Cost
-- Feature is a non_mfg routing marker with no machine by design.
--
-- machine_class collision check performed against the live MACHINE_REGISTRY
-- (default-rates.constants.ts) and classifyMachineRecord (selector.ts)
-- before choosing every slug -- see this generator script own header for
-- the one real finding ('cleaning' is already a registered Post-Processing
-- class; moot here since Cleaning has no machine file to seed, but recorded
-- for when it does).
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
