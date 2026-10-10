// Secondary processes (inspection, NDT, cleaning, packaging), costed only from
// the reference data in memory/Secondary process/ and the part's own CAD facts.
//
// Staged by migration 817 (machining_reference_data, source_version
// '2026-Secondary': variables, lookup tables, processes) and 818 (mhr_records:
// every machine, with its rates, operators, setup, yield, envelope and the
// process-specific rate/speed columns in `specs`).
//
// Each process answers three questions from real inputs only:
//   applicable?  e.g. magnetic particle testing needs a ferromagnetic material
//                (ferromagneticMaterials: cut-code families), a machine whose
//                envelope takes the part, a CMM feature with a probe-touch count.
//   how long?    the reference formula for that process (see each model below).
//   which part?  the feature ids (CMM) or the whole part (surface processes),
//                so the UI can highlight what the process acts on.
// When a needed input does not exist the result is a 'gap' naming it, never a
// substituted value. CT Scan and Xray Inspection have machines and rates but
// no cycle-time data in the reference, so they are always a disclosed gap.

export const SECONDARY_SOURCE_VERSION = '2026-Secondary';

type SecondaryStatus = 'costed' | 'not_applicable' | 'gap';

export interface SecondaryTraceStep {
  label: string;
  value: string | number;
  unit?: string;
  source: string;
}

export interface SecondaryMachine {
  id: string;
  name: string;
  machineClass: string;
  mhrUsd: number;          // direct + indirect overhead, USD/hr
  lhrUsd: number;          // labour, USD/hr
  operators: number;
  laborTimeStandard: number;
  setupHr: number;
  goodPartYield: number;   // fraction, 1 = no loss
  maxXmm: number | null;
  maxYmm: number | null;
  maxZmm: number | null;
  maxLengthMm: number | null;
  maxWorkpieceKg: number | null;
  specs: Record<string, unknown>;
}

interface SecondaryFeature {
  id: string;
  feature_type: string;
  occurrences: ReadonlyArray<unknown>;
  derived?: boolean;
}

export interface SecondaryPartFacts {
  bboxMm: { length: number; width: number; height: number } | null;
  surfaceAreaMm2: number | null;
  weightKg: number | null;
  /** Measured wall: IM nominal wall or sheet thickness. null for solids. */
  wallThicknessMm: number | null;
  /** raw_materials.cut_code of the part's material, when resolved. */
  materialCutCode: number | null;
  /** raw_materials.material_group (e.g. "Aluminum Alloy"), when resolved. */
  materialTypeName?: string | null;
  /** The part is machined (CAD family milled / turned / mill_turn): picks the passivation treatment row. */
  isMachined?: boolean | null;
  /** The drawing surface-treatment callout text (e.g. "Anodize Type II"), when stated. */
  surfaceCallout?: string | null;
  features: ReadonlyArray<SecondaryFeature>;
  batchSize: number | null;
}

export interface SecondaryReference {
  variables: ReadonlyMap<string, string>;
  lookups: ReadonlyMap<string, ReadonlyArray<Record<string, unknown>>>;
  /** processes.csv: process name -> default machine name. */
  defaultMachine: ReadonlyMap<string, string>;
}

export interface SecondaryProcessResult {
  process: string;
  machineClass: string;
  status: SecondaryStatus;
  reason: string;
  machine: Pick<SecondaryMachine, 'id' | 'name' | 'mhrUsd' | 'lhrUsd' | 'operators' | 'setupHr' | 'goodPartYield'> | null;
  /** Machine seconds per good part (after yield), incl. sampling share. */
  cycleTimeSec: number | null;
  /** Once-per-batch minutes: machine setup + any programming. */
  setupMin: number | null;
  /** Materials consumed per part (cartons), USD. */
  materialUsdPerPart: number;
  costPerPartUsd: number | null;
  /** What the process acts on, for highlighting. */
  highlight: 'features' | 'whole_part' | 'none';
  featureIds: string[];
  trace: SecondaryTraceStep[];
  warnings: string[];
}

