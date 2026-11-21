// A forged part's entries in the route comparison: one per forging route, each its cost summary priced on that route (the same lines, the same
// totals, the same code path as the quote, so the comparison cannot disagree with it). Apply saves a route's lines as the item's process
// records. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { FORGING_ROUTES, type ForgingRouteKey } from './forging-route';

/** The route id of a forging route ("forging-closed_die_hammer"). */
export const forgingRouteId = (key: string) => `forging-${key}`;
export const FORGING_ROUTE_IDS: readonly string[] = FORGING_ROUTES.map((r) => forgingRouteId(r.key));

/**
 * The route of `key` from the summary priced on it. A summary that quotes another route (this one is not a route for the part) is not feasible,
 * and says why from the summary's own list of routes.
 */
export function forgingRouteFor(key: ForgingRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const forging = summary.forging;
  const label = FORGING_ROUTES.find((r) => r.key === key)!.label;
  const isThis = forging?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && forging!.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = forging?.options.find((o) => o.route === key);
  const why = !forging ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith('Forging cannot be costed')) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : 'the forging route is incomplete: a step has no capable machine or data';
  return {
    routeId: forgingRouteId(key),
    routeLabel: isThis && forging ? `${label} · ${forging.barDiameterMm} mm bar` : label,
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
