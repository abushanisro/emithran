// An additive route's id in the route comparison is "additive-<key>" (backend additive-route-comparison.ts additiveRouteId); the key is what
// the scenario's additiveRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'additive-';

/** The ADDITIVE_ROUTES key of an additive route id, or undefined for any other route. */
export function additiveRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