export const SECONDARY_PROCESSES: ReadonlyArray<{ process: string; machineClass: string }> = [
  { process: 'CMM Inspection', machineClass: 'cmm' },
  { process: 'Ultrasonic Cleaning', machineClass: 'ultrasonic_cleaning' },
  { process: 'Magnetic Particle Testing', machineClass: 'magnetic_particle_testing' },
  { process: 'Fluorescent Penetrant Testing', machineClass: 'fluorescent_penetrant_testing' },
  { process: 'Hydrostatic Leak Testing', machineClass: 'hydrostatic_leak_testing' },
  { process: 'Ultrasonic A-Scan', machineClass: 'ultrasonic_a_scan' },
  { process: 'Ultrasonic C-Scan', machineClass: 'ultrasonic_c_scan' },
  { process: 'CT Scan', machineClass: 'ct_scan' },
  { process: 'Xray Inspection', machineClass: 'xray_inspection' },
  { process: 'Carton Forming', machineClass: 'carton_forming' },
  { process: 'Carton Sealing', machineClass: 'carton_sealing' },
  { process: 'Pack & Load', machineClass: 'pack_and_load' },
];

const SRC_VAR = 'memory/Secondary process/variables_inherited.csv';
const SRC_LOOKUP = (t: string) => `memory/Secondary process/lookup/${t}.csv`;

// ── small helpers ────────────────────────────────────────────────────────────

export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function variable(ref: SecondaryReference, key: string): number | null {
  return num(ref.variables.get(key));
}

export const sorted = (d: { length: number; width: number; height: number }) =>
  [d.length, d.width, d.height].sort((a, b) => b - a) as [number, number, number];

/** Does a box of dims `part` fit in `space` in some axis-aligned orientation? */
function fits(part: [number, number, number], space: [number | null, number | null, number | null]): boolean {
  const s = space.filter((v): v is number => v != null && v > 0).sort((a, b) => b - a);
  if (s.length === 0) return true; // machine has no envelope on file: not gated
  return s.every((v, i) => part[i]! <= v);
}

/** Most whole parts of dims `p` in box `b`, over the 6 axis-aligned orientations. */
export function maxPartsInBox(p: [number, number, number], b: [number, number, number]): number {
  const perms: Array<[number, number, number]> = [
    [p[0], p[1], p[2]], [p[0], p[2], p[1]], [p[1], p[0], p[2]],
    [p[1], p[2], p[0]], [p[2], p[0], p[1]], [p[2], p[1], p[0]],
  ];
  let best = 0;
  for (const q of perms) {
    const n = Math.floor(b[0] / q[0]) * Math.floor(b[1] / q[1]) * Math.floor(b[2] / q[2]);
    if (n > best) best = n;
  }
  return best;
}

/**
 * Parts that fit one load (a tank window, a loadbar) of a batch line.
 *
 * Each part takes its own size plus spacing = spacingFactor x that size on
 * every axis (the reference meaning of a spacing factor, e.g.
 * powderCoatCartSpacingFactor: "factor applied to the width of the part to
 * calculate the minimum spacing between parts"). A window with no depth on
 * file (a loadbar) hangs one layer: its depth is the part's own thinnest size.
 * The weight limit and the surface-area limit, when on file, cap the count;
 * `governedBy` says which limit set it. 0 = the part does not fit.
 */
export function partsPerLoad(input: {
  partMm: [number, number, number];
  windowMm: [number, number, number | null];
  spacingFactor: number;
  partKg?: number | null;
  weightLimitKg?: number | null;
  partAreaM2?: number | null;
  areaLimitM2?: number | null;
}): { count: number; governedBy: 'window' | 'weight' | 'surface area' } {
  const f = 1 + input.spacingFactor;
  const part = input.partMm.map((d) => d * f) as [number, number, number];
  const depth = input.windowMm[2] ?? Math.min(...part);
  const box = [input.windowMm[0], input.windowMm[1], depth].sort((a, b) => b - a) as [number, number, number];
  let count = maxPartsInBox([...part].sort((a, b) => b - a) as [number, number, number], box);
  let governedBy: 'window' | 'weight' | 'surface area' = 'window';
  if (input.weightLimitKg != null && input.weightLimitKg > 0 && input.partKg != null && input.partKg > 0) {
    const byWeight = Math.floor(input.weightLimitKg / input.partKg);
    if (byWeight < count) { count = byWeight; governedBy = 'weight'; }
  }
  if (input.areaLimitM2 != null && input.areaLimitM2 > 0 && input.partAreaM2 != null && input.partAreaM2 > 0) {
    const byArea = Math.floor(input.areaLimitM2 / input.partAreaM2);
    if (byArea < count) { count = byArea; governedBy = 'surface area'; }
  }
  return { count: Math.max(0, count), governedBy };
}

