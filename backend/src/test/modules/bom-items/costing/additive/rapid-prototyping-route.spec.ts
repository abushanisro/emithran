// Rapid Prototyping priced by the additive engine in its own domain (additive-domain.ts RAPID_PROTOTYPING), on the real memory/Rapid prototyping
// data: the routes its materials take, the machines that take them, the post steps, and cleaning timed per hole and void.
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRapidPrototypingCalculatorSpec, rapidPrototypingCalculatorsByName } from '../../../../../modules/bom-items/costing/additive/calculators/rapid-prototyping-calculator-spec';
import { buildRapidPrototypingCalculatorsMigrationSql, RAPID_PROTOTYPING_CALCULATORS_MIGRATION } from '../../../../../modules/bom-items/costing/additive/calculators/rapid-prototyping-calculators-migration';
import { additivePart } from '../../../../../modules/bom-items/costing/additive/additive-cost.service';
import { buildAdditiveCostSummary } from '../../../../../modules/bom-items/costing/additive/additive-cost-summary';
import { additiveRouteFor } from '../../../../../modules/bom-items/costing/additive/additive-route-comparison';
import { additiveDomainOf, RAPID_PROTOTYPING, ADDITIVE } from '../../../../../modules/bom-items/costing/additive/additive-domain';
import { buildAdditiveRoutes, chooseAdditiveRoute, type AdditivePart, type AdditiveRoute, type AdditiveRouteInput, type BuildCandidate } from '../../../../../modules/bom-items/costing/additive/additive-route';
import { cleaningFeatures, type CleaningFeature } from '../../../../../modules/bom-items/costing/additive/feature-cleaning';
import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import { allRapidPrototypingMachines, rapidPrototypingMaterial, realRapidPrototypingReference } from './rapid-prototyping-test-data';

