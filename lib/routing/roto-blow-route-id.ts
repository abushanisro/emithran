// A Roto & Blow Molding route's id in the route comparison is "roto-blow-<key>" (backend roto-blow-route-comparison.ts rotoBlowRouteId); the
// key is what the scenario's rotoBlowRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'roto-blow-';

/** The ROTO_BLOW_ROUTES key (blow, roto) of a Roto & Blow Molding route id, or undefined for any other route. */
export function rotoBlowRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
