import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ApplyRouteDto, VALID_ROUTE_IDS } from '../../../../../modules/bom-items/dto/apply-route.dto';
import type { CostSummaryDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../../../../modules/bom-items/dto/route-comparison.dto';
import { appliedOtherMoldingRouteId, isOtherMoldingRouteId, projectMoldingRoute } from '../../../../../modules/bom-items/costing/plastic-molding/molding-route-projection';

// A molding route applied for a part becomes its cost summary: the Cost tab, the saved rows and the route comparison state one price.

const line = (process: string, total: number) => ({ process, setupCost: 0, runCost: total, totalCost: total, cycleTimeMin: 0.2 }) as unknown as CostSummaryDto['processLines'][number];
const injectionSummary = () => ({
  processLines: [line('Injection Molding', 0.37)], materialCost: 0.33, totalProcessCost: 0.37, totalCost: 0.7,
  cycleTimes: { laserMin: 0.12, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0.12 },
  injectionMolding: { cavityCount: 1, clampRequiredT: 10 }, driverImpacts: [{ driver: 'Part volume' }], tooling: { moldCostUsd: 9808.59 }, warnings: ['a warning of the injection price'],
}) as unknown as CostSummaryDto & { injectionMolding?: unknown; driverImpacts?: unknown; tooling?: unknown };

const route = (over: Partial<RouteResultDto> = {}): RouteResultDto => ({
  routeId: 'im-structural-foam-molding', routeLabel: 'Structural Foam Molding — Milacron LP2500MHMWP-2x646', processFamily: 'cutting', toolingVolumeNote: null, autoRoutable: true,
  processLines: [line('Structural Foam Molding', 0.9)], materialCost: 1.46, abrasiveCost: 0, totalProcessCost: 0.9, isFeasible: true, dataComplete: true, dataGaps: [], totalCost: 2.36,
  cycleTimes: { cuttingMin: 0.2, pressBrakeMin: 0.01, tappingMin: 0, deburrMin: 0, totalMin: 0.21 }, badges: { lowestCost: false, fastest: false, bestQuality: false },
  capability: { cuttingCapable: true, pressBrakeCapable: true, overallCapable: true, confidence: 'medium', estimatedTonnage: 200, reasonCodes: [], warnings: [] }, warnings: [], ratesSource: 'test',
  ...over,
}) as unknown as RouteResultDto;

describe('which molding route a part was applied from', () => {
  it('reads the route id the saved rows were written from, and only the three processes the injection summary does not price', () => {
    expect(appliedOtherMoldingRouteId(['auto_fill_from_route:im-structural-foam-molding', null])).toBe('im-structural-foam-molding');
    expect(appliedOtherMoldingRouteId([null, 'auto_fill_from_route:im-compression-molding'])).toBe('im-compression-molding');
    expect(appliedOtherMoldingRouteId(['auto_fill_from_route:im-reaction-injection-molding'])).toBe('im-reaction-injection-molding');
    expect(appliedOtherMoldingRouteId(['auto_fill_from_route:im-small-50t'])).toBeNull();      // an injection tier: the summary prices it itself
    expect(appliedOtherMoldingRouteId(['auto_fill_from_custom_route:im-compression-molding'])).toBeNull();
    expect(appliedOtherMoldingRouteId([null, undefined, 'a note typed by hand'])).toBeNull();
    expect(appliedOtherMoldingRouteId([])).toBeNull();
    expect(isOtherMoldingRouteId('im-large-500t')).toBe(false);
  });
});

describe('projectMoldingRoute: the summary of an applied route', () => {
  it('takes the route\'s lines, material, totals, cycle and mold (structural foam runs on the injection engine and has one)', () => {
    const s = injectionSummary();
    const tooling = { moldCostUsd: 12000 };
    projectMoldingRoute(s, route({ tooling: tooling as never }), 'im-structural-foam-molding');
    expect(s.processLines.map((l) => l.process)).toEqual(['Structural Foam Molding']);
    expect([s.materialCost, s.totalProcessCost, s.totalCost]).toEqual([1.46, 0.9, 2.36]);
    expect(s.cycleTimes).toEqual({ laserMin: 0.2, pressBrakeMin: 0.01, tappingMin: 0, deburrMin: 0, totalMin: 0.21 });   // the route's cuttingMin is the summary's laserMin
    expect(s.tooling).toBe(tooling);
    expect(s.warnings).toContain('Priced as Structural Foam Molding — Milacron LP2500MHMWP-2x646, the applied route.');
  });

  it('drops what describes the injection engine: its cavity and clamp breakdown and its CAD driver impacts', () => {
    const s = injectionSummary();
    projectMoldingRoute(s, route(), 'im-structural-foam-molding');
    expect(s.injectionMolding).toBeUndefined();
    expect(s.driverImpacts).toBeUndefined();
  });

  it('compression and reaction injection have no staged mold-cost model: no mold is shown, and the summary says so (a missing price is not a free tool)', () => {
    for (const id of ['im-compression-molding', 'im-reaction-injection-molding'] as const) {
      const s = injectionSummary();
      projectMoldingRoute(s, route({ routeId: id, routeLabel: id }), id);
      expect(s.tooling).toBeUndefined();
      expect(s.warnings.join(' ')).toMatch(/has no staged mold-cost model: its tooling is not priced/);
    }
  });

  it('a route that cannot be priced is not projected: the part is never shown at a price its process cannot give, and the summary says why', () => {
    const s = injectionSummary();
    projectMoldingRoute(s, route({ isFeasible: false, totalCost: null, capability: { warnings: ['"Generic Nylon" is not a compression molding material'] } as never }), 'im-compression-molding');
    expect(s.totalCost).toBe(0.7);
    expect(s.processLines.map((l) => l.process)).toEqual(['Injection Molding']);
    expect(s.warnings.join(' ')).toMatch(/cannot be priced now \("Generic Nylon" is not a compression molding material\): the injection molding price is shown/);
    const none = injectionSummary();
    projectMoldingRoute(none, undefined, 'im-reaction-injection-molding');
    expect(none.warnings.join(' ')).toMatch(/im-reaction-injection-molding\) cannot be priced now|cannot be priced now/);
  });
});

describe('the apply endpoint accepts the other molding processes', () => {
  const check = async (routeId: string) => validate(plainToInstance(ApplyRouteDto, { routeId, location: 'USA' }));

  it('lists the three processes beside the injection tiers', () => {
    for (const id of ['im-small-50t', 'im-standard-200t', 'im-large-500t', 'im-structural-foam-molding', 'im-compression-molding', 'im-reaction-injection-molding']) expect(VALID_ROUTE_IDS).toContain(id);
  });

  it('validates each of them (it still refuses a route that is not feasible, in the apply itself, with the reason)', async () => {
    for (const id of ['im-structural-foam-molding', 'im-compression-molding', 'im-reaction-injection-molding']) expect(await check(id)).toEqual([]);
    expect((await check('im-made-up-molding')).length).toBeGreaterThan(0);
  });
});
