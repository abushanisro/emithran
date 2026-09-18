// Generator: stages full raw JSON + seeds mhr_records for the 2 real
// Machining categories (Jig Bore, Shaver) whose source machine files
// (memory/machining/machine/jig_bore_usa.json, shaver_usa.json) arrived
// after migrations 692/693/737/738 were written -- closing the last real
// data gap in the 43-station Machining catalog. Combined with 692/693's
// 12 + 737/738's 26, this brings real per-machine data to all 40 of the 43
// real stations (the remaining 3 -- No Cost Feature, Perimeter Cut, Use
// Stock Machining -- are real non-manufacturing markers with no machine by
// design, migration 756, not a data gap).
//
// Same two real outputs as 737+738 combined into one generator (small
// enough -- 6 total machines -- not to need separate files/migrations):
//   1. machining_reference_data category='machine' (raw, unflattened,
//      powers the HR Rates "Edit MHR Record" lookup panel)
//   2. mhr_records rows (powers the HR Rates summary table AND, via
//      process_calculator_mappings.machine_class below, the Process page)
//
// machine_class: snake_case(categoryLabel) -- 'jig_bore' and 'shaver'.
// Checked directly against every existing MACHINE_REGISTRY key and
// keyword in default-rates.constants.ts before choosing these (grep
// confirmed zero matches for "jig_bore"/"jig bore"/"shaver" anywhere in
// that file) -- no collision-avoidance rename needed, unlike Drill Press/
// Inspection/MillTurn in migration 738.
//
// roadmap_status/is_active: 'thin' / true -- same tier as every other
// category with real HR-rate data but no dedicated per-station cost
// engine yet (migration 753's own convention), NOT the 'production' tier
// (that's reserved for the 7 categories aliased into an existing coarse
// cnc_* pricing bucket via selector.ts's MACHINING_CATEGORY_ALIAS -- Jig
// Bore/Shaver are precision finishing operations, not lathe/mill work,
// and have no such bucket to alias into).
//
// Offline, file-in/file-out -- matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const MACHINE_DIR = path.join(__dirname, '../../../memory/machining/machine');
const OUT_STAGE_SQL = path.join(__dirname, '../757_stage_jig_bore_shaver_reference_detail.sql');
const OUT_SEED_SQL = path.join(__dirname, '../758_seed_jig_bore_shaver_mhr_records_and_activate.sql');

const SOURCE_REGION = 'USA';
const SOURCE_VERSION = '2026-03';

const FILES = {
  'jig_bore_usa.json': 'Jig Bore',
  'shaver_usa.json': 'Shaver',
};
const MACHINE_CLASS = {
  'Jig Bore': 'jig_bore',
  'Shaver': 'shaver',
};

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}
function sqlJsonb(obj) {
  return `$jsonb$${JSON.stringify(obj)}$jsonb$::jsonb`;
}
function pick(obj, ...names) {
  if (!obj) return undefined;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null) return obj[n];
  }
  return undefined;
}

// ── 1. Stage raw JSON (mirrors gen_737) ──────────────────────────────────
const stageRows = [];
// ── 2. Seed mhr_records (mirrors gen_738) ────────────────────────────────
const seedRows = [];

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'currency_code', 'country_code',
  'source_type', 'process_family', 'process_group', 'operators', 'setup_time_hr', 'press_cycle_time_s',
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

// Real per-category wage grade, from memory/machining/wage_grade_associations.json
// (used only when the individual machine's own accounting.wage_grade_name is NULL --
// both real source files have wage_grade_name: null for every machine).
const CATEGORY_WAGE_GRADE = {
  'Jig Bore': '2 - Metal',
  'Shaver': '3 - Metal',
};

