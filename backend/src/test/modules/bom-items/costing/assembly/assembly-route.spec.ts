import { allAssemblyMachines, realAssemblyReference } from './assembly-test-data';
import { buildAssemblyCostSummary } from '../../../../../modules/bom-items/costing/assembly/assembly-cost-summary';
import { finishedAssembly } from '../../../../../modules/bom-items/costing/assembly/assembly-cost.service';
import { componentOf, deriveJoints, mergeJoints, threadedHolesOf, type AssemblyComponent, type AssemblyJoint } from '../../../../../modules/bom-items/costing/assembly/assembly-joints';
import {
  buildAssemblyRoutes, chooseAssemblyRoute, loadRow, migRow, passesRow, type AssemblyRoute, type AssemblyRouteInput,
} from '../../../../../modules/bom-items/costing/assembly/assembly-route';
import { assemblyRouteFor } from '../../../../../modules/bom-items/costing/assembly/assembly-route-comparison';
import { assemblyCalculatorsByName, loadAssemblyCalculatorSpec } from '../../../../../modules/bom-items/costing/assembly/calculators/assembly-calculator-spec';
import { machineValue } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';

import type { CostSummaryResponseDto, ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';


const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const ref = realAssemblyReference();
const machines = allAssemblyMachines();

// A housing with four M4 threaded holes (as feature_graph_v2 stores them) and two brackets.
const housingGraph = { feature_graph_v2: { features: [
  { id: 'SimpleHole-threaded_d3.2_c4', feature_type: 'SimpleHole', variant: 'threaded', occurrences: [1, 2, 3, 4].map((i) => ({ spec: 'M4×0.7', face_ids: [i] })) },
  { id: 'hole-9', feature_type: 'SimpleHole', variant: 'through', occurrences: [{ face_ids: [90] }] },
] } };
const HOUSING = componentOf({ id: 'housing', name: 'Housing', quantity: 1, weight: 0.044, maxLength: 80.3, maxWidth: 65.5, maxHeight: 22.5, featureGraph: housingGraph });
const BRACKET = componentOf({ id: 'bracket', name: 'Bracket', quantity: 2, weight: 0.5, maxLength: 120, maxWidth: 40, maxHeight: 5, featureGraph: null });
const COMPONENTS = [HOUSING, BRACKET];

const weld = (over: Partial<AssemblyJoint> = {}): AssemblyJoint => mergeJoints([], [{ id: 'w1', process: 'MIG Welding', lengthMm: 500, throatMm: 4, weldMaterial: 'Steel', gas: 'Argon', ...over }]).joints[0];
const input = (over: Partial<AssemblyRouteInput> = {}): AssemblyRouteInput => ({
  ref, spec: loadAssemblyCalculatorSpec(), calculators: assemblyCalculatorsByName(), components: COMPONENTS, joints: deriveJoints(COMPONENTS),
  assembly: finishedAssembly({ id: 'a', name: 'A' }, COMPONENTS),
  machinesByClass: machines, batchSize: 250, costContext: ZERO, ...over,
});
const routeOf = (key: string, over: Partial<AssemblyRouteInput> = {}): AssemblyRoute => {
  const r = buildAssemblyRoutes(input(over)).routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} route`);
  return r;
};
const sec = (l: ProcessLineCost) => l.cycleTimeMin * 60;
const gapsOf = (r: AssemblyRoute) => r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason}`);

