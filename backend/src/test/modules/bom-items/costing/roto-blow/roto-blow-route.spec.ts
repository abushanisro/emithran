// Roto & Blow Molding on the real memory/Roto & blow molding data: the routes a material and a part take, the cavities and molds per arm, the
// inflation and cooling, the operations the features take, the tooling within its limits, the summary and the route comparison.
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRotoBlowCalculatorSpec, rotoBlowCalculatorsByName } from '../../../../../modules/bom-items/costing/roto-blow/calculators/roto-blow-calculator-spec';
import { buildRotoBlowCalculatorsMigrationSql, ROTO_BLOW_CALCULATORS_MIGRATION } from '../../../../../modules/bom-items/costing/roto-blow/calculators/roto-blow-calculators-migration';
import { rotoBlowPart } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-cost.service';
import { buildRotoBlowCostSummary } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-cost-summary';
import { rotoBlowRouteFor } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-route-comparison';
import { featureOperations } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-features';
import {
  ROTO_BLOW_CALC, ROTO_BLOW_CLASS, buildRotoBlowRoutes, chooseRotoBlowRoute, type RotoBlowPart, type RotoBlowRoute, type RotoBlowRouteInput,
} from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-route';
import { runReferenceCalculator } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { machineValue } from '../../../../../modules/bom-items/costing/casting/sand/sand-machines';
import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { allRotoBlowMachines, realRotoBlowReference, rotoBlowMaterial } from './roto-blow-test-data';

const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
// A bottle: 120 x 80 across the parting plane, 80 along the pull, 2 mm wall, 20 mm neck, a through hole and a recess; its parting line round
// the outline.
const BOTTLE: RotoBlowPart = {
  envelope: { lengthMm: 120, widthMm: 80, depthMm: 80 }, partVolumeMm3: 70000, surfaceAreaMm2: 35000, wallMm: 2, hollow: true, insideVolumeMm3: 435000,
  partingLineMm: 400, perimeterMm: 400,
  spouts: [{ id: 'spout-1', diameterMm: 20, lengthMm: 20 }],
  holes: [{ id: 'hole-1', type: 'SimpleHole', variant: 'through', diameterMm: 6, depthMm: 2 }, { id: 'hole-2', type: 'SimpleHole', variant: 'blind', diameterMm: 8, depthMm: 15 }],
  voids: [{ id: 'void-1', type: 'Void', variant: 'simple', volumeMm3: 4000, depthMm: 40, equivalentDiameterMm: null }],
};
// A tank: 300 x 200 x 150, 4 mm wall, a 50 mm fill opening and a 60 mm square cut-out.
const TANK: RotoBlowPart = {
  envelope: { lengthMm: 300, widthMm: 200, depthMm: 150 }, partVolumeMm3: 2 * (300 * 200 + 300 * 150 + 200 * 150) * 4, surfaceAreaMm2: 270000, wallMm: 4, hollow: true,
  insideVolumeMm3: 292 * 192 * 142, partingLineMm: 1000, perimeterMm: 1000,
  spouts: [{ id: 'spout-1', diameterMm: 50, lengthMm: 4 }], holes: [],
  voids: [{ id: 'void-1', type: 'ComplexHole', variant: 'through', volumeMm3: 14400, depthMm: 4, equivalentDiameterMm: 60 }],
};
const input = (material: string, part: RotoBlowPart, over: Partial<RotoBlowRouteInput['scenario']> = {}): RotoBlowRouteInput => ({
  ref: realRotoBlowReference(), spec: loadRotoBlowCalculatorSpec(), calculators: rotoBlowCalculatorsByName(), material: rotoBlowMaterial(material), part,
  machinesByClass: allRotoBlowMachines(), costContext: ZERO,
  scenario: { batchSize: 1000, route: null, colored: false, labels: null, inserts: 0, ovenTimeS: null, amortizationParts: 100000, ...over },
});
const routeOf = (material: string, part: RotoBlowPart, key: 'blow' | 'roto'): RotoBlowRoute => {
  const r = buildRotoBlowRoutes(input(material, part)).routes.find((x) => x.key === key);
  if (!r) throw new Error(`no ${key} route`);
  return r;
};
const calc = (name: string, seeds: Record<string, number>) => {
  const r = runReferenceCalculator(rotoBlowCalculatorsByName(), name, Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, { value: v, source: 'test' }])), loadRotoBlowCalculatorSpec().calculators.find((c) => c.name === name)!.output ?? 'Cycle Time');
  return r;
};

