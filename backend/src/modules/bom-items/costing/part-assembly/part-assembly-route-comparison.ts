// A weldment's entries in the route comparison: one per route (manual, robotic welding), each its cost summary priced on that route (the
// same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it). Apply saves a route's lines as
// the weldment's process records. Pure.
import { PART_ASSEMBLY_ROUTES, type PartAssemblyRouteKey } from './part-assembly-route';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';

import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';

/** The route id of a Part Assembly route ("partassembly-manual"). */
export const partAssemblyRouteId = (key: string) => `partassembly-${key}`;
export const PART_ASSEMBLY_ROUTE_IDS: readonly string[] = PART_ASSEMBLY_ROUTES.map((r) => partAssemblyRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary that quotes another route (this one is not a route for the weldment) says why. */
export function partAssemblyRouteFor(key: PartAssemblyRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const pa = summary.partAssembly;
  const label = PART_ASSEMBLY_ROUTES.find((r) => r.key === key)?.label ?? key;
  const isThis = pa?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && pa.complete;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = pa?.options.find((o) => o.route === key);
  const why = !pa?.route ? gaps.at(0)?.reason ?? summary.warnings.find((w) => w.startsWith('Part Assembly cannot be costed')) ?? 'the weldment could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this weldment'
    : `the weldment route is incomplete: ${gaps.map((g) => `${g.process}: ${g.reason}`).join('; ') || 'a weld is missing a measure or a step has no capable machine'}`;
  const welds = pa?.welds.filter((w) => w.enabled).length ?? 0;
  return {
    routeId: partAssemblyRouteId(key),
    routeLabel: isThis ? `${label} · ${pa.components.length} component(s), ${welds} weld row(s)` : label,
    processFamily: 'cutting',
    toolingVolumeNote: null,
    autoRoutable: true,
    processLines: isThis ? summary.processLines : [],
    materialCost: 0,
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
