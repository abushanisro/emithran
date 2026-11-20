// A weldment's route id in the route comparison is "partassembly-<key>" (backend part-assembly-route-comparison.ts partAssemblyRouteId); the
// key is what the scenario's partAssemblyRoute holds, so the quote follows the route picked in the Workflow Builder.
const PREFIX = 'partassembly-';

/** The PART_ASSEMBLY_ROUTES key of a weldment route id ("manual", "robotic"), or undefined for any other route. */
export function partAssemblyRouteKeyOf(routeId: string): string | undefined {
  return routeId.startsWith(PREFIX) && routeId.length > PREFIX.length ? routeId.slice(PREFIX.length) : undefined;
}
