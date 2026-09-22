// Generator: seeds mhr_records with the real PCB machines from
// memory/PCBA/Machine/*.csv -- Phase 5 of the multi-group MHR/LHR seeding
// program (Phase 1 Additive Manufacturing/793, Phase 2 Assembly/794, Phase 3
// Part Assembly/795, Phase 4 Composites/796).
//
// Same 38-column shape and value-mapping discipline as migration 738/793-796.
//
// UNLIKE every prior phase, this domain's real files are NOT 1 file = 1
// process. PCB genuinely reuses the same physical machine pool across
// several real process steps (verified directly against
// memory/PCBA/processes.csv's own "Default Machine" column for all 34 real
// processes):
//   - drilling_machines.csv (9 real machines) backs BOTH "Drill Circuit
//     Holes" and "Drill Registration Holes" -- both name the exact same
//     default machine ("Excellon HS 1L 2 heads 1 station").
//   - screen_printing_machines.csv (5 real machines, incl. ATMA PC 68) backs
//     "Screen Printing" AND "Plug Vias" -- Plug Vias has no dedicated file of
//     its own but processes.csv names the exact same "ATMA PC 68" as its
//     default machine.
// This is real, sourced machine-sharing, not a fabricated linkage -- MANY
// rows below carry the same machine_name/economics under two different
// (machine_class, process_group) pairs, matching this domain's real
// wage_grade_associations.csv, which gives each of these processes its own
// real per-process wage grade despite the shared equipment.
//
// Duplicate/partial-duplicate SOURCE FILES found and skipped (kept the
// fuller/canonical file, same discipline as 793's "(1)" file skip):
//   - drilling_machines_usable_height.csv: subset of drilling_machines.csv
//     (3 of its 9 machines, +1 extra Usable Height column, otherwise
//     identical economics). Skipped; drilling_machines.csv is the complete,
//     canonical 9-machine set.
//   - screen_printing_rate_machines.csv: column-trimmed duplicate of
//     screen_printing_machines.csv (same 5 machines/values, drops
//     Description + Total Overhead Rate). Skipped.
//   - plating_line_machines_record_view.csv: partial duplicate of
//     plating_line_machines.csv (2 of its 3 machines; "High Capacity Plating
//     Line" matches byte-for-byte, but "Medium Capacity Plating Line"
//     genuinely CONFLICTS between the two files -- direct overhead 121.04 vs
//     158.87, price 1700000 vs 2250000). Kept the fuller, internally
//     consistent plating_line_machines.csv; skipped the conflicting partial
//     view rather than silently picking one Medium Capacity value over the
//     other for the same machine name.
//   - plating_line_capacity_gating_tanks.csv: a second real export of the
//     SAME 3 machines already in plating_line_machines.csv (matching price,
//     direct/indirect overhead rate, footprint, power for all 3 -- verified
//     field by field), just described through a Gating-Tank column shape
//     instead of Panel/FlyBar and tagged "Virtual" instead of "USA". Same
//     underlying real machine; skipped as a duplicate export.
//   - default_machine.csv vs 'default_machine_no_labor (1).csv': NOT
//     duplicates of each other despite the similar name -- genuinely
//     different economics (Labor Rate 36.30/USA vs 0.00/Virtual). Both kept,
//     mapped to different real processes (see below).
//   - wet_film_solder_mask_machines.csv: its header has 4 literally
//     corrupted column names baked into the source file itself ("Overhead
//     (truncated header)", "Number of (truncated header)", "Labor Time
//     (truncated header)", "Wage Grade (truncated header)" -- verified by
//     direct byte read, not a parsing artifact), and its 5 data rows are
//     otherwise byte-identical to screen_printing_machines.csv's 5 machines
//     (same names, same every numeric field, aside from one blank Salvage
//     Value Factor cell where the clean file has "0.00"). Rather than
//     positionally guess-map a corrupted header, "Wet Film Solder Mask" is
//     routed through the clean, verified-identical screen_printing_machines.csv
//     instead. Skipped as a corrupted duplicate.
//
// machine_class collision check (verified directly against MACHINE_REGISTRY/
// classifyMachineRecord, same \b-start-boundary rigor as every prior phase):
//   'bench_operation' WOULD collide (registered 'deburring' class's bare
//   'Bench' keyword) -- renamed 'pcb_bench_operation', same fix as 796.
//   'router', 'stamp', 'des', 'ses' are NOT actual regex collisions (no bare
//   'Router'/'Stamp'/'DES'/'SES' keyword exists in MACHINE_REGISTRY -- the
//   only registered Router keywords are the 2-word 'Router' class own '2-Axis
//   Router'/'2 Axis Router', not a bare 'Router'), but are prefixed
//   'pcb_router'/'pcb_stamp'/'pcb_des'/'pcb_ses' anyway for HR Rates page
//   readability given real PCB process names overlap sheet-metal/machining
//   vocabulary far more than any prior phase -- a naming clarity choice, not
//   a collision fix, disclosed as such.
//   Every other candidate slug (multi-word, e.g. drill_circuit_holes,
//   copper_plate_and_tin_coat) checked clear with no prefix needed.
//
// process_family: a new, disclosed 'pcb' value (no established value fits;
// same pattern as 794's 'assembly'/796's 'composite'). Soft ranking signal
// only (see migration 794's own header for why this carries no correctness
// risk).
//
// wage_grade: the REAL per-process value from
// memory/PCBA/wage_grade_associations (4).csv, verified directly. "No Cost
// Feature" and "User-Defined Process" have no real wage grade AND no real
// machine file anywhere in this source -- a real, disclosed gap, not seeded
// (same pattern as every prior phase's blank-wage-grade processes).
//
// landed_machine_cost: same real app convention as 793-796 (floor at 1 when
// the real Machine Price is 0 -- mhr.service.ts's own Excel-import path).
// Applies to the 'Material Stock' row (Default/Virtual/no-labor machine,
// Machine Price 0.00).
//
// The column resolver (idxAny) tries multiple label spellings per field --
// defensive tolerance for real header spacing variance (e.g. "(USD / hr)"
// vs "(USD/hr)"), same discipline as migration 738's own pick() helper.
// Every file actually read this phase resolves on its first-choice label;
// no file needed a fallback spelling.

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MACHINE_DIR = path.join(REPO, 'memory', 'PCBA', 'Machine');
const OUT_SQL = path.join(REPO, 'backend', 'migrations', '797_seed_pcb_mhr_records.sql');