let totalMachines = 0;
for (const [file, categoryLabel] of Object.entries(FILES)) {
  const fullPath = path.join(MACHINE_DIR, file);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const machineClass = MACHINE_CLASS[categoryLabel];
  const categoryWageGrade = CATEGORY_WAGE_GRADE[categoryLabel];

  for (const m of data.machines) {
    const name = m.name;
    if (!name) continue;
    totalMachines++;

    // -- staging row --
    stageRows.push({
      key: `${categoryLabel}:${name}`,
      value: pick(m.bottom_up_overhead_rate_inputs, 'machine_price_usd') != null
        ? String(m.bottom_up_overhead_rate_inputs.machine_price_usd) : null,
      raw: m,
    });

    // -- mhr_records row --
    const acc = m.accounting || {};
    const time = { ...(m.time || {}), ...(m.standards || {}) };
    const bu = m.bottom_up_overhead_rate_inputs || {};
    const yields = m.yields || {};
    const mfr = m.manufacturer_information || {};

    const laborRate = pick(acc, 'labor_rate_usd_per_hr', 'labor_rate_usd_hr');
    const direct = pick(acc, 'direct_overhead_rate_usd_per_hr', 'direct_overhead_rate_usd_hr');
    const indirect = pick(acc, 'indirect_overhead_rate_usd_per_hr', 'indirect_overhead_rate_usd_hr');
    const total = pick(acc, 'total_overhead_rate_usd_per_hr', 'total_overhead_rate_usd_hr')
      ?? (direct != null && indirect != null ? Math.round((direct + indirect) * 100) / 100 : null);
    const wageGrade = pick(acc, 'wage_grade_name') ?? categoryWageGrade;

    seedRows.push([
      sqlStr(machineClass), sqlStr('USA'), sqlStr(name), sqlStr('USD'), sqlStr('US'),
      sqlStr('BENCHMARK'), sqlStr('machined'), sqlStr('Machining'),
      sqlNum(pick(acc, 'number_of_operators')), sqlNum(pick(time, 'setup_time_hr')), 'NULL',
      sqlNum(direct), sqlNum(indirect), sqlNum(direct), sqlNum(indirect),
      sqlNum(total), sqlNum(total),
      sqlNum(laborRate), sqlNum(laborRate), sqlNum(laborRate),
      sqlNum(pick(acc, 'work_center_labor_rate_factor')), sqlNum(pick(acc, 'labor_time_standard')), sqlStr(wageGrade),
      sqlNum(pick(bu, 'machine_price_usd')), sqlNum(pick(bu, 'machine_length_mm')), sqlNum(pick(bu, 'machine_width_mm')),
      sqlNum(pick(bu, 'footprint_allowance_factor')), sqlNum(pick(bu, 'machine_power_kW', 'machine_power_kw')), sqlNum(pick(bu, 'machine_life_yr')),
      sqlNum(pick(bu, 'installation_factor_pct', 'installation_factor_percent', 'installation_factor')),
      sqlNum(pick(bu, 'machine_uptime_pct', 'machine_uptime_percent', 'machine_uptime')),
      sqlNum(pick(bu, 'annual_maintenance_factor_pct', 'annual_maintenance_factor_percent', 'annual_maintenance_factor')),
      sqlNum(pick(bu, 'salvage_value_factor_pct', 'salvage_value_factor_percent', 'salvage_value_factor')),
      sqlNum(pick(bu, 'supplies_cost_usd_per_yr', 'supplies_cost_usd_yr')),
      sqlNum(pick(yields, 'avg_utilization')), sqlNum(pick(yields, 'good_part_yield')),
      sqlStr(pick(mfr, 'machine_manufacturer_location')), sqlStr(`${categoryLabel}:${name}`),
    ]);
  }
}

// ── Write migration 757: staging ─────────────────────────────────────────
const stageValuesSql = stageRows.map((r) =>
  `('machine', ${sqlStr(SOURCE_REGION)}, ${sqlStr(SOURCE_VERSION)}, ${sqlStr(r.key)}, ${sqlStr(r.value)}, ${sqlStr('Currency')}, ${sqlStr(`${r.key.split(':')[0]} reference spec`)}, ${sqlJsonb(r.raw)})`,
).join(',\n');

