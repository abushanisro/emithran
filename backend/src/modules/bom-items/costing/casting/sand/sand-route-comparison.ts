// A sand-cast part's entry in the route comparison: its cost summary as quoted, as one route (the same lines, the same totals, the same code path
// as the quote, so the comparison cannot disagree with it). The moulding process inside it is already the cheapest complete one (sand-route.ts),
// or the user's choice; the Cost Guide compares the moulding machines. Apply saves this route's lines as the item's process records, which
// replaces whatever another process (sheet metal, machining) left there. Pure.
import type { CostSummaryResponseDto } from '../../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../../dto/route-comparison.dto';
import { findRouteDataGaps } from '../../shared/core/engine-kernel';

export const SAND_CASTING_ROUTE_ID = 'sand-casting';

export function sandCastingRoute(summary: CostSummaryResponseDto): RouteResultDto {
  const moulding = summary.sandCasting?.mouldingProcess;
  const feasible = summary.totalCost != null;
  const gaps = findRouteDataGaps(summary.processLines);
  const why = summary.sandCasting?.complete === false ? 'the sand route is incomplete: a step has no capable machine or data' : 'the part could not be costed';
  return {
    routeId: SAND_CASTING_ROUTE_ID,
    routeLabel: moulding ? `Sand casting · ${moulding}` : 'Sand casting',
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
      estimatedTonnage: null, reasonCodes: [], warnings: feasible ? [] : [why],
    },
    warnings: summary.warnings,
    ratesSource: summary.ratesSource,
  };
}
