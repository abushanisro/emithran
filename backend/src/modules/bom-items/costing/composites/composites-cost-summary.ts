// Cost Summary of a laid-up composite part, from its route (composites-route.ts) in the location's currency. Pure. A route that could not be
// built is one named, uncosted line saying what kept it from being built; never priced as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import { COMPOSITES_CALC, COMPOSITES_PROCESS_GROUP, type CompositesRoute, type CompositesRouteGap } from './composites-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: 'Composites', processGroup: COMPOSITES_PROCESS_GROUP, processRoute: 'Composites', operation: 'Composites',
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'composites', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: 'Composites', machineClass: 'composites', reason },
  };
}

export function buildCompositesCostSummary(input: {
  /** The quoted route and every route, in the location's currency. */
  composites: { route: CompositesRoute | null; routes: CompositesRoute[]; gaps: CompositesRouteGap[]; note: string | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { route } = input.composites;
  const why = input.composites.missing.join('; ') || 'no layup route could be built';
  const warnings = [...(input.composites.note ? [input.composites.note] : []), ...input.warnings, ...input.composites.warnings];
  if (!route) warnings.push(`Composites cannot be costed: ${why}`);
  const processLines = route ? route.lines : [uncosted(`Composites cannot be costed: ${why}`)];
  if (route && !route.complete) warnings.push('The composites route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.');
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const massKg = route?.material.plyMassKg ?? 0;
  const perKg = route?.material.costPerKgUsd ?? input.materialCostPerKg;
  const calculatorRuns = route ? Object.fromEntries([
    ...(route.material.runs.ply ? [['Composites ply material', runView(COMPOSITES_CALC.plyMaterial, 'Ply Cost', route.material.runs.ply)]] : []),
    ...(route.material.runs.core ? [['Composites core material', runView(COMPOSITES_CALC.coreMaterial, 'Core Cost', route.material.runs.core)]] : []),
  ]) : {};
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
    family: 'composite',
    sustainability: computeSustainability(input.materialGrade, perKg, massKg, massKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    ...(route ? { castingMetal: { partKg: massKg, chargedKg: massKg } } : {}),
    ...(route ? {
      composites: {
        route: route.key, routeLabel: route.label, laminateMm: r3(route.stack.laminateMm), plyThicknessMm: route.stack.plyThicknessMm,
        plySource: route.stack.plySource,
        plies: route.stack.plies.map((p) => ({ index: p.index, areaMm2: r2(p.areaMm2), perimeterMm: r2(p.perimeterMm), level: p.level })),
        core: route.stack.core ? { areaMm2: r2(route.stack.core.areaMm2), perimeterMm: r2(route.stack.core.perimeterMm), depthMm: r3(route.stack.core.depthMm) } : null,
        partsPerLoad: route.partsPerLoad, boughtAreaM2: route.material.boughtAreaM2, plyMassKg: route.material.plyMassKg, complete: route.complete,
        options: [
          ...input.composites.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd, reason: r.complete ? null : `${r.lines.filter((l) => l.physicsGap).map((l) => l.process).join(', ')} not costed` })),
          ...input.composites.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
        ],
      },
    } : {}),
  };
}
