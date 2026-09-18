// Generator: inserts the 26 remaining real Machining station categories
// (memory/machining/machine/*_usa.json / *_work_center_data.json — every
// category NOT already staged by migration 692/693's machiningusa.json)
// as real, live mhr_records rows — the table the HR Rates page actually
// reads. Continues migration 693's own disclosed follow-up exactly.
//
// Column set: migration 693's real INSERT column list (37 columns —
// confirmed by counting its actual SQL, not its own header comment, which
// says 29), plus process_group (set directly in this INSERT — migration
// 693 left it NULL and needed a follow-up backfill migration 694; setting
// it here from the start avoids repeating that gap), for 38 total.
//
// Column-value mapping — same discipline as migration 693/gen_693:
//   machine_class: snake_case(categoryLabel) for 23 of the 26 categories.
//     Three deliberate exceptions, to avoid colliding with a live
//     MACHINE_REGISTRY key/keyword in default-rates.constants.ts (verified
//     directly against that file + selector.ts's classifyMachineRecord
//     Tier 0/Tier 2 matching before choosing these):
//       - "Drill Press"  -> 'cnc_drill_press' (NOT 'drill_press' — that is
//         an EXISTING live registry key already driving Sheet Metal's own
//         Drill Press cost routing; an exact string match would silently
//         merge two unrelated machine pools under Tier 0's trust-canonical-
//         value fast path).
//       - "Inspection"   -> 'machining_inspection' (bare "inspection" is a
//         literal, word-boundary-anchored substring of the 'cmm' class's
//         "Inspection" keyword — Tier 2's \b-prefixed regex would match it).
//       - "MillTurn"     -> 'machining_millturn' (bare "millturn" IS
//         'cnc_mill_turn's own "MillTurn" keyword verbatim — Tier 2 would
//         reclassify these rows into a different, un-vetted Machining
//         engine class rather than leaving them as their own honest slug).
//     Every other category's natural slug was checked the same way and
//     found to have no Tier 0 exact match and no Tier 2 \b-boundary
//     keyword match (underscored compound slugs never produce a \b
//     boundary at the collision point, since "_" is a word character) —
//     left as-is.
//   process_group: 'Machining' (matches migration 694's backfill value for
//     the first 12 categories, set here directly).
//   wage_grade: real per-category value from
//     memory/machining/wage_grade_associations.json (43 real process ->
//     wage-grade rows; all 26 of these categories have an exact name
//     match there — verified directly, not guessed) used only as a
//     fallback when a machine's own accounting.wage_grade_name is NULL,
//     exactly mirroring migration 695's backfill for the first 12
//     categories, but applied at seed time instead of a follow-up UPDATE.
//   Every other field maps 1:1 to its real source field, tolerant of the
//   real per-file naming variance documented in gen_737's header comment
//   (see pick() below) — never fabricated when genuinely absent.
//
// Offline, file-in/file-out — matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const MACHINE_DIR = path.join(__dirname, '../../../memory/machining/machine');
const OUT_SQL = path.join(__dirname, '../738_seed_machining_mhr_records_remaining.sql');

const FILES = {
  'broach_machines_usa.json': 'Broach',
  'cylindrical_grinder_machines_usa.json': 'Cylindrical Grinder',
  'deep_bore_machine_usa.json': 'Deep Bore Machine',
  'demask_usa.json': 'DeMask',
  'drill_press_usa.json': 'Drill Press',
  'etch_cell_usa.json': 'Etch Cell',
  'gun_drill_usa.json': 'Gun Drill',
  'hob_machine_usa.json': 'Hob Machine',
  'inspection_usa.json': 'Inspection',
  'internal_grinder_usa.json': 'Internal Grinder',
  'jig_grind_usa.json': 'Jig Grind',
  'manual_deburr_usa.json': 'Manual Deburr',
  'mask_cure_usa.json': 'Mask Cure',
  'millturn_usa.json': 'MillTurn',
  'profile_gear_grinder_usa.json': 'Profile Gear Grinder',
  'reciprocating_surface_grinder_usa.json': 'Reciprocating Surface Grinder',
  'rotary_surface_grinder_usa.json': 'Rotary Surface Grinder',
  'scribe_usa.json': 'Scribe',
  'shaper_usa.json': 'Shaper',
  'simultaneous_turning_usa.json': 'Simultaneous Turning',
  'special_inspection_usa.json': 'Special Inspection',
  'spline_roller_usa.json': 'Spline Roller',
  'stock_prep_lathe_usa.json': 'Stock Prep Lathe',
  'stock_prep_mill_work_center_data.json': 'Stock Prep Mill',
  'threaded_wheel_gear_grinder_work_center_data.json': 'Threaded Wheel Gear Grinder',
  'wire_edm_work_center_data.json': 'Wire EDM',
};

