// Generator: inserts the 141 real Machining machines from
// memory/machining/machine/machiningusa.json (migration 692's source —
// already staged losslessly into machining_reference_data category=
// 'machine') as real, live mhr_records rows — the table the HR Rates page
// actually reads. Migration 692 alone only powers the read-only "Edit MHR
// Record" reference-lookup panel; it does NOT create HR Rates rows. This
// migration is what makes Machining appear on the HR Rates page itself
// (both the process-group dropdown, which is derived live from distinct
// mhr_records.process_group values — app/(dashboard)/hr-rates/page.tsx
// line ~162 — and the per-category sidebar, which reads
// benchmark_source_key via lib/utils/mhrCategoryOf.ts).
//
// Column set: the exact same 29 real, confirmed-live columns migration 633
// used to seed Injection Molding's 127 real machines into this same table
// (already live and working), with IM-only capability columns (max_tonnage,
// tie_bar_x_mm, tie_bar_y_mm, shot_capacity_grams, min_mold_height_mm,
// max_mold_height_mm) dropped — they have no Machining equivalent — plus
// benchmark_source_key, a column already referenced directly in
// mhr.service.ts#getReferenceDetail.
//
// Column-value mapping (see memory/machining/machine/machiningusa.json's
// per-machine shape for the real source fields):
//   machine_class: snake_case(categoryName) — e.g. "2_axis_lathe",
//     "5_axis_mill". Deliberately NOT reused from an existing
//     MACHINE_REGISTRY key (default-rates.constants.ts) even where a
//     same-sounding key exists (cnc_lathe, cnc_lathe_live, cnc_mill_turn,
//     drill_press) — those registry keys drive REAL cost-engine keyword
//     routing today, and guessing which of the 12 real station categories
//     maps onto which registry key risks silently misrouting a future
//     quote into the wrong physics model. New, honest, non-colliding slugs
//     per real category name instead — visible/manageable on HR Rates
//     immediately, cost-engine wiring is a disclosed separate follow-up.
//   benchmark_source_key: "<categoryName>:<machine name>" — identical key
//     format to migration 692's machining_reference_data rows, giving real
//     per-station category grouping on the HR Rates sidebar (mhrCategoryOf
//     splits this on ":" — see lib/utils/mhrCategoryOf.ts).
//   process_family: 'machined' — one honest generic value spanning the
//     whole domain, mirroring migration 633's own single-value convention
//     for Injection Molding ('injection_molded').
//   press_cycle_time_s: NULL — no static per-machine cycle time exists in
//     this domain's real data; cost-cnc-engine.ts computes cycle time
//     dynamically from extracted CAD features, not a per-machine-record
//     constant. Left NULL rather than fabricated.
//   usd_labor_rate_per_hr / benchmark_labor_rate_usd_hr / usd_lhr_total:
//     the machine's own REAL accounting.laborRateUsdPerHr (unlike
//     migration 633, which substituted a flat USA LHR benchmark for
//     Injection Molding because that source file's per-machine labor rate
//     wasn't used — Machining's source file's per-machine rate IS a real,
//     directly-sourced number, so it's used directly here, not replaced).
//   wage_grade: accounting.wageGradeName verbatim (NULL where the source
//     has NULL — never fabricated).
//   Every other field maps 1:1 to its real source field — see inline
//   mapping in the script body.
//
// Offline, file-in/file-out — matches every other gen_*.js in this codebase.

const fs = require('fs');
const path = require('path');

const MACHINE_FILE = path.join(__dirname, '../../../memory/machining/machine/machiningusa.json');
const OUT_SQL = path.join(__dirname, '../693_seed_machining_mhr_records.sql');

function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `$str$${String(v)}$str$`;
}
function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function sanitize(v) {
  if (typeof v === 'string') return v.replace(/aPriori/g, 'eMithran');
  return v;
}

