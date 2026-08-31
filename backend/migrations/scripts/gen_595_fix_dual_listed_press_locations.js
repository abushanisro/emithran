// One-off generator for migration 595. Not part of the migration itself —
// run manually to (re)produce the SQL, then inspect the diff before
// committing. Same discipline as every other gen_*.js script.
//
// Fixes a real bug in migration 594: 12 machine names (the same "duplicate"
// press machines from the Standard Press reconciliation earlier this cycle
// -- Default Press, Schuler x3, United Power x8) are listed THREE times in
// every one of the 4 location source files (under "Mechanical Press"/
// "Progressive Die Press", "Standard Press", and "Tandem Press" category
// labels), but only have TWO live mhr_records rows each (location='USA'
// under 'Progressive Die Press:X' and 'Tandem Press:X' -- 'Standard
// Press:X' was correctly excluded during the earlier reconciliation, since
// it's the same physical press already captured under the other two
// categories). Migration 594's join was unconstrained by category, so it
// cross-joined every one of the 3 source occurrences against every one of
// the 2 live rows = 6 output rows per (machine, location) instead of the
// correct 2 -- confirmed live: 'Schuler 1150 Ton' had 6 rows in China/India/
// Mexico/France instead of 2.
//
// Fix: delete every row migration 594 created for these 12 machines across
// the 4 new locations (clean slate, nothing salvageable -- the cross-join
// mixed rates from the wrong category in most of the 6), then re-insert
// exactly 2 correct rows per (machine, location), each joined against its
// OWN matching live category row and priced from that SAME category's rate
// in the source file (India/Mexico/France's "Mechanical Press" category =
// China's "Progressive Die Press" category = the live 'Progressive Die
// Press:X' row -- confirmed as a consistent 1:1 label alias across all 12
// machines in all 4 files before relying on it here).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'memory', 'sheetmetal', 'machine');
const OUT = path.join(__dirname, '..', '595_fix_dual_listed_press_locations.sql');

const DUAL_LISTED = [
  'Default Press', 'Schuler 1150 Ton', 'Schuler A2/200 - 360', 'Schuler TSD 2000',
  'United Power SHD-220 Ton', 'United Power SHD-400 Ton', 'United Power SHD-666 Ton',
  'United Power SHS-166 Ton', 'United Power SHS-666 Ton',
  'United Power THD-137 High Speed', 'United Power THD-333 High Speed', 'United Power THD-66 High Speed',
];

function loadFlat(file) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return data.machines.map(m => ({
    category: m.category, name: m.name,
    direct: m.directOverheadRate, indirect: m.indirectOverheadRate, labor: m.laborRate_USD_hr,
  }));
}
function loadChina() {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, 'china_location_data_full.json'), 'utf8'));
  const out = [];
  for (const category of Object.keys(data.categories)) {
    for (const m of data.categories[category].machines) {
      out.push({ category, name: m.name, direct: m.direct_overhead_rate_usd_hr, indirect: m.indirect_overhead_rate_usd_hr, labor: m.labor_rate_usd_hr });
    }
  }
  return out;
}

const LOCATIONS = [
  { location: 'India', records: loadFlat('india.json') },
  { location: 'China', records: loadChina() },
  { location: 'Mexico', records: loadFlat('mexico_delta.json') },
  { location: 'France', records: loadFlat('france_delta.json') },
];

// Both India/Mexico/France's "Mechanical Press" label and China's own
// "Progressive Die Press" label both mean the live 'Progressive Die Press'
// category for these 12 machines (verified 1:1 across all 12 x 4 files).
function liveCategoryFor(sourceCategory) {
  if (sourceCategory === 'Mechanical Press' || sourceCategory === 'Progressive Die Press') return 'Progressive Die Press';
  if (sourceCategory === 'Tandem Press') return 'Tandem Press';
  return null; // 'Standard Press' (and anything else) has no live match for these 12 -- discarded
}

function sqlStr(v) { return v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; }
function sqlNum(v) { return v === null || v === undefined ? 'NULL::numeric' : String(v); }

const correctedRows = []; // {location, liveCategory, name, direct, indirect, labor}
for (const loc of LOCATIONS) {
  for (const name of DUAL_LISTED) {
    const occurrences = loc.records.filter(r => r.name === name);
    for (const occ of occurrences) {
      const liveCat = liveCategoryFor(occ.category);
      if (!liveCat) continue; // 'Standard Press' source rows: no live match, correctly dropped
      correctedRows.push({ location: loc.location, liveCategory: liveCat, name, direct: occ.direct, indirect: occ.indirect, labor: occ.labor });
    }
  }
}

const insertValueRows = correctedRows.map(r =>
  `(${sqlStr(r.location)}, ${sqlStr(r.liveCategory)}, ${sqlStr(r.name)}, ${sqlNum(r.direct)}, ${sqlNum(r.indirect)}, ${sqlNum(r.labor)})`
);

const namesListSql = DUAL_LISTED.map(sqlStr).join(', ');
const locationsListSql = ['India', 'China', 'Mexico', 'France'].map(sqlStr).join(', ');