// Each entry: source file -> the real process(es) it backs (processes.csv-
// verified). machineClassOverride is set only where a slug needed either a
// collision fix or a readability prefix (see header above).
const MAPPINGS = [
  { file: 'apply_photo_resist_machines.csv', processes: ['Apply Photo Resist'] },
  { file: 'aoi_machines.csv', processes: ['Automated Optical Inspection'] },
  { file: 'avi_machines.csv', processes: ['Automated Vision Inspection'] },
  { file: 'bed_of_nails_machines.csv', processes: ['Bed of Nails'] },
  { file: 'default_machine.csv', processes: ['Bench Operation'], machineClassOverride: 'pcb_bench_operation' },
  { file: 'plating_line_gating_cell_machines.csv', processes: ['Copper Plate and Tin Coat'] },
  { file: 'conveyor_dryer_machines.csv', processes: ['Cure Plugged Vias'] },
  { file: 'rack_oven_machines.csv', processes: ['Cure Solder Mask'] },
  { file: 'des_line_machine.csv', processes: ['DES'], machineClassOverride: 'pcb_des' },
  { file: 'plating_line_gating_tank_machines.csv', processes: ['Desmear and Plate Through Holes'] },
  { file: 'solder_mask_developer_machine.csv', processes: ['Develop Solder Mask'] },
  { file: 'photo_resist_developer_machine.csv', processes: ['Dissolve Unexposed Photo Resist'] },
  { file: 'drilling_machines.csv', processes: ['Drill Circuit Holes', 'Drill Registration Holes'] },
  { file: 'plating_line_machines.csv', processes: ['Electroless Nickel Immersion Gold'] },
  { file: 'exposure_machines.csv', processes: ['Film Imaging'] },
  { file: 'flying_probe_machines.csv', processes: ['Flying Probe'] },
  { file: 'hasl_machines.csv', processes: ['Hot Air Solder Leveling'] },
  { file: 'laser_drill_machines.csv', processes: ['Laser Drill Vias'] },
  { file: 'default_machine_no_labor (1).csv', processes: ['Material Stock'] },
  { file: 'osp_line_machine.csv', processes: ['Organic Solderability Preservative'] },
  { file: 'lauffer_rmv125_machine.csv', processes: ['Oven Cure Layers'] },
  { file: 'photolithography_machines.csv', processes: ['Photolithography'] },
  { file: 'screen_printing_machines.csv', processes: ['Plug Vias', 'Screen Printing', 'Wet Film Solder Mask'] },
  { file: 'router_machines.csv', processes: ['Router'], machineClassOverride: 'pcb_router' },
  { file: 'ses_line_machine.csv', processes: ['SES'], machineClassOverride: 'pcb_ses' },
  { file: 'silkscreen_cure_machines.csv', processes: ['Silkscreen Cure'] },
  { file: 'stamp_machines.csv', processes: ['Stamp'], machineClassOverride: 'pcb_stamp' },
  { file: 'surface_preparation_machines.csv', processes: ['Surface Preparation'] },
  { file: 'tack_dry_solder_mask_machines.csv', processes: ['Tack Dry Solder Mask'] },
];
// wet_film_solder_mask_machines.csv is deliberately NOT read: its header has
// 4 literally corrupted column names baked into the source file itself
// ("Overhead (truncated header)", "Number of (truncated header)", "Labor
// Time (truncated header)", "Wage Grade (truncated header)" -- verified by
// direct byte read, not a parsing artifact), and its 5 data rows are
// otherwise byte-identical to screen_printing_machines.csv's 5 machines
// (same names, same every numeric field, aside from one blank Salvage Value
// Factor cell where the clean file has "0.00"). Rather than positionally
// guess-map a corrupted header, "Wet Film Solder Mask" is routed through the
// clean, verified-identical screen_printing_machines.csv above instead.

