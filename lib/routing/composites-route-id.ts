// A composites route's id in the route comparison is "composites-<key>" (backend composites-route-comparison.ts compositesRouteId); the key is
// what the scenario's compositesRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'composites-';

/** The COMPOSITES_ROUTES key of a composites route id, or undefined for any other route. */
export function compositesRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