// Real per-category wage grade, from memory/machining/wage_grade_associations.json
// (used only when the individual machine's own accounting.wage_grade_name is NULL).
const CATEGORY_WAGE_GRADE = {
  'Broach': '3 - Metal',
  'Cylindrical Grinder': '2 - Metal',
  'Deep Bore Machine': '3 - Metal',
  'DeMask': '2 - Metal',
  'Drill Press': '2 - Metal',
  'Etch Cell': '5 - Metal',
  'Gun Drill': '2 - Metal',
  'Hob Machine': '3 - Metal',
  'Inspection': '4 - Metal',
  'Internal Grinder': '2 - Metal',
  'Jig Grind': '2 - Metal',
  'Manual Deburr': '2 - Metal',
  'Mask Cure': '2 - Metal',
  'MillTurn': '5 - Metal',
  'Profile Gear Grinder': '3 - Metal',
  'Reciprocating Surface Grinder': '3 - Metal',
  'Rotary Surface Grinder': '2 - Metal',
  'Scribe': '5 - Metal',
  'Shaper': '2 - Metal',
  'Simultaneous Turning': '5 - Metal',
  'Special Inspection': '5 - Metal',
  'Spline Roller': '4 - Metal',
  'Stock Prep Lathe': '3 - Metal',
  'Stock Prep Mill': '5 - Metal',
  'Threaded Wheel Gear Grinder': '3 - Metal',
  'Wire EDM': '5 - Metal',
};

// Deliberate machine_class exceptions — see header comment.
const MACHINE_CLASS_OVERRIDE = {
  'Drill Press': 'cnc_drill_press',
  'Inspection': 'machining_inspection',
  'MillTurn': 'machining_millturn',
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
function snakeCase(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Case/spelling-tolerant field pick — tries every real variant name found
// across all 26 files (collected by direct inspection before writing this
// script; see gen_737's header). Returns undefined, never a guess, when a
// field is genuinely absent from a given object.
function pick(obj, ...names) {
  if (!obj) return undefined;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null) return obj[n];
  }
  return undefined;
}

function machineIdentity(m) {
  if (typeof m.name === 'string' && m.name.trim()) {
    return m.name.trim();
  }
  if (m.primary_id && typeof m.primary_id === 'object' && m.primary_id.name) {
    return String(m.primary_id.name).trim();
  }
  if (typeof m.primary_id === 'string' && m.primary_id.trim()) {
    return m.primary_id.trim();
  }
  return null;
}

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

