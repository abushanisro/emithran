// One-off generator for migration 596. Not part of the migration itself —
// run manually to (re)produce the SQL, then inspect the diff before
// committing. Same discipline as every other gen_*.js script.
//
// Fixes 3 Plasma Punch machines that migration 594 silently dropped (zero
// rows added, not wrong data) because the location files spell/format their
// names differently from the live catalog:
//   - 'Ermak CPP 1270 X 30' (China/India/Mexico/France) -> live 'Ermak COP
//     1270 X 30' -- a single-letter transcription variant of the same real
//     machine (confirmed: identical rate profile pattern to every other
//     Plasma Punch entry, no other 'Ermak' listed anywhere).
//   - 'Muratec Magnum - 5000 Plasma' (all 4) -> live 'Muratec Magnium -
//     5000 Plasma' -- same reasoning, spelling variant only.
//   - 'Plasma Punch - 100 Watts 300kN' (India/Mexico/France only -- China's
//     own file already has the exact live-matching name with comma+suffix)
//     -> live 'Plasma Punch - 100 Watts, 300kN Press Force' -- identical
//     numbers (100 Watts, 300kN), only punctuation/suffix differs.
//
// Explicitly NOT fixed (real, different specs -- not name variants, would
// be fabricating an equivalence, not correcting a typo):
//   - 'Ficep Tipo C16' / 'Ficep Tipo C25' vs live's 'Ficep Tipo C23' (x2
//     units) -- different model numbers entirely.
//   - 'Plasma Punch - 200 Watts 450kN' vs live's 350kN/550kN variants --
//     the kN figure itself differs, not just formatting.
//   - 'Plasma Punch - 300 Watts 550kN' vs live's 'Plasma Punch - 200 Watts,
//     550kN Press Force' -- same kN, but the Watts figure differs (300 vs
//     200), so still a different spec, not a safe match.
//   - 'Plasma Punch - 400 Watts 100kN' vs live's 'Plasma Punch - 400 Watts,
//     1000kN Press Force' -- Watts matches, kN does not (100 vs 1000,
//     plausibly a dropped digit, but not confirmable -- left unmatched
//     rather than guessing a correction).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'memory', 'sheetmetal', 'machine');
const OUT = path.join(__dirname, '..', '596_fix_plasma_punch_spelling_variants.sql');

function loadFlat(file) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return data.machines.filter(m => m.category === 'Plasma Punch Combo').map(m => ({
    name: m.name, direct: m.directOverheadRate, indirect: m.indirectOverheadRate, labor: m.laborRate_USD_hr,
  }));
}
function loadChina() {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, 'china_location_data_full.json'), 'utf8'));
  return data.categories['Plasma Punch'].machines.map(m => ({
    name: m.name, direct: m.direct_overhead_rate_usd_hr, indirect: m.indirect_overhead_rate_usd_hr, labor: m.labor_rate_usd_hr,
  }));
}

// sourceName -> live catalog name, applied only within the Plasma Punch set.
const ALIAS = {
  'Ermak CPP 1270 X 30': 'Ermak COP 1270 X 30',
  'Muratec Magnum - 5000 Plasma': 'Muratec Magnium - 5000 Plasma',
  'Plasma Punch - 100 Watts 300kN': 'Plasma Punch - 100 Watts, 300kN Press Force',
};

const LOCATIONS = [
  { location: 'India', records: loadFlat('india.json') },
  { location: 'China', records: loadChina() },
  { location: 'Mexico', records: loadFlat('mexico_delta.json') },
  { location: 'France', records: loadFlat('france_delta.json') },
];

function sqlStr(v) { return v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`; }
function sqlNum(v) { return v === null || v === undefined ? 'NULL::numeric' : String(v); }

const rows = [];
for (const loc of LOCATIONS) {
  for (const r of loc.records) {
    const liveName = ALIAS[r.name];
    if (!liveName) continue;
    rows.push({ location: loc.location, liveName, direct: r.direct, indirect: r.indirect, labor: r.labor });
  }
}

const valueRows = rows.map(r => `(${sqlStr(r.location)}, ${sqlStr(r.liveName)}, ${sqlNum(r.direct)}, ${sqlNum(r.indirect)}, ${sqlNum(r.labor)})`);

const sql = `-- ============================================================================
-- Migration 596: Fix 3 Plasma Punch machines migration 594 silently dropped
-- due to spelling/formatting variants (2026-08-28)
--
-- 'Ermak CPP 1270 X 30' / 'Muratec Magnum - 5000 Plasma' (China/India/
-- Mexico/France) and 'Plasma Punch - 100 Watts 300kN' (India/Mexico/France
-- only -- China's own file already had the exact live-matching name) never
-- exact-matched the live catalog's 'Ermak COP 1270 X 30' / 'Muratec
-- Magnium - 5000 Plasma' / 'Plasma Punch - 100 Watts, 300kN Press Force',
-- so migration 594's join produced zero rows for them -- not wrong data,
-- just silently missing. This migration adds the correct rows using the
-- verified alias mapping (spelling/punctuation variants of the same real
-- machine, not different specs -- see the generator script's header for the
-- 4 OTHER Plasma Punch mismatches that were deliberately NOT aliased here
-- because they are genuinely different model numbers/specs, not typos).
--
-- Same clone-from-live-USA-row pattern as migrations 594/595. Dedup via
-- NOT EXISTS -- safe to re-run.
-- ============================================================================

BEGIN;

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
${valueRows.join(',\n')}
) AS v(location, name, direct, indirect, labor)
  ON lower(usa.machine_name) = lower(v.name)
WHERE usa.location = 'USA'
AND NOT EXISTS (
  SELECT 1 FROM mhr_records mr2
  WHERE lower(mr2.machine_name) = lower(usa.machine_name) AND mr2.location = v.location
);

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, location FROM mhr_records
--   WHERE machine_name IN ('Ermak COP 1270 X 30', 'Muratec Magnium - 5000 Plasma', 'Plasma Punch - 100 Watts, 300kN Press Force')
--   ORDER BY machine_name, location;
-- -- Each machine_name should now show USA + India + China + Mexico + France (5 rows) --
-- -- except 'Plasma Punch - 100 Watts, 300kN Press Force', which China already had via 594, so re-verify it doesn't duplicate (NOT EXISTS should have skipped it).
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, '--', rows.length, 'candidate rows (India/China/Mexico/France x up to 3 machines).');
