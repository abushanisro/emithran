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
// A process with no machine in the reference, or a missing input, is a 'gap'.

import {
  costed, notCosted, pickMachine, variable, num, sorted, maxPartsInBox,
  type SecondaryMachine, type SecondaryPartFacts, type SecondaryProcessResult, type SecondaryReference, type SecondaryTraceStep,
} from '../secondary/secondary-process-engine';

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

function priced(base: Base, m: SecondaryMachine, usdPerPart: number, handlingSec: number, trace: SecondaryTraceStep[],
  warnings: string[], ref: SecondaryReference, batch: number): SecondaryProcessResult {
  // Handling runs on the row's own crew/overhead; the treatment itself is the
  // priced service, added as per-part material.
  const r = costed(base, m, { perPartSec: handlingSec, materialUsdPerPart: usdPerPart, trace, warnings, highlight: 'whole_part' }, ref, batch);
  return { ...r, reason: 'Priced by weight from the reference service, plus handling at its labour and overhead.' };
}

function handlingSeconds(ref: SecondaryReference, kg: number, trace: SecondaryTraceStep[]): number | null {
  const table = ref.lookups.get('tblHandlingTimes');
  if (!table) return null;
  const row = table
    .map((r) => ({ eq: String(r['Equipment']), s: num(r['Handling Time (s)']), kg: num(r['Max Weight (kg)']) }))
    .filter((r): r is { eq: string; s: number; kg: number } => r.s != null && r.kg != null)
    .sort((a, b) => a.kg - b.kg || a.s - b.s)
    .find((r) => kg <= r.kg);
  if (!row) return null;
  trace.push({ label: `Handling (${row.eq})`, value: row.s, unit: 's', source: `${SRC_LOOKUP('tblHandlingTimes')} (≤ ${row.kg} kg)` });
  return row.s;
}

