// Heat treatment, costed only from memory/Heat treatment (migration 823:
// variables and lookups under source_version 2026-HeatTreat; 826: machines,
// class heat_treat_<process>, each machine row naming its own process) and the
// part's own facts (material cut code and type, mass, size, batch).
//
// Models, all from the reference data:
//   priced by weight   Unit Weight Cost x batch weight, or Min Batch Cost below
//                      Min Batch Weight, per part; plus the handling time for
//                      the part's weight (tblHandlingTimes) at the row's own
//                      labour and overhead.
//   Carburize /        the same, only for a carburizable cut code
//   Carbonitride       (tblCarburizableMaterialCutCodes), x the case-depth
//                      multiplier for the drawing's case depth (tblCaseDepthMultiplier).
//   Certification      Certification Cost once per batch.
//   Straighten         parts per hour for the part's weight class
//                      (small/medium/large rates and weight limits).
//   Age                oven loads (parts + agingPartNestingAllowance in the oven's
//                      internal size) x the material's aging time.
//   Hot Isostatic      heat-up + hold + cool-down (material rates and hold, else
//   Pressing           the reference averages) + pressurizing + vacuum purge per
//                      load; parts per load within the hot-zone solid-volume limit;
//                      programming once per batch; argon for the free hot-zone
//                      volume at hold pressure, less the reused share.
// The time and price formulas are database calculators (migration 907, heat/calculators/
// heat-treatment-calculators.json): the engine seeds each input with its source and runs the
// stored formulas, it holds none. A process with no machine in the reference, no calculator, or
// a missing input is a 'gap'.

import {
  costed, notCosted, pickMachine, variable, num, sorted, maxPartsInBox,
  type SecondaryCalculatorRun, type SecondaryMachine, type SecondaryPartFacts, type SecondaryProcessResult, type SecondaryReference, type SecondaryTraceStep,
} from '../secondary/secondary-process-engine';
import { runReferenceCalculator, type ReferenceCalcRun, type CalcSeed, type ReferenceCalculators } from '../shared/calculators/reference-calculator';

export const HEAT_TREATMENT_SOURCE_VERSION = '2026-HeatTreat';
const SRC_VAR = 'memory/Heat treatment/heat_treatment_variables.csv';
const SRC_LOOKUP = (t: string) => `memory/Heat treatment/Lookup/${t}.csv`;
const classOf = (p: string) => 'heat_treat_' + p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export const HEAT_TREATMENT_PROCESSES: ReadonlyArray<{ process: string; machineClass: string }> = [
  'Additional Temper', 'Age', 'Atmosphere Oil Harden', 'Carbonitride', 'Carburize', 'Certification',
  'Cryogenic Freeze', 'High Speed Steel Harden', 'High Temp Vacuum Anneal', 'Hot Isostatic Pressing',
  'Induction Harden', 'Low Temp Vacuum Anneal', 'Solution', 'Spring Steel Harden', 'Stainless Steel Harden',
  'Standard Anneal', 'Standard Temper', 'Straighten', 'Stress Relief', 'Vacuum Air Harden',
  'Vacuum Air Harden with High Temper', 'Vacuum Temper',
].map((process) => ({ process, machineClass: classOf(process) }));

type Base = { process: string; machineClass: string };

export interface HeatTreatmentFacts extends SecondaryPartFacts {
  /** Case depth (mm) read from the drawing's heat-treatment callout, when stated. */
  caseDepthMm?: number | null;
  /** Part volume (mm3), for hot-zone loading. */
  volumeMm3?: number | null;
}

const seed = (value: number, source: string): CalcSeed => ({ value, source });

/** The calculator's inputs and formulas as trace steps, each input with the source the engine gave it. */
function calcTrace(run: ReferenceCalcRun): SecondaryTraceStep[] {
  return run.trace.map((s) => ({
    label: s.displayLabel,
    value: s.value ?? '—',
    ...(s.unit ? { unit: s.unit } : {}),
    source: s.kind === 'calculated' ? `calculator formula ${s.formula ?? ''}`.trim() : s.source ?? 'calculator input',
  }));
}

