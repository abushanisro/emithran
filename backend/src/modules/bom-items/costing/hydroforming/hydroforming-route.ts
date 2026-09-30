import type { RouteResultDto } from '../../dto/route-comparison.dto';
import { findRouteDataGaps } from '../shared/core/engine-kernel';
import type { DrawnShell, HydroformingResult } from './hydroforming-engine';

/** The part's drawn shell from its feature graph (CAD Form/drawn), or null. */
export function drawnShellFromFeatures(features: ReadonlyArray<Record<string, any>> | null | undefined): DrawnShell | null {
  const entry = (features ?? []).find((f) => f.feature_type === 'Form' && f.variant === 'drawn');
  const occ = entry?.occurrences?.[0];
  if (!occ) return null;
  const depthMm = Number(occ.depth_mm);
  const openingWidthMm = Number(occ.opening_width_mm);
  const developedAreaMm2 = Number(occ.developed_area_mm2);
  return [depthMm, openingWidthMm, developedAreaMm2].every((n) => Number.isFinite(n) && n > 0)
    ? { depthMm, openingWidthMm, developedAreaMm2 }
    : null;
}

/**
 * The hydroforming route of the route comparison: Offline Blank then the
 * Hydroform press. Feasible when a press of the chosen forming type fits the
 * part and a blank press can cut it; complete only when every line is costed,
 * which the Hydroform line is not until its press rate and forming time exist
 * (findRouteDataGaps reports it) -- so it is shown and selectable, never
 * recommended on an incomplete price.
 */
export function buildHydroformRoute(args: {
  result: HydroformingResult;
  materialCost: number;
  ratesSource: string;
}): RouteResultDto {
  const { result, materialCost } = args;
  const lines = result.processLines;
  const blank = lines.find((l) => l.process === 'Offline Blank');
  const press = lines.find((l) => l.machineClass === 'hydroform');
  const dataGaps = findRouteDataGaps(lines);
  const processCost = Math.round(lines.reduce((s, l) => s + l.totalCost, 0) * 100) / 100;
  const pressFits = !!press?.machineName;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    routeId: result.process === 'Hydroform Deep Draw' ? 'sm-hydroform-deep-draw' : 'sm-hydroform-fluid-cell',
    routeLabel: result.process,
    processFamily: 'forming',
    toolingVolumeNote: null,
    processLines: lines,
    materialCost,
    abrasiveCost: 0,
    totalProcessCost: processCost,
    totalCost: r2(materialCost + processCost),
    isFeasible: pressFits,
    producesBlank: !!blank,
    dataComplete: dataGaps.length === 0,
    dataGaps,
    cycleTimes: {
      cuttingMin: r2(blank?.cycleTimeMin ?? 0),
      pressBrakeMin: 0,
      tappingMin: 0,
      deburrMin: 0,
      totalMin: r2(lines.reduce((s, l) => s + l.cycleTimeMin, 0)),
    },
    badges: { lowestCost: false, fastest: false, bestQuality: false },
    capability: {
      cuttingCapable: !!blank,
      pressBrakeCapable: false,
      overallCapable: pressFits && !!blank,
      confidence: 'low',
      estimatedTonnage: null,
      reasonCodes: [],
      warnings: [],
    },
    warnings: [
      ...(result.draws != null && result.draws > 1 ? [`${result.draws} draws needed (drawReductionPercentage).`] : []),
      ...result.warnings,
    ],
    ratesSource: args.ratesSource,
  };
}
