// Surface treatment, costed only from memory/SurfaceTreatment (migrations 819
// variables/lookups/processes, 820 machines) and the part's own CAD facts.
//
// Two real cost shapes exist in the reference data:
//   per-area price   plating lines (Application Cost Per Area, USD/m²) and
//                    e-coat painting (Surface Area Cost, USD/m²): a priced
//                    service, no machine time.
//   machine time     dot peen, laser engraving, manual paint, shot peen and the
//                    conveyor lines: seconds per part on a real machine, costed
//                    at that machine's MHR + crew rate (same assembly as the
//                    secondary processes).
//   batch loads      Passivation (tank window) and the loadbar lines Anodize
//                    and Wet Coat Line: parts per load from the window and its
//                    spacing factor (partsPerLoad), time per load from the
//                    reference (treatment time; Load Window Time per loadbar).
// A process whose reference data does not define its time or price (for
// example Black Oxide: every stage time is on file except the blackening
// immersion) is a disclosed 'gap' naming what is missing, never an estimate.

import {
  costed, notCosted, pickMachine, variable, num, sorted, envelopeCapable, partsPerLoad, maxPartsInBox,
  type SecondaryMachine, type SecondaryPartFacts, type SecondaryProcessResult, type SecondaryReference, type SecondaryTraceStep,
} from '../secondary/secondary-process-engine';
import { PROVISIONAL, provisionalTrace, provisionalWarning } from '../secondary/provisional-reference';
export { SURFACE_TREATMENT_SOURCE_VERSION } from './surface-treatment-source';

const SRC_VAR = 'memory/SurfaceTreatment/surface_treatment_variables.csv';
const SRC_LOOKUP = (t: string) => `memory/SurfaceTreatment/lookup/${t}.csv`;

const classOf = (process: string) => 'surface_' + process.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export const SURFACE_PROCESSES: ReadonlyArray<{ process: string; machineClass: string }> = [
  'Anodize', 'Bead Blast', 'Black Oxide', 'Cadmium Plating', 'Conveyor Abrasive Finishing',
  'Conveyor Conversion Coating', 'Conveyor Dry', 'Conveyor Oven Cure', 'Conveyor Part Loading',
  'Conveyor Part Unloading', 'Conveyor Powder Coating', 'Conveyor Shot Blast', 'Decorative Chrome Plating',
  'Degrease', 'Dot Peen', 'Hard Chrome Plating', 'Laser Engraving', 'Manual Paint', 'Mask-Bench',
  'Mask-Spray', 'Nickel Plating', 'Oven Cure', 'Painting', 'Passivation', 'Powder Coat Cart',
  'Sand Blast', 'Screen Printing', 'Shot Blast', 'Shot Peen', 'Vibratory Finishing', 'Wet Coat Line',
  'Zinc Nickel Plating', 'Zinc Plating',
].map((process) => ({ process, machineClass: classOf(process) }));

type Base = { process: string; machineClass: string };

const PLATING = new Set(['Cadmium Plating', 'Decorative Chrome Plating', 'Hard Chrome Plating', 'Nickel Plating', 'Zinc Nickel Plating', 'Zinc Plating']);

/** A per-area priced service: cost only, no machine time. */
function priced(base: Base, m: SecondaryMachine, usdPerPart: number, trace: SecondaryTraceStep[], warnings: string[]): SecondaryProcessResult {
  return {
    ...base,
    status: 'costed',
    reason: 'Priced per area from the reference machine rate (a priced service: no machine time).',
    machine: { id: m.id, name: m.name, mhrUsd: m.mhrUsd, lhrUsd: m.lhrUsd, operators: m.operators, setupHr: m.setupHr, goodPartYield: m.goodPartYield },
    cycleTimeSec: null,
    setupMin: null,
    materialUsdPerPart: 0,
    costPerPartUsd: Number(usdPerPart.toFixed(4)),
    highlight: 'whole_part',
    featureIds: [],
    trace,
    warnings,
  };
}