const rows = [];
for (const [file, categoryLabel] of Object.entries(FILES)) {
  const fullPath = path.join(MACHINE_DIR, file);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const machineClass = MACHINE_CLASS_OVERRIDE[categoryLabel] || snakeCase(categoryLabel);
  const categoryWageGrade = CATEGORY_WAGE_GRADE[categoryLabel] ?? null;

  for (const m of data.machines) {
    const name = machineIdentity(m);
    if (!name) continue;

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

    rows.push([
      sqlStr(machineClass),                                 // machine_class
      sqlStr('USA'),                                         // location
      sqlStr(name),                                          // machine_name
      sqlStr('USD'),                                         // currency_code
      sqlStr('US'),                                          // country_code
      sqlStr('BENCHMARK'),                                   // source_type
      sqlStr('machined'),                                    // process_family
      sqlStr('Machining'),                                    // process_group
      sqlNum(pick(acc, 'number_of_operators')),               // operators
      sqlNum(pick(time, 'setup_time_hr')),                    // setup_time_hr
      'NULL',                                                 // press_cycle_time_s
      sqlNum(direct),                                         // direct_overhead_rate
      sqlNum(indirect),                                       // indirect_overhead_rate
      sqlNum(direct),                                         // benchmark_direct_overhead_rate_usd_hr
      sqlNum(indirect),                                       // benchmark_indirect_overhead_rate_usd_hr
      sqlNum(total),                                          // total_machine_hour_rate
      sqlNum(total),                                          // mhr_usd_per_hour
      sqlNum(laborRate),                                      // usd_labor_rate_per_hr
      sqlNum(laborRate),                                      // benchmark_labor_rate_usd_hr
      sqlNum(laborRate),                                      // usd_lhr_total
      sqlNum(pick(acc, 'work_center_labor_rate_factor')),     // work_center_labor_rate_factor
      sqlNum(pick(acc, 'labor_time_standard')),               // labor_time_standard
      sqlStr(wageGrade),                                      // wage_grade
      sqlNum(pick(bu, 'machine_price_usd')),                  // machine_price_usd
      sqlNum(pick(bu, 'machine_length_mm')),                  // machine_length_mm
      sqlNum(pick(bu, 'machine_width_mm')),                   // machine_width_mm
      sqlNum(pick(bu, 'footprint_allowance_factor')),         // footprint_allowance_factor
      sqlNum(pick(bu, 'machine_power_kW', 'machine_power_kw')), // machine_power_kw
      sqlNum(pick(bu, 'machine_life_yr')),                    // machine_life_yr
      sqlNum(pick(bu, 'installation_factor_pct', 'installation_factor_percent', 'installation_factor')), // installation_factor_pct
      sqlNum(pick(bu, 'machine_uptime_pct', 'machine_uptime_percent', 'machine_uptime')), // machine_uptime_pct
      sqlNum(pick(bu, 'annual_maintenance_factor_pct', 'annual_maintenance_factor_percent', 'annual_maintenance_factor')), // annual_maintenance_factor_pct
      sqlNum(pick(bu, 'salvage_value_factor_pct', 'salvage_value_factor_percent', 'salvage_value_factor')), // salvage_value_factor_pct
      sqlNum(pick(bu, 'supplies_cost_usd_per_yr', 'supplies_cost_usd_yr')), // supplies_cost_per_year
      sqlNum(pick(yields, 'avg_utilization')),                // avg_utilization
      sqlNum(pick(yields, 'good_part_yield')),                // good_part_yield
      sqlStr(pick(mfr, 'machine_manufacturer_location')),     // manufacturer_country
      sqlStr(`${categoryLabel}:${name}`),                     // benchmark_source_key
    ]);
  }
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');

const sql = `-- ============================================================================
-- Migration 738: Seed mhr_records with the ${rows.length} remaining real
-- Machining machines (26 of 43 real station categories not covered by
-- migration 693)
--
-- Generated by gen_738_seed_machining_mhr_records_remaining.js.
-- Continues migration 693's own disclosed follow-up. Together with
-- migration 693's 141 rows, this brings the real, live Machining machine
-- pool on the HR Rates page to 38 of 43 real station categories (the
-- remaining 5 — Jig Bore, Shaver, No Cost Feature, Perimeter Cut, Use
-- Stock Machining — have no per-machine JSON file in memory/machining/
-- machine/ at all; a disclosed source-data gap, not skipped).
--
-- process_group is set directly in this INSERT ('Machining') — migration
-- 693 left it NULL and needed a follow-up backfill (694); setting it here
-- avoids repeating that gap. wage_grade likewise uses the real per-category
-- value from memory/machining/wage_grade_associations.json directly at
-- seed time (migration 695's backfill equivalent), applied only where a
-- machine's own accounting.wage_grade_name is NULL.
--
-- machine_class: three deliberate exceptions (Drill Press ->
-- 'cnc_drill_press', Inspection -> 'machining_inspection', MillTurn ->
-- 'machining_millturn') to avoid colliding with a live MACHINE_REGISTRY
-- key/keyword in default-rates.constants.ts / selector.ts's
-- classifyMachineRecord — see this script's header comment for the exact
-- Tier 0/Tier 2 collision check performed for every one of the 26
-- categories before naming them. Every other category keeps its natural
-- snake_case(categoryLabel) slug.
--
-- Same 37-column INSERT list as migration 693, plus process_group set
-- directly here rather than via a follow-up backfill (38 total).
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