describe('the assembly\'s components and joints', () => {
  it('reads a child\'s threaded holes from its feature graph, at the root or under machining_features', () => {
    expect(threadedHolesOf(housingGraph)).toEqual([{ featureId: 'SimpleHole-threaded_d3.2_c4', spec: 'M4×0.7', occurrences: 4 }]);
    expect(threadedHolesOf({ machining_features: housingGraph })).toHaveLength(1);
    expect(threadedHolesOf(null)).toEqual([]);
  });

  it('a component is the BOM child: its quantity, weight and largest dimension', () => {
    expect(BRACKET).toMatchObject({ quantity: 2, massKg: 0.5, maxDimensionMm: 120, threadedHoles: [] });
    expect(componentOf({ id: 'x', name: 'X', quantity: null, weight: 0 }).massKg).toBeNull();
  });

  it('derives a screw in every threaded hole, per instance of its part, naming the part and the feature', () => {
    const twice = componentOf({ id: 'housing', name: 'Housing', quantity: 2, weight: 0.044, featureGraph: housingGraph });
    expect(deriveJoints([twice])).toEqual([expect.objectContaining({
      id: 'screw:housing:SimpleHole-threaded_d3.2_c4', process: 'Mechanical Assembly', operation: 'Screw Tighten - Manual', count: 8,
      componentId: 'housing', featureIds: ['SimpleHole-threaded_d3.2_c4'], source: 'derived',
    })]);
  });

  it('the joint table edits or switches off a derived joint by its id, adds its own, and names a row it cannot read', () => {
    const derived = deriveJoints(COMPONENTS);
    const { joints, ignored } = mergeJoints(derived, [
      { id: derived[0].id, process: 'Mechanical Assembly', operation: 'Snap Fit', count: 4 },
      { process: 'Fillet Sealing', lengthMm: 300 },
      { process: 'Glue gun' },
    ]);
    expect(joints[0]).toMatchObject({ operation: 'Snap Fit', source: 'derived', componentId: 'housing', featureIds: derived[0].featureIds });
    expect(joints[1]).toMatchObject({ process: 'Fillet Sealing', lengthMm: 300, source: 'engineer', count: 1 });
    expect(ignored).toEqual(['joint table row 3: no known process ("Glue gun")']);
    expect(mergeJoints(derived, [{ id: derived[0].id, process: 'Mechanical Assembly', enabled: false }]).joints[0].enabled).toBe(false);
  });
});

describe('the reference tables', () => {
  it('loads a component by the quickest componentLoadTimes row that takes its weight and size', () => {
    expect(loadRow(ref, 0.044, 80)).toMatchObject({ Equipment: 'None', 'Weight (kg)': 5, 'Part Max Dimension (mm)': 915, 'Load Time (s)': 10 });
    expect(loadRow(ref, 30, 1000)).toMatchObject({ Equipment: 'Lifting Aid 1', 'Weight (kg)': 30, 'Load Time (s)': 30 });
    expect(loadRow(ref, 6000, 100)).toBeNull();
  });

  it('a throat up to 5.66 mm (an 8 mm leg) is one pass; above it two; a very thick one 28', () => {
    expect(passesRow(ref, 'MIG', 4)!['Num Passes']).toBe(1);
    expect(passesRow(ref, 'MIG', 5.66)!['Num Passes']).toBe(1);
    expect(passesRow(ref, 'MIG', 6)!['Num Passes']).toBe(2);
    expect(passesRow(ref, 'TIG', 50)!['Num Passes']).toBe(28);
  });

  it('a MIG pass runs at the speed of the smallest tabled throat that takes it, with the largest wire unless the joint names one', () => {
    expect(migRow(ref, 'Steel', 'Argon', 4, null)).toMatchObject({ 'Throat Thickness (mm)': 4.19, 'Wire Diameter (mm)': 1.1, 'Travel Speed (mm / s)': 3.95 });
    expect(migRow(ref, 'Steel', 'Argon', 4, 0.9)).toMatchObject({ 'Wire Diameter (mm)': 0.9, 'Wire Feed Speed (mm / s)': 196.05 });
  });
});

