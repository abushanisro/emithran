// High Pressure Die Casting: cycle time, machine choice and the casting line.
// Pure. Inputs are the part's measured casting geometry (cad-engine
// shared/casting_geometry.py), the alloy (raw_materials + properties, migration
// 855), memory/Die Casting variables and lookups (casting-reference.ts) and the
// HPDC machines in HR Rates (migration 845).
//
// One shot fills n cavities (resolveHpdcCavities):
//   n            the Cost Guide cavity count when it is a layoutNumCav die
//                layout, else variables defaultNumCavities; one cavity when
//                the part is heavier than largePartThreshold (kg)
//   clamp        n x projected area x clamping pressure x safety factor
//   tie bars     the layout (L x W parts on the parting plane) must fit
//   dry          the machine's Dry Cycle Time (s)
//   ladle        ladleFillTime (fixed; ladleRate is not added -- it would
//                count the same pour twice)
//   lube         lubeTimeConstant + lubeTimeCoefficient x lube area,
//                lube area = 2 x n x projected area (both die halves, mm2)
//   eject        lube x ejectTimeHPDC (the variable's own note: eject time
//                from its correlation with lube time)
//   fill         k x (Ti - Tf + S x Z) / (Tf - Td) x T   (die-casting fill-time
//                model) with k = solidificationConstantHPDC (s/mm),
//                Ti injection, Tf liquidus, Td mold temperature (C),
//                S percent solids (tblPercentSolids at the surface quality),
//                Z latent heat constant (tblLatentHeatConstant, by material type),
//                T nominal wall (mm)
//   solidify     alloy Cooling Factor (s/mm) x thickest wall (mm)
//   cycle (s)    (sum) x cycleTimeAdjustmentFactor
//   per part     shot / n (fill and solidification run in every cavity at once)
//
// The formulas are the die-casting calculators (calculators/die-casting-
// calculators.json, migration 893): Clamp Force, High Pressure Die Casting and
// Shot Volume. This file supplies their inputs, each from its real source, and
// chooses the machine.
//
// Every capable machine (clamp + tie-bar fit, hpdc-machine.ts) is priced with
// its own dry cycle and rates; the cheapest per part is chosen. Any input the
// model needs that is not on file stops the line from being costed and is
// named -- no value is substituted.
//
// Not modelled, and said so on the line: sizing cavities to annual volume
// (ejectTimeHPDC's note names it, but memory holds no available production
// hours). Metal per shot (part + overflow) is reported here and priced in
// casting-cost-summary.ts; the die is costed by die-tooling.ts.

