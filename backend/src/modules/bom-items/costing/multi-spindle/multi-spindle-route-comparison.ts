// A Multi-Spindle Machining part's entries in the route comparison: one per route (6-spindle, 8-spindle, twin-spindle turning center), each
// its cost summary priced on that route (the same lines, the same totals, the same code path as the quote, so the comparison cannot disagree
// with it). Apply saves a route's lines as the item's process records. Pure.
import { MULTI_SPINDLE_ROUTES, type MultiSpindleRouteKey } from './multi-spindle-route';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';

import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';

/** The route id of a multi-spindle route ("multispindle-6"); the prefix ms- is multi-shot's. */
export const multiSpindleRouteId = (key: string) => `multispindle-${key}`;
export const MULTI_SPINDLE_ROUTE_IDS: readonly string[] = MULTI_SPINDLE_ROUTES.map((r) => multiSpindleRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary that quotes another route (no machine of this one fits) says why. */
export function multiSpindleRouteFor(key: MultiSpindleRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const ms = summary.multiSpindle;
  const label = MULTI_SPINDLE_ROUTES.find((r) => r.key === key)!.label;
  const isThis = ms?.route === key;
  const option = ms?.options.find((o) => o.route === key);
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && !!option?.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const why = !ms ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith('Multi-Spindle Machining cannot be costed')) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : option?.reason || 'the route is incomplete: an operation has no machine or data';
  return {
    routeId: multiSpindleRouteId(key),
    routeLabel: isThis && ms ? `${label} · ${ms.machineName ?? 'no machine'}, ${ms.bar.sizeLabel}` : label,
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
