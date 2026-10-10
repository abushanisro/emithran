// Gravity Die Casting: cycle time, machine choice and the casting line. Pure.
// Same inputs and result shape as hpdc-engine.ts (HpdcResult), so the cost
// summary, die tooling and the HPDC/GDC choice treat both alike.
//
// Model (user decisions 2026-10-04), memory/Die Casting variables:
//   n            cavities: Cost Guide count when a layoutNumCav layout, else
//                defaultNumCavitiesGravityDieCasting; one above largePartThreshold
//   metal yield  materialYieldGravityDieCasting % + numCavitiesMaterialYieldAdd
//                per cavity, the addition capped at cavityCeiling; melted metal
//                per part = part / yield (gating and risers return to the furnace)
//   dry          the machine Dry Cycle Time (s)
//   ladle        ladleFillTimeGravityDieCasting (fixed, as for HPDC)
//   lube         lubeTimeConstant + lubeTimeCoefficient x 2 x n x projected area
//   fill         melted metal per shot (mm3) / moldFillRateGravityDieCasting (mm3/s)
//   solidify     coolTimeConstantGravityDieCasting (s per mm) x thickest wall (mm)
//   eject        gravityDropTime (memory default ejection method: Gravity)
//   cores        coreLoadTimeGravityDieCasting x the measured sand cores
//                (cad-engine shared/core_geometry.py)
//   shot (s)     (sum) x cycleTimeAdjustmentFactor / the machine Mold Efficiency
//                (rule, user decision 2026-10-04: memory gives the efficiency
//                but no formula; dividing makes 0.95 add the 5% of each cycle
//                that is not productive); per part = shot / n
// A gravity machine has no clamp: it is capable when the cavity layout fits
// between its tie bars and it has a rate and dry cycle on file. The cheapest
// per part is chosen.

