// A forging route's id in the route comparison is "forging-<key>" (backend forging-route-comparison.ts forgingRouteId); the key is what the
// scenario's forgingRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'forging-';

/** The FORGING_ROUTES key of a forging route id, or undefined for any other route. */
export function forgingRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
