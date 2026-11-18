import { describe, expect, it } from 'vitest';

import { appliedRouteForTree } from '@/lib/features/applied-route-for-tree';

const routes = [
  { routeId: 'additive-printing', processLines: [{ process: 'Printing' }, { process: 'Breakoff' }] },
  // Applied on a resin, the part is now in a jetting material: the resin route is in the comparison with no lines.
  { routeId: 'additive-resin_curing', processLines: [] },
];

describe('the applied route the process tree shows', () => {
  it('is the applied route while the part can still take it', () => {
    expect(appliedRouteForTree(routes, 'additive-printing')?.routeId).toBe('additive-printing');
  });

  it('is none once the applied route has no lines (the part\'s material or process changed): the tree shows the current quote', () => {
    expect(appliedRouteForTree(routes, 'additive-resin_curing')).toBeNull();
    expect(appliedRouteForTree(routes, 'additive-metal_sintering')).toBeNull();
    expect(appliedRouteForTree(undefined, 'additive-printing')).toBeNull();
    expect(appliedRouteForTree(routes, null)).toBeNull();
  });
});