function plating(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const pct = variable(ref, 'defaultPercentageOfSurfaceAreaElectroplated');
  if (pct == null) return notCosted(base, 'gap', 'defaultPercentageOfSurfaceAreaElectroplated is not staged: run migration 819.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['application_cost_per_area_usd_per_m2']) != null), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} line on file for this location.`);
  const perM2 = num(m.specs['application_cost_per_area_usd_per_m2'])!;
  const areaM2 = (part.surfaceAreaMm2 / 1e6) * (pct / 100);
  const trace: SecondaryTraceStep[] = [
    { label: 'Plated area', value: Number(areaM2.toFixed(5)), unit: 'm²', source: `CAD surface area × ${pct}% (${SRC_VAR} defaultPercentageOfSurfaceAreaElectroplated)` },
    { label: 'Application cost', value: perM2, unit: 'USD/m²', source: `line ${m.name} (standard thickness ${m.specs['standard_plate_thickness_um'] ?? '—'} µm)` },
  ];
  const warnings = ['Priced at the standard plate thickness: a thicker callout adds Extra Thickness Cost Per Area, which needs the drawing thickness.'];
  let usd = areaM2 * perM2;
  const fees = ref.lookups.get('platingWeightBasedHandlingFees');
  if (fees && part.weightKg != null && part.weightKg > 0) {
    const fee = fees
      .map((r) => ({ fee: num(r['Fee (USD)']), kg: num(r['Weight (kg)']) }))
      .filter((r): r is { fee: number; kg: number } => r.fee != null && r.kg != null)
      .sort((a, b) => a.kg - b.kg)
      .find((r) => part.weightKg! <= r.kg);
    if (fee) {
      usd += fee.fee;
      trace.push({ label: 'Weight-based handling fee', value: fee.fee, unit: 'USD', source: `${SRC_LOOKUP('platingWeightBasedHandlingFees')} (≤ ${fee.kg} kg)` });
    }
  } else {
    warnings.push('Part weight not known yet (no material chosen): the weight-based handling fee is not applied.');
  }
  return priced(base, m, usd, trace, warnings);
}

function painting(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const fraction = variable(ref, 'defaultFractionPartPainted');
  const coats = variable(ref, 'defaultPaintingCoats');
  if (fraction == null || coats == null) return notCosted(base, 'gap', 'Painting variables are not staged: run migration 819.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['surface_area_cost_usd_per_m2']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No painting line on file for this location.');
  const perM2 = num(m.specs['surface_area_cost_usd_per_m2'])!;
  const areaM2 = (part.surfaceAreaMm2 / 1e6) * fraction;
  return priced(base, m, areaM2 * perM2 * coats, [
    { label: 'Painted area', value: Number(areaM2.toFixed(5)), unit: 'm²', source: `CAD surface area × ${fraction} (defaultFractionPartPainted)` },
    { label: 'Coats', value: coats, source: `${SRC_VAR} (defaultPaintingCoats)` },
    { label: 'Surface area cost', value: perM2, unit: 'USD/m²', source: `line ${m.name}` },
  ], []);
}

function dotPeen(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const chars = variable(ref, 'dotPeenDefaultCharacters');
  const perChar = variable(ref, 'dotPeenTimePerCharacter');
  if (chars == null || perChar == null) return notCosted(base, 'gap', 'Dot peen variables are not staged: run migration 819.');
  const m = pickMachine(base.process, pool, ref);
  if (!m) return notCosted(base, 'gap', 'No dot peen machine on file for this location.');
  const progHr = num(m.specs['programming_time_hr']) ?? 0;
  return costed(base, m, {
    perPartSec: chars * perChar,
    batchExtraSec: progHr * 3600,
    trace: [
      { label: 'Characters', value: chars, source: `${SRC_VAR} (dotPeenDefaultCharacters)` },
      { label: 'Time per character', value: perChar, unit: 's', source: `${SRC_VAR} (dotPeenTimePerCharacter)` },
      { label: 'Programming (once per batch)', value: progHr, unit: 'hr', source: `machine ${m.name}` },
    ],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function laserEngraving(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const len = variable(ref, 'defaultLaserEngravingLength');
  const wid = variable(ref, 'defaultLaserEngravingWidth');
  const step = variable(ref, 'defaultLaserEngravingStepInterval');
  const speed = variable(ref, 'defaultLaserEngravingSpeed');
  const passes = variable(ref, 'defaultLaserEngravingPasses');
  const materials = ref.lookups.get('tblLaserEngraving');
  if ([len, wid, step, speed, passes].some((v) => v == null) || !materials) return notCosted(base, 'gap', 'Laser engraving reference data is not staged: run migration 819.');
  if (!part.materialTypeName) return notCosted(base, 'gap', 'The part material type is needed to check laser-engraving compatibility (tblLaserEngraving).');
  const allowed = materials.map((r) => String(r['Material Type Name'] ?? '')).filter(Boolean);
  if (!allowed.includes(part.materialTypeName)) {
    return notCosted(base, 'not_applicable', `Material type "${part.materialTypeName}" is not in ${SRC_LOOKUP('tblLaserEngraving')}: ${allowed.join(', ')}.`);
  }
  const m = pickMachine(base.process, envelopeCapable(pool, part).filter((x) => num(x.specs['max_engrave_speed_mm_per_s']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No laser engraver takes this part.');
  const v = Math.min(speed!, num(m.specs['max_engrave_speed_mm_per_s'])!);
  const lines = Math.ceil(wid! / step!);
  return costed(base, m, {
    perPartSec: (lines * len! * passes!) / v,
    batchExtraSec: (num(m.specs['programming_time_hr']) ?? 0) * 3600,
    trace: [
      { label: 'Engraved area', value: `${len} × ${wid}`, unit: 'mm', source: `${SRC_VAR} (defaultLaserEngravingLength/Width)` },
      { label: 'Scan lines', value: lines, source: `width / step ${step} mm (defaultLaserEngravingStepInterval)` },
      { label: 'Engrave speed', value: v, unit: 'mm/s', source: `min(defaultLaserEngravingSpeed ${speed}, machine max)` },
      { label: 'Passes', value: passes!, source: `${SRC_VAR} (defaultLaserEngravingPasses)` },
    ],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function manualPaint(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const keys = ['defaultFractionPartPainted', 'defaultHandCleaningRate', 'defaultHandSandingRate', 'defaultHandSprayRatePrimer',
    'defaultHandSprayRateFinish', 'defaultNumPrimerCoats', 'defaultNumFinishCoats', 'manualPaintPartLoadTime'] as const;
  const v = Object.fromEntries(keys.map((k) => [k, variable(ref, k)])) as Record<(typeof keys)[number], number | null>;
  if (keys.some((k) => v[k] == null)) return notCosted(base, 'gap', 'Manual paint variables are not staged: run migration 819.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed.');
  const m = pickMachine(base.process, envelopeCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', 'No paint booth takes this part.');
  const area = part.surfaceAreaMm2 * v.defaultFractionPartPainted!;
  const clean = area / v.defaultHandCleaningRate!;
  const sand = area / v.defaultHandSandingRate!;
  const primer = (area * v.defaultNumPrimerCoats!) / v.defaultHandSprayRatePrimer!;
  const finish = (area * v.defaultNumFinishCoats!) / v.defaultHandSprayRateFinish!;
  return costed(base, m, {
    perPartSec: v.manualPaintPartLoadTime! + clean + sand + primer + finish,
    trace: [
      { label: 'Painted area', value: Math.round(area), unit: 'mm²', source: 'CAD surface area × defaultFractionPartPainted' },
      { label: 'Hand cleaning', value: Number(clean.toFixed(1)), unit: 's', source: `area / defaultHandCleaningRate ${v.defaultHandCleaningRate} mm²/s` },
      { label: 'Hand sanding', value: Number(sand.toFixed(1)), unit: 's', source: `area / defaultHandSandingRate ${v.defaultHandSandingRate} mm²/s` },
      { label: 'Primer spray', value: Number(primer.toFixed(1)), unit: 's', source: `${v.defaultNumPrimerCoats} coat(s) at defaultHandSprayRatePrimer ${v.defaultHandSprayRatePrimer} mm²/s` },
      { label: 'Finish spray', value: Number(finish.toFixed(1)), unit: 's', source: `${v.defaultNumFinishCoats} coat(s) at defaultHandSprayRateFinish ${v.defaultHandSprayRateFinish} mm²/s` },
      { label: 'Part load', value: v.manualPaintPartLoadTime!, unit: 's', source: `${SRC_VAR} (manualPaintPartLoadTime)` },
    ],
    warnings: ['Curing runs concurrently (defaultConcurrentManualPaintCuring) and is not added.'],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function shotPeen(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const pctArea = variable(ref, 'defaultShotPeenArea');
  if (pctArea == null) return notCosted(base, 'gap', 'defaultShotPeenArea is not staged: run migration 819.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['surface_area_allowance_s_per_m2']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No shot peen machine on file for this location.');
  const sPerM2 = num(m.specs['surface_area_allowance_s_per_m2'])!;
  const areaM2 = (part.surfaceAreaMm2 / 1e6) * (pctArea / 100);
  return costed(base, m, {
    perPartSec: areaM2 * sPerM2,
    trace: [
      { label: 'Peened area', value: Number(areaM2.toFixed(5)), unit: 'm²', source: `CAD surface area × ${pctArea}% (defaultShotPeenArea)` },
      { label: 'Surface area allowance', value: sPerM2, unit: 's/m²', source: `machine ${m.name}` },
    ],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

/** Conveyor pitch: part length plus the reference part spacing. */
function conveyorPitch(part: SecondaryPartFacts, ref: SecondaryReference, trace: SecondaryTraceStep[]): number | string {
  const f = variable(ref, 'conveyorPartSpacingFactor');
  const lo = variable(ref, 'conveyorMinPartSpacing');
  const hi = variable(ref, 'conveyorMaxPartSpacing');
  if (f == null || lo == null || hi == null) return 'Conveyor spacing variables are not staged: run migration 819.';
  if (!part.bboxMm) return 'Part size is needed.';
  const [L] = sorted(part.bboxMm);
  const spacing = Math.min(hi, Math.max(lo, L * f));
  trace.push({ label: 'Part spacing', value: Number(spacing.toFixed(1)), unit: 'mm', source: `clamp(${f} × length ${L} mm, ${lo}, ${hi}) (conveyorPartSpacingFactor/Min/Max)` });
  return L + spacing;
}

/** A conveyor takes the part when its cross-section passes the opening. */
function conveyorCapable(pool: SecondaryMachine[], part: SecondaryPartFacts): SecondaryMachine[] {
  if (!part.bboxMm) return pool;
  const [, W, H] = sorted(part.bboxMm);
  return pool.filter((m) => (m.maxYmm == null || W <= m.maxYmm) && (m.maxZmm == null || H <= m.maxZmm));
}

function conveyorShotBlast(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const speed = variable(ref, 'defaultConveyorShotBlastLineSpeed');
  if (speed == null) return notCosted(base, 'gap', 'defaultConveyorShotBlastLineSpeed is not staged: run migration 819.');
  const trace: SecondaryTraceStep[] = [];
  const pitch = conveyorPitch(part, ref, trace);
  if (typeof pitch === 'string') return notCosted(base, 'gap', pitch);
  const m = pickMachine(base.process, conveyorCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', 'No shot-blast conveyor opening takes this part.');
  trace.push({ label: 'Line speed', value: speed, unit: 'mm/s', source: `${SRC_VAR} (defaultConveyorShotBlastLineSpeed)` });
  return costed(base, m, { perPartSec: pitch / speed, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

function conveyorDry(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const trace: SecondaryTraceStep[] = [];
  const pitch = conveyorPitch(part, ref, trace);
  if (typeof pitch === 'string') return notCosted(base, 'gap', pitch);
  const m = pickMachine(base.process, conveyorCapable(pool, part)
    .filter((x) => num(x.specs['dry_stage_length_mm']) != null && num(x.specs['part_dry_time_min']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No conveyor dryer opening takes this part.');
  const stage = num(m.specs['dry_stage_length_mm'])!;
  const dryMin = num(m.specs['part_dry_time_min'])!;
  const speed = stage / (dryMin * 60); // the part must spend the dry time in the stage
  trace.push({ label: 'Line speed', value: Number(speed.toFixed(3)), unit: 'mm/s', source: `dry stage ${stage} mm / dry time ${dryMin} min (machine ${m.name})` });
  return costed(base, m, { perPartSec: pitch / speed, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

const CAF_ACTIONS: Array<{ action: string; variable: string; capability: string }> = [
  { action: 'Deburr', variable: 'cafDefaultDeburrRequired', capability: 'can_deburr' },
  { action: 'Round Edges', variable: 'cafDefaultRoundEdgesRequired', capability: 'can_round_edges' },
  { action: 'Surface Finish', variable: 'cafDefaultSurfaceFinishingRequired', capability: 'can_surface_finish' },
  { action: 'Remove Oxide Skin', variable: 'cafDefaultRemoveOxideSkinRequired', capability: 'can_remove_oxide_skin' },
  { action: 'Remove Slag', variable: 'cafDefaultRemoveSlagRequired', capability: 'can_remove_slag' },
];

function conveyorAbrasiveFinishing(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const speeds = ref.lookups.get('tblCAFConveyorSpeeds');
  const passes = variable(ref, 'cafDefaultNumPasses');
  const spacing = variable(ref, 'cafPartSpacing');
  if (!speeds || passes == null || spacing == null) return notCosted(base, 'gap', 'Conveyor abrasive finishing reference data is not staged: run migration 819.');
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed.');
  const required = CAF_ACTIONS.filter((a) => ref.variables.get(a.variable) === 'true');
  const speedOf = new Map(speeds.map((r) => [String(r['Action Name']), num(r['Conveyor Speed (mm / s)'])]));
  const [L] = sorted(part.bboxMm);
  const trace: SecondaryTraceStep[] = [
    { label: 'Required actions', value: required.map((a) => a.action).join(', '), source: `${SRC_VAR} (cafDefault*Required)` },
    { label: 'Passes', value: passes, source: `${SRC_VAR} (cafDefaultNumPasses)` },
    { label: 'Part spacing', value: spacing, unit: 'mm', source: `${SRC_VAR} (cafPartSpacing)` },
  ];
  let sec = 0;
  for (const a of required) {
    const v = speedOf.get(a.action);
    if (v == null || v <= 0) return notCosted(base, 'gap', `No conveyor speed for "${a.action}" in ${SRC_LOOKUP('tblCAFConveyorSpeeds')}.`, { trace });
    sec += (passes * (L + spacing)) / v;
    trace.push({ label: `${a.action} speed`, value: v, unit: 'mm/s', source: SRC_LOOKUP('tblCAFConveyorSpeeds') });
  }
  const capable = conveyorCapable(pool, part).filter((m) => required.every((a) => m.specs[a.capability] === true));
  const m = pickMachine(base.process, capable, ref);
  if (!m) {
    return notCosted(base, 'gap', `No single machine on file can do every required action (${required.map((a) => a.action).join(', ')}) and take this part.`, { trace });
  }
  return costed(base, m, { perPartSec: sec, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

function handling(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const table = ref.lookups.get('tblHandlingTimes');
  if (!table) return notCosted(base, 'gap', 'tblHandlingTimes is not staged: run migration 819.');
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed to pick the handling time (tblHandlingTimes): choose a material first.');
  const row = table
    .map((r) => ({ eq: String(r['Equipment']), s: num(r['Handling Time (s)']), kg: num(r['Max Weight (kg)']) }))
    .filter((r): r is { eq: string; s: number; kg: number } => r.s != null && r.kg != null)
    .sort((a, b) => a.kg - b.kg || a.s - b.s)
    .find((r) => part.weightKg! <= r.kg);
  if (!row) return notCosted(base, 'gap', 'No handling-time row covers this part weight.');
  const m = pickMachine(base.process, envelopeCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} area on file for this location.`);
  return costed(base, m, {
    perPartSec: row.s,
    trace: [{ label: `Handling (${row.eq})`, value: row.s, unit: 's', source: `${SRC_LOOKUP('tblHandlingTimes')} (≤ ${row.kg} kg)` }],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

function blastByWeight(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  if (part.weightKg == null || part.weightKg <= 0) return notCosted(base, 'gap', 'Part weight is needed (priced per kg with a minimum batch charge): choose a material first.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed for the minimum batch charge.');
  const m = pickMachine(base.process, pool.filter((x) => num(x.specs['unit_weight_cost_usd_per_kg']) != null), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} service on file for this location.`);
  const perKg = num(m.specs['unit_weight_cost_usd_per_kg'])!;
  const minCost = num(m.specs['min_batch_cost_usd']);
  const minKg = num(m.specs['min_batch_weight_kg']);
  const batchKg = part.weightKg * part.batchSize;
  const batchUsd = minKg != null && minCost != null && batchKg < minKg ? minCost : batchKg * perKg;
  return priced(base, m, batchUsd / part.batchSize, [
    { label: 'Batch weight', value: Number(batchKg.toFixed(3)), unit: 'kg', source: `${part.weightKg} kg × ${part.batchSize}` },
    { label: 'Unit weight cost', value: perKg, unit: 'USD/kg', source: `service ${m.name}` },
    { label: 'Minimum batch', value: `${minCost ?? '—'} USD below ${minKg ?? '—'} kg`, source: `service ${m.name}` },
  ], []);
}

/** pickMachine over the machines that take the part, with the chosen one's fit. */
function pickFit<F extends { m: SecondaryMachine }>(process: string, fitted: F[], ref: SecondaryReference): F | undefined {
  const m = pickMachine(process, fitted.map((x) => x.m), ref);
  return m ? fitted.find((x) => x.m === m) : undefined;
}

/**
 * Passivation: a batch tank. Parts per load from the tank window (spacing
 * factor, height and weight limits), each load immersed for the treatment
 * time of the part cut code (passivationTreatments). The reference lists a hot
 * and a cold bath per cut code with no rule between them; the shortest (hot)
 * one is used and the other is shown (user decision 2026-10-09).
 */
function passivation(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const table = ref.lookups.get('passivationTreatments');
  if (!table) return notCosted(base, 'gap', 'passivationTreatments is not staged: run migration 819.');
  if (part.materialCutCode == null) return notCosted(base, 'gap', 'The material cut code is needed for the passivation treatment (passivationTreatments): choose a material first.');
  if (part.isMachined == null) return notCosted(base, 'gap', 'Whether the part is machined is needed to pick the passivation treatment.');
  const bbox = part.bboxMm;
  if (!bbox) return notCosted(base, 'gap', 'Part size is needed to load the tank.');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed to count tank loads.');
  const options = table
    .filter((r) => num(r['Cut Code']) === part.materialCutCode && String(r['Is Machined']) === String(part.isMachined))
    .map((r) => ({ treatment: typeof r.Treatment === 'string' ? r.Treatment : '', min: num(r['Time (min)']) }))
    .filter((o): o is { treatment: string; min: number } => o.min != null && o.min > 0)
    .sort((a, b) => a.min - b.min);
  const chosen = options.at(0);
  const others = options.slice(1);
  if (!chosen) {
    return notCosted(base, 'not_applicable', `Cut code ${part.materialCutCode} has no passivation treatment in ${SRC_LOOKUP('passivationTreatments')} (passivation is for stainless steels).`);
  }
  const fitted = pool.flatMap((m) => {
    const L = num(m.specs.machine_window_length_mm);
    const W = num(m.specs.machine_window_width_mm);
    const H = num(m.specs.machine_height_limit_mm);
    const f = num(m.specs.part_spacing_factor);
    if (L == null || W == null || H == null || f == null) return [];
    const r = partsPerLoad({ partMm: sorted(bbox), windowMm: [L, W, H], spacingFactor: f, partKg: part.weightKg, weightLimitKg: num(m.specs.machine_weight_limit_kg) });
    return r.count > 0 ? [{ m, n: r.count, by: r.governedBy, f }] : [];
  });
  const fit = pickFit(base.process, fitted, ref);
  if (!fit) return notCosted(base, 'gap', 'No passivation tank window takes this part.');
  const loads = Math.ceil(batch / fit.n);
  const trace: SecondaryTraceStep[] = [
    { label: 'Treatment', value: chosen.treatment, source: `${SRC_LOOKUP('passivationTreatments')} (cut code ${part.materialCutCode}, ${part.isMachined ? 'machined' : 'not machined'}; shortest listed)` },
    { label: 'Immersion time', value: chosen.min, unit: 'min', source: SRC_LOOKUP('passivationTreatments') },
    { label: 'Parts per tank load', value: fit.n, source: `tank ${fit.m.name}, spacing factor ${fit.f}, limited by ${fit.by}` },
    { label: 'Tank loads', value: loads, source: `ceil(${batch} / ${fit.n})` },
  ];
  const warnings = others.length > 0 ? [`Other listed treatment(s): ${others.map((o) => `${o.treatment} (${o.min} min)`).join('; ')}.`] : [];
  return costed(base, fit.m, { perPartSec: (loads * chosen.min * 60) / batch, trace, warnings, highlight: 'whole_part' }, ref, batch);
}

/**
 * The anodizing type a callout names, in the reference line naming ("Type I",
 * "Type IB", "Type IC", "Type II", "Type III"): "Anodize Type II", "type 3",
 * "TYPE IC". null = the callout names no type.
 */
export function anodizeTypeFromCallout(callout: string | null | undefined): string | null {
  const key = /\btype\s*(iii|ii|ib|ic|i|3|2|1)\b/i.exec(callout ?? '')?.[1];
  if (!key) return null;
  const arabic: Record<string, string> = { '1': 'I', '2': 'II', '3': 'III' };
  return `Type ${arabic[key] ?? key.toUpperCase()}`;
}

/**
 * A loadbar line (Anodize, Wet Coat Line): one loaded bar leaves the line
 * every Load Window Time (user decision 2026-10-09), so a part takes the
 * window divided by the parts on its loadbar. null = the part does not fit.
 */
function loadbarFit(part: SecondaryPartFacts, m: SecondaryMachine, areaLimit: boolean) {
  const L = num(m.specs.loadbar_window_length_mm);
  const H = num(m.specs.loadbar_window_height_mm);
  const f = num(m.specs.loadbar_spacing_factor);
  const windowHr = num(m.specs.load_window_time_hr);
  if (L == null || H == null || f == null || windowHr == null || windowHr <= 0 || !part.bboxMm) return null;
  const r = partsPerLoad({
    partMm: sorted(part.bboxMm),
    windowMm: [L, H, num(m.specs.loadbar_window_width_mm)],
    spacingFactor: f,
    partKg: part.weightKg,
    weightLimitKg: num(m.specs.loadbar_weight_limit_kg),
    partAreaM2: part.surfaceAreaMm2 != null ? part.surfaceAreaMm2 / 1e6 : null,
    areaLimitM2: areaLimit ? num(m.specs.loadbar_max_load_surface_area_m2) : null,
  });
  return r.count > 0 ? { m, n: r.count, by: r.governedBy, f, windowHr } : null;
}

/** The machines of a pool that take the part on their loadbar, with the fit. */
const loadbarFits = (part: SecondaryPartFacts, pool: SecondaryMachine[], areaLimit: boolean) =>
  pool.flatMap((m) => loadbarFit(part, m, areaLimit) ?? []);

function anodize(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const type = anodizeTypeFromCallout(part.surfaceCallout);
  if (!type) return notCosted(base, 'gap', 'The anodizing type (Type I, IB, IC, II or III) is needed from the drawing surface callout: each line runs one type.');
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed to load the loadbar.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed (each loadbar has a maximum load surface area).');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed for the minimum batch cost.');
  const ofType = pool.filter((m) => m.specs.anodizing_type === type);
  if (ofType.length === 0) return notCosted(base, 'gap', `No ${type} anodizing line on file for this location.`);
  const fit = pickFit(base.process, loadbarFits(part, ofType, true), ref);
  if (!fit) return notCosted(base, 'gap', `No ${type} anodizing loadbar takes this part.`);
  const r = costed(base, fit.m, {
    perPartSec: (fit.windowHr * 3600) / fit.n,
    trace: [
      { label: 'Anodizing type', value: type, source: 'drawing surface callout' },
      { label: 'Load window time', value: fit.windowHr, unit: 'hr', source: `line ${fit.m.name} (one loadbar per window)` },
      { label: 'Parts per loadbar', value: fit.n, source: `loadbar window, spacing factor ${fit.f}, limited by ${fit.by}` },
    ],
    highlight: 'whole_part',
  }, ref, batch);
  // The line charge for a batch never falls below the line minimum batch cost.
  const minBatch = num(fit.m.specs.min_batch_cost_usd);
  if (r.costPerPartUsd != null && minBatch != null && r.costPerPartUsd * batch < minBatch) {
    r.trace.push({ label: 'Minimum batch cost', value: minBatch, unit: 'USD', source: `line ${fit.m.name}: batch below the minimum, charged at it` });
    r.costPerPartUsd = Number((minBatch / batch).toFixed(4));
  }
  return r;
}

function wetCoatLine(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed to load the loadbar.');
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed for the paint used.');
  const fit = pickFit(base.process, loadbarFits(part, pool, false), ref);
  if (!fit) return notCosted(base, 'gap', 'No wet coat loadbar takes this part.');
  const coverage = num(fit.m.specs.paint_coverage_m2_per_l);
  const paintUsdPerL = num(fit.m.specs.paint_unit_cost_usd_per_l);
  if (coverage == null || coverage <= 0 || paintUsdPerL == null) return notCosted(base, 'gap', `Line ${fit.m.name} has no paint coverage or paint cost on file.`);
  const areaM2 = part.surfaceAreaMm2 / 1e6;
  const paintUsd = (areaM2 / coverage) * paintUsdPerL;
  return costed(base, fit.m, {
    perPartSec: (fit.windowHr * 3600) / fit.n,
    materialUsdPerPart: Number(paintUsd.toFixed(4)),
    trace: [
      { label: 'Load window time', value: fit.windowHr, unit: 'hr', source: `line ${fit.m.name} (one loadbar per window)` },
      { label: 'Parts per loadbar', value: fit.n, source: `loadbar window, spacing factor ${fit.f}, limited by ${fit.by}` },
      { label: 'Paint', value: Number(paintUsd.toFixed(4)), unit: 'USD', source: `CAD area ${areaM2.toFixed(4)} m² / ${coverage} m²/L × ${paintUsdPerL} USD/L (line ${fit.m.name})` },
    ],
    warnings: ['Primer is not costed: the reference has a primer price but no rule for when primer is applied.'],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}


// ── provisional models ──────────────────────────────────────────────────────
// The reference defines the machines and some stage times of these processes but not
// the rule that turns them into a time per part. Each model below combines what the
// reference does define with a stated rule or a published figure
// (provisional-reference.ts); the line is flagged `provisional`, never presented as reference data.

/** Parts of one batch load: loads needed, and the machine seconds per part they spend. */
const perPartFromLoads = (loadSec: number, perLoad: number, batch: number) => (Math.ceil(batch / perLoad) * loadSec) / batch;

/** An empty pool means no machine of the class has a complete rate on file (a machine missing its labour rate, crew or setup is left out when machines are loaded), not that the part does not fit one. */
const noMachineRate = (what: string) =>
  `No ${what} machine with a complete rate is on file for this location (a machine row missing its labour rate, wage grade, crew or setup time is not costed); add the missing value to the machine file in memory/SurfaceTreatment/Machine.`;

function ovenCure(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const bbox = part.bboxMm;
  if (!bbox) return notCosted(base, 'gap', 'Part size is needed to load the oven.');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed to count oven loads.');
  const f = variable(ref, 'powderCoatCartSpacingFactor');
  if (f == null) return notCosted(base, 'gap', 'powderCoatCartSpacingFactor is not staged: run migration 819.');
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('cure oven'));
  const fitted = pool.flatMap((m) => {
    const L = num(m.specs.oven_length_mm), W = num(m.specs.oven_width_mm), H = num(m.specs.oven_height_mm);
    if (L == null || W == null || H == null) return [];
    const r = partsPerLoad({ partMm: sorted(bbox), windowMm: [L, W, H], spacingFactor: f });
    return r.count > 0 ? [{ m, n: r.count }] : [];
  });
  const fit = pickFit(base.process, fitted, ref);
  if (!fit) return notCosted(base, 'gap', 'No cure oven takes this part.');
  const dwell = PROVISIONAL.powderCureDwellMin;
  return costed(base, fit.m, {
    perPartSec: perPartFromLoads(dwell.value * 60, fit.n, batch),
    trace: [
      provisionalTrace('Cure dwell per load', dwell),
      { label: 'Parts per oven load', value: fit.n, source: `oven ${fit.m.name}, spacing factor ${f} (powderCoatCartSpacingFactor)` },
      { label: 'Oven loads', value: Math.ceil(batch / fit.n), source: `ceil(${batch} / ${fit.n})` },
    ],
    warnings: [provisionalWarning('the cure dwell per oven load', dwell), 'Oven heat-up and cool-down are not in the reference and are not priced.'],
    highlight: 'whole_part',
    provisional: true,
  }, ref, batch);
}

function conveyorOvenCure(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const trace: SecondaryTraceStep[] = [];
  const pitch = conveyorPitch(part, ref, trace);
  if (typeof pitch === 'string') return notCosted(base, 'gap', pitch);
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('conveyor cure oven'));
  const [, W, H] = sorted(part.bboxMm!);
  const m = pickMachine(base.process, pool.filter((x) => {
    const w = num(x.specs.opening_width_mm), h = num(x.specs.max_nesting_height_mm), len = num(x.specs.oven_length_mm);
    return len != null && (w == null || W <= w) && (h == null || H <= h);
  }), ref);
  if (!m) return notCosted(base, 'gap', 'No conveyor oven opening takes this part.');
  const ovenLen = num(m.specs.oven_length_mm)!;
  const dwell = PROVISIONAL.powderCureDwellMin;
  const speed = ovenLen / (dwell.value * 60); // the part must spend the dwell inside the oven
  trace.push(provisionalTrace('Cure dwell', dwell));
  trace.push({ label: 'Line speed', value: Number(speed.toFixed(3)), unit: 'mm/s', source: `oven length ${ovenLen} mm / dwell ${dwell.value} min (machine ${m.name})` });
  return costed(base, m, {
    perPartSec: pitch / speed, trace,
    warnings: [provisionalWarning('the cure dwell in the conveyor oven', dwell)],
    highlight: 'whole_part', provisional: true,
  }, ref, part.batchSize);
}

function blackOxide(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const bbox = part.bboxMm;
  if (!bbox) return notCosted(base, 'gap', 'Part size is needed to load the bath.');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed to count bath loads.');
  const clean = variable(ref, 'defaultBlackOxidePartCleanTime'), pre = variable(ref, 'defaultPreBlackOxideRinse');
  const post = variable(ref, 'defaultPostBlackOxideRinseTime'), supp = variable(ref, 'defaultBlackOxideSupplementaryFinishTime');
  const stages = variable(ref, 'defaultNumberOfBlackOxideStages'), gap = variable(ref, 'defaultBlackOxidePartSpacing');
  if ([clean, pre, post, supp, stages, gap].some((v) => v == null)) return notCosted(base, 'gap', 'The black oxide stage variables are not staged: run migration 819.');
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('black oxide'));
  const fitted = pool.flatMap((m) => {
    const L = num(m.specs.bath_length_mm), W = num(m.specs.bath_width_mm), H = num(m.specs.bath_height_mm);
    if (L == null || W == null || H == null) return [];
    // the reference spacing is a length added to each side of the part
    const r = partsPerLoad({ partMm: sorted(bbox).map((d) => d + gap!) as [number, number, number], windowMm: [L, W, H], spacingFactor: 0, partKg: part.weightKg, weightLimitKg: num(m.specs.max_allowable_weight_kg) });
    return r.count > 0 ? [{ m, n: r.count, by: r.governedBy }] : [];
  });
  const fit = pickFit(base.process, fitted, ref);
  if (!fit) return notCosted(base, 'gap', 'No black oxide bath takes this part.');
  const transfer = num(fit.m.specs.transfer_time_s) ?? 0;
  const immersion = PROVISIONAL.blackOxideImmersionMin;
  const loadSec = clean! + pre! + immersion.value * 60 + post! + supp! + transfer * stages!;
  return costed(base, fit.m, {
    perPartSec: perPartFromLoads(loadSec, fit.n, batch),
    trace: [
      { label: 'Clean, rinse and finish', value: clean! + pre! + post! + supp!, unit: 's', source: `${SRC_VAR} (clean ${clean}, pre-rinse ${pre}, post-rinse ${post}, supplementary finish ${supp})` },
      provisionalTrace('Blackening immersion', immersion),
      { label: 'Transfers', value: transfer * stages!, unit: 's', source: `${stages} stages × ${transfer} s (machine ${fit.m.name})` },
      { label: 'Parts per bath load', value: fit.n, source: `bath ${fit.m.name}, ${gap} mm spacing, limited by ${fit.by}` },
      { label: 'Bath loads', value: Math.ceil(batch / fit.n), source: `ceil(${batch} / ${fit.n})` },
    ],
    warnings: [provisionalWarning('the blackening immersion', immersion), 'Black oxide is a steel (and cast iron) finish: the material is not checked here.'],
    highlight: 'whole_part', provisional: true,
  }, ref, batch);
}

function vibratoryFinishing(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const bbox = part.bboxMm;
  if (!bbox) return notCosted(base, 'gap', 'Part size is needed to fill the container.');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed to count container loads.');
  const ratio = variable(ref, 'defaultVibratoryFinishingMediaRatio'), fill = variable(ref, 'vibratoryFinishingContainerFillPercent');
  if (ratio == null || fill == null) return notCosted(base, 'gap', 'The vibratory finishing media ratio and fill are not staged: run migration 819.');
  // The CAD facts carry no solid volume: the bounding box stands in for it, which can only
  // overstate the space a part takes (fewer parts per load, a higher price).
  const partVol = bbox.length * bbox.width * bbox.height;
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('vibratory finishing'));
  const fitted = pool.flatMap((m) => {
    const vol = num(m.specs.container_volume_mm3);
    if (vol == null || vol <= 0) return [];
    let n = Math.floor((vol * fill / 100) / (partVol * (1 + ratio)));
    const limit = num(m.specs.weight_limit_kg);
    if (limit != null && part.weightKg != null && part.weightKg > 0) n = Math.min(n, Math.floor(limit / part.weightKg));
    return n > 0 ? [{ m, n }] : [];
  });
  const fit = pickFit(base.process, fitted, ref);
  if (!fit) return notCosted(base, 'gap', 'No vibratory container takes this part.');
  const cycle = PROVISIONAL.vibratoryFinishingCycleMin;
  return costed(base, fit.m, {
    perPartSec: perPartFromLoads(cycle.value * 60, fit.n, batch),
    trace: [
      provisionalTrace('Finishing cycle per load', cycle),
      { label: 'Parts per container load', value: fit.n, source: `container ${fit.m.name}, ${fill}% fill, media ${ratio}:1 by volume, part volume = bounding box` },
      { label: 'Container loads', value: Math.ceil(batch / fit.n), source: `ceil(${batch} / ${fit.n})` },
    ],
    warnings: [provisionalWarning('the finishing cycle', cycle), 'Part volume is the bounding box (no solid volume in the CAD facts): the parts per load are understated for a compact part.'],
    highlight: 'whole_part', provisional: true,
  }, ref, batch);
}

function shotBlast(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const bbox = part.bboxMm;
  if (!bbox) return notCosted(base, 'gap', 'Part size is needed to hang the part.');
  const batch = part.batchSize;
  if (batch == null || batch <= 0) return notCosted(base, 'gap', 'Batch size is needed to count blast loads.');
  const cycles = variable(ref, 'shotBlastNumberOfBlastCyclesPartsOnHanger');
  if (cycles == null) return notCosted(base, 'gap', 'shotBlastNumberOfBlastCyclesPartsOnHanger is not staged: run migration 819.');
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('shot blast'));
  const fitted = pool.flatMap((m) => {
    const L = num(m.specs.chamber_length_mm), W = num(m.specs.chamber_width_mm), H = num(m.specs.chamber_height_mm);
    const cycle = num(m.specs.blast_cycle_time_s), hangers = num(m.specs.number_hanger_positions);
    if (L == null || W == null || H == null || cycle == null || hangers == null) return [];
    let n = Math.min(hangers, maxPartsInBox(sorted(bbox), [L, W, H].sort((a, b) => b - a) as [number, number, number]));
    const cap = num(m.specs.weight_capacity_kg);
    if (cap != null && part.weightKg != null && part.weightKg > 0) n = Math.min(n, Math.floor(cap / part.weightKg));
    return n > 0 ? [{ m, n, cycle }] : [];
  });
  const fit = pickFit(base.process, fitted, ref);
  if (!fit) return notCosted(base, 'gap', 'No shot blast chamber takes this part.');
  return costed(base, fit.m, {
    perPartSec: perPartFromLoads(fit.cycle * cycles, fit.n, batch),
    trace: [
      { label: 'Blast cycle', value: fit.cycle, unit: 's', source: `machine ${fit.m.name} (blast_cycle_time_s) × ${cycles} cycle(s) on a hanger (shotBlastNumberOfBlastCyclesPartsOnHanger)` },
      { label: 'Parts per hanger load', value: fit.n, source: `min(hanger positions, chamber fit, weight capacity) on ${fit.m.name}` },
      { label: 'Blast loads', value: Math.ceil(batch / fit.n), source: `ceil(${batch} / ${fit.n})` },
    ],
    warnings: ['Provisional: the machine\'s per-area and per-perimeter blast allowances are not applied (the reference does not say how they combine with the blast cycle); the price is the cycle time per hanger load.'],
    highlight: 'whole_part', provisional: true,
  }, ref, batch);
}

function degrease(base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const trace: SecondaryTraceStep[] = [];
  const pitch = conveyorPitch(part, ref, trace);
  if (typeof pitch === 'string') return notCosted(base, 'gap', pitch);
  if (pool.length === 0) return notCosted(base, 'gap', noMachineRate('parts washer'));
  const [, W, H] = sorted(part.bboxMm!);
  const m = pickMachine(base.process, pool.filter((x) => {
    const w = num(x.specs.conveyor_window_width_mm), h = num(x.specs.conveyor_window_height_mm), v = num(x.specs.conveyor_speed_limit_mm_per_s);
    const kg = num(x.specs.conveyor_weight_limit_kg);
    return v != null && v > 0 && (w == null || W <= w) && (h == null || H <= h) && (kg == null || part.weightKg == null || part.weightKg <= kg);
  }), ref);
  if (!m) return notCosted(base, 'gap', 'No parts washer opening takes this part.');
  const speed = num(m.specs.conveyor_speed_limit_mm_per_s)!;
  trace.push({ label: 'Line speed', value: speed, unit: 'mm/s', source: `machine ${m.name} (conveyor_speed_limit_mm_per_s, the washer's maximum)` });
  return costed(base, m, {
    perPartSec: pitch / speed, trace,
    warnings: ['Provisional: the washer\'s conveyor speed limit is taken as its line speed and the part pitch is the same conveyor rule as the other conveyor lines; the reference gives no wash-time rule. A slower line, for a heavily soiled part, costs more.'],
    highlight: 'whole_part', provisional: true,
  }, ref, part.batchSize);
}

/** Why each remaining process cannot be timed from the reference data. */
const UNDEFINED: Record<string, string> = {
  'Conveyor Conversion Coating': 'The reference has no machine file for this process.',
  'Conveyor Powder Coating': 'No line speed or spray time for the conveyor booth is in the reference data.',
  'Mask-Bench': 'Which features are masked is a drawing requirement, not a CAD fact.',
  'Mask-Spray': 'Which surfaces are masked is a drawing requirement, not a CAD fact.',
  'Powder Coat Cart': 'The coating thickness and spray time rule are not in the reference data (only flow rates and handling times are).',
  'Screen Printing': 'The printed area is a drawing requirement, not a CAD fact.',
};

type Model = (base: Base, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]) => SecondaryProcessResult;

/** Every process the reference data defines a time or price for. */
const MODELS: Record<string, Model> = {
  ...Object.fromEntries([...PLATING].map((p) => [p, plating])),
  'Painting': painting,
  'Dot Peen': dotPeen,
  'Laser Engraving': laserEngraving,
  'Manual Paint': manualPaint,
  'Shot Peen': shotPeen,
  'Conveyor Shot Blast': conveyorShotBlast,
  'Conveyor Dry': conveyorDry,
  'Conveyor Abrasive Finishing': conveyorAbrasiveFinishing,
  'Conveyor Part Loading': handling,
  'Conveyor Part Unloading': handling,
  'Bead Blast': blastByWeight,
  'Sand Blast': blastByWeight,
  'Passivation': passivation,
  'Anodize': anodize,
  'Wet Coat Line': wetCoatLine,
  'Oven Cure': ovenCure,
  'Conveyor Oven Cure': conveyorOvenCure,
  'Black Oxide': blackOxide,
  'Vibratory Finishing': vibratoryFinishing,
  'Shot Blast': shotBlast,
  'Degrease': degrease,
};

/** The processes this engine can cost. The process catalog marks exactly these
 *  production and the rest not_modeled (migration 821 is checked against it). */
export const SURFACE_MODELED_PROCESSES: ReadonlySet<string> = new Set(Object.keys(MODELS));

export function computeSurfaceTreatments(
  part: SecondaryPartFacts,
  ref: SecondaryReference,
  machines: ReadonlyArray<SecondaryMachine>,
): SecondaryProcessResult[] {
  const poolOf = (cls: string) => machines.filter((m) => m.machineClass === cls);
  return SURFACE_PROCESSES.map((base) => {
    const model = MODELS[base.process];
    return model
      ? model(base, part, ref, poolOf(base.machineClass))
      : notCosted(base, 'gap', UNDEFINED[base.process] ?? 'No reference time or price rule for this process.');
  });
}

/** Words a callout often leaves out ("Hard Chrome" for Hard Chrome Plating). */
const OPTIONAL_WORDS = new Set(['plating', 'coating', 'finishing']);
const stem = (w: string) => w.slice(0, 4);

/**
 * The reference surface-treatment process a drawing callout names, or null.
 * Every non-optional word of the process name must appear in the callout (as
 * a 4-letter stem, so "Zinc plated" names Zinc Plating and "Passivate" names
 * Passivation); the most specific match wins ("Zinc Nickel Plating" over
 * "Nickel Plating"). No match is null, never a nearest guess.
 */
export function matchSurfaceTreatmentCallout(callout: string | null | undefined): string | null {
  const text = (callout ?? '').toLowerCase();
  if (!text.trim() || /^(none|n\/a|na|nil|no|-|as.?required)$/i.test(text.trim())) return null;
  const calloutStems = new Set(text.split(/[^a-z]+/).filter((w) => w.length >= 3).map(stem));
  let best: { process: string; words: number } | null = null;
  for (const { process } of SURFACE_PROCESSES) {
    const words = process.toLowerCase().split(/[^a-z]+/).filter(Boolean).filter((w) => !OPTIONAL_WORDS.has(w));
    if (words.length === 0 || !words.every((w) => calloutStems.has(stem(w)))) continue;
    if (!best || words.length > best.words) best = { process, words: words.length };
  }
  return best?.process ?? null;
}