const sql = `-- ============================================================================
-- Migration 595: Fix over-multiplied dual-listed press rows from migration
-- 594 (2026-08-28)
--
-- Root cause: 12 machine names (the same "duplicate" press machines from
-- the Standard Press reconciliation earlier this cycle) are listed THREE
-- times in every one of the 4 location source files (categories
-- "Mechanical Press"/"Progressive Die Press", "Standard Press", "Tandem
-- Press"), but only have TWO live mhr_records rows each under location=
-- 'USA' ('Progressive Die Press:X' and 'Tandem Press:X' -- 'Standard
-- Press:X' was correctly excluded during the earlier reconciliation).
-- Migration 594's join was unconstrained by category, cross-joining every
-- source occurrence (3) against every live row (2) = 6 rows per (machine,
-- location) instead of 2 -- confirmed live for 'Schuler 1150 Ton'.
--
-- Fix: delete every row migration 594 created for these 12 machines across
-- India/China/Mexico/France (nothing salvageable -- the cross-join mixed
-- rates from the wrong category in most of the 6), then re-insert exactly
-- the correct 2 rows per (machine, location), each priced from its own
-- matching category in the source file and joined against its own matching
-- live category row. Confirmed before relying on it: India/Mexico/France's
-- "Mechanical Press" category label = China's own "Progressive Die Press"
-- label = the live 'Progressive Die Press' category, consistently across
-- all 12 machines in all 4 files. "Standard Press" source rows are
-- discarded (no live match for these 12 -- consistent with the earlier
-- reconciliation decision).
--
-- No other machine name is affected -- verified: these are the ONLY 12
-- names that appear more than once within any of the 4 source files.
-- ============================================================================

BEGIN;

-- ── Step 1: remove every row migration 594 created for these 12 machines ──
DELETE FROM mhr_records
WHERE location IN (${locationsListSql})
AND machine_name IN (${namesListSql});

-- ── Step 2: re-insert the correct 2-per-(machine,location) rows ───────────
INSERT INTO mhr_records (
  user_id, organization_id, location, commodity_code, process_group, machine_class,
  machine_name, machine_description, manufacturer_country, machine_price_usd,
  landed_machine_cost, is_manual_entry, manual_mhr_value, total_machine_hour_rate,
  fully_burdened_local_per_hr,
  shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
  capacity_utilization_rate, accessories_cost_percentage, installation_cost_percentage,
  payback_period_years, interest_rate_percentage, insurance_rate_percentage,
  machine_footprint_sqm, rent_per_sqm_per_month, maintenance_cost_percentage,
  power_kwh_per_hour, electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage,
  power_kw, currency, currency_symbol,
  direct_overhead_rate, indirect_overhead_rate, usd_lhr_total,
  direct_overhead_source, indirect_overhead_source, labor_rate_source,
  economics_version, economics_updated_at,
  capability_source, benchmark_source_key,
  benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr, benchmark_labor_rate_usd_hr
)
SELECT
  NULL, NULL, v.location, usa.commodity_code, usa.process_group, usa.machine_class,
  usa.machine_name, usa.machine_description, usa.manufacturer_country, usa.machine_price_usd,
  usa.landed_machine_cost, true,
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  usa.shifts_per_day, usa.hours_per_shift, usa.working_days_per_year, usa.planned_maintenance_hours_per_year,
  usa.capacity_utilization_rate, usa.accessories_cost_percentage, usa.installation_cost_percentage,
  usa.payback_period_years, usa.interest_rate_percentage, usa.insurance_rate_percentage,
  usa.machine_footprint_sqm, usa.rent_per_sqm_per_month, usa.maintenance_cost_percentage,
  usa.power_kwh_per_hour, usa.electricity_cost_per_kwh, usa.admin_overhead_percentage, usa.profit_margin_percentage,
  usa.power_kw, 'USD', '$',
  v.direct, v.indirect, v.labor,
  'benchmark', 'benchmark', 'benchmark',
  COALESCE(usa.economics_version, 1), NOW(),
  'benchmark', usa.benchmark_source_key || ':' || v.location,
  v.direct, v.indirect, v.labor
FROM mhr_records usa
JOIN (VALUES
${insertValueRows.join(',\n')}
) AS v(location, live_category, name, direct, indirect, labor)
  ON lower(usa.machine_name) = lower(v.name)
 AND usa.benchmark_source_key = v.live_category || ':' || v.name
WHERE usa.location = 'USA';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, location, count(*) FROM mhr_records
--   WHERE location IN (${locationsListSql}) AND machine_name IN (${namesListSql})
--   GROUP BY machine_name, location ORDER BY machine_name, location;
-- -- Every row should now show count = 2 (was 6 before this migration).
-- SELECT machine_name, location, benchmark_source_key, direct_overhead_rate, indirect_overhead_rate
--   FROM mhr_records WHERE machine_name = 'Schuler 1150 Ton' ORDER BY location, benchmark_source_key;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, '--', correctedRows.length, 'corrected rows (expect', DUAL_LISTED.length * LOCATIONS.length * 2, ').');