const WAGE_GRADE = {
  'Apply Photo Resist': '4 - Metal', 'Automated Optical Inspection': '3 - Metal',
  'Automated Vision Inspection': '3 - Metal', 'Bed of Nails': '3 - Metal', 'Bench Operation': '3 - Metal',
  'Copper Plate and Tin Coat': '4 - Metal', 'Cure Plugged Vias': '3 - Metal', 'Cure Solder Mask': '3 - Metal',
  'DES': '4 - Metal', 'Desmear and Plate Through Holes': '4 - Metal', 'Develop Solder Mask': '3 - Metal',
  'Dissolve Unexposed Photo Resist': '4 - Metal', 'Drill Circuit Holes': '3 - Metal',
  'Drill Registration Holes': '3 - Metal', 'Electroless Nickel Immersion Gold': '4 - Metal',
  'Film Imaging': '4 - Metal', 'Flying Probe': '4 - Metal', 'Hot Air Solder Leveling': '3 - Metal',
  'Laser Drill Vias': '3 - Metal', 'Material Stock': '0 - Metal',
  'Organic Solderability Preservative': '3 - Metal', 'Oven Cure Layers': '3 - Metal',
  'Photolithography': '4 - Metal', 'Plug Vias': '4 - Metal', 'Router': '3 - Metal', 'SES': '4 - Metal',
  'Screen Printing': '4 - Metal', 'Silkscreen Cure': '3 - Metal', 'Stamp': '3 - Metal',
  'Surface Preparation': '3 - Metal', 'Tack Dry Solder Mask': '3 - Metal', 'Wet Film Solder Mask': '4 - Metal',
};

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

