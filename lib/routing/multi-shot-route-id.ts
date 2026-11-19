// A multi-shot route's id is "ms-<orientation>" (backend multi-shot.ts multiShotRouteId: horizontal, vertical); its key, what the scenario's
// multiShotRoute holds, is the orientation, so the quote follows the route picked.
const PREFIX = 'ms-';

/** The MULTI_SHOT_ROUTES key of a multi-shot route id, or undefined for any other route. */
export function multiShotRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
