// A bar and tube part's entries in the route comparison: one per route (saw and punch, tube laser), each its cost summary priced on that route
// (the same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it). Apply saves a route's lines as
// the item's process records. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { BAR_TUBE_ROUTES, type BarTubeRouteKey } from './bar-tube-route';

/** The route id of a bar and tube route ("bar-tube-saw"). */
export const barTubeRouteId = (key: string) => `bar-tube-${key}`;
export const BAR_TUBE_ROUTE_IDS: readonly string[] = BAR_TUBE_ROUTES.map((r) => barTubeRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary that quotes another route (this one is not a route for the part) says why. */
export function barTubeRouteFor(key: BarTubeRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const barTube = summary.barTube;
  const label = BAR_TUBE_ROUTES.find((r) => r.key === key)!.label;
  const isThis = barTube?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && barTube!.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = barTube?.options.find((o) => o.route === key);
  const why = !barTube ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith('Bar and Tube Fabrication cannot be costed')) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : option?.reason || 'the route is incomplete: a step has no capable machine or data';
  return {
    routeId: barTubeRouteId(key),
    routeLabel: isThis && barTube ? `${label} · ${barTube.stockForm.toLowerCase().replace(/_/g, ' ')}, ${barTube.developedLengthMm} mm` : label,
    processFamily: 'cutting',
    toolingVolumeNote: null,
    autoRoutable: true,
    processLines: isThis ? summary.processLines : [],
    materialCost: isThis ? summary.materialCost : 0,
    abrasiveCost: 0,
    totalProcessCost: isThis ? summary.totalProcessCost : 0,
    totalCost: feasible ? summary.totalCost : null,
    isFeasible: feasible,
    dataComplete: isThis && gaps.length === 0,
    dataGaps: gaps,
    cycleTimes: { cuttingMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: isThis ? summary.cycleTimes.totalMin : 0 },
    badges: { lowestCost: false, fastest: false, bestQuality: false },
    capability: {
      cuttingCapable: feasible, pressBrakeCapable: feasible, overallCapable: feasible, confidence: 'high',
      estimatedTonnage: null, reasonCodes: unpriced ? ['INPUT_MISSING'] : [], warnings: feasible ? [] : [unpriced ?? why],
    },
    warnings: isThis ? summary.warnings : [],
    ratesSource: summary.ratesSource,
  };
}
