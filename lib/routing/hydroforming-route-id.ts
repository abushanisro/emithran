// A Sheet Metal - Hydroforming route's id in the route comparison is "hydroform-<key>" (backend hydroforming-route-comparison.ts
// hydroformingRouteId); the key is what the scenario's hydroformRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'hydroform-';

/** The HYDROFORMING_ROUTES key (deep-draw, fluid-cell) of a hydroforming route id, or undefined for any other route. */
export function hydroformingRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