function byWeight(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[], multiplier?: { value: number; label: string }): SecondaryProcessResult {
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed (priced per kg): choose a material first.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed for the minimum batch charge.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['unit_weight_cost_usd_per_kg']) != null), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} service in the reference data for this location.`);
  const perKg = num(m.specs['unit_weight_cost_usd_per_kg'])!;
  const minCost = num(m.specs['min_batch_cost_usd']);
  const minKg = num(m.specs['min_batch_weight_kg']);
  const batchKg = part.weightKg * part.batchSize;
  let batchUsd = minKg != null && minCost != null && batchKg < minKg ? minCost : batchKg * perKg;
  const trace: SecondaryTraceStep[] = [
    { label: 'Batch weight', value: Number(batchKg.toFixed(3)), unit: 'kg', source: `${part.weightKg} kg × ${part.batchSize}` },
    { label: 'Unit weight cost', value: perKg, unit: 'USD/kg', source: `service ${m.name}` },
    { label: 'Minimum batch', value: `${minCost ?? '—'} USD below ${minKg ?? '—'} kg`, source: `service ${m.name}` },
  ];
  if (multiplier) {
    batchUsd *= multiplier.value;
    trace.push({ label: 'Case depth multiplier', value: multiplier.value, source: multiplier.label });
  }
  const hs = handlingSeconds(ref, part.weightKg, trace);
  if (hs == null) return notCosted(base, 'gap', 'tblHandlingTimes is not staged or covers no row for this weight.', { trace });
  return priced(base, m, batchUsd / part.batchSize, hs, trace, [], ref, part.batchSize);
}

function carburize(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
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
  return byWeight(base, part, ref, pool, { value: row.mult, label: `${SRC_LOOKUP('tblCaseDepthMultiplier')} (case depth ${part.caseDepthMm} mm ≤ ${row.d} mm)` });
}

function certification(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed (certification is charged once per batch).');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['certification_cost_usd']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No certification service in the reference data for this location.');
  const usd = num(m.specs['certification_cost_usd'])!;
  return priced(base, m, usd / part.batchSize, 0, [
    { label: 'Certification cost', value: usd, unit: 'USD per batch', source: `service ${m.name}` },
  ], [], ref, part.batchSize);
}

function straighten(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const small = variable(ref, 'smallPartsWeightLimit'), medium = variable(ref, 'mediumPartsWeightLimit');
  const rs = variable(ref, 'smallPartsStraighteningRatePerHr'), rm = variable(ref, 'mediumPartsStraighteningRatePerHr'), rl = variable(ref, 'largePartsStraighteningRatePerHr');
  if ([small, medium, rs, rm, rl].some((v) => v == null)) return notCosted(base, 'gap', 'Straightening variables are not staged: run migration 823.');
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed to pick the straightening rate: choose a material first.');
  const [cls, rate] = part.weightKg <= small! ? ['small', rs!] : part.weightKg <= medium! ? ['medium', rm!] : ['large', rl!];
  const m = pickMachine(base.process, pool, ref);
  if (!m) return notCosted(base, 'gap', 'No straightening station in the reference data for this location.');
  return costed(base, m, {
    perPartSec: 3600 / rate,
    trace: [{ label: `Straightening rate (${cls} part)`, value: rate, unit: 'parts/hr', source: `${SRC_VAR} (${cls}PartsStraighteningRatePerHr; small ≤ ${small} kg, medium ≤ ${medium} kg)` }],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function age(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
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
  const loads = Math.ceil(part.batchSize / perLoad);
  return costed(base, m, {
    perPartSec: (loads * hours * 3600) / part.batchSize,
    trace: [
      { label: 'Aging time', value: hours, unit: 'hr', source: `${SRC_LOOKUP('tblMaterialAgingTime')} (${part.materialTypeName})` },
      { label: 'Parts per oven load', value: perLoad, source: `part + ${allowance} mm nesting allowance in ${m.maxXmm}×${m.maxYmm}×${m.maxZmm} mm` },
      { label: 'Oven loads', value: loads, source: `ceil(${part.batchSize} / ${perLoad})` },
    ],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function hip(base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
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
  const heat = num(row!['Heating Rate (°C / min)']) ?? avgHeat!;
  const cool = num(row!['Cooling Rate (°C / min)']) ?? avgCool!;
  const holdHr = num(row!['Hold Time (hr)']) ?? avgHold!;
  const dT = holdT - room!;
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
  const loads = Math.ceil(part.batchSize / perLoad);
  const cycleMin = dT / heat + holdHr * 60 + dT / cool + press! + purge!;
  const trace: SecondaryTraceStep[] = [
    { label: 'Hold temperature', value: holdT, unit: '°C', source: `${SRC_LOOKUP('tblMaterialTypeProperties')} (${part.materialTypeName})` },
    { label: 'Heat-up', value: Number((dT / heat).toFixed(1)), unit: 'min', source: `(${holdT} − ${room}) / ${heat} °C/min${row!['Heating Rate (°C / min)'] == null ? ' (averageHeatingRate)' : ''}` },
    { label: 'Hold', value: holdHr, unit: 'hr', source: row!['Hold Time (hr)'] == null ? `${SRC_VAR} (averageHoldTime)` : SRC_LOOKUP('tblMaterialTypeProperties') },
    { label: 'Cool-down', value: Number((dT / cool).toFixed(1)), unit: 'min', source: `(${holdT} − ${room}) / ${cool} °C/min${row!['Cooling Rate (°C / min)'] == null ? ' (averageCoolingRate)' : ''}` },
    { label: 'Pressurize + vacuum purge', value: press! + purge!, unit: 'min', source: `${SRC_VAR} (pressurizingVesselTime, vacuumPurgeEqualize)` },
    { label: 'Parts per load', value: perLoad, source: `hot zone ${m.maxYmm}×${m.maxXmm} mm × ${maxSolid} solid-volume limit` },
    { label: 'Loads', value: loads, source: `ceil(${part.batchSize} / ${perLoad})` },
  ];
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
    perPartSec: (loads * cycleMin * 60) / part.batchSize,
    batchExtraSec: prog! * 3600,
    materialUsdPerPart: materialUsd,
    trace, warnings, highlight: 'whole_part',
  }, ref, part.batchSize);
}

type Model = (base: Base, part: HeatTreatmentFacts, ref: SecondaryReference, pool: SecondaryMachine[]) => SecondaryProcessResult;
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
): SecondaryProcessResult[] {
  return HEAT_TREATMENT_PROCESSES.map((base) => {
    const pool = machines.filter((m) => m.machineClass === base.machineClass);
    if (pool.length === 0) return notCosted(base, 'gap', `The reference has no machine or service for ${base.process}.`);
    return (MODELS[base.process] ?? byWeight)(base, part, ref, pool);
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
