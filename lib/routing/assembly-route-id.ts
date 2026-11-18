// An assembly route's id in the route comparison is "assembly-<key>" (backend assembly-route-comparison.ts assemblyRouteId); the key is what
// the scenario's assemblyRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'assembly-';

/** The ASSEMBLY_ROUTES key of an assembly route id, or undefined for any other route. */
export function assemblyRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