describe('an assembly\'s routes', () => {
  it('loads every component (one band: 3 instances at 10 s x handlingMultiplier 1.15) and unloads the finished assembly once', () => {
    const r = routeOf('manual');
    const pick = r.lines.filter((l) => l.process === 'Pick and Place');
    expect(pick).toHaveLength(2);
    expect(sec(pick[0])).toBeCloseTo(3 * 10 * 1.15, 1);
    expect(pick[0].featureBreakdown!.map((o) => [o.name, o.featureType, o.featureIds])).toEqual([
      ['Housing ×1', 'AssemblyComponent', ['housing']], ['Bracket ×2', 'AssemblyComponent', ['bracket']],
    ]);
    // 0.044 + 2 x 0.5 kg, its largest component 120 mm: the None band's 10 s unload.
    expect(sec(pick[1])).toBeCloseTo(10 * 1.15, 1);
    expect(pick[1].featureBreakdown![0].name).toBe('Finished assembly ×1');
    expect(JSON.stringify(pick[1].calculationTrace)).toContain('1.044 kg');
  });

  it('a machine is set up once per batch: the unload line on the pick and place station charges no second setup', () => {
    const pick = routeOf('manual').lines.filter((l) => l.process === 'Pick and Place');
    expect(pick[1].setupCost).toBe(0);
    expect(pick[1].totalCost).toBe(pick[1].runCost);
  });

  it('screws the four derived screws at the DFA 9.80 s each, on the housing\'s threaded hole', () => {
    const mech = routeOf('manual').lines.find((l) => l.process === 'Mechanical Assembly')!;
    expect(sec(mech)).toBeCloseTo(4 * 9.8, 1);
    expect(mech.featureBreakdown![0]).toMatchObject({ featureType: 'AssemblyJointDerived', count: 4, featureIds: ['SimpleHole-threaded_d3.2_c4'] });
    expect(mech.calculationTrace).toBeDefined();
  });

  it('a manual MIG weld, worked by hand: 500 mm, 4 mm throat, steel in argon (one pass at 3.95 mm/s), over the 0.45 efficiency, with its consumables', () => {
    const r = routeOf('manual', { joints: [weld()] });
    const line = r.lines.find((l) => l.process === 'Manual MIG Welding')!;
    const m = machines.manual_mig_welding.find((x) => x.name === line.machineName)!;
    const v = (k: string) => machineValue(m, k)!;
    const arc = (500 * 1) / 3.95 * v('arc_time_std');
    const tack = (500 / v('tack_pitch_mm')) * v('tack_length_mm') / 3.95;
    expect(sec(line)).toBeCloseTo((arc + tack) / 0.45 + v('gun_placement_time_s') + arc * v('gun_clean_time_per_arc_s'), 1);
    const wireKg = (Math.PI / 4) * 1.1 * 1.1 * 117.29 * arc * v('weld_density_kg_per_m3') / 1e9;
    const spray = 500 * 0.05 * 0.9 / (650 * 1); // CRC is the cheapest spray per gram: 6.75 USD a 500 mL can at 1.3 g/cm³
    const expected = wireKg * v('wire_cost_usd_per_kg') + 9.2 * arc / 3600 + wireKg / 9 * 0.32 + wireKg / 18 * 13.57 + spray * 6.75;
    expect(r.consumablesUsd).toBeCloseTo(expected, 3);
    expect(line.otherCostPerPartUsd).toBeCloseTo(expected, 3);
    expect(line.otherCostDetail).toContain('per assembly');
  });

  it('the robotic route welds on a robot at efficiency 1, its 300 s programming per weld spread over the batch', () => {
    const r = routeOf('robotic', { joints: [weld({ count: 2, lengthMm: 250 })] });
    const line = r.lines.find((l) => l.process === 'Robotic MIG Welding')!;
    const m = machines.robotic_mig_welding.find((x) => x.name === line.machineName)!;
    const v = (k: string) => machineValue(m, k)!;
    const arc = 500 / 3.95 * v('arc_time_std');
    const tack = (500 / v('tack_pitch_mm')) * v('tack_length_mm') / 3.95;
    const heads = Math.max(v('number_of_weld_heads'), 1);
    expect(sec(line)).toBeCloseTo((arc + tack + 2 * v('gun_placement_time_s') + arc * v('gun_clean_time_per_arc_s')) / heads + 2 * v('programming_time_per_weld_s') / 250, 1);
  });

  it('a TIG weld overhead runs at tigWeldOverheadSpeedMultiplier of the table speed', () => {
    const flat = routeOf('manual', { joints: [weld({ process: 'TIG Welding', throatMm: 2 })] }).lines.find((l) => l.process === 'Manual TIG Welding')!;
    const overhead = routeOf('manual', { joints: [weld({ process: 'TIG Welding', throatMm: 2, position: 'Overhead' })] }).lines.find((l) => l.process === 'Manual TIG Welding')!;
    expect(sec(overhead)).toBeGreaterThan(sec(flat));
    expect(JSON.stringify(overhead.calculationTrace)).toContain('0.7225');
  });

  it('weld prep and clean-up run along the weld when the joint asks for them', () => {
    const r = routeOf('manual', { joints: [weld({ prep: true, cleanUp: true })] });
    expect(sec(r.lines.find((l) => l.process === 'Weld Prep')!)).toBeCloseTo(500 / 10 + 500 / 5, 1);
    expect(sec(r.lines.find((l) => l.process === 'Weld Clean Up')!)).toBeCloseTo(500 / 10, 1);
  });

  it('spot welds, sealing, bonding, inserts and lock bolts are each one line on their own machines', () => {
    const joints = mergeJoints([], [
      { id: 's', process: 'Spot Welding', count: 10 }, { id: 'f', process: 'Fillet Sealing', lengthMm: 1000 }, { id: 'b', process: 'Adhesive Bonding', areaMm2: 10000 },
      { id: 't', process: 'Threaded Insert', count: 3 }, { id: 'l', process: 'Lock Bolt', count: 2 }, { id: 'c', process: 'Cap Sealing', count: 6 },
    ]).joints;
    const r = routeOf('manual', { joints });
    const at = (p: string) => sec(r.lines.find((l) => l.process === p)!);
    expect(at('Fillet Sealing')).toBeCloseTo(1000 * 0.05, 1);
    expect(at('Adhesive Bonding')).toBeCloseTo((0.01 / 0.03) * 60 + (0.01 / 0.02) * 60, 1);
    expect(at('Threaded Insert')).toBeCloseTo(3 * 4, 1);
    expect(at('Lock Bolt')).toBeGreaterThan(2 * 1.8);
    expect(r.adhesiveKg).toBeCloseTo(10000 * 0.002 * 1000 * 1100 / 1e9 * 1.1, 3);
    expect(r.warnings.join(' ')).toContain('no adhesive price');
    expect(r.complete).toBe(true);
  });

  it('names what it cannot cost: a rivet with no time, a component with no weight; the total excludes them', () => {
    const light = componentOf({ id: 'nut', name: 'Nut cap', quantity: 1, weight: null, maxLength: 24 });
    const r = routeOf('manual', { components: [...COMPONENTS, light], joints: mergeJoints([], [{ id: 'r', process: 'Rivet', count: 8 }]).joints });
    expect(gapsOf(r)).toEqual(expect.arrayContaining([
      expect.stringContaining('Nut cap: its weight'),
      expect.stringContaining("a rivet's time"),
    ]));
    expect(r.complete).toBe(false);
    expect(r.totalUsd).toBeNull();
  });

  it('robotic welding is not a route without a MIG, TIG or spot weld; nothing to cost at all is said', () => {
    const { routes, gaps } = buildAssemblyRoutes(input());
    expect(routes.map((r) => r.key)).toEqual(['manual']);
    expect(gaps).toEqual([{ key: 'robotic', label: 'Robotic welding', reason: 'the assembly has no MIG, TIG or spot weld for a robot to make' }]);
    expect(buildAssemblyRoutes(input({ components: [], joints: [] })).missing[0]).toContain('no components and no joints');
  });

  it('quotes the cheapest complete route, or the one set in the Cost Guide', () => {
    const { routes, gaps } = buildAssemblyRoutes(input({ joints: [weld()] }));
    const cheapest = [...routes].sort((a, b) => a.totalUsd! - b.totalUsd!)[0];
    expect(chooseAssemblyRoute(routes, gaps, null).route!.key).toBe(cheapest.key);
    const other = routes.find((r) => r !== cheapest)!;
    expect(chooseAssemblyRoute(routes, gaps, other.key).note).toContain('is set in the Cost Guide');
  });
});

