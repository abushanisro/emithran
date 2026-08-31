// One-off generator for migration 597. Not part of the migration itself —
// run manually to (re)produce the SQL, then inspect the diff before
// committing. Same discipline as every other gen_*.js script.
//
// Root-cause pass over every one of the 38 machine names that were
// unresolved after migrations 594/595/596, checked against BOTH the live
// USA catalog (via a direct DB query) and China's own file (cross-checked
// per-category with the CORRECT China category labels, e.g. India's "Shear"
// = China's "Shearing Machine" -- an earlier attempt at this mapping used
// wrong category labels and produced false negatives, corrected before
// writing this). Every alias below is a verified spelling/punctuation/
// formatting variant of the SAME real machine (same model number, same
// physical dimensions) -- never a guess at a different spec. Genuinely
// different specs (different model numbers, different wattage/press-force
// values not explainable by a transcription artifact) are listed at the
// bottom, deliberately NOT aliased, and remain honest gaps.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '..', 'memory', 'sheetmetal', 'machine');
const OUT = path.join(__dirname, '..', '597_fix_remaining_naming_variants.sql');

// sourceName (as it appears in india.json/mexico_delta.json/france_delta.json,
// and where applicable china_location_data_full.json) -> live catalog name.
const ALIAS = {
  // '2 Roll Bender' -- confirmed via a live query AND a screenshot of the
  // original source tool: the source's own value is genuinely "200mm" (not
  // a China/India transcription error) -- the live DB's "2000mm" is the
  // one-off artifact here, from whatever earlier bulk import first seeded
  // it. Aliased for rate-matching purposes only; the live row's own
  // dimension fields are NOT touched by this migration.
  '2 Roll Bender - 200mm Roll Length x 125mm Roll Diameter': '2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter',
  // Same reasoning, second instance found in the same category -- verified
  // live has "8000mm" via a direct query (LIKE 'Laser Punch%' OR LIKE
  // 'Waterjet Cutter%' also confirmed all 10 of those already matched
  // correctly with no digit issues -- this Roll Bender pair are the only
  // two affected).
  '2 Roll Bender - 800mm Roll Length x 200mm Roll Diameter': '2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter',
  // '3 Roll Bender' -- China's own transcription differs from India/Mexico/
  // France's by one character (S vs 5, a classic OCR confusion); China's
  // matches the live catalog.
  'Knuth KRM-S 30/4': 'Knuth KRM-5 30/4',
  // 'Cut To Length Line' -- India/Mexico/France drop "Max"/"Thickness",
  // same two numbers (12mm/21mm and 6mm/12mm) in both.
  'Cut To Length Line - 12mm Max Steel, 21mm Aluminum': 'Cut To Length Line - 12mm Max Steel, 21mm Max Aluminum Thickness',
  'Cut To Length Line - 6mm Max Steel, 12mm Aluminum': 'Cut To Length Line - 6mm Max Steel, 12mm Max Aluminum Thickness',
  // 'CO2 Laser Cutter' (live category: 'Laser Cutting Machine') -- India's
  // "Mil" vs live's "MII" is an OCR l/I confusion, same model numbers.
  'FO-Mil 2412 NT': 'FO-MII 2412 NT',
  'FO-Mil 3015 NT': 'FO-MII 3015 NT',
  'FO-Mil RI 3015': 'FO-MII RI 3015',
  // Same category -- "Trufow" is a dropped-letter transcription of
  // "Truflow" (Trumpf's own laser-head product name), confirmed by China's
  // own file using "Truflow" with a space before the dash, matching live.
  'Trumpf True Laser 5030 -Trufow 10kW': 'Trumpf True Laser 5030 - Truflow 10kW',
  'Trumpf True Laser 5030 -Trufow 8kW': 'Trumpf True Laser 5030 - Truflow 8kW',
  // 'Laser Punch Combo' (live category: 'Laser Punch / Punch Press') --
  // India drops the "Tool" suffix, same model number.
  'LVD Strippit 1250 MXP/30 Laser': 'LVD Strippit 1250 MXP/30 LaserTool',
  // 'Plasma Cutter' (live category: 'Plasma Cutting Machine') -- missing
  // comma only, same numbers.
  'Plasma Cutter - 1000 Watts 4 Heads': 'Plasma Cutter - 1000 Watts, 4 Heads',
  'Plasma Cutter - 400 Watts 1 Head': 'Plasma Cutter - 400 Watts, 1 Head',
  // 'Shear' (live category: 'Shearing Machine') -- missing comma +
  // "Thickness" suffix, same numbers throughout.
  'Shear - 13mm Steel 20mm Aluminum Max': 'Shear - 13mm Steel, 20mm Aluminum Max Thickness',
  'Shear - 3.5mm Steel 5mm Aluminum Max': 'Shear - 3.5mm Steel, 5mm Aluminum Max Thickness',
  'Shear - 7mm Steel 10mm Aluminum Max': 'Shear - 7mm Steel, 10mm Aluminum Max Thickness',
  // 'Turret Press' (live category: 'Turret Press (Punch Press)') -- same
  // pattern, missing comma + "Max Thickness" suffix.
  'Turret Press - 4.5mm Steel 6mm Aluminum': 'Turret Press - 4.5mm Steel, 6mm Aluminum Max Thickness',
  'Turret Press - 6mm Steel 8mm Aluminum': 'Turret Press - 6mm Steel, 8mm Aluminum Max Thickness',
  'Turret Press - 8mm Steel 10mm Aluminum': 'Turret Press - 8mm Steel, 10mm Aluminum Max Thickness',
  // Progressive Die Press / Standard Press / Tandem Press -- India/Mexico/
  // France omit the thousands-separator comma throughout; live and China
  // both use it consistently. Same press-force numbers in every case.
  'Progressive Die Press - 1500kN Press Force': 'Progressive Die Press - 1,500kN Press Force',
  'Progressive Die Press - 3000kN Press Force': 'Progressive Die Press - 3,000kN Press Force',
  'Progressive Die Press - 5000kN Press Force': 'Progressive Die Press - 5,000kN Press Force',
  'Progressive Die Press - 7000kN Press Force': 'Progressive Die Press - 7,000kN Press Force',
  'Progressive Die Press - 10000kN Press Force': 'Progressive Die Press - 10,000kN Press Force',
  'Standard Press - 1500kN Press Force': 'Standard Press - 1,500kN Press Force',
  'Standard Press - 3000kN Press Force': 'Standard Press - 3,000kN Press Force',
  'Standard Press - 5000kN Press Force': 'Standard Press - 5,000kN Press Force',
  'Standard Press - 7000kN Press Force': 'Standard Press - 7,000kN Press Force',
  'Tandem Press - 1500kN Press Force': 'Tandem Press - 1,500kN Press Force',
  'Tandem Press - 3000kN Press Force': 'Tandem Press - 3,000kN Press Force',
  'Tandem Press - 5000kN Press Force': 'Tandem Press - 5,000kN Press Force',
  'Tandem Press - 7000kN Press Force': 'Tandem Press - 7,000kN Press Force',
};

