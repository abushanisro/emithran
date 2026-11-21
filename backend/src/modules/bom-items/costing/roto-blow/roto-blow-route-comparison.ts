// A blow molded or rotomolded part's entries in the route comparison: extrusion blow molding and rotational molding, each its cost summary
// priced on that route (the same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it). Apply
// saves a route's lines as the item's process records. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { ROTO_BLOW_NOT_COSTED } from './roto-blow-cost-summary';
import { ROTO_BLOW_ROUTES, type RotoBlowRouteKey } from './roto-blow-route';

/** The route id of a Roto & Blow Molding route ("roto-blow-blow", "roto-blow-roto"). */
export const rotoBlowRouteId = (key: string) => `roto-blow-${key}`;
export const ROTO_BLOW_ROUTE_IDS: readonly string[] = ROTO_BLOW_ROUTES.map((r) => rotoBlowRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary that quotes the other route (this one is not a route for the part) says why. */
export function rotoBlowRouteFor(key: RotoBlowRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const rb = summary.rotoBlow;
  const label = ROTO_BLOW_ROUTES.find((r) => r.key === key)!.label;
  const isThis = rb?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && rb!.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = rb?.options.find((o) => o.route === key);
  const why = !rb ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith(ROTO_BLOW_NOT_COSTED)) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : 'the route is incomplete: a step has no capable machine or data';
  return {
    routeId: rotoBlowRouteId(key),
    routeLabel: isThis && rb ? `${label} · ${rb.partsPerCycle ?? 1} ${key === 'blow' ? 'per shot' : 'per arm'}` : label,
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
