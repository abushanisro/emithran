// Price the machining a primary process (casting, ...) leaves to be done:
// for every feature machining-need.ts marks needs_machining, time each capable
// candidate operation with its database calculator (runMachiningCalculator,
// the same calculators the machining engine runs) and keep the cheapest per
// feature on its real HR Rates machine. Pure.
//
// Calculator for a candidate: the one named after the catalog operation, else
// the one named after its capability process (Finish Traverse Grinding ->
// Surface Grinding). Inputs come from the feature's own CAD measurements:
//   hole calculators (Drilling, Reaming, Jig Boring, Gun Drilling, Deep Bore
//   Machine)   Hole Diameter, Hole Depth, Holes = 1, plus the operation's
//              lookup-table speed/feed (machiningLookupSeeds)
//   Surface Grinding   Grind Length / Width = the face's oriented-box sides
//   Internal Grinding  Grind Diameter = bore diameter, Grind Length = depth
// A calculator whose inputs the feature does not have (Cylindrical Grinding
// needs an outside diameter; no calculator exists for Boring or Milling) leaves
// that candidate unpriced, with the reason; it never prices on a stand-in.
//
// Machine per calculator follows the machining engine (cost-machining-engine.ts):
// Drilling and Reaming on the part's milling machine; Jig Boring, Gun Drilling,
// Deep Bore and each grinder on their own HR Rates class. Accessibility (which
// side a tool reaches the feature from) is not assessed: the milling machine
// is the caller's choice, disclosed on the line.