function calcRecord(run: ReferenceCalcRun, name: string, seeds: Record<string, CalcSeed>): SecondaryCalculatorRun {
  const inputs: Record<string, number> = {};
  const provenance: Record<string, string> = {};
  for (const s of run.trace) {
    if (s.kind !== 'input' || typeof s.value !== 'number') continue;
    inputs[s.fieldName] = s.value;
    provenance[s.fieldName] = seeds[s.fieldName]?.source ?? s.source ?? '';
  }
  return { calculatorId: run.calculatorId!, name, version: run.calculatorVersion ?? 1, inputs, provenance };
}

/** Runs the process's calculator; a missing calculator or input is a gap naming it. */
function runCalc(
  base: Base, calculators: ReferenceCalculators | null | undefined, seeds: Record<string, CalcSeed>,
): { run: ReferenceCalcRun; record: SecondaryCalculatorRun } | { gap: SecondaryProcessResult } {
  const run = runReferenceCalculator(calculators, base.process, seeds);
  if (run.missing.length > 0 || run.sec == null) {
    return { gap: notCosted(base, 'gap', run.calculatorId == null
      ? `The ${base.process} calculator is not in the database: run migration 907.`
      : `${run.missing.join('; ')}`, { trace: calcTrace(run) }) };
  }
  return { run, record: calcRecord(run, calculators![base.process]!.name, seeds) };
}

function handlingSeconds(ref: SecondaryReference, kg: number): { sec: number; source: string } | null {
  const table = ref.lookups.get('tblHandlingTimes');
  if (!table) return null;
  const row = table
    .map((r) => ({ eq: String(r['Equipment']), s: num(r['Handling Time (s)']), kg: num(r['Max Weight (kg)']) }))
    .filter((r): r is { eq: string; s: number; kg: number } => r.s != null && r.kg != null)
    .sort((a, b) => a.kg - b.kg || a.s - b.s)
    .find((r) => kg <= r.kg);
  return row ? { sec: row.s, source: `${SRC_LOOKUP('tblHandlingTimes')} (${row.eq}, ≤ ${row.kg} kg)` } : null;
}

