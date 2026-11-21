// Cost Summary of a powder metal part, from its route (powder-metal-route.ts) in the location's currency. Pure. A route that could not be built is
// one named, uncosted line saying what kept it from being built; never priced as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import { COMPACTION_PRESSURE, FILL_HEIGHT, POWDER, POWDER_METAL_PROCESS_GROUP, PRESS_FORCE, type PowderMetalRoute } from './powder-metal-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: 'Powder Metal', processGroup: POWDER_METAL_PROCESS_GROUP, processRoute: 'Powder Metal', operation: 'Powder Metal',
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'powder_metal', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: 'Powder Metal', machineClass: 'powder_metal', reason },
  };
}

/** The calculator run names a route's runs are shown under (PowderMetalRoute.material.runs keys). */
const RUN_NAMES: Record<string, [string, string]> = {
  powder: [POWDER, 'Material Cost'],
  compactionPressure: [COMPACTION_PRESSURE, 'Compaction Pressure'],
  pressForce: [PRESS_FORCE, 'Required Force'],
  fillHeight: [FILL_HEIGHT, 'Fill Height'],
};

export function buildPowderMetalCostSummary(input: {
  powderMetal: { route: PowderMetalRoute | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
  /** Machining after pressing (secondary-machining-cost.ts): its lines run after the route's. */
  secondaryMachining?: { lines: ProcessLineCost[]; warnings: string[] } | null;
}): CostSummaryDto {
  const { route } = input.powderMetal;
  const why = `Powder metal cannot be costed: ${input.powderMetal.missing.join('; ') || 'the route could not be built'}`;
  const warnings = [...input.warnings, ...input.powderMetal.warnings, ...(route ? [] : [why])];
  const machining = input.secondaryMachining ?? null;
  if (machining) warnings.push(...machining.warnings);
  const processLines = [...(route ? route.lines : [uncosted(why)]), ...(machining?.lines ?? [])];
  if (route && !route.complete) warnings.push('The powder metal route is incomplete: a step no machine can do is shown as a named gap, and the total excludes it.');
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const netKg = route?.material.partKg ?? 0;
  const grossKg = route?.material.powderKg ?? 0;
  const calculatorRuns = route ? Object.fromEntries(
    Object.entries(route.material.runs).filter(([k]) => RUN_NAMES[k]).map(([k, r]) => [`Powder metal ${k}`, runView(RUN_NAMES[k]![0], RUN_NAMES[k]![1], r)]),
  ) : {};
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossKg),
    // The price per kg the route charged (the powder, in the location's currency); the material resolution's own price is not in it.
    materialCostPerKg: route ? route.material.costPerKgUsd : input.materialCostPerKg,
    // Its source with it: a built route priced the powder from its raw_materials row (powder-metal-cost.service.ts getMaterial).
    materialSource: route ? 'db' : input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'powder_metal',
    sustainability: computeSustainability(input.materialGrade, route ? route.material.costPerKgUsd : input.materialCostPerKg, netKg, grossKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The powder the part is charged with: the material record is written from this one figure (the powder bought, the part).
    ...(route ? { castingMetal: { partKg: netKg, chargedKg: grossKg } } : {}),
    ...(route ? {
      powderMetal: {
        routeLabel: route.label, greenDensityKgM3: route.greenDensityKgM3, greenDensitySource: route.greenDensitySource,
        compactionPressureMpa: route.compactionPressureMpa, pressForceKn: route.pressForceKn, fillHeightMm: route.fillHeightMm,
        compressionRatio: route.compressionRatio, belt: route.belt, complete: route.complete,
      },
    } : {}),
  };
}
