// Cost Summary of a blow molded or rotomolded part, from its route (roto-blow-route.ts) in the location's currency. Pure. A part that could not
// be priced is one named, uncosted line saying why; never priced as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import { ROTO_BLOW_CALC, ROTO_BLOW_PROCESS_GROUP, type RotoBlowPart, type RotoBlowRoute, type RotoBlowRouteGap } from './roto-blow-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The sentence a summary that could not be costed starts its warning with (the route comparison reads it). */
export const ROTO_BLOW_NOT_COSTED = `${ROTO_BLOW_PROCESS_GROUP} cannot be costed`;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: ROTO_BLOW_PROCESS_GROUP, processGroup: ROTO_BLOW_PROCESS_GROUP, processRoute: ROTO_BLOW_PROCESS_GROUP, operation: ROTO_BLOW_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'roto_blow', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: ROTO_BLOW_PROCESS_GROUP, machineClass: 'roto_blow', reason },
  };
}

export function buildRotoBlowCostSummary(input: {
  /** The quoted route and every route, in the location's currency. */
  rotoBlow: { route: RotoBlowRoute | null; routes: RotoBlowRoute[]; gaps: RotoBlowRouteGap[]; part: RotoBlowPart | null; note: string | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { route, part } = input.rotoBlow;
  const why = input.rotoBlow.missing.join('; ') || 'no route could be built';
  const warnings = [...(input.rotoBlow.note ? [input.rotoBlow.note] : []), ...input.warnings, ...input.rotoBlow.warnings];
  if (!route) warnings.push(`${ROTO_BLOW_NOT_COSTED}: ${why}`);
  const processLines = route ? route.lines : [uncosted(`${ROTO_BLOW_NOT_COSTED}: ${why}`)];
  if (route && !route.complete) warnings.push('The Roto & Blow Molding route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.');
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const massKg = route?.material.massKg ?? 0;
  const perKg = massKg > 0 ? materialCost / massKg : input.materialCostPerKg;
  const run = route?.material.run;
  const calculatorRuns: Record<string, ReturnType<typeof runView>> = route && run
    ? { 'Roto & Blow material': runView(route.key === 'blow' ? ROTO_BLOW_CALC.blowMaterial : ROTO_BLOW_CALC.rotoMaterial, 'Material Cost', run) } : {};
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(massKg),
    materialCostPerKg: perKg,
    materialSource: input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'roto_blow',
    sustainability: computeSustainability(input.materialGrade, perKg, massKg, route?.material.partKg ?? massKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The material Apply records: the part's mass and what is bought for it (flash, cut-out plugs).
    ...(route ? { castingMetal: { partKg: route.material.partKg, chargedKg: Math.max(route.material.massKg, route.material.partKg) } } : {}),
    // The molds and trim tooling (USD): listed in the Cost Guide's tooling and written on Apply, not in the piece cost.
    ...(route && route.tooling.length ? { rotoBlowTooling: route.tooling } : {}),
    ...(route && part ? {
      rotoBlow: {
        route: route.key, routeLabel: route.label,
        envelopeMm: [r2(part.envelope.lengthMm), r2(part.envelope.widthMm), r2(part.envelope.depthMm)],
        wallMm: r2(part.wallMm), insideVolumeMm3: r2(part.insideVolumeMm3), partingLineMm: part.partingLineMm != null ? r2(part.partingLineMm) : null,
        spouts: part.spouts.map((s) => ({ id: s.id, diameterMm: r2(s.diameterMm) })),
        partsPerCycle: route.partsPerCycle, coolingTimeS: route.coolingTimeS, materialMassKg: route.material.massKg, partMassKg: route.material.partKg,
        features: route.features.map((f) => ({ id: f.id, featureType: f.featureType, operation: f.operation, process: f.process, reason: f.reason })),
        complete: route.complete,
        options: [
          ...input.rotoBlow.routes.map((r) => ({
            route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd,
            reason: r.complete ? null : r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason ?? 'not costed'}`).join('; ') || 'the material',
          })),
          ...input.rotoBlow.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
        ],
      },
    } : {}),
  };
}
