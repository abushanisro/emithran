// Cleaning (shot blast / tumble), Finishing (parting-line and gate grinding),
// Trim, Visual Inspection and Melting of a cast part, from memory/Die Casting
// only (user decisions 2026-10-04). Pure.
//
// Every number is computed by a die-casting calculator (calculators/die-
// casting-calculators.json, migration 893): Cleaning, Visual Inspection, Trim,
// Trim Force, Finishing and Melting. This file supplies their inputs (CAD,
// alloy, machine spec, variables and lookup rows, each with its source),
// checks which machines can do the work and keeps the cheapest.
//
// Cleaning, machine load model: a machine fits when the part's two largest
// dimensions fit its max width and height (either orientation) and at least one
// part fits a load (the calculator's Parts per Load).
//
// Visual Inspection: the tblVisualInspection row is the first whose Max Weight
// is at or above the part weight. Internal surfaces are not measured
// separately, so the internal rate is not used.

import type { CalculatorRunDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { eMithranTerms, resolveSetupMinutes, type EMithranTermsArgs } from '../shared/core/engine-kernel';
import { runReferenceCalculator, type CalcRun, type CalcSeed, type ReferenceCalculators } from '../shared/calculators/reference-calculator';
import { castingSeed, runOnLine, runView, SeedSet } from './casting-calculator-seeds';
import { machineChoice, type ChoiceEval } from './machine-choice';

export interface FinishingMachine {
  id: string;
  name: string;
  machineRatePerHr: number | null;
  labourRatePerHr: number | null;
  operators: number | null;
  setupTimeHr: number | null;
  specs: Record<string, unknown>;
}

export interface VisualInspectionRow { maxWeightKg: number; internalMinPerM2: number; externalMinPerM2: number }

export type CostContext = Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A costed casting line on one real machine (shared by the casting route engines). */
export function line(args: {
  process: string; processGroup: string; processRoute: string; machineClass: string;
  machine: FinishingMachine; sec: number; batchSize: number; costContext: CostContext; breakdown: string; warnings: string[];
  /** The calculator run that computed `sec` (its trace and lookup rows go on the line). */
  run?: CalcRun;
}): ProcessLineCost {
  const m = args.machine;
  const setup = resolveSetupMinutes({ process: args.process, machineSetupTimeHr: m.setupTimeHr, machineName: m.name });
  if (setup.warning) args.warnings.push(setup.warning);
  const ops = m.operators;
  const terms = eMithranTerms({
    ...args.costContext,
    mhrPerHr: m.machineRatePerHr!,
    dlrPerHr: ops != null ? m.labourRatePerHr ?? 0 : 0,
    setupNDL: ops ?? 0,
    cycleNDL: ops ?? 0,
    cycleTimeMin: args.sec / 60,
    setupTimeMin: setup.setupMin / Math.max(args.batchSize, 1),
  });
  return {
    process: args.process, processGroup: args.processGroup, processRoute: args.processRoute, operation: args.process,
    setupCost: r2(terms.setupCost), runCost: r2(terms.total - terms.setupCost), totalCost: r2(terms.total),
    cycleTimeMin: r3(args.sec / 60), setupTimeMin: r3(setup.setupMin), setupTimeSource: setup.source, operators: ops,
    hourlyRate: m.machineRatePerHr!, rateSource: 'mhr_database', machineClass: args.machineClass, machineName: m.name,
    commodityCode: null, labourRate: m.labourRatePerHr, mhrId: m.id,
    featureBreakdown: [{ name: args.breakdown, featureType: 'Part', timeSec: r2(args.sec), count: 1 }],
    ...(args.run ? runOnLine(args.run) : {}),
  };
}

const crewed = (m: FinishingMachine) => m.machineRatePerHr! + (m.operators != null ? (m.labourRatePerHr ?? 0) * m.operators : 0);
const RUN_RULE = 'Cheapest run cost per part among the capable machines (machine + crew rate x time per part)';

/** A named, uncosted casting line. */
export const gap = (process: string, processGroup: string, machineClass: string, reason: string): ProcessLineCost => ({
  process, processGroup, processRoute: process, operation: process,
  setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
  machineClass, machineName: null, commodityCode: null, labourRate: null,
  physicsGap: { gapType: 'unsupported_operation', process, machineClass, reason },
});

/** The first weight-band row at or above the part weight (rows ascending by Max Weight). */
const weightBand = <T extends { maxWeightKg: number }>(rows: readonly T[], kg: number): T | undefined =>
  [...rows].sort((x, y) => x.maxWeightKg - y.maxWeightKg).find((r) => r.maxWeightKg >= kg);

export function cleaningLine(input: {
  machines: readonly FinishingMachine[];
  calculators: ReferenceCalculators | null;
  /** The part weight, from the Net Material Usage calculator; null when not derivable. */
  partWeight: CalcSeed | null;
  /** Part bounding dimensions (mm), any order. */
  partDimsMm: readonly number[];
  batchSize: number;
  processGroup: string;
  machineClass: string;
  costContext: CostContext;
}): { line: ProcessLineCost; warnings: string[] } {
  const warnings: string[] = [];
  const P = 'Cleaning';
  const kg = input.partWeight?.value ?? null;
  if (!(kg != null && kg > 0)) return { line: gap(P, input.processGroup, input.machineClass, 'part mass not known (no volume or material density)'), warnings };
  const [a, b] = [...input.partDimsMm].sort((x, y) => y - x);
  const evals = input.machines.map((m) => {
    const perLoad = num(m.specs['time_per_load_min']);
    const cap = num(m.specs['weight_capacity_kg']);
    const maxBatch = num(m.specs['max_batch_size']);
    const h = num(m.specs['max_height_mm']);
    const w = num(m.specs['max_width_mm']);
    const reasons: string[] = [];
    if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (h == null || w == null) reasons.push('no max width / height on file');
    else if (!(a != null && b != null && ((a <= w && b <= h) || (a <= h && b <= w)))) reasons.push(`part ${r2(a ?? 0)} x ${r2(b ?? 0)} mm does not fit ${w} x ${h} mm`);
    const seeds = new SeedSet()
      .put('Time per Load', perLoad != null && perLoad > 0 ? perLoad : null, (x) => castingSeed.machine(m.name, 'Time per Load (min)', x), 'no Time per Load on file')
      .put('Weight Capacity', cap != null && cap > 0 ? cap : null, (x) => castingSeed.machine(m.name, 'Weight Capacity (kg)', x), 'no Weight Capacity on file')
      .put('Max Batch Size', maxBatch != null && maxBatch > 0 ? maxBatch : null, (x) => castingSeed.machine(m.name, 'Max Batch Size', x), 'no Max Batch Size on file');
    reasons.push(...seeds.missing);
    if (reasons.length) return { m, reasons, run: null, sec: 0, cost: Infinity };
    const run = runReferenceCalculator(input.calculators, P, seeds.with({ 'Part Weight': input.partWeight! }));
    if (run.value == null) return { m, reasons: run.missing, run: null, sec: 0, cost: Infinity };
    if (!(run.outputs['Parts per Load']! >= 1)) return { m, reasons: [`part ${r2(kg)} kg over the ${cap} kg load capacity`], run: null, sec: 0, cost: Infinity };
    return { m, reasons, run, sec: run.value, cost: (crewed(m) * run.value) / 3600 };
  });
  const best = evals.filter((e) => e.reasons.length === 0).sort((x, y) => x.cost - y.cost)[0];
  const choice = machineChoice({
    rule: RUN_RULE,
    criteria: [
      `Part ${r2(a ?? 0)} x ${r2(b ?? 0)} mm fits the machine's max width x height (either way round)`,
      `At least one ${r2(kg)} kg part per load (Weight Capacity); parts per load capped by Max Batch Size`,
      'Machine hour rate, Time per Load, Weight Capacity and Max Batch Size on file',
    ],
    evals: evals.map((e): ChoiceEval => ({
      name: e.m.name, reasons: e.reasons, cost: e.reasons.length ? null : e.cost,
      note: e.run ? `${e.run.outputs['Parts per Load']} parts per ${num(e.m.specs['time_per_load_min'])} min load` : undefined,
    })),
    chosen: best?.m.name ?? null,
  });
  if (!best) return { line: { ...gap(P, input.processGroup, input.machineClass, `no cleaning machine in HR Rates fits a ${r2(kg)} kg part of ${r2(a ?? 0)} x ${r2(b ?? 0)} mm`), machineChoice: choice }, warnings };
  return {
    line: {
      ...line({
        process: P, processGroup: input.processGroup, processRoute: P, machineClass: input.machineClass, machine: best.m,
        sec: best.sec, batchSize: input.batchSize, costContext: input.costContext, warnings, run: best.run!,
        breakdown: `${num(best.m.specs['time_per_load_min'])} min per load / ${best.run!.outputs['Parts per Load']} parts per load`,
      }),
      machineChoice: choice,
    },
    warnings,
  };
}

export function visualInspectionLine(input: {
  machines: readonly FinishingMachine[];
  calculators: ReferenceCalculators | null;
  rows: readonly VisualInspectionRow[];
  partMassKg: number | null;
  surfaceAreaMm2: number | null;
  batchSize: number;
  processGroup: string;
  machineClass: string;
  costContext: CostContext;
}): { line: ProcessLineCost; warnings: string[] } {
  const warnings: string[] = [];
  const P = 'Visual Inspection';
  if (!(input.surfaceAreaMm2 && input.surfaceAreaMm2 > 0)) return { line: gap(P, input.processGroup, input.machineClass, 'part surface area not measured'), warnings };
  if (!(input.partMassKg && input.partMassKg > 0)) return { line: gap(P, input.processGroup, input.machineClass, 'part mass not known (no volume or material density)'), warnings };
  const row = weightBand(input.rows, input.partMassKg);
  if (!row) return { line: gap(P, input.processGroup, input.machineClass, `tblVisualInspection has no row for ${r2(input.partMassKg)} kg`), warnings };
  const run = runReferenceCalculator(input.calculators, P, {
    'Surface Area': castingSeed.cad(input.surfaceAreaMm2, 'part surface area (mm²)'),
    'External Inspection Rate': castingSeed.lookup('tblVisualInspection', 'External Inspection Rate (min / m^2)', row.externalMinPerM2, { 'Max Weight (kg)': row.maxWeightKg }),
  });
  if (run.value == null) return { line: gap(P, input.processGroup, input.machineClass, run.missing.join('; ')), warnings };
  const sec = run.value;
  const evals: ChoiceEval[] = input.machines.map((m) => m.machineRatePerHr == null
    ? { name: m.name, reasons: ['no machine hour rate on file'] }
    : { name: m.name, reasons: [], cost: (crewed(m) * sec) / 3600 });
  const machine = input.machines.filter((m) => m.machineRatePerHr != null).sort((x, y) => crewed(x) - crewed(y))[0];
  const m2 = input.surfaceAreaMm2 / 1e6;
  const choice = machineChoice({
    rule: RUN_RULE,
    criteria: [`Inspection time is the same on every station (${r3(m2)} m² x ${row.externalMinPerM2} min/m²), so the cheapest crewed rate wins`, 'Machine hour rate on file'],
    evals, chosen: machine?.name ?? null,
  });
  if (!machine) return { line: { ...gap(P, input.processGroup, input.machineClass, 'no visual inspection station in HR Rates'), machineChoice: choice }, warnings };
  return {
    line: {
      ...line({
        process: P, processGroup: input.processGroup, processRoute: P, machineClass: input.machineClass, machine,
        sec, batchSize: input.batchSize, costContext: input.costContext, warnings, run,
        breakdown: `${r3(m2)} m² x ${row.externalMinPerM2} min/m² (tblVisualInspection ≤ ${row.maxWeightKg} kg)`,
      }),
      machineChoice: choice,
    },
    warnings,
  };
}

/**
 * Trim (removing gates, runners and overflows): each real trim press (HR
 * Rates class die_casting_trim) strokes once per Cycle Time, trimming
 * defaultNumberOfTrimmedParts parts per stroke (calculator Trim). The press
 * must give the force that shears the parting-line flash (calculator Trim
 * Force); the cheapest per part among the presses strong enough is chosen.
 */
export function trimLine(input: {
  machines: readonly FinishingMachine[];
  calculators: ReferenceCalculators | null;
  partsPerStroke: number | null;
  /** Parting-line perimeter at the pull plane (cad-engine casting_geometry); null when not measured. */
  partingPerimeterMm: number | null;
  partMassKg: number | null;
  dimensions: ReadonlyArray<{ maxWeightKg: number; partingLineThicknessMm: number }>;
  /** The alloy name and its Shear Strength (MPa); null when not on file. */
  alloyName: string | null;
  shearStrengthMpa: number | null;
  batchSize: number;
  processGroup: string;
  machineClass: string;
  costContext: CostContext;
}): { line: ProcessLineCost; warnings: string[]; forceRun: CalculatorRunDto | null } {
  const warnings: string[] = [];
  const P = 'Trim';
  // Force to shear the flash off along the parting line (calculator Trim Force).
  const flash = input.partMassKg != null ? weightBand(input.dimensions, input.partMassKg) ?? null : null;
  const forceSeeds = new SeedSet()
    .put('Parting Line Perimeter', input.partingPerimeterMm, (x) => castingSeed.cad(x, 'parting-line perimeter (mm)'), 'parting-line perimeter not measured (re-run analysis)')
    .put('Flash Thickness', flash?.partingLineThicknessMm, (x) => castingSeed.lookup('tblGrindingDimensions', 'Parting Line Thickness (mm)', x, { 'Max Weight (kg)': flash!.maxWeightKg }),
      `tblGrindingDimensions has no row for ${input.partMassKg != null ? `${r2(input.partMassKg)} kg` : 'an unknown part weight'}`)
    .put('Shear Strength', input.shearStrengthMpa, (x) => castingSeed.alloy(input.alloyName ?? 'alloy', 'Shear Strength (MPa)', x), 'the alloy has no Shear Strength on file');
  const forceRaw = forceSeeds.missing.length ? null : runReferenceCalculator(input.calculators, 'Trim Force', forceSeeds.seeds, 'Trim Force');
  const forceRun = forceRaw ? runView('Die Casting - Trim Force', 'Trim Force', forceRaw) : null;
  const requiredKn = forceRaw?.value ?? null;
  const forceGap = forceSeeds.missing.length ? forceSeeds.missing.join('; ') : forceRaw?.missing.join('; ') ?? '';
  const stroke = new SeedSet().put('Parts per Stroke', input.partsPerStroke != null && input.partsPerStroke > 0 ? input.partsPerStroke : null,
    (x) => castingSeed.variable('defaultNumberOfTrimmedParts', x), 'variables defaultNumberOfTrimmedParts not staged');
  if (stroke.missing.length) return { line: gap(P, input.processGroup, input.machineClass, stroke.missing[0]!), warnings, forceRun };
  const evals = input.machines.map((m) => {
    const cycle = num(m.specs['cycle_time_s']);
    const force = num(m.specs['press_force_kn']);
    const reasons: string[] = [];
    if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (!(cycle! > 0)) reasons.push('no Cycle Time on file');
    if (requiredKn != null) {
      if (force == null) reasons.push('no Press Force on file');
      else if (force < requiredKn) reasons.push(`Press Force ${force} kN below the ${r2(requiredKn)} kN trim force`);
    }
    if (reasons.length) return { m, reasons, run: null, sec: 0, cycle: 0, cost: Infinity };
    const run = runReferenceCalculator(input.calculators, P, stroke.with({ 'Press Cycle Time': castingSeed.machine(m.name, 'Cycle Time (s)', cycle!) }));
    if (run.value == null) return { m, reasons: run.missing, run: null, sec: 0, cycle: 0, cost: Infinity };
    return { m, reasons, run, sec: run.value, cycle: cycle!, cost: (crewed(m) * run.value) / 3600 };
  });
  const best = evals.filter((e) => e.reasons.length === 0).sort((x, y) => x.cost - y.cost)[0];
  const choice = machineChoice({
    rule: RUN_RULE,
    criteria: [
      `Per part = press Cycle Time / ${input.partsPerStroke} part${input.partsPerStroke === 1 ? '' : 's'} per stroke (defaultNumberOfTrimmedParts)`,
      'Machine hour rate and Cycle Time on file',
      requiredKn != null
        ? `Press Force at least ${r2(requiredKn)} kN (parting line ${r2(input.partingPerimeterMm!)} mm x ${flash!.partingLineThicknessMm} mm flash x ${input.shearStrengthMpa} MPa shear strength)`
        : `Press force not checked: ${forceGap}`,
    ],
    evals: evals.map((e): ChoiceEval => ({ name: e.m.name, reasons: e.reasons, cost: e.reasons.length ? null : e.cost, note: e.reasons.length ? undefined : `${e.cycle} s per stroke` })),
    chosen: best?.m.name ?? null,
  });
  if (!best) return { line: { ...gap(P, input.processGroup, input.machineClass, requiredKn != null ? `no trim press in HR Rates with a cycle time, a rate and ${r2(requiredKn)} kN press force` : 'no trim press in HR Rates with a cycle time and a rate'), machineChoice: choice }, warnings, forceRun };
  if (requiredKn == null) warnings.push(`Trim: press force not checked against ${best.m.name} (${forceGap}).`);
  return {
    line: {
      ...line({
        process: P, processGroup: input.processGroup, processRoute: P, machineClass: input.machineClass, machine: best.m,
        sec: best.sec, batchSize: input.batchSize, costContext: input.costContext, warnings, run: best.run!,
        breakdown: `${best.cycle} s per stroke / ${input.partsPerStroke} part${input.partsPerStroke === 1 ? '' : 's'} per stroke`,
      }),
      machineChoice: choice,
    },
    warnings,
    forceRun,
  };
}

/** A route step memory holds no cost data for: shown, named, not priced. */
export function unpricedStep(process: string, processGroup: string, machineClass: string, reason: string): ProcessLineCost {
  return gap(process, processGroup, machineClass, reason);
}

/**
 * Finishing (calculator Finishing): grind the parting-line flash (CAD perimeter
 * x tblGrindingDimensions thickness x height for the part weight) and, on a
 * pressure die, the ingate stubs (runner area from the thickest wall, ingate
 * area x Ingate Height, one ingate per ingateGap of part length), each at the
 * machine grinding speed x the alloy Cut Code factor
 * (tblGrindingSpeedMaterialFactor), on each real finishing machine (HR Rates
 * class die_casting_finishing) whose Max Weight carries the part; the cheapest
 * per part is chosen. A gravity die grinds no gate stubs here (gatesGround
 * false, with the reason on the line).
 */
export function partingLineGrindingLine(input: {
  machines: readonly FinishingMachine[];
  calculators: ReferenceCalculators | null;
  partMassKg: number | null;
  partingPerimeterMm: number | null;
  dimensions: ReadonlyArray<{ maxWeightKg: number; partingLineThicknessMm: number; partingLineHeightMm: number; ingateHeightMm: number }>;
  /** tblGrindingSpeedMaterialFactor for the alloy and its Cut Code; null when the alloy has no Cut Code or no row. */
  speedFactor: number | null;
  cutCode: number | null;
  speedFactorNote: string;
  /** Pressure die: its ingate stubs are ground; otherwise why they are not. */
  gates: { ground: true } | { ground: false; reason: string };
  wallMaxMm: number | null;
  partLengthMm: number | null;
  variables: { additionalRunnerThickness: number; runnerAspectRatio: number; ingateAreaToRunnerArea: number; ingateGap: number };
  batchSize: number;
  processGroup: string;
  machineClass: string;
  costContext: CostContext;
}): { line: ProcessLineCost; warnings: string[] } {
  const warnings: string[] = input.gates.ground ? [] : [`Finishing: gate stubs are not ground on this line (${input.gates.reason}).`];
  const P = 'Finishing';
  const g = (reason: string) => ({ line: gap(P, input.processGroup, input.machineClass, reason), warnings });
  if (!(input.partMassKg && input.partMassKg > 0)) return g('part mass not known (no volume or material density)');
  if (input.speedFactor == null) return g(input.speedFactorNote);
  const row = weightBand(input.dimensions, input.partMassKg);
  if (!row) return g(`tblGrindingDimensions has no row for ${r2(input.partMassKg)} kg`);
  const band = { 'Max Weight (kg)': row.maxWeightKg };
  const v = input.variables;
  const seeds = new SeedSet()
    .put('Parting Line Perimeter', input.partingPerimeterMm, (x) => castingSeed.cad(x, 'parting-line perimeter (mm)'), 'parting-line perimeter not measured (re-run analysis as a casting process)')
    .put('Flash Thickness', row.partingLineThicknessMm, (x) => castingSeed.lookup('tblGrindingDimensions', 'Parting Line Thickness (mm)', x, band), 'tblGrindingDimensions Parting Line Thickness')
    .put('Flash Height', row.partingLineHeightMm, (x) => castingSeed.lookup('tblGrindingDimensions', 'Parting Line Height (mm)', x, band), 'tblGrindingDimensions Parting Line Height')
    .put('Ingate Height', row.ingateHeightMm, (x) => castingSeed.lookup('tblGrindingDimensions', 'Ingate Height (mm)', x, band), 'tblGrindingDimensions Ingate Height')
    .put('Material Factor', input.speedFactor, (x) => castingSeed.lookup('tblGrindingSpeedMaterialFactor', 'Grinding Speed Material Factor', x, { 'Material Cut Code': input.cutCode! }), input.speedFactorNote)
    .put('Gates Ground', input.gates.ground ? 1 : 0, (x) => castingSeed.engine(x, x ? 'pressure die: its ingate stubs are ground' : `no gate stubs ground: ${(input.gates as { reason: string }).reason}`), 'gates')
    .put('Wall Max', input.wallMaxMm, (x) => castingSeed.cad(x, 'thickest wall (mm)'), 'thickest wall not measured, so the runner and ingate are not sized')
    .put('Part Length', input.partLengthMm, (x) => castingSeed.cad(x, 'longest part dimension (mm)'), 'part length not known, so the ingate count is not known')
    .put('Additional Runner Thickness', v.additionalRunnerThickness, (x) => castingSeed.variable('additionalRunnerThickness', x), 'variables additionalRunnerThickness')
    .put('Runner Aspect Ratio', v.runnerAspectRatio, (x) => castingSeed.variable('runnerAspectRatio', x), 'variables runnerAspectRatio')
    .put('Ingate to Runner Area', v.ingateAreaToRunnerArea, (x) => castingSeed.variable('ingateAreaToRunnerArea', x), 'variables ingateAreaToRunnerArea')
    .put('Ingate Gap', v.ingateGap, (x) => castingSeed.variable('ingateGap', x), 'variables ingateGap');
  if (seeds.missing.length) return g(seeds.missing.join('; '));
  const evals = input.machines.map((m) => {
    const speed = num(m.specs['grinding_speed_parting_line_mm3_per_s']);
    const gateSpeed = num(m.specs['grinding_speed_gating_mm3_per_s']);
    const maxKg = num(m.specs['max_weight_kg']);
    const reasons: string[] = [];
    if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
    if (!(speed! > 0)) reasons.push('no parting-line grinding speed on file');
    if (!(gateSpeed! > 0)) reasons.push('no gating grinding speed on file');
    if (maxKg == null) reasons.push('no Max Weight on file');
    else if (maxKg < input.partMassKg!) reasons.push(`part ${r2(input.partMassKg!)} kg over its ${maxKg} kg Max Weight`);
    if (reasons.length) return { m, reasons, run: null, sec: 0, speed: 0, gateSpeed: 0, cost: Infinity };
    const run = runReferenceCalculator(input.calculators, P, seeds.with({
      'Grinding Speed Parting Line': castingSeed.machine(m.name, 'Grinding Speed Parting Line (mm³/s)', speed!),
      'Grinding Speed Gating': castingSeed.machine(m.name, 'Grinding Speed Gating (mm³/s)', gateSpeed!),
    }));
    if (run.value == null) return { m, reasons: run.missing, run: null, sec: 0, speed: 0, gateSpeed: 0, cost: Infinity };
    return { m, reasons, run, sec: run.value, speed: speed!, gateSpeed: gateSpeed!, cost: (crewed(m) * run.value) / 3600 };
  });
  const best = evals.filter((e) => e.reasons.length === 0).sort((x, y) => x.cost - y.cost)[0];
  const choice = machineChoice({
    rule: RUN_RULE,
    criteria: [
      `Carries the ${r2(input.partMassKg)} kg part (Max Weight)`,
      `Per part = flash / (Grinding Speed Parting Line x ${input.speedFactor} Cut Code factor)${input.gates.ground ? ' + gate stubs / (Grinding Speed Gating x the same factor)' : ''}`,
      'Machine hour rate and grinding speeds on file',
    ],
    evals: evals.map((e): ChoiceEval => ({ name: e.m.name, reasons: e.reasons, cost: e.reasons.length ? null : e.cost, note: e.reasons.length ? undefined : `${e.speed} mm³/s` })),
    chosen: best?.m.name ?? null,
  });
  if (!best) return { line: { ...gap(P, input.processGroup, input.machineClass, `no finishing machine in HR Rates carries a ${r2(input.partMassKg)} kg part with grinding speeds and a rate`), machineChoice: choice }, warnings };
  const o = best.run!.outputs;
  const base = line({
    process: P, processGroup: input.processGroup, processRoute: P, machineClass: input.machineClass, machine: best.m,
    sec: best.sec, batchSize: input.batchSize, costContext: input.costContext, warnings, run: best.run!,
    breakdown: `${r2(o['Flash Volume']!)} mm³ flash / (${best.speed} mm³/s × ${input.speedFactor})`,
  });
  return {
    line: {
      ...base,
      featureBreakdown: [
        { name: `${r2(input.partingPerimeterMm!)} mm parting line × ${row.partingLineThicknessMm} × ${row.partingLineHeightMm} mm flash = ${r2(o['Flash Volume']!)} mm³ / (${best.speed} mm³/s × ${input.speedFactor})`, featureType: 'Part', timeSec: r2(o['Parting Line Time']!), count: 1 },
        ...(o['Ingates']! > 0 ? [{ name: `${o['Ingates']} ingate stub${o['Ingates'] === 1 ? '' : 's'} × ${r2(o['Ingate Area']!)} mm² × ${row.ingateHeightMm} mm = ${r2(o['Gate Stub Volume']!)} mm³ / (${best.gateSpeed} mm³/s × ${input.speedFactor})`, featureType: 'Part', timeSec: r2(o['Gate Time']!), count: o['Ingates']! }] : []),
      ],
      machineChoice: choice,
    },
    warnings,
  };
}

/**
 * Melting (calculator Melting): the melted metal per part (the shot shared
 * across cavities) at the ductile-iron melter Conversion Cost x
 * regionConvFactor. The furnace is the smallest one hot enough for the alloy
 * that holds the batch melt (Required Furnace Capacity), else the largest hot
 * enough one in several heats; melting is costed per kg, the same on every furnace.
 */
export function meltingLine(input: {
  furnaces: readonly FinishingMachine[];
  calculators: ReferenceCalculators | null;
  /** The ductile-iron melter whose Conversion Cost prices the melt, in the line currency per kg; null when not on file. */
  ductileIron: { name: string; costPerKg: number } | null;
  regionConvFactor: number;
  furnaceCapacitySafetyFactor: number;
  shotVolumeMm3: number | null;
  cavities: number | null;
  alloyName: string | null;
  densityKgM3: number | null;
  injectionTempC: number | null;
  batchSize: number;
  processGroup: string;
  machineClass: string;
}): { line: ProcessLineCost; warnings: string[]; meltedKg: number | null } {
  const warnings: string[] = [];
  const P = 'Melting';
  const g = (reason: string) => ({ line: gap(P, input.processGroup, input.machineClass, reason), warnings, meltedKg: null });
  if (input.ductileIron == null) return g('the ductile-iron melter (Induction - DI, HR Rates class casting_pm_melting) has no Conversion Cost on file for this location');
  if (input.injectionTempC == null) return g('the alloy has no Injection Temp on file, so no furnace can be checked for it');
  const seeds = new SeedSet()
    .put('Shot Volume', input.shotVolumeMm3, (x) => castingSeed.calculator(x, 'Shot Volume'), 'melted metal per part not derived (casting line not costed)')
    .put('Cavities', input.cavities, (x) => castingSeed.engine(x, `${x} cavit${x === 1 ? 'y' : 'ies'} per shot`), 'cavities')
    .put('Density', input.densityKgM3, (x) => castingSeed.alloy(input.alloyName ?? 'alloy', 'Density (kg/m^3)', x), 'alloy density')
    .put('Conversion Cost', input.ductileIron.costPerKg, (x) => castingSeed.machine(input.ductileIron!.name, 'Conversion Cost per kg', x), 'Conversion Cost')
    .put('Region Conversion Factor', input.regionConvFactor, (x) => castingSeed.variable('regionConvFactor', x), 'variables regionConvFactor')
    .put('Batch Size', input.batchSize, (x) => castingSeed.scenario(x, 'batch size'), 'batch size')
    .put('Furnace Capacity Safety Factor', input.furnaceCapacitySafetyFactor, (x) => castingSeed.variable('furnaceCapacitySafetyFactor', x), 'variables furnaceCapacitySafetyFactor');
  if (seeds.missing.length) return g(seeds.missing.join('; '));
  const run = runReferenceCalculator(input.calculators, P, seeds.seeds, 'Cost per Part');
  if (run.value == null) return g(run.missing.join('; '));
  const needM3 = run.outputs['Required Furnace Capacity']!;
  const all = input.furnaces.map((f) => ({ f, cap: num(f.specs['furnace_capacity_m3']), temp: num(f.specs['max_temperature_c']) }));
  const hot = all
    .filter((x) => x.cap != null && x.cap > 0 && x.temp != null && x.temp >= input.injectionTempC!)
    .sort((a, b) => a.cap! - b.cap!);
  const holds = hot.find((x) => x.cap! >= needM3);
  const chosen = holds ?? hot[hot.length - 1];
  const choice = machineChoice({
    rule: 'The smallest furnace that reaches the alloy temperature and holds the batch metal (else the largest hot enough one, in several heats); melting is costed per kg, the same on every furnace',
    criteria: [
      `Max Temperature at least the alloy injection temperature ${input.injectionTempC} C`,
      `Capacity at least ${r3(needM3)} m³ (Required Furnace Capacity: batch ${input.batchSize} x ${r2(run.outputs['Melted Volume']! / 1000)} cm³ melted x furnaceCapacitySafetyFactor ${input.furnaceCapacitySafetyFactor})`,
    ],
    evals: all.map((x): ChoiceEval => {
      const reasons: string[] = [];
      if (x.temp == null) reasons.push('no Max Temperature on file');
      else if (x.temp < input.injectionTempC!) reasons.push(`Max Temperature ${x.temp} C below ${input.injectionTempC} C`);
      if (x.cap == null || !(x.cap > 0)) reasons.push('no Furnace Capacity on file');
      else if (reasons.length === 0 && holds && x.cap < needM3) reasons.push(`capacity ${x.cap} m³ below ${r3(needM3)} m³`);
      return { name: x.f.name, reasons, cost: null, rank: x.cap ?? Infinity, note: reasons.length ? undefined : `${x.cap} m³, ${x.temp} C` };
    }),
    chosen: chosen?.f.name ?? null,
  });
  const meltedKg = run.outputs['Melted Weight']!;
  if (!chosen) return { line: { ...gap(P, input.processGroup, input.machineClass, `no melting furnace in HR Rates reaches the alloy injection temperature ${input.injectionTempC} C`), machineChoice: choice }, warnings, meltedKg };
  if (!holds) warnings.push(`Melting: no furnace holds the batch metal at once; ${chosen.f.name} melts it in ${Math.ceil(needM3 / chosen.cap!)} heats.`);
  return {
    line: {
      process: P, processGroup: input.processGroup, processRoute: P, operation: P,
      setupCost: 0, runCost: r2(run.value), totalCost: r2(run.value), cycleTimeMin: 0,
      hourlyRate: 0, rateSource: 'consumable_allowance', machineClass: input.machineClass, machineName: chosen.f.name,
      commodityCode: null, labourRate: null, mhrId: chosen.f.id,
      machineChoice: choice,
      featureBreakdown: [{
        name: `${r3(run.outputs['Melted Weight']!)} kg melted x ${r3(input.ductileIron.costPerKg)}/kg (Induction - DI Conversion Cost) x ${input.regionConvFactor} (regionConvFactor)`,
        featureType: 'Part', timeSec: 0, count: 1,
      }],
      ...runOnLine(run),
    },
    warnings,
    meltedKg,
  };
}