const stageSql = `-- ============================================================================
-- Migration 757: Stage full raw JSON of the ${stageRows.length} real Jig Bore /
-- Shaver machines into machining_reference_data category='machine'
--
-- Generated by gen_757_stage_and_seed_jig_bore_shaver.js. These 2 source
-- files (memory/machining/machine/jig_bore_usa.json, shaver_usa.json)
-- arrived after migrations 692/693/737/738 were written -- closing the
-- last real machine-data gap in the 43-station Machining catalog (40 of
-- 43 now have real per-machine data; the remaining 3 -- No Cost Feature,
-- Perimeter Cut, Use Stock Machining -- are real non-manufacturing
-- markers with no machine by design, migration 756).
--
-- Powers the same HR Rates "Edit MHR Record" lookup panel as migrations
-- 692/737 -- mhr.service.ts#getReferenceDetail already queries
-- machining_reference_data category='machine' generically.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${stageValuesSql}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;
fs.writeFileSync(OUT_STAGE_SQL, stageSql, 'utf8');

// ── Write migration 758: mhr_records seed + process activation ──────────
const seedValuesSql = seedRows.map((r) => `  (${r.join(', ')})`).join(',\n');

const seedSql = `-- ============================================================================
-- Migration 758: Seed mhr_records with the ${seedRows.length} real Jig Bore /
-- Shaver machines, and activate their process_calculator_mappings rows
--
-- Generated by gen_757_stage_and_seed_jig_bore_shaver.js. Continues
-- migration 738's own disclosed gap (these 2 categories had zero source
-- machine data at that time) now that real data has arrived.
--
-- machine_class = snake_case(categoryLabel) -- 'jig_bore'/'shaver' -- both
-- checked directly against every MACHINE_REGISTRY key/keyword in
-- default-rates.constants.ts before use; zero collisions found (unlike
-- Drill Press/Inspection/MillTurn in migration 738, which needed a
-- rename).
--
-- roadmap_status/is_active = 'thin'/true -- same tier as the other 31
-- non-aliased real Machining categories (migration 753): real HR-rate
-- data, catalog-visible, no dedicated per-station cost engine yet. NOT
-- 'production' -- these are precision finishing operations (jig boring,
-- gear shaving), not lathe/mill work, so selector.ts's
-- MACHINING_CATEGORY_ALIAS has no coarse cnc_* bucket to alias them into.
-- ============================================================================

BEGIN;

INSERT INTO mhr_records (
  ${COLUMNS.join(', ')}
) VALUES
${seedValuesSql}
;

UPDATE process_taxonomy
SET machine_class = 'jig_bore', roadmap_status = 'thin'
WHERE process_group = 'Machining' AND process_name = 'Jig Bore';

UPDATE process_taxonomy
SET machine_class = 'shaver', roadmap_status = 'thin'
WHERE process_group = 'Machining' AND process_name = 'Shaver';

UPDATE process_calculator_mappings
SET machine_class = 'jig_bore', is_active = true, updated_at = NOW()
WHERE process_group = 'Machining' AND process_route = 'Jig Bore';

UPDATE process_calculator_mappings
SET machine_class = 'shaver', is_active = true, updated_at = NOW()
WHERE process_group = 'Machining' AND process_route = 'Shaver';

COMMIT;

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT machine_class, count(*) FROM mhr_records WHERE machine_class IN ('jig_bore','shaver') GROUP BY machine_class;
-- -- Expect: jig_bore 4, shaver 2
-- SELECT process_route, is_active, machine_class FROM process_calculator_mappings
--   WHERE process_group = 'Machining' AND process_route IN ('Jig Bore', 'Shaver');
-- -- Expect: both is_active = true, machine_class set
-- SELECT count(*) FROM process_calculator_mappings WHERE process_group = 'Machining' AND is_active = false;
-- -- Expect: 0 -- all 43 real Machining stations now either active (40 with real machine_class,
-- -- 3 non-mfg markers) with none left disclosed-inactive.

NOTIFY pgrst, 'reload schema';
`;
fs.writeFileSync(OUT_SEED_SQL, seedSql, 'utf8');

console.log(`Wrote ${stageRows.length} staging rows to ${OUT_STAGE_SQL}`);
console.log(`Wrote ${seedRows.length} mhr_records rows + activation to ${OUT_SEED_SQL}`);
console.log(`Total machines processed: ${totalMachines}`);
