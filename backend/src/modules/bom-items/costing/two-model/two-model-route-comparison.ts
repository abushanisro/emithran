// A 2-Model Machining part's entry in the route comparison: its cost summary as quoted (the source component and the machining of what it
// does not supply), as one route: the same lines and totals as the quote, so the comparison cannot disagree with it. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';

export const TWO_MODEL_ROUTE_ID = 'two-model-machining';

export function twoModelRoute(summary: CostSummaryResponseDto): RouteResultDto {
  const source = summary.sourceComponent;
  const gaps = findRouteDataGaps(summary.processLines);
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && !!source && gaps.length === 0 && summary.totalCost != null;
  const why = !source ? (gaps[0]?.reason ?? summary.warnings[0] ?? 'the part could not be costed') : gaps[0]?.reason ?? 'a machining step has no capable machine or data';
  return {
    routeId: TWO_MODEL_ROUTE_ID,
    routeLabel: source ? `2-Model Machining · from ${source.name}` : '2-Model Machining',
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
