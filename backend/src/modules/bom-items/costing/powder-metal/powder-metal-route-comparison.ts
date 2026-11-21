// A powder metal part's entry in the route comparison: its cost summary as quoted, as one route (the same lines, the same totals, the same code
// path as the quote, so the comparison cannot disagree with it). Apply saves its lines as the item's process records. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { POWDER_METAL_ROUTE_LABEL } from './powder-metal-route';

export const POWDER_METAL_ROUTE_ID = 'powder-metal';

export function powderMetalRoute(summary: CostSummaryResponseDto): RouteResultDto {
  const pm = summary.powderMetal;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && !!pm?.complete && summary.totalCost != null;
  const gaps = findRouteDataGaps(summary.processLines);
  const why = pm?.complete === false ? 'the powder metal route is incomplete: a step has no capable machine or data' : (!pm && gaps[0]?.reason) || 'the part could not be costed';
  return {
    routeId: POWDER_METAL_ROUTE_ID,
    routeLabel: pm ? `${POWDER_METAL_ROUTE_LABEL} · ${pm.greenDensityKgM3} kg/m³ green` : POWDER_METAL_ROUTE_LABEL,
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