/** Hourly cost of running the machine with its crew. */
const hourlyUsd = (m: SecondaryMachine) => m.mhrUsd + m.lhrUsd * m.operators * m.laborTimeStandard;

export function pickMachine(
  process: string, candidates: SecondaryMachine[], ref: SecondaryReference,
): SecondaryMachine | null {
  if (candidates.length === 0) return null;
  // The reference names a default machine per process; it wins when capable.
  const dflt = ref.defaultMachine.get(process);
  const byDefault = dflt ? candidates.find((m) => m.name === dflt) : undefined;
  if (byDefault) return byDefault;
  return [...candidates].sort((a, b) => hourlyUsd(a) - hourlyUsd(b))[0]!;
}

// ── shared result assembly ───────────────────────────────────────────────────

export interface Timing {
  /** machine seconds per part, before yield */
  perPartSec: number;
  /** extra once-per-batch seconds beyond the machine setup (programming) */
  batchExtraSec?: number;
  materialUsdPerPart?: number;
  trace: SecondaryTraceStep[];
  warnings?: string[];
  highlight: SecondaryProcessResult['highlight'];
  featureIds?: string[];
}

export function costed(
  base: { process: string; machineClass: string },
  m: SecondaryMachine,
  t: Timing,
  ref: SecondaryReference,
  batchSize: number | null,
): SecondaryProcessResult {
  const trace = [...t.trace];
  const warnings = [...(t.warnings ?? [])];
  const efficiency = variable(ref, 'defaultMachineEfficiency');
  const ctAdj = variable(ref, 'cycleTimeAdjustmentFactor');
  const yieldFrac = m.goodPartYield > 0 && m.goodPartYield <= 1 ? m.goodPartYield : null;

  let sec = t.perPartSec;
  if (ctAdj != null) {
    sec *= ctAdj;
    trace.push({ label: 'Cycle time adjustment factor', value: ctAdj, source: SRC_VAR });
  }
  if (efficiency != null && efficiency > 0) {
    sec /= efficiency;
    trace.push({ label: 'Machine efficiency', value: efficiency, source: `${SRC_VAR} (defaultMachineEfficiency)` });
  }
  if (yieldFrac != null) {
    sec /= yieldFrac;
    trace.push({ label: 'Good part yield', value: yieldFrac, source: `machine ${m.name}` });
  } else {
    warnings.push(`${m.name} has no usable good-part yield on file; no yield loss applied.`);
  }

  const setupMin = m.setupHr * 60 + (t.batchExtraSec ?? 0) / 60;
  trace.push({ label: 'Machine setup', value: m.setupHr, unit: 'hr', source: `machine ${m.name}` });
  trace.push({ label: 'Machine + crew rate', value: Number(hourlyUsd(m).toFixed(4)), unit: 'USD/hr',
    source: `machine ${m.name}: MHR ${m.mhrUsd} + LHR ${m.lhrUsd} × ${m.operators} operator(s) × labour std ${m.laborTimeStandard}` });

  const materialUsd = t.materialUsdPerPart ?? 0;
  let costPerPartUsd: number | null = null;
  if (batchSize != null && batchSize > 0) {
    const runUsd = (sec / 3600) * hourlyUsd(m);
    const setupUsd = ((setupMin / 60) * hourlyUsd(m)) / batchSize;
    costPerPartUsd = runUsd + setupUsd + materialUsd;
  } else {
    warnings.push('No batch size: setup cannot be spread per part, so no per-part cost is given.');
  }

  return {
    ...base,
    status: 'costed',
    reason: 'Costed from the reference formula and the selected machine.',
    machine: { id: m.id, name: m.name, mhrUsd: m.mhrUsd, lhrUsd: m.lhrUsd, operators: m.operators, setupHr: m.setupHr, goodPartYield: m.goodPartYield },
    cycleTimeSec: Number(sec.toFixed(3)),
    setupMin: Number(setupMin.toFixed(3)),
    materialUsdPerPart: materialUsd,
    costPerPartUsd: costPerPartUsd != null ? Number(costPerPartUsd.toFixed(4)) : null,
    highlight: t.highlight,
    featureIds: t.featureIds ?? [],
    trace,
    warnings,
  };
}