describe('the routes a material and a part take', () => {
  it('HDPE is blow molded and rotomolded: both routes are priced and the cheaper quoted', () => {
    const { routes, gaps } = buildRotoBlowRoutes(input('Polyethylene, High Density, HDPE', BOTTLE));
    expect(routes.map((r) => r.key)).toEqual(['blow', 'roto']);
    expect(gaps).toEqual([]);
    const { route } = chooseRotoBlowRoute(routes, gaps, null);
    const cheapest = routes.filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!)[0]!;
    expect(route!.key).toBe(cheapest.key);
  });

  it('a blow molding PET is blow molded only, and says why it is not rotomolded', () => {
    const { routes, gaps } = buildRotoBlowRoutes(input('PET, Blow Molding', BOTTLE));
    expect(routes.map((r) => r.key)).toEqual(['blow']);
    expect(gaps[0]).toMatchObject({ key: 'roto' });
    expect(gaps[0]!.reason).toContain('not rotomolded');
  });

  it('a tank too big for every blow mold is rotomolded only (the blow route is a named gap)', () => {
    const big: RotoBlowPart = { ...TANK, envelope: { lengthMm: 2000, widthMm: 1600, depthMm: 900 } };
    const blow = routeOf('Polyethylene, High Density, HDPE', big, 'blow');
    expect(blow.complete).toBe(false);
    expect(blow.lines[0]!.physicsGap).toBeDefined();
    expect(routeOf('Polyethylene, High Density, HDPE', big, 'roto').complete).toBe(true);
  });

  it('a solid part is not blow or roto molded', () => {
    const r = buildRotoBlowRoutes(input('Polyethylene, High Density, HDPE', { ...BOTTLE, hollow: false, insideVolumeMm3: 0 }));
    expect(r.routes).toEqual([]);
    expect(r.missing[0]).toContain('hollow');
  });
});

describe('the blow molding cycle', () => {
  it('the cavities a mold takes: the part\'s length and margin in a row, capped by the parisons (Bekum H-121S: 3)', () => {
    const m = allRotoBlowMachines()[ROTO_BLOW_CLASS.blow]!.find((x) => x.name === 'Bekum H-121S')!;
    const v = (k: string) => machineValue(m, k)!;
    const r = calc(ROTO_BLOW_CALC.cavities, {
      'Mold Length': v('mold_length_mm'), 'Mold Width': v('mold_width_mm'), 'Mold Depth': v('mold_depth_mm'), 'Envelope Margin': v('cavity_envelope_margin_mm'),
      'Adjacent Margin': v('adjacent_cavity_margin_mm'), 'Parison Distance': v('parison_center_distance_mm'), 'Max Parisons': v('max_number_of_parisons'),
      'Part Length': 120, 'Part Width': 80, 'Part Depth': 80,
    });
    // floor((480 - 2 x 25.4 + 12.7) / max(120 + 12.7, 100)) = floor(441.9 / 132.7) = 3, within 3 parisons.
    expect(r.value).toBe(3);
  });

  it('inflation is the inside through the blow pin\'s bore at the air\'s speed; cooling is Menges on twice the wall', () => {
    const route = routeOf('Polyethylene, High Density, HDPE', BOTTLE, 'blow');
    // HDPE: k 0.39, ρ_melt 733, cp 2.63 -> α = 0.39 / (733 x 2.63 x 1000) x 1e6 mm²/s; Tm 260, Tw 40, Te 106; s = 2 x 2 mm.
    const alpha = (0.39 / (733 * 2.63 * 1000)) * 1e6;
    const cooling = ((4 * 4) / (Math.PI ** 2 * alpha)) * Math.log((4 / Math.PI) * ((260 - 40) / (106 - 40)));
    expect(route.coolingTimeS).toBeCloseTo(cooling, 1);
    const inflate = calc(ROTO_BLOW_CALC.inflate, { 'Inside Volume': 435000, 'Air Flow Velocity': 35, 'Bore Diameter': 10 }).value!;
    expect(inflate).toBeCloseTo(435000 / (35 * 1000 * Math.PI * 25), 6);
  });

  it('a blown bottle is molded, its pinch-off and opening routed, its neck sawn', () => {
    const route = routeOf('Polyethylene, High Density, HDPE', BOTTLE, 'blow');
    expect(route.lines.map((l) => l.process)).toEqual(['Extrusion Blow Mold', 'Router', 'Saw']);
    expect(route.complete).toBe(true);
    expect(route.partsPerCycle).toBeGreaterThanOrEqual(1);
  });
});

