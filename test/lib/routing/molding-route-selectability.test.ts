import { describe, expect, it } from 'vitest';

import type { RouteResultDto } from '@/lib/api/hooks/useBOMItems';
import { MOLDING_APPLY_ROUTE_IDS, moldingRouteSelectability } from '@/lib/routing/molding-route-selectability';

const route = (over: Partial<RouteResultDto> = {}) => ({
  routeId: 'im-structural-foam-molding', isFeasible: true, warnings: [], capability: { warnings: [] }, compatibility: { status: 'compatible', incompatibilities: [], notAssessed: [], warnings: [] }, ...over,
}) as unknown as RouteResultDto;

describe('which molding routes can be set manually', () => {
  it('accepts every molding process the apply endpoint accepts: the three injection tiers, Structural Foam, Compression and Reaction Injection', () => {
    expect([...MOLDING_APPLY_ROUTE_IDS].sort()).toEqual(['im-compression-molding', 'im-large-500t', 'im-reaction-injection-molding', 'im-small-50t', 'im-standard-200t', 'im-structural-foam-molding']);
  });

  it('an injection tier that is priced can be set, with nothing to add', () => {
    expect(moldingRouteSelectability(route({ routeId: 'im-small-50t' }))).toEqual({ selectable: true, note: null });
  });

  it('another process that is compatible and priced can be set, and the note says it is a different process priced by its own engine', () => {
    for (const routeId of ['im-structural-foam-molding', 'im-compression-molding', 'im-reaction-injection-molding']) {
      const s = moldingRouteSelectability(route({ routeId }));
      expect(s.selectable).toBe(true);
      expect(s.note).toMatch(/different manufacturing process: priced by its own engine/);
    }
  });

  it('a route whose process cannot make a feature of the part cannot be set, and the note names the feature and why', () => {
    const s = moldingRouteSelectability(route({
      routeId: 'im-compression-molding',
      compatibility: { status: 'incompatible', notAssessed: [], warnings: [], incompatibilities: [{ featureType: 'LifterBundle', variant: 'small', count: 4, featureIds: [], kind: 'not_in_process_vocabulary', reason: 'The reference lists no LifterBundle for Compression Molding' }] },
    }));
    expect(s.selectable).toBe(false);
    expect(s.note).toBe('Cannot be set: this process cannot make a feature of this part (4 x LifterBundle: The reference lists no LifterBundle for Compression Molding)');
  });

  it('a route that is not feasible (the material excludes the process, no machine rate) cannot be set, and the note is the route\'s own reason', () => {
    const s = moldingRouteSelectability(route({ routeId: 'im-reaction-injection-molding', isFeasible: false, capability: { warnings: ['"Generic Nylon" is not a reaction injection molding material'] } as never }));
    expect(s).toEqual({ selectable: false, note: 'Cannot be set: "Generic Nylon" is not a reaction injection molding material' });
    expect(moldingRouteSelectability(route({ isFeasible: false, warnings: ['no machine rate'], capability: { warnings: [] } as never })).note).toBe('Cannot be set: no machine rate');
    expect(moldingRouteSelectability(route({ isFeasible: false })).note).toBe('Cannot be set: it could not be priced for this part');
  });

  it('an id the apply endpoint does not accept is never offered', () => {
    expect(moldingRouteSelectability(route({ routeId: 'im-made-up' })).selectable).toBe(false);
  });
});