export function notCosted(
  base: { process: string; machineClass: string },
  status: Exclude<SecondaryStatus, 'costed'>,
  reason: string,
  extra: Partial<Pick<SecondaryProcessResult, 'trace' | 'highlight' | 'featureIds' | 'warnings'>> = {},
): SecondaryProcessResult {
  return {
    ...base, status, reason, machine: null, cycleTimeSec: null, setupMin: null,
    materialUsdPerPart: 0, costPerPartUsd: null,
    highlight: extra.highlight ?? 'none', featureIds: extra.featureIds ?? [],
    trace: extra.trace ?? [], warnings: extra.warnings ?? [],
  };
}

/** Share of parts tested (defaultPercentToBeTested). */
function testedFraction(ref: SecondaryReference, trace: SecondaryTraceStep[]): number | null {
  const pct = variable(ref, 'defaultPercentToBeTested');
  if (pct == null) return null;
  trace.push({ label: 'Parts tested', value: pct, unit: '%', source: `${SRC_VAR} (defaultPercentToBeTested)` });
  return pct / 100;
}

// ── process models ───────────────────────────────────────────────────────────

/** Machines whose envelope and mass limit take the part. */
export function envelopeCapable(machines: SecondaryMachine[], part: SecondaryPartFacts): SecondaryMachine[] {
  if (!part.bboxMm) return machines;
  const dims = sorted(part.bboxMm);
  return machines.filter((m) =>
    fits(dims, [m.maxXmm, m.maxYmm, m.maxZmm]) &&
    (m.maxWorkpieceKg == null || part.weightKg == null || part.weightKg <= m.maxWorkpieceKg));
}

/** Probe-touch table feature name -> catalog feature type ("Simple Hole" -> "SimpleHole", "Pocket" -> "PocketV2"). */
function touchesByFeatureType(rows: ReadonlyArray<Record<string, unknown>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const name = String(r['Feature'] ?? '').replace(/\s+/g, '');
    const t = num(r['Touches']);
    if (name && t != null) out.set(name.toLowerCase(), t);
  }
  return out;
}

function cmm(base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const touchRows = ref.lookups.get('CMMInspectionProbeTouches');
  const sampleRows = ref.lookups.get('CMMInspection');
  const probeSec = variable(ref, 'defaultCMMProbeTime');
  const progSecPerTouch = variable(ref, 'CMMProgrammingTimePerTouch');
  const inspectionType = ref.variables.get('defaultCMMInspection');
  if (!touchRows || !sampleRows || probeSec == null || progSecPerTouch == null || !inspectionType) {
    return notCosted(base, 'gap', 'CMM reference data (probe touches, sample sizes, probe/programming time) is not staged: run migration 817.');
  }
  const touchTable = touchesByFeatureType(touchRows);
  const trace: SecondaryTraceStep[] = [];
  const featureIds: string[] = [];
  const unmeasured = new Set<string>();
  let touches = 0;
  for (const f of part.features) {
    // PocketV2 is the catalog name of the table's "Pocket".
    const key = String(f.feature_type).replace(/V\d+$/, '').toLowerCase();
    const perOcc = touchTable.get(key);
    if (perOcc == null) { unmeasured.add(String(f.feature_type)); continue; }
    const n = f.occurrences.length;
    touches += perOcc * n;
    featureIds.push(f.id);
    trace.push({ label: `${f.feature_type} ×${n}`, value: perOcc * n, unit: 'touches', source: `${SRC_LOOKUP('CMMInspectionProbeTouches')} (${perOcc}/feature)` });
  }
  const warnings = unmeasured.size > 0
    ? [`No probe-touch count in the reference for: ${[...unmeasured].join(', ')} (not measured).`] : [];
  if (touches === 0) {
    return notCosted(base, 'gap', 'No detected feature has a probe-touch count in the reference, so there is nothing to measure.', { warnings });
  }
  if (part.batchSize == null || part.batchSize <= 0) {
    return notCosted(base, 'gap', 'Batch size is needed to pick the AQL sample size (CMMInspection table).', { trace, warnings, highlight: 'features', featureIds });
  }
  const rows = sampleRows
    .filter((r) => r['Inspection Type'] === inspectionType)
    .map((r) => ({ batch: num(r['Batch Size']), sample: num(r['Sample Size']) }))
    .filter((r): r is { batch: number; sample: number } => r.batch != null && r.sample != null)
    .sort((a, b) => a.batch - b.batch);
  const row = rows.find((r) => part.batchSize! <= r.batch);
  if (!row) return notCosted(base, 'gap', `No ${inspectionType} sample-size row covers batch ${part.batchSize}.`, { trace, warnings });
  const sample = Math.min(row.sample, part.batchSize);
  const measureSec = touches * probeSec;
  trace.push({ label: 'Probe touches per part', value: touches, source: SRC_LOOKUP('CMMInspectionProbeTouches') });
  trace.push({ label: 'Probe time per touch', value: probeSec, unit: 's', source: `${SRC_VAR} (defaultCMMProbeTime)` });
  trace.push({ label: `Sample size (${inspectionType}, batch ≤ ${row.batch})`, value: sample, source: SRC_LOOKUP('CMMInspection') });
  trace.push({ label: 'Programming (once per batch)', value: touches * progSecPerTouch, unit: 's', source: `${SRC_VAR} (CMMProgrammingTimePerTouch ${progSecPerTouch} s/touch)` });

  const capable = envelopeCapable(pool, part);
  const m = pickMachine(base.process, capable, ref);
  if (!m) return notCosted(base, 'gap', pool.length === 0 ? 'No CMM machine on file for this location.' : 'No CMM bed takes this part (size or mass).', { trace, warnings, highlight: 'features', featureIds });
  return costed(base, m, {
    perPartSec: (measureSec * sample) / part.batchSize,
    batchExtraSec: touches * progSecPerTouch,
    trace, warnings, highlight: 'features', featureIds,
  }, ref, part.batchSize);
}

