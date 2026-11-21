import { additiveCalculatorsByName, loadAdditiveCalculatorSpec } from '../../../../../modules/bom-items/costing/additive/calculators/additive-calculator-spec';
import { additivePart } from '../../../../../modules/bom-items/costing/additive/additive-cost.service';
import { buildAdditiveCostSummary } from '../../../../../modules/bom-items/costing/additive/additive-cost-summary';
import { additiveRouteFor } from '../../../../../modules/bom-items/costing/additive/additive-route-comparison';
import { ADDITIVE } from '../../../../../modules/bom-items/costing/additive/additive-domain';
import {
  buildAdditiveRoutes, chooseAdditiveRoute, chooseBuild, selfSupportingAngle, type AdditivePart, type AdditiveRoute, type AdditiveRouteInput, type BuildCandidate,
} from '../../../../../modules/bom-items/costing/additive/additive-route';
import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { additiveMaterial, allAdditiveMachines, realAdditiveReference } from './additive-test-data';

const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const angles = (overhang: number, support: number, contact: number, regions: number): BuildCandidate['byAngle'] => ({
  30: { overhangAreaMm2: overhang, overhangProjectedAreaMm2: overhang, supportVolumeMm3: support, plateContactAreaMm2: contact, overhangRegions: regions },
  45: { overhangAreaMm2: overhang, overhangProjectedAreaMm2: overhang, supportVolumeMm3: support, plateContactAreaMm2: contact, overhangRegions: regions },
});
// The tee of the cad-engine tests (test_additive_measurements.py): a 10 x 10 x 30 stem under a 50 x 10 x 5 flange. Upright (+z) its flange
// hangs 400 mm² over the plate, 30 mm up; on its side (+y) it needs no support and is 10 mm tall.
const TEE: AdditivePart = {
  partVolumeMm3: 10 * 10 * 30 + 50 * 10 * 5, surfaceAreaMm2: 3400, measuredAxis: '+y', cleaningFeatures: null,
  candidates: {
    '+z': { buildHeightMm: 35, footprintMm: [50, 10], byAngle: angles(400, 12000, 500, 2) },
    '-z': { buildHeightMm: 35, footprintMm: [50, 10], byAngle: angles(0, 0, 500, 0) },
    '+y': { buildHeightMm: 10, footprintMm: [50, 35], byAngle: angles(0, 0, 650, 0) },
  },
};
const input = (material: string, over: Partial<AdditiveRouteInput> = {}): AdditiveRouteInput => ({
  domain: ADDITIVE, ref: realAdditiveReference(), spec: loadAdditiveCalculatorSpec(), calculators: additiveCalculatorsByName(), material: additiveMaterial(material),
  part: TEE, machinesByClass: allAdditiveMachines(), scenario: { batchSize: 100, route: null, buildAxis: null }, costContext: ZERO, ...over,
});
const only = (material: string, over: Partial<AdditiveRouteInput> = {}): AdditiveRoute => {
  const { routes, missing, gaps } = buildAdditiveRoutes(input(material, over));
  if (routes.length !== 1) throw new Error(`${routes.length} routes: ${[...missing, ...gaps.map((g) => g.reason)].join('; ')}`);
  return routes[0]!;
};
const processes = (r: AdditiveRoute) => r.lines.map((l) => l.process);
const gapsOf = (r: AdditiveRoute) => r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason}`);

describe('the build direction', () => {
  it('a stainless part supports down to 30 degrees, a polymer to the 45 degree default (tblSelfSupportingAngles lists metals only)', () => {
    const ref = realAdditiveReference();
    expect(selfSupportingAngle(ref, 'Stainless Steel Alloy').deg).toBe(30);
    expect(selfSupportingAngle(ref, 'DuraForm')).toEqual({ deg: 45, source: '45 degrees: tblSelfSupportingAngles lists no DuraForm' });
  });

  it('is the one of least support, of equal ones the lowest; the Cost Guide\'s direction wins', () => {
    expect(chooseBuild(TEE, 45, null)).toMatchObject({ axis: '+y', source: 'least_support' });
    expect(chooseBuild(TEE, 45, '+z')).toMatchObject({ axis: '+z', source: 'engineer' });
    expect(chooseBuild({ ...TEE, candidates: {} }, 45, null)).toBeNull();
  });
});

describe('the routes on the real memory/Additive Manufacturing data', () => {
  it('a material is built by its own process only: a stainless powder is metal sintered, the others say why not', () => {
    const { routes, gaps } = buildAdditiveRoutes(input('Stainless Steel, 17-4PH'));
    expect(routes.map((r) => r.key)).toEqual(['metal_sintering']);
    expect(gaps.map((g) => g.key)).toEqual(['laser_sintering', 'printing', 'resin_curing']);
    expect(gaps[0]!.reason).toBe('Stainless Steel, 17-4PH is built by DMLS, not by Laser Sintering');
  });

  it('metal sintering: powder loading, the build, powder recovery, the base cut off; no breakoff when the part needs no support', () => {
    const r = only('Stainless Steel, 17-4PH');
    expect(gapsOf(r)).toEqual([]);
    expect(processes(r)).toEqual(['Powder Loading', 'Metal Sintering', 'Sieving', 'Power Tool Base Removal', 'Cleaning']);
    expect(r.complete).toBe(true);
    expect(r.build).toMatchObject({ axis: '+y', selfSupportingDeg: 30 });
    // Built on its side the plate takes the 650 mm² face under a 10 mm support base: the only supports.
    expect(r.material.supportVolumeMm3).toBeCloseTo(650 * 10, 6);
    expect(r.partsPerBuild).toBeGreaterThan(1);
    expect(r.material.costUsd).toBeGreaterThan(0);
    expect(r.lines.every((l) => l.processGroup === 'Additive Manufacturing')).toBe(true);
  });

  it('metal sintering built upright: the flange\'s supports are broken off, and the build machine only one that lists the material', () => {
    const r = only('Stainless Steel, 17-4PH', { scenario: { batchSize: 100, route: null, buildAxis: '+z' } });
    expect(processes(r)).toEqual(['Powder Loading', 'Metal Sintering', 'Sieving', 'Power Tool Base Removal', 'Breakoff', 'Cleaning']);
    expect(r.material.supportVolumeMm3).toBeCloseTo(12000 + 500 * 10, 6);
    const listed = realAdditiveReference().table('tblMaterialCompatibility').filter((x) => x['Material Name'] === 'Stainless Steel, 17-4PH').map((x) => x['Machine Name']);
    expect(listed).toContain(r.lines.find((l) => l.process === 'Metal Sintering')!.machineName);
    expect(r.lines.find((l) => l.process === 'Breakoff')!.featureBreakdown?.[0]).toMatchObject({ featureType: 'SupportStructure', count: 2 });
  });

  it('laser sintering: no supports, the parts stacked in the bed, its powder recovered', () => {
    const r = only('Duraform EX');
    expect(gapsOf(r)).toEqual([]);
    expect(processes(r)).toEqual(['Laser Sintering', 'Sieving', 'Cleaning']);
    expect(r.material.supportVolumeMm3).toBe(0);
    expect(r.partsPerBuild).toBe(100);
  });

  it('material jetting and stereolithography: their supports broken off; a stereolithography part post-cured in the oven', () => {
    const jet = only('Objet Rigid VeroBlack 875', { scenario: { batchSize: 10, route: null, buildAxis: '+z' } });
    expect(gapsOf(jet)).toEqual([]);
    expect(processes(jet)).toEqual(['Printing', 'Breakoff', 'Cleaning']);
    const sla = only('Accura 25', { scenario: { batchSize: 10, route: null, buildAxis: '+z' } });
    expect(gapsOf(sla)).toEqual([]);
    expect(processes(sla)).toEqual(['Resin Curing', 'Breakoff', 'Cleaning', 'Part Curing']);
  });

  it('a part too big for every bed is a named gap on the build step, never priced on a smaller machine', () => {
    const big: AdditivePart = { ...TEE, candidates: { '+z': { buildHeightMm: 30, footprintMm: [2000, 2000], byAngle: angles(0, 0, 4e6, 0) } } };
    const r = only('Stainless Steel, 17-4PH', { part: big });
    expect(r.complete).toBe(false);
    expect(gapsOf(r)[0]).toContain('no Metal Sintering machine fits');
  });

  it('the route quoted is the Cost Guide\'s when it is one, else the cheapest complete one', () => {
    const { routes, gaps } = buildAdditiveRoutes(input('Duraform EX'));
    expect(chooseAdditiveRoute(ADDITIVE, routes, gaps, null).note).toContain('Laser sintering (SLS) is quoted');
    expect(chooseAdditiveRoute(ADDITIVE, routes, gaps, 'metal_sintering').route!.key).toBe('laser_sintering');
  });
});

describe('the build measurements as auto-fill promotes them', () => {
  it('reads the six candidates, and says what is missing for a part not measured for its build', () => {
    const { part } = additivePart({
      axis: '+z', partVolumeMm3: 5500, surfaceAreaMm2: 3400,
      candidates: { '+z': { buildHeightMm: 35, footprintMm: [50, 10], byAngle: { 45: { overhangAreaMm2: 400, supportVolumeMm3: 12000, plateContactAreaMm2: 500, overhangRegions: 2 } } } },
    });
    expect(part?.candidates['+z']?.byAngle['45']?.supportVolumeMm3).toBe(12000);
    expect(additivePart(null).missing[0]).toContain('Refresh analysis');
  });
});

describe('the cost summary and the route comparison', () => {
  const routeInput = input('Stainless Steel, 17-4PH');
  const { routes, gaps } = buildAdditiveRoutes(routeInput);
  const { route, note } = chooseAdditiveRoute(ADDITIVE, routes, gaps, null);
  const summary = buildAdditiveCostSummary({
    additive: { domain: ADDITIVE, route, routes, gaps, note, missing: [], warnings: [] }, materialGrade: 'Generic Stainless Steel, 17-4PH', materialCostPerKg: 0,
    materialSource: 'db', batchSize: 100, warnings: [], ratesSource: 'test',
  });

  it('is the route\'s material and lines, with the build and every route', () => {
    expect(summary.family).toBe('additive');
    expect(summary.materialCost).toBeCloseTo(route!.material.costUsd, 2);
    expect(summary.totalCost).toBeCloseTo(route!.totalUsd!, 2);
    expect(summary.additive).toMatchObject({ route: 'metal_sintering', buildDirection: '+y', selfSupportingDeg: 30, complete: true });
    expect(summary.additive!.options.map((o) => o.route)).toEqual(['metal_sintering', 'laser_sintering', 'printing', 'resin_curing']);
    // Apply records what is bought for the part (its supports, the powder lost and trapped), not the part with a stock allowance.
    expect(summary.castingMetal!.partKg).toBeCloseTo((TEE.partVolumeMm3 * 7770) / 1e9, 3);
    expect(summary.castingMetal!.chargedKg).toBeCloseTo(route!.material.massKg, 6);
    expect(summary.castingMetal!.chargedKg).toBeGreaterThan(summary.castingMetal!.partKg);
  });

  it('a route not for the part is not feasible and says why; the quoted one carries the lines', () => {
    const s = summary as unknown as CostSummaryResponseDto;
    expect(additiveRouteFor(ADDITIVE, 'metal_sintering', s)).toMatchObject({ routeId: 'additive-metal_sintering', isFeasible: true });
    expect(additiveRouteFor(ADDITIVE, 'printing', s)).toMatchObject({ isFeasible: false, processLines: [] });
  });

  it('a part that cannot be costed is one named line, never priced as another process', () => {
    const none = buildAdditiveCostSummary({
      additive: { domain: ADDITIVE, route: null, routes: [], gaps: [], note: null, missing: ['the build measurements'], warnings: [] }, materialGrade: null, materialCostPerKg: 0,
      materialSource: 'default', batchSize: 1, warnings: [], ratesSource: 'test',
    });
    expect(none.totalCost).toBe(0);
    expect(none.warnings).toContain('Additive Manufacturing cannot be costed: the build measurements');
  });
});
