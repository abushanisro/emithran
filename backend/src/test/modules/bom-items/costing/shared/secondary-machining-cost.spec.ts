import { join } from 'path';
import { runMachiningCalculator } from '../../../../../modules/bom-items/costing/machining/calculators/machining-calculator';
import { machiningLookupSeeds } from '../../../../../modules/bom-items/costing/machining/calculators/machining-lookup-seeds';
import { specAsCalculators } from '../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import type { MHRRateInput } from '../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { featureInstances, resolveFeatureRequirements, type ManualTolerance } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import { evaluateMachiningNeed, resolveOperationLinks } from '../../../../../modules/bom-items/costing/shared/tolerance/machining-need';
import { resolveCapabilityTable, resolveIsoTable } from '../../../../../modules/bom-items/costing/shared/tolerance/process-capability';
import { priceSecondaryMachining } from '../../../../../modules/bom-items/costing/shared/tolerance/secondary-machining-cost';
import {
  readMachiningMemoryCsv,
  realCapabilityRules,
  realDrillingTable,
  realSurfaceGrindingParams,
} from '../machining/real-reference-tables';

// Real data: memory/ capability, ISO 286, operation links, the machining
// calculators (machining-calculators.json), tblDrilling / tblReaming /
// tblReciprocatingSurfaceGrinding. The machine rates are inputs to this pure
// function (HR Rates rows are not available offline); every expectation is
// derived from the calculator runs, never from a copied number.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;

const capability = resolveCapabilityTable(csv('Machining/lookup/tblGtolProcessCapabilities.csv'));
const iso = resolveIsoTable(csv('Standards/lookup/iso286_standard_tolerances.csv'));
const links = resolveOperationLinks(csv('Machining/lookup/operation_capability_process.csv'));
const calculators = specAsCalculators();
const reamTable = readMachiningMemoryCsv('lookup/tblReaming.csv').map((r) => ({
  ...r, Hardness: Number(r['Hardness']), DiameterMm: Number(r['DiameterMm']),
  CuttingSpeedMPerMin: Number(r['CuttingSpeedMPerMin']), FeedMm: Number(r['FeedMm']),
}));
const lookupContext = {
  matClass: 'aluminum' as const,
  drillingTable: realDrillingTable(),
  reamTable,
  surfaceGrindingParams: realSurfaceGrindingParams('30.11'),
  capabilityRules: realCapabilityRules(),
};

const machine = (machineClass: string, machineName: string, rate: number): MHRRateInput => ({
  rate, source: 'mhr_database', machineClass, machineName, commodityCode: null, labourRate: 30, operators: 1, setupTimeHr: 1,
});
const mill = machine('3_axis_mill', 'Mill A', 60);
const grinder = machine('reciprocating_surface_grinder', 'Grinder B', 45);
const machineFor = (calc: string) => (calc === 'Surface Grinding' ? grinder : ['Drilling', 'Reaming'].includes(calc) ? mill : undefined);