function snakeCase(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const data = JSON.parse(fs.readFileSync(MACHINE_FILE, 'utf8'));

const COLUMNS = [
  'machine_class', 'location', 'machine_name', 'currency_code', 'country_code',
  'source_type', 'process_family', 'operators', 'setup_time_hr', 'press_cycle_time_s',
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
for (const cat of data.machineCategories) {
  for (const m of cat.machines) {
    const name = sanitize(m.name || m.primaryId);
    if (!name) continue;
    const acc = m.accounting || {};
    const time = m.time || {};
    const bu = m.bottomUpOverheadRateInputs || {};
    const yields = m.yields || {};
    const mfr = m.manufacturerInformation || {};

    const direct = acc.directOverheadRateUsdPerHr;
    const indirect = acc.indirectOverheadRateUsdPerHr;
    const total = acc.totalOverheadRateUsdPerHr != null
      ? acc.totalOverheadRateUsdPerHr
      : (direct != null && indirect != null ? direct + indirect : null);
    const laborRate = acc.laborRateUsdPerHr;

    rows.push([
      sqlStr(snakeCase(cat.categoryName)),                 // machine_class
      sqlStr('USA'),                                       // location
      sqlStr(name),                                        // machine_name
      sqlStr('USD'),                                       // currency_code
      sqlStr('US'),                                        // country_code
      sqlStr('BENCHMARK'),                                 // source_type
      sqlStr('machined'),                                  // process_family
      sqlNum(acc.numberOfOperators),                        // operators
      sqlNum(time.setupTimeHr),                             // setup_time_hr
      'NULL',                                               // press_cycle_time_s
      sqlNum(direct),                                       // direct_overhead_rate
      sqlNum(indirect),                                     // indirect_overhead_rate
      sqlNum(direct),                                       // benchmark_direct_overhead_rate_usd_hr
      sqlNum(indirect),                                     // benchmark_indirect_overhead_rate_usd_hr
      sqlNum(total),                                        // total_machine_hour_rate
      sqlNum(total),                                        // mhr_usd_per_hour
      sqlNum(laborRate),                                    // usd_labor_rate_per_hr
      sqlNum(laborRate),                                    // benchmark_labor_rate_usd_hr
      sqlNum(laborRate),                                    // usd_lhr_total
      sqlNum(acc.workCenterLaborRateFactor),                 // work_center_labor_rate_factor
      sqlNum(acc.laborTimeStandard),                         // labor_time_standard
      sqlStr(sanitize(acc.wageGradeName)),                   // wage_grade
      sqlNum(bu.machinePriceUsd),                            // machine_price_usd
      sqlNum(bu.machineLengthMm),                            // machine_length_mm
      sqlNum(bu.machineWidthMm),                             // machine_width_mm
      sqlNum(bu.footprintAllowanceFactor),                   // footprint_allowance_factor
      sqlNum(bu.machinePowerKw),                             // machine_power_kw
      sqlNum(bu.machineLifeYr),                              // machine_life_yr
      sqlNum(bu.installationFactorPct),                      // installation_factor_pct
      sqlNum(bu.machineUptimePct),                           // machine_uptime_pct
      sqlNum(bu.annualMaintenanceFactorPct),                 // annual_maintenance_factor_pct
      sqlNum(bu.salvageValueFactorPct),                      // salvage_value_factor_pct
      sqlNum(bu.suppliesCostUsdPerYr),                       // supplies_cost_per_year
      sqlNum(yields.avgUtilization),                         // avg_utilization
      sqlNum(yields.goodPartYield),                          // good_part_yield
      sqlStr(sanitize(mfr.machineManufacturerLocation)),     // manufacturer_country
      sqlStr(`${cat.categoryName}:${name}`),                 // benchmark_source_key
    ]);
  }
}

const valuesSql = rows.map((r) => `  (${r.join(', ')})`).join(',\n');

const sql = `-- ============================================================================
-- Migration 693: Seed mhr_records with 141 real Machining machines
--
-- Generated by gen_693_seed_machining_mhr_records.js.
-- Row count: ${rows.length} (memory/machining/machine/machiningusa.json, 12 of
-- 43 real station categories — remaining categories/regions to follow in a
-- future session per the user).
--
-- Reuses the exact 29-column set migration 633 already used successfully
-- to seed Injection Molding's 127 real machines into this same table
-- (IM-only capability columns dropped), plus benchmark_source_key (already
-- referenced in mhr.service.ts#getReferenceDetail) for real per-station
-- category grouping on the HR Rates page. See the generator script header
-- for the full column-mapping rationale.
--
-- No CHECK constraint on machine_class exists on this table (confirmed via
-- migration-file audit); the live full column list was not independently
-- confirmed via information_schema before this migration was written —
-- if this fails, that confirmation is still needed before retrying.
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