// Tolerant column resolver -- tries each candidate label in order, returns
// the first index found. Needed only because wet_film_solder_mask_machines.csv
// spells its unit-suffixed headers differently from every other file this
// phase (see the generator's own header comment).
function idxAny(header, ...labels) {
  for (const label of labels) {
    const i = header.findIndex((h) => h.trim() === label);
    if (i !== -1) return i;
  }
  return -1;
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
const counts = {};

for (const mapping of MAPPINGS) {
  const fullPath = path.join(MACHINE_DIR, mapping.file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing source file: ${fullPath}`);
  const table = parseCsv(fs.readFileSync(fullPath, 'utf8'));
  const header = table[0].map((h) => h.trim());

  const iName = idxAny(header, 'Name');
  const iLabor = idxAny(header, 'Labor Rate (USD / hr)', 'Labor Rate (USD/hr)');
  const iDirect = idxAny(header, 'Direct Overhead Rate (USD / hr)', 'Direct Overhead Rate');
  const iIndirect = idxAny(header, 'Indirect Overhead Rate (USD / hr)', 'Indirect Overhead Rate');
  const iOperators = idxAny(header, 'Number of Operators');
  const iSetup = idxAny(header, 'Setup Time (hr)');
  const iWclrf = idxAny(header, 'Work Center Labor Rate Factor');
  const iLts = idxAny(header, 'Labor Time Standard');
  const iWageGrade = idxAny(header, 'Wage Grade Name');
  const iPrice = idxAny(header, 'Machine Price (USD)');
  const iLength = idxAny(header, 'Machine Length (mm)');
  const iWidth = idxAny(header, 'Machine Width (mm)');
  const iFootprint = idxAny(header, 'Footprint Allowance Factor');
  const iPower = idxAny(header, 'Machine Power (kW)');
  const iLife = idxAny(header, 'Machine Life (yr)');
  const iInstall = idxAny(header, 'Installation Factor (%)');
  const iUptime = idxAny(header, 'Machine Uptime (%)');
  const iMaint = idxAny(header, 'Annual Maintenance Factor (%)');
  const iSalvage = idxAny(header, 'Salvage Value Factor (%)');
  const iSupplies = idxAny(header, 'Supplies Cost (USD / yr)', 'Supplies Cost (USD/yr)');
  const iUtil = idxAny(header, 'Avg Utilization');
  const iYield = idxAny(header, 'Good Part Yield');
  const iMfrLoc = idxAny(header, 'Machine Manufacturer Location');
  if (iName === -1 || iLabor === -1) throw new Error(`${mapping.file}: unexpected header shape`);

  const machinesInFile = [];
  const seen = new Set();
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

    machinesInFile.push({ name, direct, indirect, total, laborRate, realPrice, landedCost, r });
  }

  for (const processName of mapping.processes) {
    const machineClass = mapping.machineClassOverride || snakeCase(processName);
    const wageGrade = WAGE_GRADE[processName] ?? null;
    let n = 0;
    for (const m of machinesInFile) {
      const rowWageGrade = iWageGrade !== -1 && m.r[iWageGrade] && m.r[iWageGrade].trim() ? m.r[iWageGrade] : wageGrade;
      rows.push([
        sqlStr(machineClass), sqlStr('USA'), sqlStr(m.name), sqlStr('USD'), sqlStr('US'),
        sqlStr('BENCHMARK'), sqlStr('pcb'), sqlStr('PCB'),
        sqlNum(m.r[iOperators]), sqlNum(m.r[iSetup]), 'NULL',
        sqlNum(m.landedCost), sqlNum(m.direct), sqlNum(m.indirect), sqlNum(m.direct), sqlNum(m.indirect),
        sqlNum(m.total), sqlNum(m.total), sqlNum(m.laborRate), sqlNum(m.laborRate), sqlNum(m.laborRate),
        sqlNum(m.r[iWclrf]), sqlNum(m.r[iLts]), sqlStr(rowWageGrade), sqlNum(iPrice === -1 ? null : m.r[iPrice]),
        sqlNum(m.r[iLength]), sqlNum(m.r[iWidth]), sqlNum(m.r[iFootprint]), sqlNum(m.r[iPower]), sqlNum(m.r[iLife]),
        sqlNum(m.r[iInstall]), sqlNum(m.r[iUptime]), sqlNum(m.r[iMaint]), sqlNum(m.r[iSalvage]), sqlNum(m.r[iSupplies]),
        sqlNum(m.r[iUtil]), sqlNum(m.r[iYield]), sqlStr(iMfrLoc === -1 ? null : m.r[iMfrLoc]),
        sqlStr(`${processName}:${m.name}`),
      ]);
      n++;
    }
    counts[processName] = (counts[processName] || 0) + n;
  }
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');
const countLines = Object.entries(counts).map(([c, n]) => `--   ${c.padEnd(34)} ${n} machines`).join('\n');

const sql = `-- ============================================================================
-- Migration 797: Seed mhr_records with the real PCB machines
-- (Phase 5 of the multi-group MHR/LHR seeding program)
-- ============================================================================
-- Generated by scripts/gen_797_seed_pcb_mhr_records.js -- do not hand-edit,
-- re-run the generator and diff instead.
--
-- Source: memory/PCBA/Machine/*.csv (29 of 34 real files used -- 5 skipped
-- as duplicate/partial-duplicate exports of another kept file, see the
-- generator script's own header for exactly which and why).
--
${countLines}
--
-- ${rows.length} real machine rows total, across 32 of PCB's 34 real processes
-- ("No Cost Feature" and "User-Defined Process" have no real wage grade or
-- machine file anywhere in this source -- a real, disclosed gap, not seeded).
--
-- Same 38-column shape/value-mapping discipline as migration 738/793-796.
-- process_family: a new, disclosed 'pcb' value (no established value fits)
-- for all seeded processes -- see the generator script's own header.
-- wage_grade is the REAL per-process value, verified directly.
--
-- UNLIKE every prior phase, several real machine pools back MORE THAN ONE
-- real process here (verified against memory/PCBA/processes.csv's own
-- Default Machine column for every process) -- e.g. the same 9 real drilling
-- machines back both "Drill Circuit Holes" and "Drill Registration Holes";
-- the same 5 real screen-printing machines back both "Screen Printing" and
-- "Plug Vias" (which has no dedicated file of its own). This is real,
-- sourced machine-sharing, not a fabricated linkage -- see the generator
-- script's own header for the full list.
--
-- machine_class: 'Bench Operation' -> 'pcb_bench_operation' (real collision
-- with the registered 'deburring' class's own bare 'Bench' keyword, same
-- \\b-start-boundary shape as migration 796's own finding). 'router',
-- 'stamp', 'des', 'ses' are prefixed 'pcb_' for HR Rates page readability
-- only, not because of an actual regex collision -- see the generator
-- script's own header for the exact reasoning.
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