describe('the rotational molding cycle', () => {
  it('the molds one carousel arm carries (Ferry RS-1900: 6 on each of its 2 surfaces)', () => {
    const m = allRotoBlowMachines()[ROTO_BLOW_CLASS.roto]!.find((x) => x.name === 'Ferry RS-1900')!;
    const r = calc(ROTO_BLOW_CALC.moldsPerArm, {
      'Part Length': 300, 'Part Width': 200, 'Part Depth': 150, Shrinkage: 3, 'Structure Margin': 82.55, 'Mounting Margin': 127, 'Spacing Margin': 152.4,
      'Cylinder Diameter': machineValue(m, 'max_cylinder_dia_mm')!, 'Surfaces per Arm': machineValue(m, 'num_mounting_surfaces_per_arm')!,
      'Weight Capacity': machineValue(m, 'weight_capacity_kg')!, 'Charge Mass': 1.1,
    });
    // Mold 474.1 x 371.1 mm; (1879 - 254 + 152.4) / (474.1 + 152.4) -> 2, / (371.1 + 152.4) -> 3: 6 a surface, 12 an arm.
    expect(r.value).toBe(12);
  });

  it('a rotomolded tank grinds its powder, molds on the carousel, its fill opening cored and its cut-out trimmed by hand', () => {
    const route = routeOf('Polyethylene, High Density, HDPE', TANK, 'roto');
    expect(route.lines.map((l) => l.process)).toEqual(['Grind', 'Rotational Mold']);
    expect(route.complete).toBe(true);
    expect(route.features.map((f) => [f.featureType, f.operation])).toEqual([['Spout', 'Coring'], ['ComplexHole', 'Trimming']]);
    // The cut-out's plug and its trim stock are bought with the part.
    expect(route.material.massKg).toBeGreaterThan(route.material.partKg);
  });

  it('the Cost Guide\'s oven time replaces the cooling time the oven is otherwise taken as', () => {
    const fast = buildRotoBlowRoutes(input('Polyethylene, High Density, HDPE', TANK)).routes.find((r) => r.key === 'roto')!;
    const slow = buildRotoBlowRoutes(input('Polyethylene, High Density, HDPE', TANK, { ovenTimeS: 36000 })).routes.find((r) => r.key === 'roto')!;
    expect(slow.lines[1]!.cycleTimeMin).toBeGreaterThan(fast.lines[1]!.cycleTimeMin);
  });
});

describe('the operations the features take (memory thresholds)', () => {
  const rules = { minBlowHoleDiameter: 12.7, maxBlowHoleDiameter: 63.5, maxBlowMoldSimpleHoleDepth: 10, maxCorableHoleDiameter: 381, voidDepthConstant: 4, trimStockAllowance: 0.5 };
  it('on a blow mold: the spout a blow hole (and its moil sawn), a through hole routed, a deep blind hole cored, the parting line routed', () => {
    const ops = featureOperations('blow', { wallMm: 2, partingLineMm: 400, spouts: BOTTLE.spouts, holes: BOTTLE.holes, voids: BOTTLE.voids }, rules);
    expect(ops.map((o) => `${o.featureType}:${o.operation}`)).toEqual([
      'Spout:Blow Hole', 'Spout:Sawing', 'SimpleHole:Routing', 'SimpleHole:Coring', 'Void:As Molded', 'PartingLine:Routing',
    ]);
  });
  it('a recess deeper than voidDepthConstant times its width is cored', () => {
    const ops = featureOperations('roto', { wallMm: 4, partingLineMm: null, spouts: [], holes: [], voids: [{ id: 'v', type: 'Void', variant: 'simple', volumeMm3: 1000, depthMm: 100, equivalentDiameterMm: null }] }, rules);
    expect(ops[0]!.operation).toBe('Coring');
  });
});

describe('the tooling', () => {
  it('each mold and tool is priced within its memory limits, and spread over the job', () => {
    const blow = routeOf('Polyethylene, High Density, HDPE', BOTTLE, 'blow');
    const mold = blow.tooling.find((t) => t.key === 'blow-mold')!;
    expect(mold.costUsd).toBeGreaterThanOrEqual(1000);
    expect(mold.costUsd).toBeLessThanOrEqual(12000);
    expect(mold.perPartUsd).toBeCloseTo(mold.costUsd! / 100000, 4);
    const trim = blow.tooling.find((t) => t.key === 'trim-tooling')!;
    expect(trim.costUsd).toBeGreaterThanOrEqual(5000);
    expect(trim.costUsd).toBeLessThanOrEqual(10000);
    const roto = routeOf('Polyethylene, High Density, HDPE', TANK, 'roto').tooling.find((t) => t.key === 'roto-mold')!;
    expect(roto.costUsd).toBeGreaterThanOrEqual(3000);
  });
});