function ultrasonicCleaning(base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const runSec = variable(ref, 'ultrasonicCleaningTimePerRun');
  const rinseSec = variable(ref, 'ultrasonicCleaningRinseTimePerPart');
  const allowance = variable(ref, 'basketNestingAllowance');
  if (runSec == null || rinseSec == null || allowance == null) return notCosted(base, 'gap', 'Ultrasonic cleaning variables are not staged: run migration 817.');
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed to fill a cleaning basket.');
  if (part.batchSize == null || part.batchSize <= 0) return notCosted(base, 'gap', 'Batch size is needed to count cleaning runs.');
  const dims = sorted(part.bboxMm);
  // Parts per basket: the basket less the nesting allowance at each edge.
  const withFill = pool.map((m) => {
    const b = [m.maxXmm, m.maxYmm, m.maxZmm].map((v) => (v ?? 0) - 2 * allowance) as [number, number, number];
    return { m, perBasket: b.every((v) => v > 0) ? maxPartsInBox(dims, b) : 0 };
  }).filter((x) => x.perBasket > 0);
  const chosen = pickMachine(base.process, withFill.map((x) => x.m), ref);
  if (!chosen) return notCosted(base, 'gap', pool.length === 0 ? 'No ultrasonic cleaning machine on file for this location.' : 'The part does not fit any cleaning basket (after the nesting allowance).');
  const perBasket = withFill.find((x) => x.m === chosen)!.perBasket;
  const runs = Math.ceil(part.batchSize / perBasket);
  const trace: SecondaryTraceStep[] = [
    { label: 'Basket nesting allowance', value: allowance, unit: 'mm', source: `${SRC_VAR} (basketNestingAllowance)` },
    { label: 'Parts per basket', value: perBasket, source: `basket ${chosen.maxXmm}×${chosen.maxYmm}×${chosen.maxZmm} mm, part ${dims.join('×')} mm` },
    { label: 'Runs per batch', value: runs, source: `ceil(${part.batchSize} / ${perBasket})` },
    { label: 'Time per run', value: runSec, unit: 's', source: `${SRC_VAR} (ultrasonicCleaningTimePerRun)` },
    { label: 'Rinse per part', value: rinseSec, unit: 's', source: `${SRC_VAR} (ultrasonicCleaningRinseTimePerPart)` },
  ];
  return costed(base, chosen, { perPartSec: (runs * runSec) / part.batchSize + rinseSec, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

/** Surface-area driven inspection: MPT and FPI (visualInspectTimeStandard min/m²). */
function surfaceInspection(
  base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[], ferromagneticOnly: boolean,
): SecondaryProcessResult {
  const minPerM2 = variable(ref, 'visualInspectTimeStandard');
  if (minPerM2 == null) return notCosted(base, 'gap', 'visualInspectTimeStandard is not staged: run migration 817.');
  const trace: SecondaryTraceStep[] = [];
  if (ferromagneticOnly) {
    const fam = ref.lookups.get('ferromagneticMaterials');
    if (!fam) return notCosted(base, 'gap', 'ferromagneticMaterials is not staged: run migration 817.');
    if (part.materialCutCode == null) return notCosted(base, 'gap', 'The part material has no cut code on file, so ferromagnetism cannot be checked.');
    const family = Math.floor(part.materialCutCode);
    const families = new Set(fam.map((r) => num(r['Cut Code Family'])).filter((v): v is number => v != null));
    trace.push({ label: 'Material cut-code family', value: family, source: `raw_materials.cut_code ${part.materialCutCode}` });
    if (!families.has(family)) {
      return notCosted(base, 'not_applicable', `Cut-code family ${family} is not ferromagnetic (${SRC_LOOKUP('ferromagneticMaterials')}): magnetic particle testing cannot be used.`, { trace });
    }
  }
  if (part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part surface area is needed.', { trace });
  const tested = testedFraction(ref, trace);
  if (tested == null) return notCosted(base, 'gap', 'defaultPercentToBeTested is not staged.', { trace });
  const areaM2 = part.surfaceAreaMm2 / 1e6;
  trace.push({ label: 'Surface area', value: Number(areaM2.toFixed(5)), unit: 'm²', source: 'CAD surface area' });
  trace.push({ label: 'Inspection time standard', value: minPerM2, unit: 'min/m²', source: `${SRC_VAR} (visualInspectTimeStandard)` });
  const warnings = base.process === 'Fluorescent Penetrant Testing'
    ? ['Penetrant/developer dwell times are marked deprecated in the reference and are not added.'] : [];
  const m = pickMachine(base.process, envelopeCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', pool.length === 0 ? `No ${base.process} machine on file for this location.` : 'No machine takes this part.', { trace, warnings });
  return costed(base, m, { perPartSec: minPerM2 * 60 * areaM2 * tested, trace, warnings, highlight: 'whole_part' }, ref, part.batchSize);
}

function hydrostaticLeak(base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const rate = variable(ref, 'leakTestDwellRate');
  const minSec = variable(ref, 'leakTestMinDwellTime');
  const maxSec = variable(ref, 'leakTestMaxDwellTime');
  const minT = variable(ref, 'leakTestMinThickness');
  const maxT = variable(ref, 'leakTestMaxThickness');
  if ([rate, minSec, maxSec, minT, maxT].some((v) => v == null)) return notCosted(base, 'gap', 'Leak test variables are not staged: run migration 817.');
  if (part.wallThicknessMm == null || part.wallThicknessMm <= 0) {
    return notCosted(base, 'gap', 'Leak test dwell is set by wall thickness, and no wall thickness is measured for this part (solid parts have none).');
  }
  const t = part.wallThicknessMm;
  const dwell = t <= minT! ? minSec! : t >= maxT! ? maxSec! : rate! * t;
  const trace: SecondaryTraceStep[] = [
    { label: 'Wall thickness', value: t, unit: 'mm', source: 'CAD measured wall' },
    { label: 'Dwell', value: dwell, unit: 's', source: `${SRC_VAR}: ${rate} s/mm, ${minSec} s at ≤ ${minT} mm, ${maxSec} s at ≥ ${maxT} mm` },
  ];
  const tested = testedFraction(ref, trace);
  if (tested == null) return notCosted(base, 'gap', 'defaultPercentToBeTested is not staged.', { trace });
  const m = pickMachine(base.process, envelopeCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', `No ${base.process} machine on file for this location.`, { trace });
  return costed(base, m, { perPartSec: dwell * tested, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

function ultrasonicScan(base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const handling = ref.lookups.get('tblMaterialHandlingTimeUltrasonicScan');
  if (!handling) return notCosted(base, 'gap', 'tblMaterialHandlingTimeUltrasonicScan is not staged: run migration 817.');
  if (!part.bboxMm || part.surfaceAreaMm2 == null || part.surfaceAreaMm2 <= 0) return notCosted(base, 'gap', 'Part size and surface area are needed.');
  const [len, wid] = sorted(part.bboxMm);
  const handlingRow = handling
    .map((r) => ({ s: num(r['Handling Time (s)']), l: num(r['Part Length (mm)']), w: num(r['Part Width (mm)']) }))
    .filter((r): r is { s: number; l: number; w: number } => r.s != null && r.l != null && r.w != null)
    .sort((a, b) => a.s - b.s)
    .find((r) => len <= r.l && wid <= r.w);
  if (!handlingRow) return notCosted(base, 'gap', 'No handling-time row covers this part size.');
  const capable = envelopeCapable(pool, part).filter((m) => num(m.specs['surface_scan_rate_mm2_per_s']) != null);
  const m = pickMachine(base.process, capable, ref);
  if (!m) return notCosted(base, 'gap', pool.length === 0 ? `No ${base.process} machine on file for this location.` : 'No scanner takes this part or carries a scan rate.');
  const scanRate = num(m.specs['surface_scan_rate_mm2_per_s'])!;
  const trace: SecondaryTraceStep[] = [
    { label: 'Surface area', value: part.surfaceAreaMm2, unit: 'mm²', source: 'CAD surface area' },
    { label: 'Surface scan rate', value: scanRate, unit: 'mm²/s', source: `machine ${m.name}` },
    { label: 'Handling time', value: handlingRow.s, unit: 's', source: `${SRC_LOOKUP('tblMaterialHandlingTimeUltrasonicScan')} (≤ ${handlingRow.l} × ${handlingRow.w} mm)` },
  ];
  const tested = testedFraction(ref, trace);
  if (tested == null) return notCosted(base, 'gap', 'defaultPercentToBeTested is not staged.', { trace });
  return costed(base, m, { perPartSec: (part.surfaceAreaMm2 / scanRate + handlingRow.s) * tested, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

/** Smallest standard carton the part fits in, and how many parts fit it. */
function cartonFor(part: SecondaryPartFacts, ref: SecondaryReference, trace: SecondaryTraceStep[], warnings: string[]):
  { l: number; w: number; h: number; costUsd: number; perCarton: number } | string {
  const cartons = ref.lookups.get('cartonSizes');
  const maxKg = variable(ref, 'maxPackedUnitsWeightPerStandardCarton');
  if (!cartons || maxKg == null) return 'cartonSizes / maxPackedUnitsWeightPerStandardCarton are not staged: run migration 817.';
  if (!part.bboxMm) return 'Part size is needed to choose a carton.';
  const dims = sorted(part.bboxMm);
  const options = cartons
    .map((r) => ({ l: num(r['Carton Length (mm)']), w: num(r['Carton Width (mm)']), h: num(r['Carton Height (mm)']), costUsd: num(r['Carton Cost (USD)']) }))
    .filter((c): c is { l: number; w: number; h: number; costUsd: number } => c.l != null && c.w != null && c.h != null && c.costUsd != null)
    .filter((c) => maxPartsInBox(dims, [c.l, c.w, c.h].sort((a, b) => b - a) as [number, number, number]) > 0)
    .sort((a, b) => a.l * a.w * a.h - b.l * b.w * b.h);
  const c = options[0];
  if (!c) return 'The part is larger than every standard carton.';
  let perCarton = maxPartsInBox(dims, [c.l, c.w, c.h].sort((a, b) => b - a) as [number, number, number]);
  if (part.weightKg != null && part.weightKg > 0) {
    perCarton = Math.min(perCarton, Math.max(1, Math.floor(maxKg / part.weightKg)));
    trace.push({ label: 'Carton weight limit', value: maxKg, unit: 'kg', source: `${SRC_VAR} (maxPackedUnitsWeightPerStandardCarton)` });
  } else {
    warnings.push('Part weight not known yet (no material chosen): the carton weight limit is not applied.');
  }
  trace.push({ label: 'Carton', value: `${c.l}×${c.w}×${c.h} mm, $${c.costUsd}`, source: SRC_LOOKUP('cartonSizes') });
  trace.push({ label: 'Parts per carton', value: perCarton, source: `part ${dims.join('×')} mm` });
  return { ...c, perCarton };
}

function cartonProcess(
  base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[], rateKey: string, chargeCarton: boolean,
): SecondaryProcessResult {
  const trace: SecondaryTraceStep[] = [];
  const warnings: string[] = [];
  const carton = cartonFor(part, ref, trace, warnings);
  if (typeof carton === 'string') return notCosted(base, 'gap', carton, { trace, warnings });
  const [cl, cw] = [carton.l, carton.w, carton.h].sort((a, b) => b - a);
  const capable = pool.filter((m) => {
    const rate = num(m.specs[rateKey]);
    const ml = num(m.specs['max_carton_length_mm']);
    const mw = num(m.specs['max_carton_width_mm']);
    return rate != null && rate > 0 && (ml == null || ml >= cl!) && (mw == null || mw >= cw!);
  });
  const m = pickMachine(base.process, capable, ref);
  if (!m) return notCosted(base, 'gap', pool.length === 0 ? `No ${base.process} machine on file for this location.` : 'No machine takes this carton size.', { trace, warnings });
  const perMin = num(m.specs[rateKey])!;
  trace.push({ label: 'Machine rate', value: perMin, unit: 'cartons/min', source: `machine ${m.name}` });
  return costed(base, m, {
    perPartSec: 60 / perMin / carton.perCarton,
    materialUsdPerPart: chargeCarton ? carton.costUsd / carton.perCarton : 0,
    trace, warnings, highlight: 'whole_part',
  }, ref, part.batchSize);
}

function packAndLoad(base: { process: string; machineClass: string }, part: SecondaryPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const perBag = variable(ref, 'defaultComponentsPerBag');
  if (perBag == null || perBag <= 0) return notCosted(base, 'gap', 'defaultComponentsPerBag is not staged: run migration 817.');
  if (!part.bboxMm) return notCosted(base, 'gap', 'Part size is needed.');
  const [, mid] = sorted(part.bboxMm);
  // The seal spans the bag opening, which must pass the part's cross-section.
  const capable = pool.filter((m) => num(m.specs['sealing_time_s']) != null &&
    (num(m.specs['maximum_sealing_length_mm']) ?? Infinity) >= mid);
  const m = pickMachine(base.process, capable, ref);
  if (!m) return notCosted(base, 'gap', pool.length === 0 ? 'No Pack & Load machine on file for this location.' : 'No sealer is long enough for this part.');
  const sealSec = num(m.specs['sealing_time_s'])!;
  return costed(base, m, {
    perPartSec: sealSec / perBag,
    trace: [
      { label: 'Sealing time per bag', value: sealSec, unit: 's', source: `machine ${m.name}` },
      { label: 'Components per bag', value: perBag, source: `${SRC_VAR} (defaultComponentsPerBag)` },
    ],
    warnings: ['Bag cost is not charged: the reference gives bag sizes but no rule for the bag size a part needs.'],
    highlight: 'whole_part',
  }, ref, part.batchSize);
}

/**
 * Every secondary process for this part. `machines` is the location's real
 * pool (mhr_records, machine_class per SECONDARY_PROCESSES).
 */
export function computeSecondaryProcesses(
  part: SecondaryPartFacts,
  ref: SecondaryReference,
  machines: ReadonlyArray<SecondaryMachine>,
): SecondaryProcessResult[] {
  const poolOf = (cls: string) => machines.filter((m) => m.machineClass === cls);
  return SECONDARY_PROCESSES.map((base) => {
    const pool = poolOf(base.machineClass);
    switch (base.process) {
      case 'CMM Inspection': return cmm(base, part, ref, pool);
      case 'Ultrasonic Cleaning': return ultrasonicCleaning(base, part, ref, pool);
      case 'Magnetic Particle Testing': return surfaceInspection(base, part, ref, pool, true);
      case 'Fluorescent Penetrant Testing': return surfaceInspection(base, part, ref, pool, false);
      case 'Hydrostatic Leak Testing': return hydrostaticLeak(base, part, ref, pool);
      case 'Ultrasonic A-Scan':
      case 'Ultrasonic C-Scan': return ultrasonicScan(base, part, ref, pool);
      case 'Carton Forming': return cartonProcess(base, part, ref, pool, 'max_carton_form_rate_cartons_per_min', true);
      case 'Carton Sealing': return cartonProcess(base, part, ref, pool, 'max_carton_seal_rate_cartons_per_min', false);
      case 'Pack & Load': return packAndLoad(base, part, ref, pool);
      default:
        return notCosted(base, 'gap',
          `The reference has ${pool.length > 0 ? 'machines and rates' : 'no machine'} for ${base.process} but no cycle-time data, so it cannot be costed.`);
    }
  });
}
