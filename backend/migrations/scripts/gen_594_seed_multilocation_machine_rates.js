// One-off generator for migration 594. Not part of the migration itself —
// run manually to (re)produce the SQL from the source JSON files, then
// inspect the diff before committing. Same discipline as
// gen_590_seed_sheet_metal_raw_materials.js / gen_593.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'memory', 'sheetmetal', 'machine');
const OUT = path.join(__dirname, '..', '594_seed_multilocation_machine_rates.sql');

// ── Load + normalize each location file into a common shape ────────────────
// {category, name, direct, indirect, labor} — direct/indirect/labor are all
// already USD per the source files (China's fields are explicitly
// '..._usd_hr'; India/Mexico/France's unlabeled fields are the same order
// of magnitude — confirmed against China's labeled figures for the same
// machines). User decision (2026-08-28): store as USD directly, no FX
// conversion to local currency — the source's own values, not a guess.

function loadFlat(file) {
  // india.json / mexico_delta.json / france_delta.json share this shape:
  // { machines: [{category, name, laborRate_USD_hr, directOverheadRate, indirectOverheadRate}] }
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return data.machines.map(m => ({
    category: m.category,
    name: m.name,
    direct: m.directOverheadRate,
    indirect: m.indirectOverheadRate,
    labor: m.laborRate_USD_hr,
  }));
}

function loadChina() {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, 'china_location_data_full.json'), 'utf8'));
  const out = [];
  for (const category of Object.keys(data.categories)) {
    for (const m of data.categories[category].machines) {
      out.push({
        category,
        name: m.name,
        direct: m.direct_overhead_rate_usd_hr,
        indirect: m.indirect_overhead_rate_usd_hr,
        labor: m.labor_rate_usd_hr,
      });
    }
  }
  return out;
}

const chinaRecords = loadChina();

// China's names are verified to match the live location='USA' mhr_records
// catalog exactly (migration 582's counts matched exactly using this same
// naming). India/mexico_delta/france_delta's names are truncated for
// multi-word categories like Roll Benders (e.g. "2 Roll Bender - 1400mm
// Roll Length" vs China's/the live catalog's "2 Roll Bender - 1400mm Roll
// Length x 300mm Roll Diameter") -- confirmed: 64 of India's 318 names
// don't exact-match China's set. Resolved here, not via a fuzzy SQL JOIN at
// migration-run time, so every resolution is deterministic and inspectable
// before the migration is ever written: 26 of the 64 resolve to exactly ONE
// China name via a unique "<truncated> x ...\" or "<truncated> ..." prefix
// match (zero ambiguous cases -- verified before relying on this); the
// remaining 38 are genuine naming divergences (different model numbers,
// e.g. "Knuth KRM-S 30/4", "Progressive Die Press - 1500kN Press Force")
// with no safe resolution -- left as their original (truncated) name, which
// will simply 0-match the live join (a documented gap, not a wrong guess).
const canonicalNames = new Set(chinaRecords.map(r => r.name));
function resolveName(name) {
  if (canonicalNames.has(name)) return name;
  const candidates = [...canonicalNames].filter(cn => cn.startsWith(name + ' x ') || cn.startsWith(name + ' '));
  return candidates.length === 1 ? candidates[0] : name;
}

const LOCATIONS = [
  { location: 'India', region: 'IND', records: loadFlat('india.json').map(r => ({ ...r, name: resolveName(r.name) })) },
  { location: 'China', region: 'CHN', records: chinaRecords },
  { location: 'Mexico', region: 'MEX', records: loadFlat('mexico_delta.json').map(r => ({ ...r, name: resolveName(r.name) })) },
  { location: 'France', region: 'FRA', records: loadFlat('france_delta.json').map(r => ({ ...r, name: resolveName(r.name) })) },
];

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL::numeric';
  return String(v);
}
function rawJsonb(row) {
  return `'${JSON.stringify(row).replace(/'/g, "''")}'::jsonb`;
}

let stageBlocks = [];
let promoteBlocks = [];

