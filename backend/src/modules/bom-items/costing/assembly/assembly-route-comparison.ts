// An assembly's entries in the route comparison: one per route (manual, robotic welding), each its cost summary priced on that route (the
// same lines, the same totals, the same code path as the quote, so the comparison cannot disagree with it). Apply saves a route's lines as the
// assembly's process records. Pure.
import { ASSEMBLY_ROUTES, type AssemblyRouteKey } from './assembly-route';
import { findRouteDataGaps, unpricedReason } from '../shared/core/engine-kernel';

import type { CostSummaryResponseDto } from '../../dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../dto/route-comparison.dto';

/** The route id of an assembly route ("assembly-manual"). */
export const assemblyRouteId = (key: string) => `assembly-${key}`;
export const ASSEMBLY_ROUTE_IDS: readonly string[] = ASSEMBLY_ROUTES.map((r) => assemblyRouteId(r.key));

/** The route of `key` from the summary priced on it; a summary that quotes another route (this one is not a route for the assembly) says why. */
export function assemblyRouteFor(key: AssemblyRouteKey, summary: CostSummaryResponseDto): RouteResultDto {
  const assembly = summary.assembly;
  const label = ASSEMBLY_ROUTES.find((r) => r.key === key)!.label;
  const isThis = assembly?.route === key;
  // Priced on a summary that priced nothing (no material grade): not feasible, and the missing input is the reason.
  const unpriced = unpricedReason(summary);
  const feasible = !unpriced && isThis && assembly.complete && summary.totalCost != null;
  const gaps = isThis ? findRouteDataGaps(summary.processLines) : [];
  const option = assembly?.options.find((o) => o.route === key);
  const why = !assembly?.route ? gaps[0]?.reason ?? summary.warnings.find((w) => w.startsWith('Assembly cannot be costed')) ?? 'the assembly could not be costed'
    : !isThis ? option?.reason ?? 'not a route for this assembly'
    : `the assembly route is incomplete: ${gaps.map((g) => `${g.process}: ${g.reason}`).join('; ') || 'a step has no capable machine or a joint is missing a measure'}`;
  const joints = assembly?.joints.filter((j) => j.enabled).length ?? 0;
  return {
    routeId: assemblyRouteId(key),
    routeLabel: isThis ? `${label} · ${assembly.components.length} component(s), ${joints} joint row(s)` : label,
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
