// Generator: stages real per-machine Digital Factory data for all 4
// Injection Molding domain machine classes (injection_molding,
// compression_molding, structural_foam_molding, reaction_injection_molding)
// into mhr_records, and replaces the 3 confirmed-fabricated legacy
// "injection_molding" placeholder rows (mhr_source: 'legacy_import',
// generic "Injection Molding 100T/200T/500T" names, every capability field
// null, round-number rates) with the real 81-machine dataset.
//
// Source: memory/Injection/machine/{injection,compression,structural_foam,
// reaction_injection}_molding_machines.json — real per-machine records
// (labor rate, direct/indirect overhead rate, kinematics, capability
// limits, bottom-up cost inputs). File-level self-label is
// "sector": "World Average" (not region-specific); staged as location
// 'USA' per explicit user decision (2026-09-02) — USD-denominated data,
// no "World Average" location option exists on this platform.
//
// Offline, file-in/file-out — no live DB credentials, matches every other
// gen_*.js script in this codebase. Produces one seed SQL file for the user
// to run in the Supabase SQL editor.
//
// Column mapping (every value real, sourced from the JSON — nothing
// fabricated):
//   machine_name              <- name (== primaryId in every sample)
//   location                  <- 'USA' (see header)
//   currency_code/country_code<- 'USD' / 'US'
//   source_type                = 'BENCHMARK' (matches this platform's own
//                                 existing convention for reference/
//                                 non-customer-specific machine data)
//   process_family             = 'injection_molded' (existing real value
//                                 already used elsewhere in this codebase)
//   operators                 <- accounting.numberOfOperators
//   setup_time_hr              <- time.setupTimeHr
//   press_cycle_time_s         <- time.dryCycleTimeS directly for
//                                 injection/structural-foam/RIM (a real
//                                 measured dry-cycle). Compression molding
//                                 has no dryCycleTimeS field at all (it
//                                 doesn't inject a shot) — derived instead
//                                 from real kinematics already used by
//                                 cost-compression-molding-engine.ts's own
//                                 header comment: openingStrokeMm /
//                                 compressionTravelRateMmPerS (controlled
//                                 close) + openingStrokeMm /
//                                 rapidTravelRateMmPerS (fast open). A real
//                                 physics identity (distance / rate = time),
//                                 not an invented formula.
//   direct_overhead_rate,
//   benchmark_direct_overhead_rate_usd_hr    <- accounting.directOverheadRateUsdPerHr
//   indirect_overhead_rate,
//   benchmark_indirect_overhead_rate_usd_hr  <- accounting.indirectOverheadRateUsdPerHr
//   total_machine_hour_rate,
//   mhr_usd_per_hour            = direct + indirect overhead rate (the real
//                                 machine's own bottom-up ownership cost;
//                                 this platform keeps machine rate and labor
//                                 rate as separate columns/lines, matching
//                                 MHRRateInput.rate vs .labourRate — direct
//                                 sum of two real provided fields, not a
//                                 new formula)
//   usd_labor_rate_per_hr,
//   benchmark_labor_rate_usd_hr,
//   usd_lhr_total               <- accounting.laborRateUsdPerHr
//   work_center_labor_rate_factor <- accounting.workCenterLaborRateFactor
//   labor_time_standard         <- accounting.laborTimeStandard
//   wage_grade                  <- accounting.wageGradeName (null in every
//                                 real sample — kept null, not fabricated)
//   machine_price_usd           <- machine.machinePriceUsd
//   machine_length_mm/width_mm  <- machine.machineLengthMm/machineWidthMm
//   footprint_allowance_factor  <- machine.footprintAllowanceFactor
//   machine_power_kw            <- bottomUpOverheadRateInputs.machinePowerKw
//   machine_life_yr             <- bottomUpOverheadRateInputs.machineLifeYr
//   installation_factor_pct     <- bottomUpOverheadRateInputs.installationFactorPct
//   machine_uptime_pct          <- bottomUpOverheadRateInputs.machineUptimePct
//   annual_maintenance_factor_pct <- bottomUpOverheadRateInputs.annualMaintenanceFactorPct
//   salvage_value_factor_pct    <- bottomUpOverheadRateInputs.salvageValueFactorPct
//   supplies_cost_per_year      <- bottomUpOverheadRateInputs.suppliesCostUsdPerYr
//   avg_utilization             <- yields.avgUtilization
//   good_part_yield             <- yields.goodPartYield
//   manufacturer_country        <- manufacturerInformation.machineManufacturerLocation
//                                 (the machine's own real country of
//                                 manufacture — Germany/China/Italy/USA/
//                                 Virtual — a genuinely different real fact
//                                 from the 'USA' pricing-region `location`
//                                 tag above; both are kept, not conflated)
//   max_tonnage                 <- limits.clampingForceKn or limits.pressForceKn
//                                 (whichever the class has), converted
//                                 kN -> metric tons via / 9.80665 (real
//                                 physical unit conversion: 1 tonne-force
//                                 = 9.80665 kN)
//   tie_bar_x_mm/y_mm           <- limits.tieBarDistanceHorMm/VertMm (when present)
//   shot_capacity_grams         <- limits.shotSizeGppsG or limits.shotSizeG
//                                 (whichever the class has; compression
//                                 molding has neither — stays null, it
//                                 doesn't shoot a charge)
//   min_mold_height_mm/max_mold_height_mm <- limits.minMoldHeightMm/maxMoldHeightMm
//
// Deliberately left NULL, not fabricated: manufacturer, machine_description,
// industry, data_version, wage_grade (when absent), commodity_code,
// handling_time_const_s / handling_time_mass_coeff_s_per_kg (a Sheet-Metal-
// specific concept with no equivalent field in this real source data).