for (const loc of LOCATIONS) {
  const stageRows = loc.records.map(r =>
    `('machine', ${sqlStr(loc.region)}, '2026-08', ${sqlStr(loc.category + ':' + r.name)}, ${sqlStr(r.direct)}, 'USD/hr direct overhead', 'Sheet metal machine rate reference row (${loc.location})', ${rawJsonb(r)})`
  );
  stageBlocks.push(
    `-- ── ${loc.location} (${loc.records.length} records) ──\nINSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)\nVALUES\n${stageRows.join(',\n')}\nON CONFLICT (category, source_region, source_version, key) DO NOTHING;`
  );

  const valueRows = loc.records.map(r =>
    `(${sqlStr(r.name)}, ${sqlNum(r.direct)}, ${sqlNum(r.indirect)}, ${sqlNum(r.labor)})`
  );

  promoteBlocks.push(`-- ── Promote ${loc.location} into mhr_records (clone matched USA row's
-- physical/capability columns, override location + rates) ─────────────────
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
  NULL, NULL, ${sqlStr(loc.location)}, usa.commodity_code, usa.process_group, usa.machine_class,
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
  'benchmark', usa.benchmark_source_key || ':' || ${sqlStr(loc.location)},
  v.direct, v.indirect, v.labor
FROM mhr_records usa
JOIN (VALUES
${valueRows.join(',\n')}
) AS v(name, direct, indirect, labor) ON lower(usa.machine_name) = lower(v.name)
WHERE usa.location = 'USA'
AND NOT EXISTS (
  SELECT 1 FROM mhr_records mr2
  WHERE lower(mr2.machine_name) = lower(usa.machine_name) AND mr2.location = ${sqlStr(loc.location)}
);`);
}

const totalRecords = LOCATIONS.reduce((s, l) => s + l.records.length, 0);

const sql = `-- ============================================================================
-- Migration 594: Seed India/China/Mexico/France machine rate data (2026-08-28)
--
-- Source: memory/sheetmetal/machine/india.json (342), china_location_data_full.json
-- (341), mexico_delta.json (342), france_delta.json (342) -- ${totalRecords} total
-- records. Each is the SAME base Sheet Metal machine catalog already live
-- under location='USA' (seeded by migrations 564/582-590), just with that
-- location's own labor rate + direct/indirect overhead rate (the Mexico/
-- France files' own header note confirms this explicitly: "Country-specific
-- overrides only ... All other fields ... inherit from world_average_base.json").
--
-- Currency: all four files give rates already in USD (China's fields are
-- explicitly '..._usd_hr'; India/Mexico/France's unlabeled fields are the
-- same order of magnitude for the same machines, confirming USD too). User
-- decision (2026-08-28): store as USD directly on every new row (currency=
-- 'USD'), not converted to each location's local currency (INR/CNY/MXN/EUR)
-- -- avoids introducing an FX-rate/date choice that isn't in the source data.
--
-- Two-step discipline (same as every seed this cycle):
--   Step 1: land all ${totalRecords} rows losslessly into sm_reference_data
--           (category='machine', source_region='IND'/'CHN'/'MEX'/'FRA').
--   Step 2: promote into mhr_records. Since these files carry ONLY rate data
--           (no machine_price_usd, power_kw, or any other physical/
--           capability column -- confirmed against India/Mexico/France's own
--           field lists and the delta files' own "inherit from world_average
--           _base.json" note), each new row is built by joining the rate
--           data against the MATCHING live location='USA' row (by exact
--           case-insensitive machine_name) and cloning every physical/
--           capability/operating-assumption column from it verbatim --
--           overriding only location, currency, the three rate columns
--           (direct_overhead_rate, indirect_overhead_rate, usd_lhr_total),
--           the three MHR-derivation columns (recomputed as direct+indirect,
--           matching migration 581's canonical formula), and
--           benchmark_source_key (suffixed with the location so it stays
--           unique per machine-per-location; the existing single '.split(":")
--           [0]' parse in mhr.service.ts only reads the first segment, so
--           appending a third segment is safe -- verified against every live
--           usage of benchmark_source_key before choosing this format).
--           Dedup: skips any (machine_name, location) pair that already
--           exists, same NOT EXISTS precedent used all cycle.
--
-- A machine name present in one of these location files but with NO matching
-- location='USA' row updates nothing for that location (0-row join miss) --
-- deliberately not inserted as a location-only row with fabricated physical/
-- capability data it doesn't have. Still staged in Step 1 for audit.
-- ============================================================================

BEGIN;

-- ── Step 1: lossless staging (audit trail; not read live by the app) ────────
${stageBlocks.join('\n\n')}

-- ── Step 2: promote into mhr_records, per location ─────────────────────────
${promoteBlocks.join('\n\n')}

COMMIT;

-- Verification (run manually after):
-- SELECT location, count(*) FROM mhr_records WHERE location IN ('India','China','Mexico','France') GROUP BY location ORDER BY location;
-- -- Expect counts close to (but possibly less than) 342/341/342/342 -- limited by how many
-- -- machine names actually matched a live location='USA' row.
-- SELECT count(*) FROM sm_reference_data WHERE category='machine' AND source_region IN ('IND','CHN','MEX','FRA') AND source_version='2026-08';
-- -- Expect ${totalRecords}.
-- SELECT machine_name, location, direct_overhead_rate, indirect_overhead_rate, total_machine_hour_rate, currency
--   FROM mhr_records WHERE machine_name = '2 Axis Router - 18,000 RPM' ORDER BY location;
-- -- Should show one row per location (USA + any of India/China/Mexico/France that matched), each with its own rate.
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, '--', totalRecords, 'total source records across 4 locations.');