import type { FeatureOp, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { MHRRateInput } from '../core/cost-engine';
import { MACHINE_REGISTRY } from '../core/default-rates.constants';
import { eMithranTerms, resolveSetupMinutes, type EMithranTermsArgs } from '../core/engine-kernel';
import { runMachiningCalculator, type CalcRun, type CalcSeed, type MachiningCalculators } from '../../machining/calculators/machining-calculator';
import { machiningLookupSeeds, type MachiningLookupContext } from '../../machining/calculators/machining-lookup-seeds';
import type { FeatureInstance } from './feature-tolerances';
import type { MachiningNeedResult } from './machining-need';

const HOLE_CALCULATORS = new Set(['Drilling', 'Reaming', 'Jig Boring', 'Gun Drilling', 'Deep Bore Machine']);

/** HR Rates machine per calculator; the caller supplies the classes the machining engine uses. */
type MachineForCalculator = (calculator: string) => MHRRateInput | undefined;

interface PricedCandidate {
  operation: string;
  calculator: string;
  machine: MHRRateInput;
  sec: number;
  /** Run cost per part (machine + labour), currency of the rates. */
  runCost: number;
  run: CalcRun;
}

interface FeatureMachiningChoice {
  label: string;
  featureType: string;
  /** The operations run on the feature, in order: forming (if any), then the cheapest finishing. Empty when none could be priced. */
  chosen: PricedCandidate[];
  priced: Array<Omit<PricedCandidate, 'run' | 'machine'> & { machineName: string | null }>;
  unpriced: Array<{ operation: string; reason: string }>;
}

interface SecondaryMachiningResult {
  /** One line per machine that machines at least one feature. */
  lines: ProcessLineCost[];
  features: FeatureMachiningChoice[];
  warnings: string[];
}

/** A machine class's display name (its first registry keyword: '3 Axis Mill'), else the class id. */
function machineClassName(machineClass: string): string {
  const entry = (MACHINE_REGISTRY as Record<string, { machineClassKeywords?: readonly string[] }>)[machineClass];
  return entry?.machineClassKeywords?.[0] ?? machineClass;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function seedsFor(calculator: string, inst: FeatureInstance, ctx: MachiningLookupContext): { seeds: Record<string, CalcSeed>; missing: string[] } {
  const missing: string[] = [];
  const seeds: Record<string, CalcSeed> = {};
  if (HOLE_CALCULATORS.has(calculator)) {
    if (inst.sizeMm == null) return { seeds, missing: ['the hole has no measured diameter'] };
    seeds['Hole Diameter'] = { value: inst.sizeMm, source: `CAD: ${inst.label} diameter` };
    seeds['Holes'] = { value: 1, source: `CAD: ${inst.label}` };
    if (inst.depthMm != null) seeds['Hole Depth'] = { value: inst.depthMm, source: `CAD: ${inst.label} depth` };
  } else if (calculator === 'Surface Grinding') {
    const [len, wid] = inst.extentsMm ?? [];
    if (!(len! > 0) || !(wid! > 0)) return { seeds, missing: ['the face has no measured length and width'] };
    seeds['Grind Length'] = { value: len!, source: `CAD: ${inst.label} oriented-box length` };
    seeds['Grind Width'] = { value: wid!, source: `CAD: ${inst.label} oriented-box width` };
    seeds['Faces'] = { value: 1, source: `CAD: ${inst.label}` };
  } else if (calculator === 'Internal Grinding') {
    if (inst.sizeMm == null || inst.depthMm == null) return { seeds, missing: ['the bore has no measured diameter and depth'] };
    seeds['Grind Diameter'] = { value: inst.sizeMm, source: `CAD: ${inst.label} diameter` };
    seeds['Grind Length'] = { value: inst.depthMm, source: `CAD: ${inst.label} depth` };
    seeds['Surfaces'] = { value: 1, source: `CAD: ${inst.label}` };
  } else {
    return { seeds, missing: [`the ${calculator} calculator's inputs are not measured for a ${inst.featureType}`] };
  }
  const lookup = machiningLookupSeeds(calculator, ctx, { 'Hole Diameter': inst.sizeMm ?? NaN });
  if (lookup) { Object.assign(seeds, lookup.seeds); missing.push(...lookup.missing); }
  return { seeds, missing };
}

export function priceSecondaryMachining(input: {
  need: MachiningNeedResult;
  instances: readonly FeatureInstance[];
  calculators: MachiningCalculators | null;
  lookupContext: MachiningLookupContext;
  machineFor: MachineForCalculator;
  batchSize: number;
  costContext: Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;
  /** Shown on every line: what the caller could not assess (e.g. accessibility). */
  disclosures?: string[];
  /** The catalog identity (process group / route) of a machine class (process_calculator_mappings). */
  identityFor?: (machineClass: string) => { processGroup: string; processRoute: string; operation: string } | undefined;
  /** The deburr machine: when given, the machined features' sharp edges are deburred after. */
  deburr?: { machine: MHRRateInput };
  /**
   * Bench work after machining (memory/Machining Bench Operation), once per
   * part: each step's time from the reference variables, null when memory
   * holds none (the step is then a named, unpriced line).
   */
  bench?: {
    machine: MHRRateInput;
    steps: Array<{ operation: string; sec: number | null; source: string }>;
    /** The bench machine's setup hours from its memory reference record (resolveSetupMinutes referenceSetupTimeHr). */
    referenceSetupTimeHr?: number | null;
  };
  /** Per machine class: part handling added once to its first line (reorienting the part between setups). */
  handling?: Record<string, { sec: number; name: string }>;
}): SecondaryMachiningResult {
  const byKey = new Map(input.instances.filter((i) => i.key).map((i) => [i.key!, i]));
  const byLabel = new Map(input.instances.map((i) => [i.label, i]));
  const warnings: string[] = [];
  const features: FeatureMachiningChoice[] = [];

  for (const f of input.need.features.filter((x) => x.verdict === 'needs_machining')) {
    const inst = (f.featureKey ? byKey.get(f.featureKey) : undefined) ?? byLabel.get(f.label)!;
    const priced: PricedCandidate[] = [];
    const unpriced: FeatureMachiningChoice['unpriced'] = [];
    const price = (c: { operation: string; capabilityProcess: string }): PricedCandidate | null => {
      const calculator = input.calculators?.[c.operation] ? c.operation : input.calculators?.[c.capabilityProcess] ? c.capabilityProcess : null;
      if (!calculator) { unpriced.push({ operation: c.operation, reason: `no calculator for ${c.operation} or ${c.capabilityProcess}` }); return null; }
      const machine = input.machineFor(calculator);
      if (!machine || machine.source !== 'mhr_database') { unpriced.push({ operation: c.operation, reason: `no HR Rates machine for ${calculator}` }); return null; }
      // A stepped hole is drilled step by step: one hole-calculator run per
      // step, at that step's own diameter and depth, summed.
      const parts = inst.steps?.length && HOLE_CALCULATORS.has(calculator)
        ? inst.steps.map((st) => ({ ...inst, sizeMm: st.diameterMm, depthMm: st.depthMm > 0 ? st.depthMm : null, label: `${inst.label} step Ø${st.diameterMm}` }))
        : [inst];
      const runs = parts.map((part) => {
        const { seeds, missing: m } = seedsFor(calculator, part, input.lookupContext);
        return { run: runMachiningCalculator(input.calculators, calculator, seeds), missing: m };
      });
      const missing = runs.flatMap((r) => (r.run.sec == null ? [...r.missing, ...r.run.missing] : []));
      const run: CalcRun = {
        ...runs[0]!.run,
        sec: runs.every((r) => r.run.sec != null) ? runs.reduce((t, r) => t + r.run.sec!, 0) : null,
        trace: runs.flatMap((r) => r.run.trace),
        missing,
      };
      if (run.sec == null) { unpriced.push({ operation: c.operation, reason: [...missing, ...run.missing].join('; ') }); return null; }
      const ops = machine.operators ?? null;
      const runCost = ((machine.rate + (ops != null ? (machine.labourRate ?? 0) * ops : 0)) * run.sec) / 3600;
      const p = { operation: c.operation, calculator, machine, sec: run.sec, runCost, run };
      priced.push(p);
      return p;
    };

    const chosen: PricedCandidate[] = [];
    let complete = true;
    if (f.forming) {
      const p = price(f.forming);
      if (p) chosen.push(p); else complete = false;
    }
    if (f.candidates.length > 0) {
      const finishing = f.candidates.map(price).filter((p): p is PricedCandidate => p != null).sort((a, b) => a.runCost - b.runCost);
      if (finishing[0]) chosen.push(finishing[0]); else complete = false;
    }
    if (!complete || chosen.length === 0) {
      warnings.push(`${f.label} needs machining but ${chosen.length ? 'not every operation' : 'no operation'} could be priced: ${unpriced.map((u) => `${u.operation} (${u.reason})`).join('; ') || 'no operation on file'}.`);
    }
    features.push({
      label: f.label, featureType: f.featureType, chosen: complete ? chosen : [],
      priced: priced.map(({ run: _r, machine, ...p }) => ({ ...p, machineName: machine.machineName })),
      unpriced,
    });
  }

  // One line per (machine class, operation): Drilling and Reaming on the same
  // mill are two lines, as the machining engine prices them, each with its
  // catalog identity. The machine's setup is charged once, on its first line.
  type Pick = { f: FeatureMachiningChoice; op: PricedCandidate; inst: FeatureInstance };
  const groups = new Map<string, { machine: MHRRateInput; operation: string; picks: Pick[] }>();
  for (const f of features) {
    for (const op of f.chosen) {
      const k = `${op.machine.machineClass}|${op.operation}`;
      const g = groups.get(k) ?? { machine: op.machine, operation: op.operation, picks: [] };
      g.picks.push({ f, op, inst: byLabel.get(f.label)! });
      groups.set(k, g);
    }
  }
  const lines: ProcessLineCost[] = [];
  const setupCharged = new Set<string>();
  const lineFor = (machine: MHRRateInput, operation: string, sec: number, breakdown: FeatureOp[], referenceSetupTimeHr?: number | null): ProcessLineCost => {
    const firstOnMachine = !setupCharged.has(machine.machineClass);
    setupCharged.add(machine.machineClass);
    const handling = firstOnMachine ? input.handling?.[machine.machineClass] : undefined;
    if (handling) {
      sec += handling.sec;
      breakdown = [...breakdown, { name: handling.name, featureType: 'Part', timeSec: r2(handling.sec), count: 1 }];
    }
    const setup = firstOnMachine
      ? resolveSetupMinutes({ process: operation, referenceSetupTimeHr, machineSetupTimeHr: machine.setupTimeHr, machineName: machine.machineName })
      : { setupMin: 0, source: 'none' as const };
    if (firstOnMachine && 'warning' in setup && setup.warning) warnings.push(setup.warning);
    const ops = machine.operators ?? null;
    if (ops == null && firstOnMachine) warnings.push(`${machine.machineName ?? machine.machineClass}: no operator count on file, labour not costed on its lines.`);
    const terms = eMithranTerms({
      ...input.costContext,
      mhrPerHr: machine.rate,
      dlrPerHr: ops != null ? machine.labourRate ?? 0 : 0,
      setupNDL: ops ?? 0,
      cycleNDL: ops ?? 0,
      cycleTimeMin: sec / 60,
      setupTimeMin: setup.setupMin / Math.max(input.batchSize, 1),
    });
    const identity = input.identityFor?.(machine.machineClass);
    const candidate = machine.selection?.balanced?.candidate as { machineId?: string } | undefined;
    return {
      process: operation,
      processGroup: identity?.processGroup ?? 'Machining',
      processRoute: identity?.processRoute ?? machineClassName(machine.machineClass),
      operation,
      setupCost: r2(terms.setupCost),
      runCost: r2(terms.total - terms.setupCost),
      totalCost: r2(terms.total),
      cycleTimeMin: r3(sec / 60),
      setupTimeMin: r3(setup.setupMin),
      setupTimeSource: setup.source,
      operators: ops,
      hourlyRate: machine.rate,
      rateSource: 'mhr_database',
      machineClass: machine.machineClass,
      machineName: machine.machineName,
      commodityCode: machine.commodityCode,
      labourRate: machine.labourRate ?? null,
      ...(machine.selection ? { machineSelection: machine.selection } : {}),
      ...(candidate?.machineId ? { mhrId: candidate.machineId } : {}),
      featureBreakdown: breakdown,
    };
  };
  const occRef = (inst: FeatureInstance | undefined) =>
    inst?.featureId ? { occurrenceRefs: [{ featureId: inst.featureId, occurrenceIndex: inst.occurrenceIndex }] } : {};
  for (const { machine, operation, picks } of groups.values()) {
    const sec = picks.reduce((t, p) => t + p.op.sec, 0);
    lines.push(lineFor(machine, operation, sec, picks.map(({ f, op, inst }) => ({
      name: f.label, featureType: f.featureType, timeSec: r2(op.sec), count: 1, ...occRef(inst),
    }))));
  }

  // Deburring: the sharp edges machining creates -- every CAD sharp edge
  // touching a machined feature's faces -- at the Deburring calculator's
  // tblDeburring edge speed (the machining engine's own deburr model).
  const machined = features.filter((f) => f.chosen.length > 0).map((f) => byLabel.get(f.label)!).filter(Boolean);
  if (machined.length > 0 && input.deburr) {
    const edges = input.instances.filter((i) => i.featureType === 'SharpEdge' && i.lengthMm != null);
    const rows: FeatureOp[] = [];
    let sec = 0;
    const gaps: string[] = [];
    for (const inst of machined) {
      const faces = new Set(inst.faceIds);
      const lengthMm = edges.filter((e) => e.faceIds.some((id) => faces.has(id))).reduce((t, e) => t + e.lengthMm!, 0);
      if (lengthMm <= 0) continue;
      const lookup = machiningLookupSeeds('Deburring', input.lookupContext, {});
      const run = runMachiningCalculator(input.calculators, 'Deburring', {
        'Sharp Edge Length': { value: lengthMm, source: `CAD: sharp edges touching ${inst.label}` },
        ...(lookup?.seeds ?? {}),
      });
      if (run.sec == null) { gaps.push(...(lookup?.missing ?? []), ...run.missing); continue; }
      sec += run.sec;
      rows.push({ name: inst.label, featureType: inst.featureType, timeSec: r2(run.sec), count: 1, ...occRef(inst) });
    }
    if (gaps.length) warnings.push(`Deburring after machining not fully priced: ${[...new Set(gaps)].join('; ')}.`);
    if (rows.length === 0 && gaps.length === 0) warnings.push('Deburring after machining: no CAD sharp edge touches a machined feature (re-run analysis if edges are missing).');
    if (rows.length > 0) {
      if (input.deburr.machine.source === 'mhr_database') lines.push(lineFor(input.deburr.machine, 'Deburring', sec, rows));
      else warnings.push('Deburring after machining not costed: no deburr machine in HR Rates.');
    }
  }

  if (machined.length > 0 && input.bench) {
    const m = input.bench.machine;
    for (const step of input.bench.steps) {
      if (step.sec == null) {
        lines.push({
          process: step.operation, processGroup: input.identityFor?.(m.machineClass)?.processGroup ?? 'Machining',
          processRoute: input.identityFor?.(m.machineClass)?.processRoute ?? machineClassName(m.machineClass), operation: step.operation,
          setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
          machineClass: m.machineClass, machineName: m.machineName, commodityCode: null, labourRate: null,
          physicsGap: { gapType: 'unsupported_operation', process: step.operation, machineClass: m.machineClass, reason: step.source },
        });
        warnings.push(`${step.operation} not priced: ${step.source}`);
        continue;
      }
      if (m.source !== 'mhr_database') { warnings.push(`${step.operation} not costed: no ${machineClassName(m.machineClass)} in HR Rates.`); continue; }
      lines.push(lineFor(m, step.operation, step.sec, [{ name: 'Part', featureType: 'Part', timeSec: r2(step.sec), count: 1 }], input.bench.referenceSetupTimeHr));
    }
  }

  warnings.push(...(input.disclosures ?? []));
  return { lines, features, warnings };
}
