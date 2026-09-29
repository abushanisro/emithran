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
// A process whose reference data does not define its time or price (for
// example Anodize: stage times are on file but the anodizing duration itself
// is not) is a disclosed 'gap' naming what is missing, never an estimate.

import {
  costed, notCosted, pickMachine, variable, num, sorted, envelopeCapable,
  type SecondaryMachine, type SecondaryPartFacts, type SecondaryProcessResult, type SecondaryReference, type SecondaryTraceStep,
} from '../secondary/secondary-process-engine';
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

/** Why each remaining process cannot be timed from the reference data. */
const UNDEFINED: Record<string, string> = {
  'Anodize': 'Stage times (clean, etch, rinse, seal) are on the machines, but the anodizing duration itself (from coating thickness and current) has no reference rule.',
  'Black Oxide': 'The blackening immersion time is not in the reference data (only rinse, clean and transfer times are).',
  'Conveyor Conversion Coating': 'The reference has no machine file for this process.',
  'Conveyor Oven Cure': 'No cure time or line speed for the conveyor oven is in the reference data.',
  'Conveyor Powder Coating': 'No line speed or spray time for the conveyor booth is in the reference data.',
  'Degrease': 'The conveyor pitch rule for the washer is not in the reference data (only handling time by weight and tank capacity are).',
  'Mask-Bench': 'Which features are masked is a drawing requirement, not a CAD fact.',
  'Mask-Spray': 'Which surfaces are masked is a drawing requirement, not a CAD fact.',
  'Oven Cure': 'No cure time is in the reference data.',
  'Passivation': 'The parts-per-load rule for the passivation tank is not in the reference data (immersion times are, per cut code).',
  'Powder Coat Cart': 'The coating thickness and spray time rule are not in the reference data (only flow rates and handling times are).',
  'Screen Printing': 'The printed area is a drawing requirement, not a CAD fact.',
  'Shot Blast': 'Parts per hanger and the part perimeter are needed; neither is in the reference or the CAD data.',
  'Vibratory Finishing': 'No tumbling time is in the reference data (media compatibility and container sizes are).',
  'Wet Coat Line': 'The parts-per-loadbar rule is not in the reference data (coverage and paint cost are).',
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