describe('the assembly\'s Cost Summary and route comparison', () => {
  const assemblyResult = (joints: AssemblyJoint[], components: AssemblyComponent[] = COMPONENTS, batchSize = 250) => {
    const { routes, gaps } = buildAssemblyRoutes(input({ joints, components, batchSize }));
    const { route, note } = chooseAssemblyRoute(routes, gaps, null);
    return { materialOfParts: true, route, routes, gaps, components, joints, note, missing: [], warnings: [] };
  };

  it('holds the assembly\'s own work only: no material, its total the sum of its lines; the components are listed, not costed', () => {
    const s = buildAssemblyCostSummary({ assembly: assemblyResult([...deriveJoints(COMPONENTS), weld()]), batchSize: 250, warnings: [], ratesSource: 'test' });
    expect(s.family).toBe('assembly');
    // Its material is its parts': Apply keeps no record of its own and the Cost tab counts its work without one.
    expect(s.materialOfParts).toBe(true);
    expect(s.materialCost).toBe(0);
    expect(s.totalCost).toBeCloseTo(s.processLines.reduce((t, l) => t + l.totalCost, 0), 2);
    expect(s.assembly!.components.map((c) => [c.name, c.quantity, c.threadedHoles])).toEqual([['Housing', 1, 4], ['Bracket', 2, 0]]);
    // At 250 a batch the robot's 300 s programming per weld is 1.2 s an assembly: the robotic route is the cheaper one.
    expect(s.assembly!.route).toBe('robotic');
    expect(s.assembly!.joints.map((j) => [j.label, j.componentId, j.routeProcess])).toEqual([['M4×0.7 screws ×4', 'housing', 'Mechanical Assembly'], ['MIG Welding 1', null, 'Robotic MIG Welding']]);
    expect(s.assembly!.consumablesCost).toBeGreaterThan(0);
    expect(Object.keys(s.calculatorRuns ?? {})).toEqual(['w1 consumables']);
  });

  it('one assembly at a time is welded by hand: the robot\'s programming is not spread over a batch', () => {
    const s = buildAssemblyCostSummary({ assembly: assemblyResult([weld()], COMPONENTS, 1), batchSize: 1, warnings: [], ratesSource: 'test' });
    expect(s.assembly!.route).toBe('manual');
    expect(s.assembly!.options.map((o) => [o.route, o.complete])).toEqual([['manual', true], ['robotic', true]]);
  });

  it('an assembly that cannot be costed is one named line', () => {
    const s = buildAssemblyCostSummary({ assembly: { materialOfParts: false, route: null, routes: [], gaps: [], components: [], joints: [], note: null, missing: ['the assembly has no components and no joints'], warnings: [] }, batchSize: 1, warnings: [], ratesSource: 'test' });
    expect(s.processLines).toHaveLength(1);
    expect(s.processLines[0].physicsGap).toBeDefined();
    expect(s.warnings).toContain('Assembly cannot be costed: the assembly has no components and no joints');
  });

  it('each route of the comparison is the summary priced on it; a route it is not says why', () => {
    const summary = { ...buildAssemblyCostSummary({ assembly: assemblyResult(deriveJoints(COMPONENTS)), batchSize: 250, warnings: [], ratesSource: 'test' }) } as CostSummaryResponseDto;
    const manual = assemblyRouteFor('manual', summary);
    expect(manual).toMatchObject({ routeId: 'assembly-manual', isFeasible: true, totalCost: summary.totalCost });
    const robotic = assemblyRouteFor('robotic', summary);
    expect(robotic).toMatchObject({ routeId: 'assembly-robotic', isFeasible: false, totalCost: null });
    expect(robotic.capability.warnings[0]).toContain('no MIG, TIG or spot weld');
  });

  it('an incomplete route says which step is missing what, so Apply can say why it refuses it', () => {
    const light = componentOf({ id: 'nut', name: 'Nut cap', quantity: 1, weight: null, maxLength: 24 });
    const summary = buildAssemblyCostSummary({ assembly: assemblyResult(deriveJoints(COMPONENTS), [...COMPONENTS, light]), batchSize: 250, warnings: [], ratesSource: 'test' }) as CostSummaryResponseDto;
    const manual = assemblyRouteFor('manual', summary);
    expect(manual.isFeasible).toBe(false);
    expect(manual.capability.warnings[0]).toContain('Pick and Place: the load time of Nut cap: its weight');
  });
});