import type { FeatureOp } from '../../dto/cost-breakdown.dto';
import { eMithranTerms, type EMithranTermsArgs } from '../shared/core/engine-kernel';
import type { CastingMaterial, CastingReference } from './casting-reference';
import { selectHpdcMachines, type HpdcMachine, type MachineCheck } from './hpdc-machine';
import type { MachineChoiceDto } from '../../dto/cost-breakdown.dto';
import { machineChoice, type ChoiceEval } from './machine-choice';
import { resolveHpdcCavities, type CastingGeometry, type HpdcCavities, type HpdcResult, type TraceStep } from './hpdc-engine';
import { runReferenceCalculator, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { castingSeed, runOnLine, SeedSet } from './casting-calculator-seeds';

export const GDC_PROCESS = 'Gravity Die Casting';
export const GDC_MACHINE_CLASS_ID = 'die_casting_gravity_die_casting';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Calculator key (calculators/die-casting-calculators.json): pour time and metal yield. */
const GDC_CALCULATOR = 'Gravity Die Casting';

export function computeGdc(input: {
  reference: CastingReference | null;
  referenceMissing: string[];
  material: CastingMaterial | null;
  materialGrade: string | null;
  geometry: CastingGeometry;
  /** The die-casting calculators (database), keyed by calculator key. */
  calculators: ReferenceCalculators | null;
  machines: readonly HpdcMachine[];
  batchSize: number;
  /** Sand cores measured on the part (cad-engine core_geometry); null when not measured. */
  coreCount: number | null;
  cavityCountOverride?: number | null;
  costContext: Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;
}): HpdcResult {
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  let machineChecks: MachineCheck[] = [];
  let cavities: HpdcCavities | null = null;
  let choice: MachineChoiceDto | null = null;
  const gapLine = (reason: string, machine?: HpdcMachine | null): HpdcResult => ({
    processName: GDC_PROCESS,
    processLines: [{
      process: GDC_PROCESS,
      setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0,
      hourlyRate: 0, rateSource: 'no_db_rate',
      machineClass: GDC_MACHINE_CLASS_ID,
      machineName: machine?.name ?? null, commodityCode: null, labourRate: null,
      physicsGap: { gapType: 'unsupported_operation', process: GDC_PROCESS, machineClass: GDC_MACHINE_CLASS_ID, reason },
      ...(choice ? { machineChoice: choice } : {}),
    }],
    requiredClampKn: null, machineChecks, shotVolumeMm3: null, cavities,
    yieldLossFactor: input.material?.yieldLossFactor ?? null, machine: null,
    calculatorRuns: {}, trace, warnings: [...warnings, reason],
  });

  if (!input.reference) return gapLine(`Die casting reference data not staged: ${input.referenceMissing.join(', ')} (migration 846).`);
  if (!input.material) {
    return gapLine(`Material "${input.materialGrade ?? '(none)'}" is not a die-casting alloy in Raw Materials (material group Die Casting).`);
  }
  const ref = input.reference;
  const v = ref.variables;
  const mat = input.material;
  const g = input.geometry;
  trace.push({ label: 'Alloy', value: `${mat.name} (${mat.materialType ?? 'type not on file'})` });

  const vol = g.partVolumeMm3;
  const partMassKg = vol && vol > 0 && mat.densityKgM3 && mat.densityKgM3 > 0 ? (vol / 1e9) * mat.densityKgM3 : null;
  const cav = resolveHpdcCavities({
    reference: ref, requested: input.cavityCountOverride ?? null, partMassKg,
    defaultCount: v.defaultNumCavitiesGravityDieCasting, defaultName: 'defaultNumCavitiesGravityDieCasting',
  });
  cavities = cav.cavities;
  if (!cav.ok) return gapLine(cav.reason);
  if (cav.note) warnings.push(cav.note);
  const n = cav.cavities.count;
  trace.push({ label: 'Cavities', value: cav.trace });

  if (!g.footprintMm) return gapLine('Part footprint on the parting plane not measured (re-run analysis as a casting process): tie-bar fit cannot be checked.');
  const selection = selectHpdcMachines({
    machines: input.machines, requiredKn: null, footprintMm: g.footprintMm,
    layout: { lengthWise: cav.cavities.lengthWise, widthWise: cav.cavities.widthWise },
  });
  machineChecks = selection.checks;
  const criteria = [
    `Tie bars clear the ${cav.cavities.lengthWise} × ${cav.cavities.widthWise} cavity layout of ${g.footprintMm.map(r2).join(' × ')} mm parts (either way round); a gravity machine has no clamp to check`,
    'Machine hour rate, labour rate, crew, Dry Cycle Time and Mold Efficiency on file',
  ];
  const gdcChoice = (priced: ReadonlyArray<{ m: HpdcMachine; shotS: number; terms: { total: number } }> | null, chosen: string | null) => machineChoice({
    rule: 'Cheapest cost per part among the capable machines (each with its own dry cycle and Mold Efficiency, machine + crew rate and setup over the batch)',
    criteria,
    evals: selection.checks.map((c): ChoiceEval => {
      if (!c.capable) return { name: c.machine.name, reasons: c.reasons };
      if (!priced) return { name: c.machine.name, reasons: [], cost: null };
      const p = priced.find((x) => x.m === c.machine);
      if (!p) return { name: c.machine.name, reasons: [c.machine.dryCycleTimeS == null ? 'no Dry Cycle Time on file' : 'no Mold Efficiency on file'] };
      return { name: c.machine.name, reasons: [], cost: p.terms.total, note: `dry cycle ${c.machine.dryCycleTimeS} s, Mold Efficiency ${c.machine.moldEfficiency}, shot ${r2(p.shotS)} s` };
    }),
    chosen,
  });
  choice = gdcChoice(null, null);
  if (selection.capable.length === 0) {
    return gapLine(`No Gravity Die Casting machine in HR Rates (${input.machines.length} checked) has tie bars clearing the ${cav.cavities.lengthWise} × ${cav.cavities.widthWise} layout of ${g.footprintMm.map(r2).join(' × ')} mm parts and a rate on file.`);
  }

  const pos = (x: number | null | undefined) => (x != null && x > 0 ? x : null);
  const seeds = new SeedSet()
    .put('Cavities', n, (x) => castingSeed.engine(x, cav.trace), 'cavities')
    .put('Projected Area', pos(g.projectedAreaMm2), (x) => castingSeed.cad(x, 'projected area on the parting plane (mm²)'), 'measured projected area')
    .put('Part Volume', pos(vol), (x) => castingSeed.cad(x, 'part volume (mm³)'), 'part volume')
    .put('Wall Max', pos(g.wallMaxMm), (x) => castingSeed.cad(x, 'thickest wall (mm)'), 'measured maximum wall thickness')
    .put('Core Count', input.coreCount, (x) => castingSeed.cad(x, 'sand cores (trapped regions no die half reaches)'), 'the part cores (re-run analysis as a casting process)')
    .put('Ladle Fill Time', v.ladleFillTimeGravityDieCasting, (x) => castingSeed.variable('ladleFillTimeGravityDieCasting', x), 'variables ladleFillTimeGravityDieCasting')
    .put('Lube Time Constant', v.lubeTimeConstant, (x) => castingSeed.variable('lubeTimeConstant', x), 'variables lubeTimeConstant')
    .put('Lube Time Coefficient', v.lubeTimeCoefficient, (x) => castingSeed.variable('lubeTimeCoefficient', x), 'variables lubeTimeCoefficient')
    .put('Material Yield', v.materialYieldGravityDieCasting, (x) => castingSeed.variable('materialYieldGravityDieCasting', x), 'variables materialYieldGravityDieCasting')
    .put('Cavity Yield Add', v.numCavitiesMaterialYieldAdd, (x) => castingSeed.variable('numCavitiesMaterialYieldAdd', x), 'variables numCavitiesMaterialYieldAdd')
    .put('Cavity Ceiling', v.cavityCeiling, (x) => castingSeed.variable('cavityCeiling', x), 'variables cavityCeiling')
    .put('Mold Fill Rate', v.moldFillRateGravityDieCasting, (x) => castingSeed.variable('moldFillRateGravityDieCasting', x), 'variables moldFillRateGravityDieCasting')
    .put('Cool Time Constant', v.coolTimeConstantGravityDieCasting, (x) => castingSeed.variable('coolTimeConstantGravityDieCasting', x), 'variables coolTimeConstantGravityDieCasting')
    .put('Gravity Drop Time', v.gravityDropTime, (x) => castingSeed.variable('gravityDropTime', x), 'variables gravityDropTime')
    .put('Core Load Time', v.coreLoadTimeGravityDieCasting, (x) => castingSeed.variable('coreLoadTimeGravityDieCasting', x), 'variables coreLoadTimeGravityDieCasting')
    .put('Cycle Time Adjustment Factor', v.cycleTimeAdjustmentFactor, (x) => castingSeed.variable('cycleTimeAdjustmentFactor', x), 'variables cycleTimeAdjustmentFactor');
  if (seeds.missing.length) return gapLine(`Gravity Die Casting cycle time not derivable: missing ${seeds.missing.join('; ')}.`, selection.capable[0]);

  const runs = selection.capable
    .filter((m) => m.dryCycleTimeS != null && m.moldEfficiency != null && m.moldEfficiency > 0)
    .map((m) => ({ m, run: runReferenceCalculator(input.calculators, GDC_CALCULATOR, seeds.with({
      'Dry Cycle Time': castingSeed.machine(m.name, 'Dry Cycle Time (s)', m.dryCycleTimeS!),
      'Mold Efficiency': castingSeed.machine(m.name, 'Mold Efficiency', m.moldEfficiency!),
    })) }));
  if (runs.length > 0 && runs.every((r) => r.run.value == null)) {
    return gapLine(`Gravity Die Casting cycle time not derivable: ${runs[0]!.run.missing.join('; ')}.`, selection.capable[0]);
  }
  const priced = runs
    .filter((r) => r.run.value != null)
    .map(({ m, run }) => {
      const terms = eMithranTerms({
        ...input.costContext,
        mhrPerHr: m.machineRatePerHr!, dlrPerHr: m.labourRatePerHr!,
        setupNDL: m.operators!, cycleNDL: m.operators!,
        cycleTimeMin: run.value! / 60,
        setupTimeMin: ((m.setupTimeHr ?? 0) * 60) / Math.max(input.batchSize, 1),
      });
      return { m, run, shotS: run.outputs['Shot Time']!, terms };
    })
    .sort((a, b) => a.terms.total - b.terms.total);
  if (priced.length === 0) return gapLine('No capable Gravity Die Casting machine has a Dry Cycle Time and a Mold Efficiency on file.', selection.capable[0]);
  const best = priced[0]!;
  choice = gdcChoice(priced, best.m.name);
  if (best.m.setupTimeHr == null) warnings.push(`${best.m.name} has no setup time on file: setup not costed.`);
  const o = best.run.outputs;
  const shotVolumeMm3 = o['Shot Volume']!;
  trace.push({ label: 'Machine', value: `${best.m.name}: dry cycle ${best.m.dryCycleTimeS} s, cheapest per part of ${priced.length} capable` });
  trace.push({ label: 'Shot', value: `${r2(best.shotS)} s; per part ${r2(best.run.value!)} s; metal yield ${r3(o['Metal Yield']!)}, shot ${r2(shotVolumeMm3)} mm³ (Gravity Die Casting calculator)` });

  const suffix = n === 1 ? '' : ` (shot ÷ ${n} cavities)`;
  const op = (name: string, sec: number): FeatureOp => ({ name: `${name}${suffix}`, featureType: 'Component', timeSec: r3(sec / n), count: 1 });
  return {
    processName: GDC_PROCESS,
    processLines: [{
      process: GDC_PROCESS,
      setupCost: r2(best.terms.setupCost),
      runCost: r2(best.terms.total - best.terms.setupCost),
      totalCost: r2(best.terms.total),
      cycleTimeMin: r3(best.run.value! / 60),
      setupTimeMin: r3((best.m.setupTimeHr ?? 0) * 60),
      setupTimeSource: best.m.setupTimeHr != null ? 'machine' : 'none',
      operators: best.m.operators,
      hourlyRate: best.m.machineRatePerHr!,
      rateSource: 'mhr_database',
      machineClass: GDC_MACHINE_CLASS_ID,
      machineName: best.m.name,
      commodityCode: null,
      labourRate: best.m.labourRatePerHr,
      mhrId: best.m.id,
      machineChoice: choice,
      featureBreakdown: [
        op('Dry cycle', best.m.dryCycleTimeS!), op('Ladle', v.ladleFillTimeGravityDieCasting), op('Lube', o['Lube Time']!), op('Fill', o['Fill Time']!),
        op('Solidification', o['Solidification Time']!), op('Eject', v.gravityDropTime), ...(o['Core Load']! > 0 ? [op('Core load', o['Core Load']!)] : []),
      ],
      ...runOnLine(best.run),
    }],
    requiredClampKn: null, machineChecks, shotVolumeMm3, cavities, yieldLossFactor: mat.yieldLossFactor, machine: best.m, calculatorRuns: {}, trace, warnings,
  };
}
