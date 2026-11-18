import { compositesCalculatorsByName, loadCompositesCalculatorSpec } from '../../../../../modules/bom-items/costing/composites/calculators/composites-calculator-spec';
import { compositePart } from '../../../../../modules/bom-items/costing/composites/composites-cost.service';
import { buildCompositesCostSummary } from '../../../../../modules/bom-items/costing/composites/composites-cost-summary';
import { compositesRouteFor } from '../../../../../modules/bom-items/costing/composites/composites-route-comparison';
import {
  buildCompositesRoutes, chooseCompositesRoute, plyStack, type CompositePart, type CompositesRoute, type CompositesRouteInput,
} from '../../../../../modules/bom-items/costing/composites/composites-route';
import { allCompositesMachines, compositeMaterial, realCompositesReference } from './composites-test-data';

const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
// The laminates of the cad-engine tests (test_composite_measurements.py), as the extractor measured them.
const PLATE: CompositePart = {
  toolAreaMm2: 60000, bagAreaMm2: 60000, levels: [{ thicknessMm: 3, regionAreaMm2: 60000, regionPerimeterMm: 1000, faceIds: [5] }],
  outerAreaMm2: 60000, trimLengthMm: 1000, openingsAreaMm2: 0, footprintMm: [300, 200], heightMm: 3, curvaturePerM: 0, holeCount: 0,
};
const DROP: CompositePart = {
  ...PLATE, levels: [{ thicknessMm: 2, regionAreaMm2: 60000, regionPerimeterMm: 1000, faceIds: [5] }, { thicknessMm: 3, regionAreaMm2: 10000, regionPerimeterMm: 400, faceIds: [7] }],
};
const SANDWICH: CompositePart = {
  ...PLATE, heightMm: 17,
  levels: [{ thicknessMm: 2, regionAreaMm2: 60000, regionPerimeterMm: 1000, faceIds: [5] }, { thicknessMm: 17, regionAreaMm2: 15000, regionPerimeterMm: 500, faceIds: [7] }],
};
const input = (over: Partial<CompositesRouteInput> = {}): CompositesRouteInput => ({
  ref: realCompositesReference(), spec: loadCompositesCalculatorSpec(), calculators: compositesCalculatorsByName(),
  material: compositeMaterial('Generic Ply Material'), coreMaterial: compositeMaterial('Generic Core Material'),
  part: PLATE, machinesByClass: allCompositesMachines(), scenario: { batchSize: 10, route: null }, costContext: ZERO, ...over,
});
const routeOf = (key: string, over: Partial<CompositesRouteInput> = {}): CompositesRoute => {
  const { routes, missing, gaps } = buildCompositesRoutes(input(over));
  const r = routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} route: ${[...missing, ...gaps.map((g) => g.reason)].join('; ')}`);
  return r;
};

describe('the ply stack read from the laminate', () => {
  it('a 3 mm laminate of 0.25 mm plies is 12 plies, each the whole part', () => {
    const s = plyStack(PLATE, 0.25, 12.7);
    if ('missing' in s) throw new Error(s.missing);
    expect(s.plies).toHaveLength(12);
    expect(s.plies.every((p) => p.areaMm2 === 60000 && p.perimeterMm === 1000 && p.level === 0)).toBe(true);
    expect(s.core).toBeNull();
  });

  it('a ply drop-off: 2 mm everywhere and 3 mm on a 100 x 100 pad is 8 whole plies and 4 on the pad', () => {
    const s = plyStack(DROP, 0.25, 12.7);
    if ('missing' in s) throw new Error(s.missing);
    expect(s.plies.map((p) => p.level)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
    expect(s.plies.filter((p) => p.level === 1).every((p) => p.areaMm2 === 10000 && p.perimeterMm === 400 && p.lengthMm === 100)).toBe(true);
  });

  it('a level rising 15 mm (more than the 12.7 mm core stock) is a core, not 60 plies; switched off it is plies', () => {
    const s = plyStack(SANDWICH, 0.25, 12.7);
    if ('missing' in s) throw new Error(s.missing);
    expect(s.core).toEqual({ areaMm2: 15000, perimeterMm: 500, depthMm: 15, level: 1 });
    expect(s.plies).toHaveLength(8);
    const solid = plyStack(SANDWICH, 0.25, 12.7, { core: 'none' });
    if ('missing' in solid) throw new Error(solid.missing);
    expect(solid.core).toBeNull();
    expect(solid.plies).toHaveLength(68);
  });

  it('the Cost Guide\'s ply count stands in for the geometry\'s, and says so', () => {
    const s = plyStack(PLATE, 0.25, 12.7, { plyCount: 10 });
    if ('missing' in s) throw new Error(s.missing);
    expect(s.plies).toHaveLength(10);
    expect(s.plySource).toBe('scenario');
    expect(s.notes[0]).toContain('set in the Cost Guide');
  });
});

describe('the layup routes on the real memory/Composites data', () => {
  it('Generic Ply Material (woven, Can HLU only) is laid by hand: tape and fiber placement are not routes for it, and say why', () => {
    const { routes, gaps } = buildCompositesRoutes(input());
    expect(routes.map((r) => r.key)).toEqual(['hand_layup']);
    expect(gaps.map((g) => g.key)).toEqual(['tape_layup', 'fiber_placement']);
    expect(gaps[0]!.reason).toContain('Can ATL false');
  });

  it('the hand layup route is every step on a capable machine, in order, with the plies broken down on cutting and layup', () => {
    const r = routeOf('hand_layup');
    expect(r.lines.map((l) => l.process)).toEqual(['Tool Clean', 'Mold Preparation', 'Ultrasonic Cut', 'Hand Layup', 'Final Vacuum Bag', 'Autoclave Cure', 'Bench Operation']);
    expect(r.lines.filter((l) => l.physicsGap)).toEqual([]);
    expect(r.complete).toBe(true);
    // 3 mm over the 0.25 mm cured ply: 12 plies, each one entry of the cutting and the layup.
    expect(r.stack.plies).toHaveLength(12);
    expect(r.lines[2]!.featureBreakdown).toHaveLength(12);
    expect(r.lines[3]!.featureBreakdown!.every((f) => f.featureType === 'Ply')).toBe(true);
    expect(r.totalUsd).toBeGreaterThan(0);
    // The CAD inputs name the faces they were measured on (the calculator dialog's eye).
    const clean = r.lines[0]!.calculationTrace!.find((t) => t.fieldName === 'Tool Side Area')!;
    expect(clean.ref).toEqual({ kind: 'cad', evidence: 'tool_area' });
    expect(r.lines[0]!.calculationTrace!.find((t) => t.fieldName === 'Trim Length')!.ref).toEqual({ kind: 'cad', evidence: 'trim_length' });
    // The clean room's file gives a labour rate (47.36 USD/hr) but no crew: one operator is charged, and said so.
    const layup = r.lines[3]!;
    expect(layup.labourRate).toBeGreaterThan(0);
    expect(r.warnings).toContain('The hand_layup machines give a labour rate but no number of operators: each is costed with one operator.');
  });

  it('the prepreg is the plies with their trim over the utilization at 243.33 USD/m²', () => {
    const r = routeOf('hand_layup');
    const ply = 60000 + 1000 * 25.4 * 0.85;
    const util = compositeMaterial('Generic Ply Material').columns['material_utilization']!;
    expect(r.material.plyCostUsd).toBeCloseTo((12 * ply / (util / 100) / 1e6) * 243.33, 6);
    expect(r.material.plyMassKg).toBeCloseTo(12 * 0.06 * 0.279, 4);
  });

  it('a unidirectional tape (Can ATL) is also laid by tape layup, its band the tape width within the head\'s', () => {
    const { routes } = buildCompositesRoutes(input({ material: compositeMaterial('Carbon - Uni Directional Prepreg Tape - 12in') }));
    expect(routes.map((r) => r.key)).toEqual(['hand_layup', 'tape_layup']);
    const atl = routes.find((r) => r.key === 'tape_layup')!;
    expect(atl.lines.map((l) => l.process)).toContain('Automated Tape Layup');
  });

  it('a tow prepreg (Can AFP only) is laid by fiber placement only', () => {
    const { routes, gaps } = buildCompositesRoutes(input({ material: compositeMaterial('Carbon - Tow Prepreg - 1/4in') }));
    expect(routes.map((r) => r.key)).toEqual(['fiber_placement']);
    expect(gaps.map((g) => g.key).sort()).toEqual(['hand_layup', 'tape_layup']);
  });

  it('a sandwich is laid by hand (the core is placed by hand), its honeycomb in two 12.7 mm layers', () => {
    const { routes, gaps } = buildCompositesRoutes(input({ part: SANDWICH, material: compositeMaterial('Carbon - Uni Directional Prepreg Tape - 12in') }));
    expect(routes.map((r) => r.key)).toEqual(['hand_layup']);
    expect(gaps.find((g) => g.key === 'tape_layup')!.reason).toContain('core is placed by hand');
    const hlu = routes[0]!;
    expect(hlu.material.coreCostUsd).toBeGreaterThan(0);
    expect(hlu.lines[3]!.featureBreakdown!.some((f) => f.featureType === 'Core')).toBe(true);
  });

  it('a part whose tool does not fit any autoclave is a named gap on Autoclave Cure, not a guess', () => {
    const huge: CompositePart = { ...PLATE, footprintMm: [20000, 9000], outerAreaMm2: 1.8e8, toolAreaMm2: 1.8e8, bagAreaMm2: 1.8e8, trimLengthMm: 58000,
      levels: [{ thicknessMm: 3, regionAreaMm2: 1.8e8, regionPerimeterMm: 58000, faceIds: [5] }] };
    const r = routeOf('hand_layup', { part: huge });
    const cure = r.lines.find((l) => l.process === 'Autoclave Cure')!;
    expect(cure.physicsGap).toBeTruthy();
    expect(r.complete).toBe(false);
  });

  it('the cheapest complete route is quoted; the summary and the route comparison say the same', () => {
    const { routes, gaps } = buildCompositesRoutes(input({ material: compositeMaterial('Carbon - Uni Directional Prepreg Tape - 12in') }));
    const { route, note } = chooseCompositesRoute(routes, gaps, null);
    const cheapest = [...routes].filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!)[0]!;
    expect(route).toBe(cheapest);
    expect(note).toContain('is quoted');
    const s = buildCompositesCostSummary({ composites: { route, routes, gaps, note, missing: [], warnings: [] }, materialGrade: 'tape', materialCostPerKg: 0, materialSource: 'db', batchSize: 10, warnings: [], ratesSource: 'test' });
    expect(s.family).toBe('composite');
    expect(s.composites!.plies).toHaveLength(route!.stack.plies.length);
    expect(compositesRouteFor(route!.key, { ...s, currency: 'USD' } as never)).toMatchObject({ isFeasible: true, totalCost: s.totalCost });
    const other = routes.find((r) => r !== route)!;
    expect(compositesRouteFor(other.key, { ...s, currency: 'USD' } as never)).toMatchObject({ isFeasible: false });
  });
});

describe('the laminate as auto-fill promotes it', () => {
  it('a part not measured as a laminate asks for a refresh', () => {
    expect(compositePart(null).missing[0]).toContain('Refresh analysis');
    expect(compositePart({ toolAreaMm2: 60000, trimLengthMm: 1000, outerAreaMm2: 60000, footprintMm: [200, 300], levels: [] }).part).toBeNull();
  });

  it('the footprint is taken long side first', () => {
    const { part } = compositePart({ toolAreaMm2: 60000, trimLengthMm: 1000, outerAreaMm2: 60000, footprintMm: [200, 300], levels: [{ thicknessMm: 3, regionAreaMm2: 60000, regionPerimeterMm: 1000 }] });
    expect(part!.footprintMm).toEqual([300, 200]);
  });
});