describe('the shell measurements as auto-fill promotes them', () => {
  it('reads the envelope, wall, inside and features; asks for a Refresh analysis before them', () => {
    const { part } = rotoBlowPart({
      extractionVersion: 'roto-blow-1', envelopeMm: { length: 120, width: 80, depth: 80 }, partVolumeMm3: 70000, wall: { nominal_mm: 2 }, hollow: true,
      inside: { volume_mm3: 435000 }, partingLineMm: 400, spouts: [{ id: 'spout-1', diameter_mm: 20, length_mm: 20 }],
      holes: [{ id: 'hole-1', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 6, depth_mm: 2 }], voids: [],
    });
    expect(part).toMatchObject({ wallMm: 2, insideVolumeMm3: 435000, hollow: true, spouts: [{ diameterMm: 20 }] });
    expect(rotoBlowPart(null).missing[0]).toContain('Refresh analysis');
  });
});

describe('the cost summary and the route comparison', () => {
  const { routes, gaps } = buildRotoBlowRoutes(input('Polyethylene, High Density, HDPE', BOTTLE));
  const { route, note } = chooseRotoBlowRoute(routes, gaps, 'blow');
  const summary = buildRotoBlowCostSummary({
    rotoBlow: { route, routes, gaps, part: BOTTLE, note, missing: [], warnings: [] }, materialGrade: 'HDPE', materialCostPerKg: 0, materialSource: 'db',
    batchSize: 1000, warnings: [], ratesSource: 'test',
  });

  it('is the route\'s material and lines, with the shell, its features\' operations, the tooling and both routes', () => {
    expect(summary.family).toBe('roto_blow');
    expect(summary.totalCost).toBeCloseTo(route!.totalUsd!, 2);
    expect(summary.rotoBlow).toMatchObject({ route: 'blow', wallMm: 2, insideVolumeMm3: 435000, complete: true });
    expect(summary.rotoBlow!.options.map((o) => o.route)).toEqual(['blow', 'roto']);
    expect(summary.rotoBlowTooling!.map((t) => t.key)).toEqual(['blow-mold', 'trim-tooling']);
  });

  it('compares both routes', () => {
    const s = summary as unknown as CostSummaryResponseDto;
    expect(rotoBlowRouteFor('blow', s)).toMatchObject({ routeId: 'roto-blow-blow', isFeasible: true });
    expect(rotoBlowRouteFor('roto', s)).toMatchObject({ isFeasible: false, processLines: [] });
  });

  it('a part that cannot be costed says why, one named line', () => {
    const none = buildRotoBlowCostSummary({
      rotoBlow: { route: null, routes: [], gaps: [], part: null, note: null, missing: ['the shell measurements'], warnings: [] }, materialGrade: null, materialCostPerKg: 0,
      materialSource: 'default', batchSize: 1, warnings: [], ratesSource: 'test',
    });
    expect(none.warnings).toContain('Roto & Blow Molding cannot be costed: the shell measurements');
  });
});

describe('the Roto & Blow Molding calculators', () => {
  it('compute every catalog operation', () => {
    expect(loadRotoBlowCalculatorSpec().calculators.flatMap((c) => c.operations).sort()).toEqual(['Extrusion Blow Mold', 'Grind', 'Rotational Mold', 'Router', 'Saw']);
  });
  it('every variable they read is in memory/Roto & blow molding', () => {
    const ref = realRotoBlowReference();
    const vars = loadRotoBlowCalculatorSpec().calculators.flatMap((c) => c.fields).flatMap((f) => (f.source && 'variable' in f.source ? [f.source.variable] : []));
    expect(vars.filter((v) => ref.number(v) == null)).toEqual([]);
  });
  it('migration 1108 is the one the spec generates', () => {
    const file = join(__dirname, `../../../../../../migrations/${ROTO_BLOW_CALCULATORS_MIGRATION}_roto_blow_calculators.sql`);
    expect(readFileSync(file, 'utf8')).toBe(buildRotoBlowCalculatorsMigrationSql());
  });
});