const fs = require('fs');
const path = require('path');

const MACHINE_DIR = path.join(__dirname, '../../../memory/Injection/machine');
const OUT_SQL = path.join(__dirname, '../633_stage_injection_molding_machines.sql');

const FILES = [
  { file: 'injection_molding_machines.json', machineClass: 'injection_molding' },
  { file: 'compression_molding_machines.json', machineClass: 'compression_molding' },
  { file: 'structural_foam_molding_machines.json', machineClass: 'structural_foam_molding' },
  { file: 'reaction_injection_molding_machines.json', machineClass: 'reaction_injection_molding' },
];

const KN_PER_TONNE = 9.80665;

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return 'NULL';
  return String(v);
}

function pressCycleTimeS(m, machineClass) {
  if (machineClass === 'compression_molding') {
    const stroke = m.limits?.openingStrokeMm;
    const compRate = m.limits?.compressionTravelRateMmPerS;
    const rapidRate = m.limits?.rapidTravelRateMmPerS;
    if (stroke == null || compRate == null || rapidRate == null || compRate <= 0 || rapidRate <= 0) return null;
    return Math.round(((stroke / compRate) + (stroke / rapidRate)) * 100) / 100;
  }
  return m.time?.dryCycleTimeS ?? null;
}

function maxTonnage(m) {
  const kn = m.limits?.clampingForceKn ?? m.limits?.pressForceKn ?? null;
  if (kn == null) return null;
  return Math.round((kn / KN_PER_TONNE) * 100) / 100;
}

function shotCapacityGrams(m) {
  return m.limits?.shotSizeGppsG ?? m.limits?.shotSizeG ?? null;
}

const rows = [];
const unmatchedNotes = [];

