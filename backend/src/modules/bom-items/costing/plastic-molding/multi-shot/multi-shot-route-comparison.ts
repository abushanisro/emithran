// A multi-shot molded part's entries in the route comparison: one per press orientation, each its cost summary priced on that route (the same
// lines and totals as the quote, so the comparison cannot disagree with it). Apply saves a route's lines as the part's process records. Pure.
import { MULTI_SHOT_ROUTES, multiShotRouteId, type MultiShotRouteKey } from './multi-shot';
import { findRouteDataGaps } from '../../shared/core/engine-kernel';

import type { CostSummaryResponseDto } from '../../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../../dto/route-comparison.dto';

/** The route of `key` from the summary priced on it. */
export function multiShotRouteFor(key: MultiShotRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const im = summary.multiShot;
  const label = MULTI_SHOT_ROUTES.find((r) => r.key === key)!.label;
  const isThis = im?.route === key;
  const feasible = isThis && im.complete;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const why = !im ? summary.warnings[0] ?? 'the part could not be costed'
    : !isThis ? im.options.find((o) => o.route === key)?.reason ?? 'not a route for this part'
    : gaps.map((g) => `${g.process}: ${g.reason}`).join('; ') || 'a step has no capable machine or data';
  return {
    routeId: multiShotRouteId(key),
    routeLabel: isThis && im.press.name ? `${label} · ${im.press.name}${im.loaderName ? ` + ${im.loaderName}` : ''}` : label,
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
      estimatedTonnage: null, reasonCodes: [], warnings: feasible ? [] : [why],
    },
    warnings: isThis ? summary.warnings : [],
    ratesSource: summary.ratesSource,
    ...(isThis && summary.tooling ? { tooling: summary.tooling } : {}),
  };
}
