// A hydroformed part's entries in the route comparison: Hydroform Deep Draw and Hydroform Fluid Cell, each its cost summary priced on that
// route (the same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it). Apply saves a route's
// lines as the item's process records. Pure.
import { HYDROFORMING_NOT_COSTED } from './hydroforming-cost-summary';
import { HYDROFORMING_ROUTE_LABEL, HYDROFORMING_ROUTES, type HydroformingRouteKey } from './hydroforming-route';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';

import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';


/** The route id of a hydroforming route ("hydroform-deep-draw", "hydroform-fluid-cell"). */
export const hydroformingRouteId = (key: string) => `hydroform-${key}`;
export const HYDROFORMING_ROUTE_IDS: readonly string[] = HYDROFORMING_ROUTES.map((r) => hydroformingRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary whose route could not be built says why. */
export function hydroformingRouteFor(key: HydroformingRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const hf = summary.hydroforming;
  const label = HYDROFORMING_ROUTE_LABEL[key];
  const isThis = hf?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && hf.complete;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = hf?.options.find((o) => o.route === key);
  const why = !hf ? gaps.at(0)?.reason ?? summary.warnings.find((w) => w.startsWith(HYDROFORMING_NOT_COSTED)) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : 'the route is incomplete: a step has no capable machine or data';
  const detail = isThis
    ? key === 'deep-draw' ? ` · ${hf.draws} draw${hf.draws === 1 ? '' : 's'}` : ` · ${hf.partsPerTray?.value ?? 1} per tray`
    : '';
  return {
    routeId: hydroformingRouteId(key),
    routeLabel: `${label}${detail}`,
    processFamily: 'forming',
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
