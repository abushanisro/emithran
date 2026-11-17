import { BomItemCostingService } from '../../../modules/bom-items/bom-item-costing.service';

/**
 * A part whose Process is Casting, before its material grade is set: no casting family can be priced, and each unpriced summary names no
 * family ('unknown'). The route comparison then still answers, with the routes of every casting process and none recommended. It used to
 * look the quoted family up by the summary's own family and fail on the missing one (500 on route-comparison and on Apply).
 */
describe('casting route comparison of a part with no material grade', () => {
  const unpriced = { family: 'unknown', processLines: [], totalCost: 0, warnings: [], usdToDisplayRate: 1 };
  const comparison = (routeId: string) => ({ recommendedRouteId: null, routes: [{ routeId, badges: { lowestCost: false, fastest: false, bestQuality: false } }], comparisonWarnings: [] });
  const service = Object.assign(Object.create(BomItemCostingService.prototype), {
    computeCostSummary: async () => unpriced,
    dieCastingRouteComparison: async () => comparison('die-casting-hpdc'),
    singleCastingRouteComparison: async (family: string) => comparison(family === 'sand_cast' ? 'sand-casting' : 'investment-casting'),
  }) as { castingRouteComparison(...args: unknown[]): Promise<{ recommendedRouteId: string | null; routes: Array<{ routeId: string }>; comparisonWarnings: string[] }> };

  it('lists every casting route, recommends none and says why', async () => {
    const result = await service.castingRouteComparison('item', 'user', 'token', 1, 'USA');
    expect(result.recommendedRouteId).toBeNull();
    expect(result.routes.map((r) => r.routeId)).toEqual(['die-casting-hpdc', 'sand-casting', 'investment-casting']);
    expect(result.comparisonWarnings[0]).toMatch(/no casting process could be fully costed/);
    expect(result.comparisonWarnings).toContain('No casting route is both feasible and fully costed for this part.');
  });
});
