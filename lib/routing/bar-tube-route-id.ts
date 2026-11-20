// A bar and tube route's id in the route comparison is "bar-tube-<key>" (backend bar-tube-route-comparison.ts barTubeRouteId); the key is what
// the scenario's barTubeRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'bar-tube-';

/** The BAR_TUBE_ROUTES key of a bar and tube route id, or undefined for any other route. */
export function barTubeRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
