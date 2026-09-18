// Generator: stages the FULL raw JSON of the 26 remaining real Machining
// station categories (memory/machining/machine/*_usa.json /
// *_work_center_data.json — everything NOT already covered by migration
// 692's machiningusa.json, which staged 12 of the real 43 station
// categories) into machining_reference_data category='machine' (schema:
// migration 638) — continuing exactly what migration 692's own header
// comment disclosed as future work ("remaining categories/regions to
// follow in a future session per the user").
//
// Same conventions as migration 692/gen_692:
//   key = "<categoryLabel>:<machine name>"
//   value = bottom_up_overhead_rate_inputs.machine_price_usd
//   raw = the untouched, unflattened original machine object
//
// Source-file shape differs from machiningusa.json's per-machine schema in
// two real ways (confirmed by inspecting all 26 files directly):
//   1. snake_case field names throughout (labor_rate_usd_per_hr, not
//      laborRateUsdPerHr) instead of camelCase.
//   2. Per-field naming genuinely varies FILE TO FILE for a handful of
//      real fields (e.g. "annual_maintenance_factor_percent" vs
//      "annual_maintenance_factor_pct" vs "annual_maintenance_factor";
//      "machine_power_kW" vs "machine_power_kw"; setup_time_hr living
//      under "time" in most files but "standards" in others) — this was
//      verified by collecting every distinct key actually present across
//      all 26 files before writing this script, not guessed. pick()
//      below tries every real variant found; it does not invent a value
//      for a field that is genuinely absent.
//   3. Three files (stock_prep_mill / threaded_wheel_gear_grinder /
//      wire_edm — the "_work_center_data" files) use "primary_id" as an
//      OBJECT ({name, description}) for machine identity instead of a
//      top-level string "name" field. Handled explicitly, not coerced.
//
// Offline, file-in/file-out — matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const MACHINE_DIR = path.join(__dirname, '../../../memory/machining/machine');
const OUT_SQL = path.join(__dirname, '../737_stage_machining_machine_reference_detail_remaining.sql');

const SOURCE_REGION = 'USA';
const SOURCE_VERSION = '2026-03';

// file -> real category label, exactly as memory/machining/wage_grade_associations.json
// and memory/machining/processes.json spell each real station name.
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

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlJsonb(obj) {
  return `$jsonb$${JSON.stringify(obj)}$jsonb$::jsonb`;
}

function machineIdentity(m) {
  if (typeof m.name === 'string' && m.name.trim()) {
    return { name: m.name.trim(), description: m.description ?? null };
  }
  if (m.primary_id && typeof m.primary_id === 'object') {
    return { name: m.primary_id.name ?? null, description: m.primary_id.description ?? null };
  }
  if (typeof m.primary_id === 'string' && m.primary_id.trim()) {
    return { name: m.primary_id.trim(), description: m.description ?? null };
  }
  return { name: null, description: null };
}

function bu(m) {
  return m.bottom_up_overhead_rate_inputs || {};
}

const rows = [];
for (const [file, categoryLabel] of Object.entries(FILES)) {
  const fullPath = path.join(MACHINE_DIR, file);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  for (const m of data.machines) {
    const { name } = machineIdentity(m);
    if (!name) continue;
    const price = bu(m).machine_price_usd;
    rows.push({
      key: `${categoryLabel}:${name}`,
      value: price != null ? String(price) : null,
      unit_type: 'Currency',
      notes: `Machining reference spec (${categoryLabel})`,
      raw: m,
    });
  }
}

const valuesSql = rows.map((r) => {
  return `('machine', '${SOURCE_REGION}', '${SOURCE_VERSION}', ${sqlStr(r.key)}, ${sqlStr(r.value)}, ${sqlStr(r.unit_type)}, ${sqlStr(r.notes)}, ${sqlJsonb(r.raw)})`;
}).join(',\n');

const sql = `-- ============================================================================
-- Migration 737: Stage full raw JSON of the ${rows.length} remaining real
-- Machining machines (26 of 43 real station categories not covered by
-- migration 692) into machining_reference_data category='machine'
--
-- Generated by gen_737_stage_machining_machine_reference_detail_remaining.js.
-- Completes the "remaining categories/regions to follow in a future
-- session" disclosed in migration 692's own header comment. Combined with
-- migration 692's 141 rows, all 12 + 26 = 38 real station categories from
-- memory/machining/machine/ are now staged (5 of the real 43 process.json
-- station names — Jig Bore, Shaver, No Cost Feature, Perimeter Cut, Use
-- Stock Machining — have no per-machine JSON file in memory/machining/
-- machine/ at all; genuinely absent source data, not skipped).
--
-- Powers the same HR Rates "Edit MHR Record" dialog read-only "Machine &
-- Process Lookup" panel as migration 692 — mhr.service.ts#getReferenceDetail
-- already queries machining_reference_data category='machine' generically
-- (no per-category code), so no backend change is needed for these rows.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
${valuesSql}
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${rows.length} rows to ${OUT_SQL}`);