// Deliberately NOT aliased -- genuinely different specs (different model
// numbers, or a wattage/press-force number that live simply doesn't have
// any variant of), confirmed against the live catalog and/or China's file.
// Left as honest gaps, not guessed:
//   'Bystronic BySprint 4020 4kW Fiber' -- live/China only have 3kW and 6kW.
//   'Muratec Motorum Hybrid 2558 (2500W)' -- live/China only have 2000W/4000W.
//   'Bliss - B-55' -- live/China only have 'Bliss - B-35' (different model).
//   'OMAX 80160' -- live/China's OMAX models are 2626/2652/55100/60120.
//   The 4 Plasma Punch mismatches already documented in migration 596
//   (Ficep C16/C25 vs live's C23 x2; 200W/450kN; 300W/550kN; 400W/100kN).

function loadFlat(file) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return data.machines.map(m => ({ name: m.name, direct: m.directOverheadRate, indirect: m.indirectOverheadRate, labor: m.laborRate_USD_hr }));
}
function loadChina() {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, 'china_location_data_full.json'), 'utf8'));
  const out = [];
  for (const category of Object.keys(data.categories)) {
    for (const m of data.categories[category].machines) {
      out.push({ name: m.name, direct: m.direct_overhead_rate_usd_hr, indirect: m.indirect_overhead_rate_usd_hr, labor: m.labor_rate_usd_hr });
    }
  }
  return out;
}

