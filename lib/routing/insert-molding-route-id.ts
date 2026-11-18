// An insert molding route's id is "im-insert-<method>" (backend insert-molding.ts insertMoldingRouteId: manual, 3-axis, 6-axis); its key,
// what the scenario's insertMoldingRoute holds, is the method with an underscore (3_axis), so the quote follows the route picked.
const PREFIX = 'im-insert-';

/** The INSERT_MOLDING_ROUTES key of an insert molding route id, or undefined for any other route. */
export function insertMoldingRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length).replace('-', '_') : undefined;
}