for (const { file, machineClass } of FILES) {
  const data = JSON.parse(fs.readFileSync(path.join(MACHINE_DIR, file), 'utf8'));
  const machines = data.machines || [];
  for (const m of machines) {
    const name = m.name || m.primaryId;
    if (!name) { unmatchedNotes.push(`${file}: machine with no name/primaryId, skipped`); continue; }

    const directOh = m.accounting?.directOverheadRateUsdPerHr ?? null;
    const indirectOh = m.accounting?.indirectOverheadRateUsdPerHr ?? null;
    const mhrRate = (directOh != null && indirectOh != null) ? Math.round((directOh + indirectOh) * 100) / 100 : null;
    if (mhrRate == null) unmatchedNotes.push(`${file}: "${name}" missing direct/indirect overhead rate — total_machine_hour_rate left NULL, not fabricated`);

    rows.push({
      machine_class: machineClass,
      location: 'USA',
      machine_name: name,
      currency_code: 'USD',
      country_code: 'US',
      source_type: 'BENCHMARK',
      process_family: 'injection_molded',
      operators: m.accounting?.numberOfOperators ?? null,
      setup_time_hr: m.time?.setupTimeHr ?? null,
      press_cycle_time_s: pressCycleTimeS(m, machineClass),
      direct_overhead_rate: directOh,
      indirect_overhead_rate: indirectOh,
      benchmark_direct_overhead_rate_usd_hr: directOh,
      benchmark_indirect_overhead_rate_usd_hr: indirectOh,
      total_machine_hour_rate: mhrRate,
      mhr_usd_per_hour: mhrRate,
      usd_labor_rate_per_hr: m.accounting?.laborRateUsdPerHr ?? null,
      benchmark_labor_rate_usd_hr: m.accounting?.laborRateUsdPerHr ?? null,
      usd_lhr_total: m.accounting?.laborRateUsdPerHr ?? null,
      work_center_labor_rate_factor: m.accounting?.workCenterLaborRateFactor ?? null,
      labor_time_standard: m.accounting?.laborTimeStandard ?? null,
      wage_grade: m.accounting?.wageGradeName ?? null,
      machine_price_usd: m.machine?.machinePriceUsd ?? null,
      machine_length_mm: m.machine?.machineLengthMm ?? null,
      machine_width_mm: m.machine?.machineWidthMm ?? null,
      footprint_allowance_factor: m.machine?.footprintAllowanceFactor ?? null,
      machine_power_kw: m.bottomUpOverheadRateInputs?.machinePowerKw ?? null,
      machine_life_yr: m.bottomUpOverheadRateInputs?.machineLifeYr ?? null,
      installation_factor_pct: m.bottomUpOverheadRateInputs?.installationFactorPct ?? null,
      machine_uptime_pct: m.bottomUpOverheadRateInputs?.machineUptimePct ?? null,
      annual_maintenance_factor_pct: m.bottomUpOverheadRateInputs?.annualMaintenanceFactorPct ?? null,
      salvage_value_factor_pct: m.bottomUpOverheadRateInputs?.salvageValueFactorPct ?? null,
      supplies_cost_per_year: m.bottomUpOverheadRateInputs?.suppliesCostUsdPerYr ?? null,
      avg_utilization: m.yields?.avgUtilization ?? null,
      good_part_yield: m.yields?.goodPartYield ?? null,
      manufacturer_country: m.manufacturerInformation?.machineManufacturerLocation ?? null,
      max_tonnage: maxTonnage(m),
      tie_bar_x_mm: m.limits?.tieBarDistanceHorMm ?? null,
      tie_bar_y_mm: m.limits?.tieBarDistanceVertMm ?? null,
      shot_capacity_grams: shotCapacityGrams(m),
      min_mold_height_mm: m.limits?.minMoldHeightMm ?? null,
      max_mold_height_mm: m.limits?.maxMoldHeightMm ?? null,
    });
  }
}

const columns = Object.keys(rows[0]);
const valuesSql = rows.map((r) => {
  const vals = columns.map((c) => {
    const v = r[c];
    if (typeof v === 'string') return sqlStr(v);
    return sqlNum(v);
  });
  return `  (${vals.join(', ')})`;
}).join(',\n');

const sql = `-- ============================================================================
-- Migration 633: Stage real Injection Molding domain machine data
--
-- Generated by gen_633_stage_injection_molding_machines.js from
-- memory/Injection/machine/*.json (${rows.length} real machines total:
-- ${FILES.map(f => f.machineClass).join(', ')}).
--
-- Also removes the 3 confirmed-fabricated legacy "injection_molding"
-- placeholder rows (mhr_source = 'legacy_import', generic "Injection
-- Molding 100T/200T/500T" names, every capability field NULL, round-number
-- rates -- not real per-machine data) that were the only injection_molding
-- rows staged before this migration.
-- ============================================================================

DELETE FROM mhr_records WHERE machine_class = 'injection_molding' AND mhr_source = 'legacy_import';

INSERT INTO mhr_records (
  ${columns.join(', ')}
) VALUES
${valuesSql};

NOTIFY pgrst, 'reload schema';
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${rows.length} real machine rows to ${OUT_SQL}`);
if (unmatchedNotes.length) {
  console.log(`\n${unmatchedNotes.length} note(s):`);
  unmatchedNotes.forEach((n) => console.log('  - ' + n));
}
