// An investment-cast part's entry in the route comparison: its cost summary as quoted, as one route (the same lines, the same totals, the same
// code path as the quote, so the comparison cannot disagree with it). Apply saves this route's lines as the item's process records. Pure.
import type { CostSummaryResponseDto } from '../../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../../shared/core/engine-kernel';

export const INVESTMENT_CASTING_ROUTE_ID = 'investment-casting';

export function investmentCastingRoute(summary: CostSummaryResponseDto): RouteResultDto {
  const tree = summary.investmentCasting;
  // Costed only when the route was built and every step has a machine; a route that could not be built is one uncosted line whose total is the metal alone.
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && tree?.complete === true && summary.totalCost != null;
  const gaps = findRouteDataGaps(summary.processLines);
  // A route that could not be built at all is one uncosted line that says what kept it from being built.
  const why = tree ? 'the investment casting route is incomplete: a step has no capable machine or data' : gaps[0]?.reason ?? 'the part could not be costed';
  return {
    routeId: INVESTMENT_CASTING_ROUTE_ID,
    routeLabel: tree ? `Investment casting · ${tree.patternsPerTree} per tree` : 'Investment casting',
    processFamily: 'cutting',
    toolingVolumeNote: null,
    autoRoutable: true,
    processLines: summary.processLines,
    materialCost: summary.materialCost,
    abrasiveCost: 0,
    totalProcessCost: summary.totalProcessCost,
    totalCost: feasible ? summary.totalCost : null,
    isFeasible: feasible,
    dataComplete: gaps.length === 0,
    dataGaps: gaps,
    cycleTimes: { cuttingMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: summary.cycleTimes.totalMin },
    badges: { lowestCost: feasible, fastest: false, bestQuality: false },
    capability: {
      cuttingCapable: feasible, pressBrakeCapable: feasible, overallCapable: feasible, confidence: 'high',
      estimatedTonnage: null, reasonCodes: unpriced ? ['INPUT_MISSING'] : [], warnings: feasible ? [] : [unpriced ?? why],
    },
    warnings: summary.warnings,
    ratesSource: summary.ratesSource,
  };
}