import type { CalculatorRunDto, FeatureOp, MachineChoiceDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { eMithranTerms, type EMithranTermsArgs } from '../shared/core/engine-kernel';
import { runReferenceCalculator, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import type { CastingMaterial, CastingReference } from './casting-reference';
import { castingSeed, runOnLine, runView, SeedSet } from './casting-calculator-seeds';
import { machineChoice, type ChoiceEval } from './machine-choice';
import { selectHpdcMachines, type HpdcMachine, type MachineCheck } from './hpdc-machine';

export const HPDC_PROCESS = 'High Pressure Die Casting';
export const HPDC_MACHINE_CLASS_ID = 'die_casting_high_pressure_die_casting';

export interface CastingGeometry {
  projectedAreaMm2: number | null;
  /** Silhouette extents on the parting plane (mm). */
  footprintMm: [number, number] | null;
  wallNominalMm: number | null;
  wallMaxMm: number | null;
  partVolumeMm3: number | null;
  /** Longest part dimension (mm): the ingate count along the part (hpdcRunner). */
  partLengthMm?: number | null;
}

export interface TraceStep { label: string; value: string }

/** Cavities per die and how the count was decided. */
export interface HpdcCavities {
  count: number;
  lengthWise: number;
  widthWise: number;
  /** 'user' Cost Guide choice, 'default' defaultNumCavities, 'large_part' forced
   *  to one by largePartThreshold, 'unverified' the requested count could not be used. */
  constrainedBy: 'user' | 'default' | 'large_part' | 'unverified';
  /** Every layoutNumCav cavity count. */
  layouts: number[];
  defaultCount: number;
}

type CavityResult =
  | { ok: true; cavities: HpdcCavities; trace: string; note: string | null }
  | { ok: false; cavities: HpdcCavities; reason: string };

/** Cavities per die from the Cost Guide choice, memory's default and the large-part limit. */
export function resolveHpdcCavities(input: {
  reference: CastingReference;
  requested: number | null;
  partMassKg: number | null;
  /** The process default cavity count; variables defaultNumCavities when omitted (HPDC). */
  defaultCount?: number;
  /** Name of that default, for the trace. */
  defaultName?: string;
}): CavityResult {
  const ref = input.reference;
  const layouts = ref.cavityLayouts.map((l) => l.count);
  const defaultCount = input.defaultCount ?? ref.variables.defaultNumCavities;
  const defaultName = input.defaultName ?? 'defaultNumCavities';
  const threshold = ref.variables.largePartThreshold;
  const want = input.requested ?? defaultCount;
  const constrainedBy = input.requested != null ? 'user' as const : 'default' as const;
  const fail = (reason: string): CavityResult => ({
    ok: false, reason,
    cavities: { count: want, lengthWise: NaN, widthWise: NaN, constrainedBy: 'unverified', layouts, defaultCount },
  });
  const layoutOf = (n: number) => ref.cavityLayouts.find((l) => l.count === n);
  const layout = layoutOf(want);
  if (!layout) return fail(`${want} cavities has no die layout in layoutNumCav (${layouts.join(', ')}).`);
  if (want > 1) {
    if (input.partMassKg == null) return fail(`${want} cavities: part mass not known, so largePartThreshold (${threshold} kg) cannot be checked.`);
    if (input.partMassKg > threshold) {
      const one = layoutOf(1);
      if (!one) return fail('layoutNumCav has no one-cavity layout.');
      return {
        ok: true,
        cavities: { count: 1, lengthWise: one.lengthWise, widthWise: one.widthWise, constrainedBy: 'large_part', layouts, defaultCount },
        trace: `1 (part ${r2(input.partMassKg)} kg > largePartThreshold ${threshold} kg)`,
        note: `${want} cavities asked, but the part (${r2(input.partMassKg)} kg) is above largePartThreshold (${threshold} kg): costed with one cavity.`,
      };
    }
  }
  return {
    ok: true,
    cavities: { count: want, lengthWise: layout.lengthWise, widthWise: layout.widthWise, constrainedBy, layouts, defaultCount },
    trace: `${want} (${layout.lengthWise} × ${layout.widthWise} layout, ${constrainedBy === 'user' ? 'Cost Guide' : defaultName})`,
    note: null,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Calculator keys (calculators/die-casting-calculators.json). */
export const HPDC_CALCULATOR = 'High Pressure Die Casting';
const CLAMP_CALCULATOR = 'Clamp Force';
const SHOT_CALCULATOR = 'Shot Volume';

type CycleSeedResult =
  | { ok: true; seeds: SeedSet; surfaceQualityIndex: number }
  | { ok: false; missing: string[] };

/**
 * The machine-independent inputs of the High Pressure Die Casting calculator
 * (everything but the machine Dry Cycle Time), each from its real source, or
 * the inputs that are not on file.
 */
export function hpdcCycleSeeds(input: {
  reference: CastingReference;
  material: CastingMaterial;
  geometry: CastingGeometry;
  surfaceQualityIndex?: number;
  /** Cavities filled per shot (default 1). */
  cavities?: number;
}): CycleSeedResult {
  const { reference: ref, material: m, geometry: g } = input;
  const v = ref.variables;
  const n = input.cavities ?? 1;
  const s = new SeedSet();
  const pos = (x: number | null | undefined) => (x != null && x > 0 ? x : null);
  s.put('Cavities', n, (x) => castingSeed.engine(x, `${x} cavit${x === 1 ? 'y' : 'ies'} per shot (die layout)`), 'cavities');
  s.put('Projected Area', pos(g.projectedAreaMm2), (x) => castingSeed.cad(x, 'projected area on the parting plane (mm²)'), 'measured projected area (re-run analysis as a casting process)');
  s.put('Wall Nominal', pos(g.wallNominalMm), (x) => castingSeed.cad(x, 'nominal wall thickness (mm)'), 'measured nominal wall thickness');
  s.put('Wall Max', pos(g.wallMaxMm), (x) => castingSeed.cad(x, 'thickest wall (mm)'), 'measured maximum wall thickness');
  s.put('Injection Temp', m.injectionTempC, (x) => castingSeed.alloy(m.name, 'Injection Temp (C)', x), `${m.name}: Injection Temp`);
  s.put('Liquidus Temp', m.liquidusTempC, (x) => castingSeed.alloy(m.name, 'Liquidus Temp (C)', x), `${m.name}: Liquidus Temp`);
  s.put('Mold Temp', m.moldTempC, (x) => castingSeed.alloy(m.name, 'Mold Temp (C)', x), `${m.name}: Mold Temp`);
  s.put('Cooling Factor', m.coolingFactorSPerMm, (x) => castingSeed.alloy(m.name, 'Cooling Factor (s/mm)', x), `${m.name}: Cooling Factor`);
  const z = m.materialType ? ref.latentHeatConstantByType.get(m.materialType) : null;
  s.put('Latent Heat Constant', z, (x) => castingSeed.lookup('tblLatentHeatConstant', 'Latent Heat Constant', x, { 'Material Name': m.materialType! }),
    m.materialType ? `tblLatentHeatConstant row for material type ${m.materialType}` : `${m.name}: Material Type (needed for its tblLatentHeatConstant row)`);
  const qIndex = input.surfaceQualityIndex ?? ref.defaultSurfaceQuality?.index ?? null;
  const solids = ref.percentSolids.find((p) => p.index === qIndex) ?? null;
  s.put('Percent Solids', solids?.percentSolids, (x) => castingSeed.lookup('tblPercentSolids', 'Percent Solids', x, { Index: solids!.index }),
    `tblPercentSolids row for surface quality ${qIndex ?? '(none)'}`);
  s.put('Ladle Fill Time', v.ladleFillTime, (x) => castingSeed.variable('ladleFillTime', x), 'variables ladleFillTime');
  s.put('Lube Time Constant', v.lubeTimeConstant, (x) => castingSeed.variable('lubeTimeConstant', x), 'variables lubeTimeConstant');
  s.put('Lube Time Coefficient', v.lubeTimeCoefficient, (x) => castingSeed.variable('lubeTimeCoefficient', x), 'variables lubeTimeCoefficient');
  s.put('Eject Time Factor', v.ejectTimeHPDC, (x) => castingSeed.variable('ejectTimeHPDC', x), 'variables ejectTimeHPDC');
  s.put('Solidification Constant', v.solidificationConstantHPDC, (x) => castingSeed.variable('solidificationConstantHPDC', x), 'variables solidificationConstantHPDC');
  s.put('Cycle Time Adjustment Factor', v.cycleTimeAdjustmentFactor, (x) => castingSeed.variable('cycleTimeAdjustmentFactor', x), 'variables cycleTimeAdjustmentFactor');
  if (m.liquidusTempC != null && m.moldTempC != null && m.liquidusTempC <= m.moldTempC) {
    s.missing.push(`${m.name}: liquidus (${m.liquidusTempC} C) is not above mold temperature (${m.moldTempC} C)`);
  }
  if (s.missing.length) return { ok: false, missing: s.missing };
  return { ok: true, seeds: s, surfaceQualityIndex: solids!.index };
}

/**
 * The tblOverflowDim row at or below the nominal wall (the table's
 * thinnest-to-thickest breakpoints; at and above its last row the ratio is that
 * row's) and its column: High for surface quality 1-2, Low otherwise. null
 * below the first breakpoint.
 */
export function overflowRow(ref: CastingReference, wallMm: number, surfaceQualityIndex: number):
  { wallMm: number; column: string; ratio: number } | null {
  const row = [...ref.overflow].reverse().find((r) => r.wallMm <= wallMm);
  if (!row) return null;
  const high = surfaceQualityIndex <= 2;
  return { wallMm: row.wallMm, column: high ? 'Overflow Volume Ratio High' : 'Overflow Volume Ratio Low', ratio: high ? row.high : row.low };
}

export interface HpdcResult {
  /** The die-casting process this line prices: HPDC_PROCESS or GDC_PROCESS (gdc-engine.ts). */
  processName: string;
  processLines: ProcessLineCost[];
  requiredClampKn: number | null;
  machineChecks: MachineCheck[];
  /** Metal per shot, every cavity (mm3); null when not derivable. */
  shotVolumeMm3: number | null;
  /** Cavities per die; null before the alloy and reference are resolved. */
  cavities: HpdcCavities | null;
  /** The alloy materials_master Yield Loss Factor; null when not on file or no alloy. */
  yieldLossFactor: number | null;
  /** The machine the line is priced on; null when no machine was chosen. */
  machine: HpdcMachine | null;
  /** Calculators behind values that are not the line (clamp force, shot volume). */
  calculatorRuns: Record<string, CalculatorRunDto>;
  trace: TraceStep[];
  warnings: string[];
}

export function computeHpdc(input: {
  reference: CastingReference | null;
  referenceMissing: string[];
  /** The die-casting calculators (database), keyed by calculator key. */
  calculators: ReferenceCalculators | null;
  material: CastingMaterial | null;
  materialGrade: string | null;
  geometry: CastingGeometry;
  machines: readonly HpdcMachine[];
  batchSize: number;
  surfaceQualityIndex?: number;
  /** Cost Guide cavity count (scenario override); null for memory's default. */
  cavityCountOverride?: number | null;
  costContext: Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;
}): HpdcResult {
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  const calculatorRuns: Record<string, CalculatorRunDto> = {};
  const gapLine = (reason: string, machine?: HpdcMachine | null): HpdcResult => ({
    processName: HPDC_PROCESS,
    processLines: [{
      process: HPDC_PROCESS,
      setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0,
      hourlyRate: 0, rateSource: 'no_db_rate',
      machineClass: HPDC_MACHINE_CLASS_ID,
      machineName: machine?.name ?? null, commodityCode: null, labourRate: null,
      physicsGap: { gapType: 'unsupported_operation', process: HPDC_PROCESS, machineClass: HPDC_MACHINE_CLASS_ID, reason },
      ...(choice ? { machineChoice: choice } : {}),
    }],
    requiredClampKn, machineChecks, shotVolumeMm3: null, cavities, yieldLossFactor: input.material?.yieldLossFactor ?? null, machine: null,
    calculatorRuns, trace, warnings: [...warnings, reason],
  });
  let requiredClampKn: number | null = null;
  let machineChecks: MachineCheck[] = [];
  let cavities: HpdcCavities | null = null;
  let choice: MachineChoiceDto | null = null;

  if (!input.reference) {
    return gapLine(`Die casting reference data not staged: ${input.referenceMissing.join(', ')} (migration 846).`);
  }
  if (!input.material) {
    return gapLine(`Material "${input.materialGrade ?? '(none)'}" is not a die-casting alloy in Raw Materials (material group Die Casting): HPDC needs its clamping pressure, temperatures and cooling factor.`);
  }
  const ref = input.reference;
  const mat = input.material;
  const calcs = input.calculators;
  trace.push({ label: 'Alloy', value: `${mat.name} (${mat.materialType ?? 'type not on file'}, ${mat.chamber ?? 'chamber not on file'} chamber)` });

  const vol = input.geometry.partVolumeMm3;
  const partMassKg = vol && vol > 0 && mat.densityKgM3 && mat.densityKgM3 > 0 ? (vol / 1e9) * mat.densityKgM3 : null;
  const cav = resolveHpdcCavities({ reference: ref, requested: input.cavityCountOverride ?? null, partMassKg });
  cavities = cav.cavities;
  if (!cav.ok) return gapLine(cav.reason);
  if (cav.note) warnings.push(cav.note);
  const n = cav.cavities.count;
  trace.push({ label: 'Cavities', value: cav.trace });

  // Clamp force (calculator Clamp Force).
  const area = input.geometry.projectedAreaMm2;
  const clampSeeds = new SeedSet()
    .put('Cavities', n, (x) => castingSeed.engine(x, cav.trace), 'cavities')
    .put('Projected Area', area != null && area > 0 ? area : null, (x) => castingSeed.cad(x, 'projected area on the parting plane (mm²)'), 'no measured projected area (re-run analysis as a casting process)')
    .put('Clamping Pressure', mat.clampingPressureMpa != null && mat.clampingPressureMpa > 0 ? mat.clampingPressureMpa : null,
      (x) => castingSeed.alloy(mat.name, 'Clamping Pressure (MPa)', x), `${mat.name} has no Clamping Pressure in materials_master`)
    .put('Clamp Force Safety Factor', ref.clampForceSafetyFactor, (x) => castingSeed.variable('clampForceSafetyFactor', x), 'variables clampForceSafetyFactor');
  if (clampSeeds.missing.length) return gapLine(`Clamp force not derivable: ${clampSeeds.missing.join('; ')}.`);
  const clampRun = runReferenceCalculator(calcs, CLAMP_CALCULATOR, clampSeeds.seeds, 'Required Clamp Force');
  calculatorRuns[CLAMP_CALCULATOR] = runView('Die Casting - Clamp Force', 'Required Clamp Force', clampRun);
  if (clampRun.value == null) return gapLine(`Clamp force not derivable: ${clampRun.missing.join('; ')}.`);
  requiredClampKn = clampRun.value;
  trace.push({ label: 'Required clamp force', value: `${r2(clampRun.value)} kN (Clamp Force calculator)` });

  if (!input.geometry.footprintMm) return gapLine('Part footprint on the parting plane not measured (re-run analysis as a casting process): tie-bar fit cannot be checked.');
  const selection = selectHpdcMachines({
    machines: input.machines, requiredKn: requiredClampKn, footprintMm: input.geometry.footprintMm,
    layout: { lengthWise: cav.cavities.lengthWise, widthWise: cav.cavities.widthWise },
  });
  machineChecks = selection.checks;
  const fpText = input.geometry.footprintMm.map((x) => r2(x)).join(' × ');
  const criteria = [
    `Clamping force at least ${r2(requiredClampKn)} kN (${n} cavit${n === 1 ? 'y' : 'ies'} x projected area x alloy clamping pressure x clampForceSafetyFactor)`,
    `Tie bars clear the ${cav.cavities.lengthWise} × ${cav.cavities.widthWise} cavity layout of ${fpText} mm parts (either way round)`,
    'Machine hour rate, labour rate, crew and Dry Cycle Time on file',
  ];
  choice = castingChoice({ criteria, checks: selection.checks, priced: null, chosen: null });
  if (selection.capable.length === 0) {
    const clear = n === 1 ? `${fpText} mm` : `${cav.cavities.lengthWise} × ${cav.cavities.widthWise} parts of ${fpText} mm`;
    return gapLine(`No HPDC machine in HR Rates (${input.machines.length} checked) has ${r2(requiredClampKn)} kN clamp with tie bars clearing ${clear} and a rate on file.`);
  }

  const cyc = hpdcCycleSeeds({ reference: ref, material: mat, geometry: input.geometry, surfaceQualityIndex: input.surfaceQualityIndex, cavities: n });
  if (!cyc.ok) return gapLine(`HPDC cycle time not derivable: missing ${cyc.missing.join('; ')}.`, selection.capable[0]);

  // Price every capable machine with its own dry cycle, the calculator per machine; keep the cheapest per part.
  const runs = selection.capable
    .filter((m) => m.dryCycleTimeS != null)
    .map((m) => ({ m, run: runReferenceCalculator(calcs, HPDC_CALCULATOR, cyc.seeds.with({ 'Dry Cycle Time': castingSeed.machine(m.name, 'Dry Cycle Time (s)', m.dryCycleTimeS!) })) }));
  const unpriced = runs.find((r) => r.run.value == null);
  if (unpriced && runs.every((r) => r.run.value == null)) {
    return gapLine(`HPDC cycle time not derivable: ${unpriced.run.missing.join('; ')}.`, selection.capable[0]);
  }
  const priced = runs
    .filter((r) => r.run.value != null)
    .map(({ m, run }) => {
      const shotS = run.outputs['Shot Time']!;
      const setupHr = m.setupTimeHr ?? 0;
      const terms = eMithranTerms({
        ...input.costContext,
        mhrPerHr: m.machineRatePerHr!,
        dlrPerHr: m.labourRatePerHr!,
        setupNDL: m.operators!,
        cycleNDL: m.operators!,
        cycleTimeMin: run.value! / 60,
        setupTimeMin: (setupHr * 60) / Math.max(input.batchSize, 1),
      });
      return { m, run, shotS, terms };
    })
    .sort((a, b) => a.terms.total - b.terms.total);
  if (priced.length === 0) return gapLine('No capable HPDC machine has a Dry Cycle Time on file.', selection.capable[0]);
  const best = priced[0]!;
  choice = castingChoice({ criteria, checks: selection.checks, priced, chosen: best.m.name });
  if (best.m.setupTimeHr == null) warnings.push(`${best.m.name} has no setup time on file: setup not costed.`);
  trace.push({ label: 'Machine', value: `${best.m.name}: dry cycle ${best.m.dryCycleTimeS} s, cheapest per part of ${priced.length} capable` });
  trace.push({ label: 'Shot', value: `${r2(best.shotS)} s; per part ${r2(best.run.value!)} s (High Pressure Die Casting calculator)` });

  // Shot components per part: each shot second is shared by the n parts it casts.
  const o = best.run.outputs;
  const suffix = n === 1 ? '' : ` (shot ÷ ${n} cavities)`;
  const per = (sec: number) => sec / n;
  const ops: FeatureOp[] = [
    { name: `Dry cycle${suffix}`, featureType: 'Component', timeSec: r2(per(best.m.dryCycleTimeS!)), count: 1 },
    { name: `Ladle${suffix}`, featureType: 'Component', timeSec: r2(per(ref.variables.ladleFillTime)), count: 1 },
    { name: `Lube${suffix}`, featureType: 'Component', timeSec: r2(per(o['Lube Time']!)), count: 1 },
    { name: `Fill${suffix}`, featureType: 'Component', timeSec: r3(per(o['Fill Time']!)), count: 1 },
    { name: `Solidification${suffix}`, featureType: 'Component', timeSec: r2(per(o['Solidification Time']!)), count: 1 },
    { name: `Eject${suffix}`, featureType: 'Component', timeSec: r2(per(o['Eject Time']!)), count: 1 },
  ];

  // Metal per shot (calculator Shot Volume): parts + overflow + runner.
  let shotVolumeMm3: number | null = null;
  const g = input.geometry;
  const ov = g.wallNominalMm != null ? overflowRow(ref, g.wallNominalMm, cyc.surfaceQualityIndex) : null;
  const shotSeeds = new SeedSet()
    .put('Part Volume', vol != null && vol > 0 ? vol : null, (x) => castingSeed.cad(x, 'part volume (mm³)'), 'part volume')
    .put('Cavities', n, (x) => castingSeed.engine(x, cav.trace), 'cavities')
    .put('Overflow Ratio', ov?.ratio, (x) => castingSeed.lookup('tblOverflowDim', ov!.column, x, { 'Wall Thickness (mm)': ov!.wallMm }),
      'a tblOverflowDim row (nominal wall below the first row, or not measured)')
    .put('Wall Max', g.wallMaxMm != null && g.wallMaxMm > 0 ? g.wallMaxMm : null, (x) => castingSeed.cad(x, 'thickest wall (mm)'), 'thickest wall')
    .put('Part Length', g.partLengthMm != null && g.partLengthMm > 0 ? g.partLengthMm : null, (x) => castingSeed.cad(x, 'longest part dimension (mm)'), 'part length')
    .put('Additional Runner Thickness', ref.variables.additionalRunnerThickness, (x) => castingSeed.variable('additionalRunnerThickness', x), 'variables additionalRunnerThickness')
    .put('Runner Aspect Ratio', ref.variables.runnerAspectRatio, (x) => castingSeed.variable('runnerAspectRatio', x), 'variables runnerAspectRatio')
    .put('Ingate Gap', ref.variables.ingateGap, (x) => castingSeed.variable('ingateGap', x), 'variables ingateGap');
  if (shotSeeds.missing.length) warnings.push(`Shot volume not derived: missing ${shotSeeds.missing.join('; ')}.`);
  else {
    const shotRun = runReferenceCalculator(calcs, SHOT_CALCULATOR, shotSeeds.seeds, 'Shot Volume');
    calculatorRuns[SHOT_CALCULATOR] = runView('Die Casting - Shot Volume', 'Shot Volume', shotRun);
    if (shotRun.value == null) warnings.push(`Shot volume not derived: ${shotRun.missing.join('; ')}.`);
    else {
      shotVolumeMm3 = shotRun.value;
      trace.push({ label: 'Shot volume', value: `${r2(shotVolumeMm3)} mm³ (parts + overflow + runner, Shot Volume calculator)` });
    }
  }

  return {
    processName: HPDC_PROCESS,
    processLines: [{
      process: HPDC_PROCESS,
      setupCost: r2(best.terms.setupCost),
      runCost: r2(best.terms.total - best.terms.setupCost),
      totalCost: r2(best.terms.total),
      cycleTimeMin: r3(best.run.value! / 60),
      setupTimeMin: r3((best.m.setupTimeHr ?? 0) * 60),
      setupTimeSource: best.m.setupTimeHr != null ? 'machine' : 'none',
      operators: best.m.operators,
      hourlyRate: best.m.machineRatePerHr!,
      rateSource: 'mhr_database',
      machineClass: HPDC_MACHINE_CLASS_ID,
      machineName: best.m.name,
      commodityCode: null,
      labourRate: best.m.labourRatePerHr,
      mhrId: best.m.id,
      featureBreakdown: ops,
      machineChoice: choice,
      ...runOnLine(best.run),
    }],
    requiredClampKn, machineChecks, shotVolumeMm3, cavities, yieldLossFactor: mat.yieldLossFactor, machine: best.m, calculatorRuns, trace, warnings,
  };
}

/** The casting-line machine choice: every checked machine, with its per-part cost when priced. */
function castingChoice(input: {
  criteria: string[];
  checks: readonly MachineCheck[];
  priced: ReadonlyArray<{ m: HpdcMachine; shotS: number; terms: { total: number } }> | null;
  chosen: string | null;
}): MachineChoiceDto {
  return machineChoice({
    rule: 'Cheapest cost per part among the capable machines (each with its own dry cycle, machine + crew rate and setup over the batch)',
    criteria: input.criteria,
    evals: input.checks.map((c): ChoiceEval => {
      if (!c.capable) return { name: c.machine.name, reasons: c.reasons };
      if (!input.priced) return { name: c.machine.name, reasons: [], cost: null };
      const p = input.priced.find((x) => x.m === c.machine);
      if (!p) return { name: c.machine.name, reasons: ['no Dry Cycle Time on file'] };
      return { name: c.machine.name, reasons: [], cost: p.terms.total, note: `dry cycle ${c.machine.dryCycleTimeS} s, shot ${Math.round(p.shotS * 100) / 100} s` };
    }),
    chosen: input.chosen,
  });
}
