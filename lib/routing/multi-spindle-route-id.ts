// A multi-spindle route's id in the route comparison is "multispindle-<key>" (backend multi-spindle-route-comparison.ts multiSpindleRouteId:
// 6, 8, twin); the key is what the scenario's multiSpindleRoute holds, so the quote follows the route picked. "ms-" is multi-shot's.
const PREFIX = 'multispindle-';

/** The MULTI_SPINDLE_ROUTES key of a multi-spindle route id, or undefined for any other route. */
export function multiSpindleRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
