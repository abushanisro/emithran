// Cost Summary of a forged part, from its route (forging-route.ts) in the location's currency. Pure. A route that could not be built is one named,
// uncosted line saying what kept it from being built; never priced as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import { DIES, FORGING_PROCESS_GROUP, type ForgingRoute, type ForgingRouteGap } from './forging-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: 'Forging', processGroup: FORGING_PROCESS_GROUP, processRoute: 'Forging', operation: 'Forging',
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'forging', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: 'Forging', machineClass: 'forging', reason },
  };
}

/** The calculator run names a route's runs are shown under (forging-route.ts ForgingRoute.material.runs keys). */
const RUN_NAMES: Record<string, [string, string]> = {
  forgedVolume: ['Forging - Forged volume', 'Mult Volume'],
  stock: ['Forging - Bar stock', 'Material Cost'],
  flashLand: ['Forging - Flash land', 'Flash Thickness'],
  pressForce: ['Forging - Press force', 'Required Force'],
  trimForce: ['Forging - Trim force', 'Required Force'],
  hammerEnergy: ['Forging - Hammer energy', 'Required Energy'],
  ringPreform: ['Forging - Ring preform', 'Preform Wall'],
};

export function buildForgingCostSummary(input: {
  /** The quoted route and every route, in the location's currency (a route's total includes its dies per part). */
  forging: { route: ForgingRoute | null; routes: ForgingRoute[]; gaps: ForgingRouteGap[]; note: string | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
  /** Machining after forging (secondary-machining-cost.ts): its lines run after the route's. */
  secondaryMachining?: { lines: ProcessLineCost[]; warnings: string[] } | null;
}): CostSummaryDto {
  const { route } = input.forging;
  const warnings = [...(input.forging.note ? [input.forging.note] : []), ...input.warnings, ...input.forging.warnings];
  if (!route) warnings.push(`Forging cannot be costed: ${input.forging.missing.join('; ') || 'no forging route could be built'}`);
  const machining = input.secondaryMachining ?? null;
  if (machining) warnings.push(...machining.warnings);
  const processLines = [
    ...(route ? route.lines : [uncosted(`Forging cannot be costed: ${input.forging.missing.join('; ') || 'no forging route could be built'}`)]),
    ...(machining?.lines ?? []),
  ];
  if (route && !route.complete) warnings.push('The forging route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.');
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const netKg = route?.material.netKg ?? 0;
  const grossKg = route?.material.boughtKg ?? 0;
  const calculatorRuns = route ? Object.fromEntries([
    ...Object.entries(route.material.runs).filter(([k]) => RUN_NAMES[k]).map(([k, r]) => [`Forging ${k}`, runView(RUN_NAMES[k]![0], RUN_NAMES[k]![1], r)]),
    ...(route.tooling ? [['Forging dies', runView(DIES, 'Cost per Part', route.tooling.run)]] : []),
  ]) : {};
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossKg),
    // The price per kg the route charged (the forging bar, in the location's currency): the material record is written from it and the
    // charged mass, so the two give the material cost above. The material resolution's own price is not in the location's currency.
    materialCostPerKg: route ? route.material.costPerKgUsd : input.materialCostPerKg,
    materialSource: input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'forged',
    sustainability: computeSustainability(input.materialGrade, route ? route.material.costPerKgUsd : input.materialCostPerKg, netKg, grossKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The metal the part is charged with: the material record is written from this one figure (the bar bought, the forged part).
    ...(route ? { castingMetal: { partKg: netKg, chargedKg: route.material.boughtKg } } : {}),
    ...(route ? {
      forging: {
        route: route.key, routeLabel: route.label, complexity: route.complexity, barDiameterMm: route.barDiameterMm, multLengthMm: route.multLengthMm,
        heating: route.heating, hits: route.hits, forming: route.forming, trimForceKn: route.trimForceKn, flash: route.flash, complete: route.complete,
        options: [
          ...input.forging.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd, reason: r.complete ? null : `${r.lines.filter((l) => l.physicsGap).map((l) => l.process).join(', ')} not costed` })),
          ...input.forging.gaps.map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
        ],
      },
    } : {}),
    ...(route?.tooling ? {
      forgingDies: {
        sets: route.tooling.dieSets, costUsd: route.tooling.toolingCostUsd, perPartUsd: route.tooling.perPartUsd,
        detail: `${route.tooling.dieSets} set(s): finishing die ${route.tooling.finishDieUsd} USD and trim die ${route.tooling.trimDieUsd} USD each`,
      },
    } : {}),
  };
}