function byWeight(
  base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined,
  multiplier?: { value: number; label: string },
): SecondaryProcessResult {
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed (priced per kg): choose a material first.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed for the minimum batch charge.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['unit_weight_cost_usd_per_kg']) != null), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} service in the reference data for this location.`);
  const hs = handlingSeconds(ref, part.weightKg);
  if (hs == null) return notCosted(base, 'gap', 'tblHandlingTimes is not staged or covers no row for this weight.');
  const minCost = num(m.specs['min_batch_cost_usd']);
  const minKg = num(m.specs['min_batch_weight_kg']);
  // A service states a minimum batch as a cost and a weight together; without both there is no minimum.
  const hasMin = minCost != null && minKg != null;
  const svc = `service ${m.name}`;
  const seeds: Record<string, CalcSeed> = {
    'Part Weight': seed(part.weightKg, 'part weight from the material'),
    'Batch Size': seed(part.batchSize, 'batch size'),
    'Unit Weight Cost': seed(num(m.specs['unit_weight_cost_usd_per_kg'])!, svc),
    'Min Batch Cost': seed(hasMin ? minCost : 0, hasMin ? svc : `${svc} states no minimum batch`),
    'Min Batch Weight': seed(hasMin ? minKg : 0, hasMin ? svc : `${svc} states no minimum batch`),
    'Case Depth Multiplier': seed(multiplier?.value ?? 1, multiplier?.label ?? 'this process has no case-depth multiplier'),
    'Handling Time': seed(hs.sec, hs.source),
  };
  const r = runCalc(base, calculators, seeds);
  if ('gap' in r) return r.gap;
  // Handling runs on the row's own crew/overhead; the treatment itself is the
  // priced service, added as per-part material.
  const out = costed(base, m, {
    perPartSec: r.run.sec!, materialUsdPerPart: r.run.outputs['Service Cost per Part'] ?? 0,
    trace: calcTrace(r.run), highlight: 'whole_part', calculator: r.record,
  }, ref, part.batchSize);
  return { ...out, reason: 'Priced by weight from the reference service, plus handling at its labour and overhead.' };
}

function carburize(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined): SecondaryProcessResult {
  const codes = ref.lookups.get('tblCarburizableMaterialCutCodes');
  const depths = ref.lookups.get('tblCaseDepthMultiplier');
  if (!codes || !depths) return notCosted(base, 'gap', 'Carburizing lookups are not staged: run migration 823.');
  if (part.materialCutCode == null) return notCosted(base, 'gap', 'The material cut code is needed to check it can be carburized.');
  const allowed = codes.map((r) => num(r['Material Cut Code'])).filter((v): v is number => v != null);
  if (!allowed.some((c) => Math.abs(c - part.materialCutCode!) < 1e-9)) {
    return notCosted(base, 'not_applicable', `Cut code ${part.materialCutCode} is not carburizable (${SRC_LOOKUP('tblCarburizableMaterialCutCodes')}: ${allowed.join(', ')}).`);
  }
  if (part.caseDepthMm == null) return notCosted(base, 'gap', 'The case depth is needed (tblCaseDepthMultiplier): the drawing heat-treatment callout states none.');
  const row = depths
    .map((r) => ({ d: num(r['Depth']), mult: num(r['Multiplier']) }))
    .filter((r): r is { d: number; mult: number } => r.d != null && r.mult != null)
    .sort((a, b) => a.d - b.d)
    .find((r) => part.caseDepthMm! <= r.d);
  if (!row) return notCosted(base, 'gap', `Case depth ${part.caseDepthMm} mm is deeper than ${SRC_LOOKUP('tblCaseDepthMultiplier')} covers.`);
  return byWeight(base, part, ref, pool, calculators, { value: row.mult, label: `${SRC_LOOKUP('tblCaseDepthMultiplier')} (case depth ${part.caseDepthMm} mm ≤ ${row.d} mm)` });
}

function certification(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined): SecondaryProcessResult {
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed (certification is charged once per batch).');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['certification_cost_usd']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No certification service in the reference data for this location.');
  const seeds = {
    'Certification Cost': seed(num(m.specs['certification_cost_usd'])!, `service ${m.name}`),
    'Batch Size': seed(part.batchSize, 'batch size'),
  };
  const r = runCalc(base, calculators, seeds);
  if ('gap' in r) return r.gap;
  const out = costed(base, m, {
    perPartSec: r.run.sec!, materialUsdPerPart: r.run.outputs['Service Cost per Part'] ?? 0,
    trace: calcTrace(r.run), highlight: 'whole_part', calculator: r.record,
  }, ref, part.batchSize);
  return { ...out, reason: 'Priced by weight from the reference service, plus handling at its labour and overhead.' };
}

function straighten(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined): SecondaryProcessResult {
  const small = variable(ref, 'smallPartsWeightLimit'), medium = variable(ref, 'mediumPartsWeightLimit');
  const rs = variable(ref, 'smallPartsStraighteningRatePerHr'), rm = variable(ref, 'mediumPartsStraighteningRatePerHr'), rl = variable(ref, 'largePartsStraighteningRatePerHr');
  if ([small, medium, rs, rm, rl].some((v) => v == null)) return notCosted(base, 'gap', 'Straightening variables are not staged: run migration 823.');
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed to pick the straightening rate: choose a material first.');
  const [cls, rate] = part.weightKg <= small! ? ['small', rs!] : part.weightKg <= medium! ? ['medium', rm!] : ['large', rl!];
  const m = pickMachine(base.process, pool, ref);
  if (!m) return notCosted(base, 'gap', 'No straightening station in the reference data for this location.');
  const seeds = { 'Straightening Rate': seed(rate, `${SRC_VAR} (${cls}PartsStraighteningRatePerHr; small ≤ ${small} kg, medium ≤ ${medium} kg)`) };
  const r = runCalc(base, calculators, seeds);
  if ('gap' in r) return r.gap;
  return costed(base, m, { perPartSec: r.run.sec!, trace: calcTrace(r.run), highlight: 'whole_part', calculator: r.record }, ref, part.batchSize);
}

function age(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined): SecondaryProcessResult {
  const allowance = variable(ref, 'agingPartNestingAllowance');
  const table = ref.lookups.get('tblMaterialAgingTime');
  if (allowance == null || !table) return notCosted(base, 'gap', 'Aging reference data is not staged: run migration 823.');
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed to load the oven.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed to count oven loads.');
  if (!part.materialTypeName) return notCosted(base, 'gap', 'The material type is needed for its aging time (tblMaterialAgingTime).');
  const row = table.find((r) => r['Material Type'] === part.materialTypeName);
  const hours = row ? num(row['Aging Time (hr)']) : null;
  if (hours == null) return notCosted(base, 'gap', `No aging time for material type "${part.materialTypeName}" in ${SRC_LOOKUP('tblMaterialAgingTime')}.`);
  const dims = sorted(part.bboxMm).map((d) => d + allowance) as [number, number, number];
  const fitted = pool.map((m) => ({ m, n: m.maxXmm && m.maxYmm && m.maxZmm ? maxPartsInBox(dims, [m.maxXmm, m.maxYmm, m.maxZmm].sort((a, b) => b - a) as [number, number, number]) : 0 })).filter((x) => x.n > 0);
  const m = pickMachine(base.process, fitted.map((x) => x.m), ref);
  if (!m) return notCosted(base, 'gap', 'No aging oven takes this part.');
  const perLoad = fitted.find((x) => x.m === m)!.n;
  const seeds = {
    'Aging Time': seed(hours, `${SRC_LOOKUP('tblMaterialAgingTime')} (${part.materialTypeName})`),
    'Parts per Oven Load': seed(perLoad, `part + ${allowance} mm nesting allowance in ${m.maxXmm}×${m.maxYmm}×${m.maxZmm} mm`),
    'Batch Size': seed(part.batchSize, 'batch size'),
  };
  const r = runCalc(base, calculators, seeds);
  if ('gap' in r) return r.gap;
  return costed(base, m, { perPartSec: r.run.sec!, trace: calcTrace(r.run), highlight: 'whole_part', calculator: r.record }, ref, part.batchSize);
}

function hip(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined): SecondaryProcessResult {
  const props = ref.lookups.get('tblMaterialTypeProperties');
  const v = (k: string) => variable(ref, k);
  const room = v('defaultRoomTemperature'), avgHeat = v('averageHeatingRate'), avgCool = v('averageCoolingRate'), avgHold = v('averageHoldTime');
  const press = v('pressurizingVesselTime'), purge = v('vacuumPurgeEqualize'), prog = v('hipProgrammingTime'), maxSolid = v('hipMaxPercentageSolidVolumeFromHotZoneVolume');
  const holdMpa = v('hipDefaultHoldPressure'), cylMpa = v('hipGasCylinderPressure'), reuse = v('hipDefaultGasReusePercentage');
  if (!props || [room, avgHeat, avgCool, avgHold, press, purge, prog, maxSolid, holdMpa, cylMpa, reuse].some((x) => x == null)) {
    return notCosted(base, 'gap', 'HIP reference data is not staged: run migration 823.');
  }
  if (!part.materialTypeName) return notCosted(base, 'gap', 'The material type is needed for the HIP hold temperature (tblMaterialTypeProperties).');
  if (!part.bboxMm || part.volumeMm3 == null || part.volumeMm3 <= 0) return notCosted(base, 'gap', 'Part size and volume are needed to load the hot zone.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed to count HIP loads.');
  const row = props.find((r) => r['Material Type'] === part.materialTypeName);
  const holdT = row ? num(row['Hold Temperature (°C)']) : null;
  if (holdT == null) return notCosted(base, 'gap', `No HIP hold temperature for "${part.materialTypeName}" in ${SRC_LOOKUP('tblMaterialTypeProperties')}.`);
  const heatOwn = num(row!['Heating Rate (°C / min)']), coolOwn = num(row!['Cooling Rate (°C / min)']), holdOwn = num(row!['Hold Time (hr)']);
  const [L, W, H] = sorted(part.bboxMm);
  const fitted = pool.map((m) => {
    const D = m.maxYmm, len = m.maxXmm;
    if (!D || !len || L > len || Math.hypot(W, H) > D) return { m, n: 0, vol: 0 };
    const vol = Math.PI * (D / 2) ** 2 * len;
    return { m, n: Math.floor((vol * maxSolid!) / part.volumeMm3!), vol };
  }).filter((x) => x.n > 0);
  const m = pickMachine(base.process, fitted.map((x) => x.m), ref);
  if (!m) return notCosted(base, 'gap', 'No HIP hot zone takes this part.');
  const { n: perLoad, vol } = fitted.find((x) => x.m === m)!;
  const props3 = SRC_LOOKUP('tblMaterialTypeProperties');
  const seeds: Record<string, CalcSeed> = {
    'Hold Temperature': seed(holdT, `${props3} (${part.materialTypeName})`),
    'Room Temperature': seed(room!, `${SRC_VAR} (defaultRoomTemperature)`),
    'Heating Rate': seed(heatOwn ?? avgHeat!, heatOwn != null ? props3 : `${SRC_VAR} (averageHeatingRate)`),
    'Cooling Rate': seed(coolOwn ?? avgCool!, coolOwn != null ? props3 : `${SRC_VAR} (averageCoolingRate)`),
    'Hold Time': seed(holdOwn ?? avgHold!, holdOwn != null ? props3 : `${SRC_VAR} (averageHoldTime)`),
    'Pressurize Time': seed(press!, `${SRC_VAR} (pressurizingVesselTime)`),
    'Vacuum Purge Time': seed(purge!, `${SRC_VAR} (vacuumPurgeEqualize)`),
    'Parts per Load': seed(perLoad, `hot zone ${m.maxYmm}×${m.maxXmm} mm × ${maxSolid} solid-volume limit`),
    'Batch Size': seed(part.batchSize, 'batch size'),
  };
  const r = runCalc(base, calculators, seeds);
  if ('gap' in r) return r.gap;
  const loads = r.run.outputs['Loads']!;
  const trace = calcTrace(r.run);
  const argonUsd = num(m.specs['argon_gas_cost_usd_per_m3']);
  let materialUsd = 0;
  const warnings: string[] = [];
  if (argonUsd != null) {
    const freeM3 = (vol - perLoad * part.volumeMm3) / 1e9;
    const gasM3 = freeM3 * (holdMpa! / cylMpa!) * (1 - reuse!);
    materialUsd = (loads * gasM3 * argonUsd) / part.batchSize;
    trace.push({ label: 'Argon per load', value: Number(gasM3.toFixed(3)), unit: 'm³', source: `free hot-zone volume × ${holdMpa}/${cylMpa} MPa × (1 − ${reuse} reuse) at ${argonUsd} USD/m³` });
  } else {
    warnings.push(`${m.name} has no argon gas cost; gas is not charged.`);
  }
  return costed(base, m, {
    perPartSec: r.run.sec!,
    batchExtraSec: prog! * 3600,
    materialUsdPerPart: materialUsd,
    trace, warnings, highlight: 'whole_part', calculator: r.record,
  }, ref, part.batchSize);
}

type Model = (base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], calculators: ReferenceCalculators | null | undefined) => SecondaryProcessResult;
const MODELS: Record<string, Model> = {
  'Carburize': carburize,
  'Carbonitride': carburize,
  'Certification': certification,
  'Straighten': straighten,
  'Age': age,
  'Hot Isostatic Pressing': hip,
};

export function computeHeatTreatments(
  part: HeatTreatmentFacts,
  ref: SecondaryReference,
  machines: ReadonlyArray<SecondaryMachine>,
  /** The heat-treatment calculators by operation (migration 907). */
  calculators: ReferenceCalculators | null | undefined,
): SecondaryProcessResult[] {
  return HEAT_TREATMENT_PROCESSES.map((base) => {
    const pool = machines.filter((m) => m.machineClass === base.machineClass);
    if (pool.length === 0) return notCosted(base, 'gap', `The reference has no machine or service for ${base.process}.`);
    return (MODELS[base.process] ?? ((b, p, r, pl, c) => byWeight(b, p, r, pl, c)))(base, part, ref, pool, calculators);
  });
}

const OPTIONAL = new Set(['heat', 'treat', 'process', 'with']);
/** The reference heat-treatment process a drawing callout names (most specific wins), or null.
 *  Every process word must begin a callout word on its first five letters
 *  ("carbu" is Carburize, "carbo" Carbonitride; "aged" is Age). */
export function matchHeatTreatmentCallout(callout: string | null | undefined): string | null {
  const words = (callout ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  if (words.length === 0) return null;
  let best: { p: string; n: number } | null = null;
  for (const { process } of HEAT_TREATMENT_PROCESSES) {
    const need = process.toLowerCase().split(/[^a-z]+/).filter((w) => w && !OPTIONAL.has(w));
    const hit = need.length > 0 && need.every((w) => words.some((cw) => cw.startsWith(w.slice(0, 5))));
    if (hit && (!best || need.length > best.n)) best = { p: process, n: need.length };
  }
  return best?.p ?? null;
}

/** "case depth 0.8 mm" / "0.8mm case" in a callout, in mm; null when not stated. */
export function caseDepthFromCallout(callout: string | null | undefined): number | null {
  const m = /case[^0-9]{0,12}([\d.]+)\s*mm|([\d.]+)\s*mm[^a-z]{0,4}case/i.exec(callout ?? '');
  const v = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}