const graph = {
  features: [
    { id: 'simple_hole_through', feature_type: 'SimpleHole', variant: 'through', occurrences: [
      { face_ids: [1], source_face_stable_ids: ['a'], diameter_mm: 10, depth_mm: 20 },
      { face_ids: [2], source_face_stable_ids: ['b'], diameter_mm: 8, depth_mm: 10 },
    ] },
    { id: 'planar_face', feature_type: 'PlanarFace', variant: 'default', occurrences: [
      { face_ids: [0], source_face_stable_ids: ['p'], extent_mm: 50, extents_mm: [50, 40, 0] },
    ] },
  ],
};
const inst = featureInstances(graph);
const key = (l: string) => inst.find((i) => i.label === l)!.key!;
const manual: ManualTolerance[] = [
  { featureKey: key('SimpleHole:1'), category: 'diamTolerance', value: 0.009 },
  { featureKey: key('PlanarFace:1'), category: 'flatness', value: 0.03 },
];
const need = evaluateMachiningNeed({
  primaryProcess: 'High Pressure Die Casting',
  features: resolveFeatureRequirements({ instances: inst, manual, policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
  capability, iso, links,
});
const costContext = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const result = priceSecondaryMachining({ need, instances: inst, calculators, lookupContext, machineFor, batchSize: 100, costContext });
const pick = (l: string) => result.features.find((f) => f.label === l)!;

describe('priceSecondaryMachining (real calculators and tables)', () => {
  it('the IT7 hole is reamed: the cheapest priced capable operation; Boring has no calculator', () => {
    const hole = pick('SimpleHole:1');
    // A cast (cored) hole: finishing only.
    expect(hole.chosen.map((c) => c.operation)).toEqual(['Reaming']);
    expect(hole.chosen[0]!.sec).toBeGreaterThan(0);
    expect(hole.unpriced.find((u) => u.operation === 'Boring')?.reason).toMatch(/no calculator/);
    for (const p of hole.priced) expect(p.runCost).toBeGreaterThanOrEqual(hole.chosen[0]!.runCost);
  });

  it('the IT7 face is surface ground with its measured length and width', () => {
    const face = pick('PlanarFace:1');
    expect(face.chosen.map((c) => c.calculator)).toEqual(['Surface Grinding']);
    const trace = result.lines.find((l) => l.machineClass === 'reciprocating_surface_grinder');
    expect(trace).toBeDefined();
  });

  it('one line per machine and operation, named by the operation; rows are the features', () => {
    expect(result.lines.map((l) => `${l.machineName}: ${l.process}`).sort()).toEqual(['Grinder B: Finish Plunge Grinding', 'Mill A: Reaming']);
    const millLine = result.lines.find((l) => l.machineName === 'Mill A')!;
    expect(millLine.processGroup).toBe('Machining');
    expect(millLine.processRoute).toBe('3 Axis Mill');
    expect(millLine.operation).toBe('Reaming');
    expect(millLine.featureBreakdown).toEqual([
      expect.objectContaining({ name: 'SimpleHole:1', occurrenceRefs: [{ featureId: 'simple_hole_through', occurrenceIndex: 0 }] }),
    ]);
    // Cost = machine + labour x crew over the calculator time, plus setup / batch.
    const sec = pick('SimpleHole:1').chosen[0]!.sec;
    const setupMin = 60 / 100;
    expect(millLine.totalCost).toBeCloseTo(((60 + 30) * (sec / 60 + setupMin)) / 60, 1);
  });

  it('part handling between setups joins the first line on its machine, once', () => {
    const handled = priceSecondaryMachining({
      need, instances: inst, calculators, lookupContext, machineFor, batchSize: 100, costContext,
      handling: { '3_axis_mill': { sec: 20, name: 'Reorient 2 × 10 s' } },
    });
    const plain = result.lines.find((l) => l.machineName === 'Mill A')!;
    const line = handled.lines.find((l) => l.machineName === 'Mill A')!;
    expect(line.featureBreakdown!.map((r) => r.name)).toContain('Reorient 2 × 10 s');
    expect(line.cycleTimeMin).toBeCloseTo(plain.cycleTimeMin + 20 / 60, 3);
    expect(handled.lines.find((l) => l.machineName === 'Grinder B')!.featureBreakdown!.map((r) => r.name)).not.toContain('Reorient 2 × 10 s');
  });

  it('the as-cast hole is not machined', () => {
    expect(result.features.map((f) => f.label)).not.toContain('SimpleHole:2');
  });
});

describe('a hole the casting cannot form is drilled first', () => {
  // Same holes, now with the casting unable to form them (e.g. below the
  // minimum castable diameter): formability says so for both.
  const needUncast = evaluateMachiningNeed({
    primaryProcess: 'High Pressure Die Casting',
    features: resolveFeatureRequirements({ instances: inst, manual, policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
    capability, iso, links,
    formability: ({ instance }) => (instance.featureType === 'SimpleHole' ? { formable: false, detail: 'below the casting minimum diameter' } : null),
  });
  const priced = priceSecondaryMachining({ need: needUncast, instances: inst, calculators, lookupContext, machineFor, batchSize: 100, costContext });
  const ops = (l: string) => priced.features.find((f) => f.label === l)!.chosen.map((c) => c.operation);

  it('no tolerance: drilled from solid, never reamed, bored or tapped', () => {
    expect(needUncast.features.find((f) => f.label === 'SimpleHole:2')!.forming?.operation).toBe('Drilling');
    expect(needUncast.features.find((f) => f.label === 'SimpleHole:2')!.candidates).toEqual([]);
    expect(ops('SimpleHole:2')).toEqual(['Drilling']);
  });

  it('IT7 tolerance: drilled, then reamed', () => {
    expect(ops('SimpleHole:1')).toEqual(['Drilling', 'Reaming']);
    const drill = priced.lines.find((l) => l.process === 'Drilling')!;
    const ream = priced.lines.find((l) => l.process === 'Reaming')!;
    expect(drill.featureBreakdown!.map((b) => b.name)).toEqual(['SimpleHole:1', 'SimpleHole:2']);
    expect(ream.featureBreakdown!.map((b) => b.name)).toEqual(['SimpleHole:1']);
    // One setup per machine: charged on its first line only.
    expect(drill.setupTimeMin).toBeGreaterThan(0);
    expect(ream.setupTimeMin).toBe(0);
  });
});

describe('a stepped hole is drilled step by step', () => {
  const stepped = featureInstances({ features: [{ id: 'msh', feature_type: 'MultiStepHole', variant: 'stepped', occurrences: [
    { face_ids: [1, 2], source_face_stable_ids: ['s1', 's2'], max_diameter_mm: 8,
      steps: [{ diameter_mm: 8, depth_mm: 4 }, { diameter_mm: 5, depth_mm: 6 }] },
  ] }] });
  const needStepped = evaluateMachiningNeed({
    primaryProcess: 'High Pressure Die Casting',
    features: resolveFeatureRequirements({ instances: stepped, manual: [], policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
    capability, iso, links,
    formability: () => ({ formable: false, detail: 'a step below the casting minimum' }),
  });
  const res = priceSecondaryMachining({ need: needStepped, instances: stepped, calculators, lookupContext, machineFor, batchSize: 100, costContext });

  it('Step Drilling is timed as one Drilling run per step, summed', () => {
    const chosen = res.features[0]!.chosen;
    expect(chosen.map((c) => c.operation)).toEqual(['Step Drilling']);
    expect(chosen[0]!.calculator).toBe('Drilling');
    const one = (d: number, depth: number) => priceSecondaryMachining({
      need: evaluateMachiningNeed({
        primaryProcess: 'High Pressure Die Casting',
        features: resolveFeatureRequirements({ instances: featureInstances({ features: [{ id: 'h', feature_type: 'SimpleHole', variant: 'blind',
          occurrences: [{ face_ids: [9], source_face_stable_ids: ['x'], diameter_mm: d, depth_mm: depth }] }] }), manual: [], policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
        capability, iso, links, formability: () => ({ formable: false, detail: 'x' }),
      }),
      instances: featureInstances({ features: [{ id: 'h', feature_type: 'SimpleHole', variant: 'blind', occurrences: [{ face_ids: [9], source_face_stable_ids: ['x'], diameter_mm: d, depth_mm: depth }] }] }),
      calculators, lookupContext, machineFor, batchSize: 100, costContext,
    }).features[0]!.chosen[0]!.sec;
    expect(chosen[0]!.sec).toBeCloseTo(one(8, 4) + one(5, 6), 6);
  });
});

describe('deburring after machining', () => {
  const g = {
    features: [
      { id: 'h', feature_type: 'SimpleHole', variant: 'through', occurrences: [
        { face_ids: [5], source_face_stable_ids: ['h5'], diameter_mm: 6, depth_mm: 10 },
      ] },
      { id: 'e', feature_type: 'SharpEdge', variant: 'default', occurrences: [
        { face_ids: [5, 0], source_face_stable_ids: ['h5', 'p0'], length_mm: 18.85 },   // hole entry edge
        { face_ids: [5, 1], source_face_stable_ids: ['h5', 'p1'], length_mm: 18.85 },   // hole exit edge
        { face_ids: [0, 1], source_face_stable_ids: ['p0', 'p1'], length_mm: 40 },      // part edge, not machined
      ] },
    ],
  };
  const ins = featureInstances(g);
  const n = evaluateMachiningNeed({
    primaryProcess: 'High Pressure Die Casting',
    features: resolveFeatureRequirements({ instances: ins, manual: [], policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
    capability, iso, links,
    formability: ({ instance }) => (instance.featureType === 'SimpleHole' ? { formable: false, detail: 'not castable' } : null),
  });
  const deburrMachine = machine('manual_deburr', 'Bench C', 30);
  const ctx = { ...lookupContext, deburrParams: { linearSpeedMmPerSec: 10, dataFound: true } };

  it('deburrs only the sharp edges touching machined features', () => {
    const r = priceSecondaryMachining({ need: n, instances: ins, calculators, lookupContext: ctx, machineFor, batchSize: 100, costContext, deburr: { machine: deburrMachine } });
    const line = r.lines.find((l) => l.process === 'Deburring')!;
    expect(line.machineName).toBe('Bench C');
    expect(line.featureBreakdown!.map((b) => b.name)).toEqual(['SimpleHole:1']);
    // 2 x 18.85 mm of hole edges (the 40 mm part edge excluded), timed by the Deburring calculator.
    const expected = runMachiningCalculator(calculators, 'Deburring', {
      'Sharp Edge Length': { value: 2 * 18.85, source: 't' },
      ...machiningLookupSeeds('Deburring', ctx, {})!.seeds,
    }).sec!;
    expect(line.featureBreakdown![0]!.timeSec).toBeCloseTo(expected, 2);
  });
});

describe('bench work after machining', () => {
  const bench = machine('manual_bench_cell', 'Bench Cell D', 25);
  const steps = [
    { operation: 'Cleaning', sec: null, source: 'no cleaning time in memory/Machining variables' },
    { operation: 'Identing', sec: 45, source: 'variables defaultIdentingTime = 45 Time' },
  ];
  it('times each step on the bench cell; a step without a time is a named, unpriced line', () => {
    const r = priceSecondaryMachining({ need, instances: inst, calculators, lookupContext, machineFor, batchSize: 100, costContext, bench: { machine: bench, steps } });
    const ident = r.lines.find((l) => l.process === 'Identing')!;
    expect(ident.machineName).toBe('Bench Cell D');
    expect(ident.cycleTimeMin).toBeCloseTo(45 / 60, 3);
    const clean = r.lines.find((l) => l.process === 'Cleaning')!;
    expect(clean.totalCost).toBe(0);
    expect(clean.physicsGap).toBeDefined();
  });
  it('no machining, no bench work', () => {
    const none = { ...need, features: need.features.map((f) => ({ ...f, verdict: 'as_primary' as const })), machiningRequired: false };
    const r = priceSecondaryMachining({ need: none, instances: inst, calculators, lookupContext, machineFor, batchSize: 100, costContext, bench: { machine: bench, steps } });
    expect(r.lines).toEqual([]);
  });
});
