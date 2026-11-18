// The route the Manufacturing Process tree shows when a route was applied (process_cost_records tagged auto_fill_from_route:<id>): that route
// as the route comparison prices it now. Pure.

/**
 * The applied route, when it is still one of the part's routes. A route the part can no longer take (its material or process changed since the
 * Apply: a resin route on a part now in a jetting material) is in the comparison with no lines; showing it would leave the tree with steps no
 * engine line stands behind, so no features and no machines. Then the tree shows the part's current quote instead, as the Cost Summary does.
 */
export function appliedRouteForTree<R extends { routeId: string; processLines: readonly unknown[] }>(
  routes: readonly R[] | null | undefined,
  appliedRouteId: string | null | undefined,
): R | null {
  if (!appliedRouteId) return null;
  const route = routes?.find((r) => r.routeId === appliedRouteId);
  return route && route.processLines.length > 0 ? route : null;
}