const ZERO = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const angles = (overhang: number, support: number, contact: number, regions: number): BuildCandidate['byAngle'] => ({
  30: { overhangAreaMm2: overhang, overhangProjectedAreaMm2: overhang, supportVolumeMm3: support, plateContactAreaMm2: contact, overhangRegions: regions },
  45: { overhangAreaMm2: overhang, overhangProjectedAreaMm2: overhang, supportVolumeMm3: support, plateContactAreaMm2: contact, overhangRegions: regions },
});
// One of each feature cleaning times, with its size and depth in a known band of memory/Rapid prototyping's limits.
const FEATURES: CleaningFeature[] = [
  { id: 'hole-1', type: 'SimpleHole', size: 5, depthMm: 25 }, // small (< 10 mm) x2, deep (> 20 mm) x2: 30 x 2 x 2 = 120 s
  { id: 'hole-2', type: 'MultiStepHole', size: 20, depthMm: 8 }, // medium x1, shallow (< 10 mm) x0.5: 60 x 0.5 = 30 s
  { id: 'hole-3', type: 'RingedHole', size: 8, depthMm: 12 }, // small x2, medium x1: 60 x 2 = 120 s
  { id: 'void-1', type: 'ComplexHole', size: 40, depthMm: 15 }, // large (> 30 mm) x0.5, medium x1: 45 x 0.5 = 22.5 s
  { id: 'void-2', type: 'Void', size: 3000, depthMm: 5 }, // medium volume x1, shallow x0.5: 30 x 0.5 = 15 s
  { id: 'void-3', type: 'Ring', size: 6000, depthMm: 15 }, // large (> 5000 mm³) x0.5, medium x1: 30 x 0.5 = 15 s
  { id: 'void-4', type: 'ComplexVoid', size: 500, depthMm: 25 }, // small (< 1000 mm³) x2, deep x2: 45 x 4 = 180 s
];
const FEATURE_SECONDS = 120 + 30 + 120 + 22.5 + 15 + 15 + 180;
// The tee of the additive tests: on its side (+y) it needs no support and is 10 mm tall.
const TEE: AdditivePart = {
  partVolumeMm3: 10 * 10 * 30 + 50 * 10 * 5, surfaceAreaMm2: 3400, measuredAxis: '+y', cleaningFeatures: FEATURES,
  candidates: {
    '+z': { buildHeightMm: 35, footprintMm: [50, 10], byAngle: angles(400, 12000, 500, 2) },
    '+y': { buildHeightMm: 10, footprintMm: [50, 35], byAngle: angles(0, 0, 650, 0) },
  },
};
const input = (material: string, over: Partial<AdditiveRouteInput> = {}): AdditiveRouteInput => ({
  domain: RAPID_PROTOTYPING, ref: realRapidPrototypingReference(), spec: loadRapidPrototypingCalculatorSpec(), calculators: rapidPrototypingCalculatorsByName(),
  material: rapidPrototypingMaterial(material), part: TEE, machinesByClass: allRapidPrototypingMachines(),
  scenario: { batchSize: 50, route: null, buildAxis: null }, costContext: ZERO, ...over,
});
const only = (material: string, over: Partial<AdditiveRouteInput> = {}): AdditiveRoute => {
  const { routes, missing, gaps } = buildAdditiveRoutes(input(material, over));
  if (routes.length !== 1) throw new Error(`${routes.length} routes: ${[...missing, ...gaps.map((g) => g.reason)].join('; ')}`);
  return routes[0]!;
};
const processes = (r: AdditiveRoute) => r.lines.map((l) => l.process);
const machineOf = (r: AdditiveRoute, process: string) => r.lines.find((l) => l.process === process)?.machineName;
const gapsOf = (r: AdditiveRoute) => r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason}`);

describe('Rapid Prototyping is priced in its own domain', () => {
  it('a part whose Process is Rapid Prototyping is priced as Rapid Prototyping; any other additive part as Additive Manufacturing', () => {
    expect(additiveDomainOf('Rapid Prototyping')).toBe(RAPID_PROTOTYPING);
    expect(additiveDomainOf('Additive Manufacturing')).toBe(ADDITIVE);
    expect(additiveDomainOf(undefined)).toBe(ADDITIVE);
  });
});

describe('the routes a material takes (its own SLS, SLA or 3D Printing)', () => {
  it('polyamide 12 is laser sintered, then cleaned; it needs no curing, sieving or break-off', () => {
    const r = only('Polyamide 12');
    expect(r.key).toBe('laser_sintering');
    expect(processes(r)).toEqual(['Laser Sintering', 'Cleaning']);
    expect(r.complete).toBe(true);
    expect(r.lines.every((l) => l.processGroup === 'Rapid Prototyping')).toBe(true);
    // The powder bed stacks the parts: more than one layer of them on the bed.
    expect(r.partsPerBuild).toBeGreaterThan(1);
  });

  it('a resin is built by stereolithography, cleaned, and post-cured in an oven (never the "No Curing Needed" placeholder)', () => {
    const r = only('Accura 25');
    expect(r.key).toBe('resin_curing');
    expect(processes(r)).toEqual(['Resin Curing', 'Cleaning', 'Part Curing']);
    expect(r.complete).toBe(true);
    expect(machineOf(r, 'Part Curing')).not.toBe('No Curing Needed');
    expect(machineOf(r, 'Part Curing')).not.toBe('LaserForm Oven');
  });

  it('a jetting material is 3D printed, never on the V-Flash printer; V-Flash material only on it', () => {
    const r = only('830 White');
    expect(processes(r)).toEqual(['Printing', 'Cleaning']);
    expect(machineOf(r, 'Printing')).not.toBe('V-Flash');
    expect(machineOf(only('V-Flash'), 'Printing')).toBe('V-Flash');
  });

  it('LaserForm (A6 Metal) sinters only on a machine that takes it and cures in the LaserForm oven', () => {
    const r = only('A6 Metal');
    expect(processes(r)).toEqual(['Laser Sintering', 'Cleaning', 'Part Curing']);
    expect(machineOf(r, 'Laser Sintering')).toBe('Sinterstation HiQ');
    expect(machineOf(r, 'Part Curing')).toBe('LaserForm Oven');
  });

  it('the other routes are not routes for the material, and say why', () => {
    const { gaps } = buildAdditiveRoutes(input('Polyamide 12'));
    expect(gaps.map((g) => g.key)).toEqual(['printing', 'resin_curing']);
    expect(gaps[0]!.reason).toContain('built by SLS');
  });

  it('the Default material takes every route at its route\'s default price, and the cheapest is quoted', () => {
    const { routes, gaps } = buildAdditiveRoutes(input('Default'));
    expect(gaps).toEqual([]);
    expect(routes.map((r) => r.key)).toEqual(['laser_sintering', 'printing', 'resin_curing']);
    // Priced per kg at each route's default (slsDefaultMaterialCost 125, slaDefaultMaterialCost 175, printingDefaultMaterialCost 225 USD/kg).
    const sls = routes.find((r) => r.key === 'laser_sintering')!.material.runs.material!;
    expect(sls.value! / ((sls.outputs['Part Mass'] ?? 0) + (sls.outputs['Spent Powder Mass'] ?? 0))).toBeCloseTo(125, 6);
    const sla = routes.find((r) => r.key === 'resin_curing')!.material.runs.material!;
    expect(sla.value! / ((sla.outputs['Part Mass'] ?? 0) + (sla.outputs['Support Mass'] ?? 0))).toBeCloseTo(175, 6);
    const { route, note } = chooseAdditiveRoute(RAPID_PROTOTYPING, routes, gaps, null);
    const cheapest = [...routes].filter((r) => r.complete).sort((a, b) => a.totalUsd! - b.totalUsd!)[0]!;
    expect(route!.key).toBe(cheapest.key);
    expect(note).toContain('Rapid Prototyping:');
  });
});

describe('cleaning, timed per hole and void (memory/Rapid prototyping cleaning* variables)', () => {
  it('is the base time plus each feature\'s base x size multiplier x depth multiplier', () => {
    const r = only('Polyamide 12');
    const times = Object.fromEntries(r.cleaned.map((f) => [f.id, f.timeSec]));
    expect(times).toEqual({ 'hole-1': 120, 'hole-2': 30, 'hole-3': 120, 'void-1': 22.5, 'void-2': 15, 'void-3': 15, 'void-4': 180 });
    const cleaning = r.lines.find((l) => l.process === 'Cleaning')!;
    expect(cleaning.cycleTimeMin * 60).toBeCloseTo(300 + FEATURE_SECONDS, 6);
    // The process tree lists each feature's time under the step.
    expect(cleaning.featureBreakdown?.map((o) => o.featureIds?.[0])).toEqual(FEATURES.map((f) => f.id));
  });

  it('a part with no holes or voids is cleaned in the base time', () => {
    const r = only('Polyamide 12', { part: { ...TEE, cleaningFeatures: [] } });
    expect(r.lines.find((l) => l.process === 'Cleaning')!.cycleTimeMin * 60).toBeCloseTo(300, 6);
  });

  it('a part analysed before its voids were measured asks for a Refresh analysis, never cleans it in the base time', () => {
    const r = only('Polyamide 12', { part: { ...TEE, cleaningFeatures: null } });
    expect(r.complete).toBe(false);
    expect(gapsOf(r)[0]).toContain('Refresh analysis');
  });

  it('reads the holes and voids as auto-fill promotes them', () => {
    expect(cleaningFeatures({
      holes: [{ id: 'hole-1', feature_type: 'RingedHole', diameter_mm: 6, depth_mm: 20 }],
      voids: [
        { id: 'void-1', feature_type: 'Void', variant: 'complex', volume_mm3: 900, depth_mm: 12 },
        { id: 'void-2', feature_type: 'Ring', variant: 'ringed', volume_mm3: 4000, depth_mm: 10 },
        { id: 'void-3', feature_type: 'ComplexHole', variant: 'through', volume_mm3: 1500, depth_mm: 15, equivalent_diameter_mm: 10 },
      ],
    })).toEqual([
      { id: 'hole-1', type: 'RingedHole', size: 6, depthMm: 20 },
      { id: 'void-1', type: 'ComplexVoid', size: 900, depthMm: 12 },
      { id: 'void-2', type: 'Ring', size: 4000, depthMm: 10 },
      { id: 'void-3', type: 'ComplexHole', size: 10, depthMm: 15 },
    ]);
    expect(cleaningFeatures({ holes: [] })).toBeNull();
    expect(additivePart({ axis: '+z', partVolumeMm3: 1, surfaceAreaMm2: 1, candidates: { '+z': { buildHeightMm: 1, footprintMm: [1, 1], byAngle: {} } } }).part!.cleaningFeatures).toBeNull();
  });
});

describe('the cost summary and the route comparison', () => {
  const { routes, gaps } = buildAdditiveRoutes(input('Accura 25'));
  const { route, note } = chooseAdditiveRoute(RAPID_PROTOTYPING, routes, gaps, null);
  const summary = buildAdditiveCostSummary({
    additive: { domain: RAPID_PROTOTYPING, route, routes, gaps, note, missing: [], warnings: [] }, materialGrade: 'Accura 25', materialCostPerKg: 0,
    materialSource: 'db', batchSize: 50, warnings: [], ratesSource: 'test',
  });

  it('names its process group, its routes and every hole and void cleaned', () => {
    expect(summary.family).toBe('additive');
    expect(summary.additive).toMatchObject({ processGroup: 'Rapid Prototyping', route: 'resin_curing', complete: true });
    expect(summary.additive!.options.map((o) => o.route)).toEqual(['resin_curing', 'laser_sintering', 'printing']);
    expect(summary.additive!.cleaning).toHaveLength(FEATURES.length);
    expect(summary.totalCost).toBeCloseTo(route!.totalUsd!, 2);
    expect(Object.keys(summary.calculatorRuns ?? {})).toEqual(['Rapid Prototyping material']);
  });

  it('compares its own three routes', () => {
    const s = summary as unknown as CostSummaryResponseDto;
    expect(additiveRouteFor(RAPID_PROTOTYPING, 'resin_curing', s)).toMatchObject({ routeId: 'additive-resin_curing', isFeasible: true });
    expect(additiveRouteFor(RAPID_PROTOTYPING, 'printing', s)).toMatchObject({ isFeasible: false, processLines: [] });
  });

  it('a part that cannot be costed says Rapid Prototyping cannot be costed', () => {
    const none = buildAdditiveCostSummary({
      additive: { domain: RAPID_PROTOTYPING, route: null, routes: [], gaps: [], note: null, missing: ['the build measurements'], warnings: [] }, materialGrade: null,
      materialCostPerKg: 0, materialSource: 'default', batchSize: 1, warnings: [], ratesSource: 'test',
    });
    expect(none.warnings).toContain('Rapid Prototyping cannot be costed: the build measurements');
    expect(none.processLines[0]!.processGroup).toBe('Rapid Prototyping');
  });
});

describe('the Rapid Prototyping calculators', () => {
  it('compute every Rapid Prototyping catalog operation', () => {
    const ops = loadRapidPrototypingCalculatorSpec().calculators.flatMap((c) => c.operations).sort();
    expect(ops).toEqual(['Cleaning', 'Laser Sintering', 'Part Curing', 'Printing', 'Resin Curing']);
  });

  it('every variable they read is in memory/Rapid prototyping', () => {
    const ref = realRapidPrototypingReference();
    const vars = loadRapidPrototypingCalculatorSpec().calculators.flatMap((c) => c.fields).flatMap((f) => (f.source && 'variable' in f.source ? [f.source.variable] : []));
    expect(vars.filter((v) => ref.number(v) == null)).toEqual([]);
  });

  it('migration 1105 is the one the spec generates', () => {
    const file = join(__dirname, `../../../../../../migrations/${RAPID_PROTOTYPING_CALCULATORS_MIGRATION}_rapid_prototyping_calculators.sql`);
    expect(readFileSync(file, 'utf8')).toBe(buildRapidPrototypingCalculatorsMigrationSql());
  });
});
