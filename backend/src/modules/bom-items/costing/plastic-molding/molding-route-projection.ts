// A molding route applied for a part (Injection tiers, Structural Foam, Compression, Reaction Injection) becomes the part's cost summary: the summary adopts the route's own
// priced lines, material and totals, so the Cost tab, the saved rows and the route comparison state one price. The injection tiers are what the summary computes itself
// (its press is the selected one); the other three processes are priced by their own engines in the route comparison, and this takes what that priced. Pure.
import type { CostSummaryDto, ToolingCostDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';

/** The route ids whose process the injection summary does not price: each has its own engine in the route comparison. */
export const OTHER_MOLDING_ROUTE_IDS = ['im-structural-foam-molding', 'im-compression-molding', 'im-reaction-injection-molding'] as const;
export type OtherMoldingRouteId = (typeof OTHER_MOLDING_ROUTE_IDS)[number];

export const isOtherMoldingRouteId = (id: string | null | undefined): id is OtherMoldingRouteId => !!id && (OTHER_MOLDING_ROUTE_IDS as readonly string[]).includes(id);

/** The route id the active process records were written from (`auto_fill_from_route:<id>`), when it is one of the three other molding processes. */
export function appliedOtherMoldingRouteId(notes: ReadonlyArray<string | null | undefined>): OtherMoldingRouteId | null {
  for (const n of notes) {
    const m = /^auto_fill_from_route:(.+)$/.exec(n ?? '');
    if (m && isOtherMoldingRouteId(m[1])) return m[1];
  }
  return null;
}

/** What a route's process has no staged model for, said on the summary where the missing price would otherwise read as free. */
const NO_TOOLING_MODEL: Partial<Record<OtherMoldingRouteId, string>> = {
  'im-compression-molding': 'Compression molding has no staged mold-cost model: its tooling is not priced.',
  'im-reaction-injection-molding': 'Reaction injection molding has no staged mold-cost model: its tooling is not priced.',
};

/**
 * The summary with the route's lines, material, totals, cycle times and mold in place of the injection ones. A route that is not feasible or has no cost is not projected
 * (a part is never shown at a price its process cannot give): the summary keeps its own and says why.
 */
export function projectMoldingRoute<T extends CostSummaryDto>(summary: T, route: RouteResultDto | undefined, routeId: OtherMoldingRouteId): T {
  if (!route || !route.isFeasible || route.totalCost == null) {
    const why = route?.capability.warnings[0] ?? route?.warnings[0] ?? 'the route could not be priced';
    summary.warnings.push(`The applied route (${route?.routeLabel ?? routeId}) cannot be priced now (${why}): the injection molding price is shown.`);
    return summary;
  }
  const out = summary as T & { injectionMolding?: unknown; tooling?: ToolingCostDto };
  out.processLines = route.processLines;
  out.materialCost = route.materialCost;
  out.totalProcessCost = route.totalProcessCost;
  out.totalCost = route.totalCost;
  out.cycleTimes = { laserMin: route.cycleTimes.cuttingMin, pressBrakeMin: route.cycleTimes.pressBrakeMin, tappingMin: route.cycleTimes.tappingMin, deburrMin: route.cycleTimes.deburrMin, totalMin: route.cycleTimes.totalMin };
  // The injection breakdown (cavities, clamp, mold class) and its CAD driver impacts describe the injection engine: they do not describe this process
  delete out.injectionMolding;
  delete (out as { driverImpacts?: unknown }).driverImpacts;
  if (route.tooling) out.tooling = route.tooling;
  else delete out.tooling;
  out.warnings.push(`Priced as ${route.routeLabel}, the applied route.`);
  const noTooling = NO_TOOLING_MODEL[routeId];
  if (noTooling) out.warnings.push(noTooling);
  return summary;
}