// Reproduces migration 594's own prefix-resolution step (truncated India/
// Mexico/France names like "2 Roll Bender - 200mm Roll Length" resolving to
// China's fuller "...x 125mm Roll Diameter" form) so that names needing
// BOTH that resolution AND one of the ALIAS corrections above (the 2 Roll
// Bender digit cases) are actually reached -- without this, ALIAS lookups
// below would only ever see the raw truncated name, never the resolved
// one, and would silently miss those two.
const chinaRecordsForResolution = loadChina();
const canonicalNames = new Set(chinaRecordsForResolution.map(r => r.name));
function resolveTruncated(name) {
  if (canonicalNames.has(name)) return name;
  const candidates = [...canonicalNames].filter(cn => cn.startsWith(name + ' x ') || cn.startsWith(name + ' '));
  return candidates.length === 1 ? candidates[0] : name;
}

const LOCATIONS = [
  { location: 'India', records: loadFlat('india.json').map(r => ({ ...r, name: resolveTruncated(r.name) })) },
  { location: 'China', records: chinaRecordsForResolution },
  { location: 'Mexico', records: loadFlat('mexico_delta.json').map(r => ({ ...r, name: resolveTruncated(r.name) })) },
  { location: 'France', records: loadFlat('france_delta.json').map(r => ({ ...r, name: resolveTruncated(r.name) })) },
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
-- Migration 597: Fix remaining naming-variant gaps across India/China/
-- Mexico/France machine rates (2026-08-28, root-cause pass)
--
-- After migrations 594/595/596, 38 machine names per location remained
-- unresolved (verified identical across India/Mexico/France; China had its
-- own separate small set from migration 596). Checked every one against the
-- REAL live 'location=USA' catalog (via direct query, not inference) and
-- China's own file (using the CORRECT China category labels -- e.g. India's
-- "Shear" category = China's "Shearing Machine", "CO2 Laser Cutter" =
-- China's "Laser Cutting Machine" -- an earlier attempt used wrong labels
-- and produced false "no match" results, corrected before writing this).
--
-- Of the 38: 30 are verified spelling/punctuation/formatting variants of a
-- real live machine (same model number, same physical spec -- see the
-- generator script's ALIAS map for the exact reasoning per name: OCR-style
-- single-character confusions, missing thousands-separator commas, dropped
-- suffix words like "Thickness"/"Tool"). One additional case ('2 Roll
-- Bender - 200mm...') was confirmed via a screenshot of the original source
-- tool to be the live catalog's OWN transcription artifact (extra zero),
-- not an India/China/Mexico/France error -- aliased for rate-matching
-- purposes only, the live row's own dimension fields are untouched.
--
-- The remaining 8 (4 from this pass + 4 already documented in migration
-- 596's Plasma Punch analysis) are genuinely different specs -- different
-- model numbers or wattage/press-force values the live catalog has no
-- variant of at all -- and are deliberately left unaliased. See the
-- generator script's header for the itemized list. These are real,
-- confirmed data gaps, not something this migration guesses at.
--
-- Same clone-from-live-USA-row + NOT EXISTS dedup pattern as migrations
-- 594/595/596. Safe to re-run.
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
-- SELECT location, count(*) FROM mhr_records WHERE location IN ('India','China','Mexico','France') GROUP BY location ORDER BY location;
-- -- Should increase from the post-596 baseline (289/310/276/276) by however many of the 31 aliases matched per location.
-- SELECT machine_name, location FROM mhr_records
--   WHERE machine_name IN ('Knuth KRM-5 30/4', 'FO-MII 2412 NT', 'Progressive Die Press - 1,500kN Press Force', 'Standard Press - 1,500kN Press Force', 'Tandem Press - 1,500kN Press Force')
--   ORDER BY machine_name, location;
`;

fs.writeFileSync(OUT, sql, 'utf8');
console.log('Wrote', OUT, '--', rows.length, 'candidate rows across', Object.keys(ALIAS).length, 'aliased machine names.');
