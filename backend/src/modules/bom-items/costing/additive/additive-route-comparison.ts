// A part built layer by layer: its entries in the route comparison, one per build route of its domain (Additive Manufacturing: metal sintering,
// laser sintering, material jetting, stereolithography; Rapid Prototyping: laser sintering, 3D printing, stereolithography), each its cost
// summary priced on that route (the same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it).
// Apply saves a route's lines as the item's process records. Pure.
import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';
import { ADDITIVE_DOMAINS, type AdditiveDomain, type AdditiveRouteKey } from './additive-domain';
import { notCostedPrefix } from './additive-cost-summary';

/** The route id of an additive route ("additive-metal_sintering"). */
export const additiveRouteId = (key: string) => `additive-${key}`;
export const ADDITIVE_ROUTE_IDS: readonly string[] = [...new Set(ADDITIVE_DOMAINS.flatMap((d) => d.routes.map((r) => additiveRouteId(r.key))))];

/** The route of `key` from the summary priced on it; a summary that quotes another route (this one is not a route for the part) says why. */
export function additiveRouteFor(domain: AdditiveDomain, key: AdditiveRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const additive = summary.additive;
  const label = domain.routes.find((r) => r.key === key)!.label;
  const isThis = additive?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && additive!.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = additive?.options.find((o) => o.route === key);
  const why = !additive ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith(notCostedPrefix(domain))) ?? 'the part could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this part'
    : 'the build route is incomplete: a step has no capable machine or data';
  return {
    routeId: additiveRouteId(key),
    routeLabel: isThis && additive ? `${label} · built along ${additive.buildDirection}, ${additive.partsPerBuild ?? 1} per build` : label,
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
