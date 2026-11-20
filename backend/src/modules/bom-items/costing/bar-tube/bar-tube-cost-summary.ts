// Cost Summary of a bar, tube or profile part, from its route (bar-tube-route.ts) in the location's currency. Pure. A part that could not be
// priced is one named, uncosted line saying why; never priced as another process.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';
import { BAR_TUBE_CALC, BAR_TUBE_PROCESS_GROUP, relevantBarTubeGaps, type BarTubePart, type BarTubeRoute, type BarTubeRouteGap } from './bar-tube-route';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: BAR_TUBE_PROCESS_GROUP, processGroup: BAR_TUBE_PROCESS_GROUP, processRoute: BAR_TUBE_PROCESS_GROUP, operation: BAR_TUBE_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'bar_tube', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: BAR_TUBE_PROCESS_GROUP, machineClass: 'bar_tube', reason },
  };
}

export function buildBarTubeCostSummary(input: {
  /** The quoted route and every route, in the location's currency. */
  barTube: { route: BarTubeRoute | null; routes: BarTubeRoute[]; gaps: BarTubeRouteGap[]; part: BarTubePart | null; note: string | null; missing: string[]; warnings: string[] };
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { route, part } = input.barTube;
  const why = input.barTube.missing.join('; ') || 'no route could be built';
  const warnings = [...(input.barTube.note ? [input.barTube.note] : []), ...input.warnings, ...input.barTube.warnings];
  if (!route) warnings.push(`Bar and Tube Fabrication cannot be costed: ${why}`);
  const processLines = route ? route.lines : [uncosted(`Bar and Tube Fabrication cannot be costed: ${why}`)];
  if (route && !route.complete) warnings.push('The bar and tube route is incomplete: what cannot be costed is shown as a named gap, and the total excludes it.');
  const materialCost = route?.material.costUsd ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const massKg = route?.material.massKg ?? 0;
  const perKg = massKg > 0 && route?.material.costUsd != null ? route.material.costUsd / massKg : input.materialCostPerKg;
  const run = route?.material.run;
  const calculatorRuns: Record<string, ReturnType<typeof runView>> = run ? { 'Bar and tube stock': runView(BAR_TUBE_CALC.stock, 'Material Cost', run) } : {};
  const option = (r: BarTubeRoute) => ({
    route: r.key, label: r.label, complete: r.complete, totalCost: r.totalUsd,
    reason: r.complete ? null : [
      ...r.lines.filter((l) => l.physicsGap).map((l) => `${l.process}: ${(l.physicsGap as { reason?: string }).reason ?? 'not costed'}`),
      ...(r.material.missing ? [`stock: ${r.material.missing}`] : []),
    ].join('; '),
  });
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
    family: 'bar_tube',
    sustainability: computeSustainability(input.materialGrade, perKg, massKg, route?.material.partKg ?? massKg, input.batchSize, processLines),
    warnings: warnings.filter(Boolean),
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The material Apply records: the part's mass and what is bought for it (its share of a stock length).
    ...(route ? { castingMetal: { partKg: route.material.partKg, chargedKg: Math.max(route.material.massKg, route.material.partKg) } } : {}),
    // The route's tools (USD, the HR Rates and research currency): listed in the Cost Guide's tooling and written on Apply, not in the piece cost.
    ...(route && route.tooling.length ? { barTubeTooling: route.tooling } : {}),
    ...(route && part ? {
      barTube: {
        route: route.key, routeLabel: route.label,
        stockForm: part.stockForm, sectionWidthMm: r2(part.section.widthMm), sectionHeightMm: r2(part.section.heightMm),
        wallMm: part.section.wallMm != null ? r2(part.section.wallMm) : null, sectionAreaMm2: r2(part.section.areaMm2),
        developedLengthMm: r2(part.developedLengthMm), partsPerStock: route.material.partsPerStock,
        materialMassKg: route.material.massKg, partMassKg: route.material.partKg,
        stockPricePerKg: route.material.costUsd != null && route.material.massKg > 0 ? r3(route.material.costUsd / route.material.massKg) : null,
        stockMissing: route.material.missing,
        bends: part.bends.map((b) => ({ clrMm: r2(b.clrMm), angleDeg: r2(b.angleDeg) })),
        holeCount: part.holes.length, openingCount: part.complexHoles.length + part.cutouts.length,
        ends: part.ends.map((e) => ({ end: e.end, variant: e.variant, cutAngleDeg: e.cutAngleDeg })),
        forms: part.forms.map((f) => ({ end: f.end, variant: f.variant })),
        bendPlan: route.bendPlan.map((b) => ({ ...b, clrMm: r2(b.clrMm), angleDeg: r2(b.angleDeg) })),
        plate: part.plate ? { thicknessMm: part.plate.thicknessMm, blankLengthMm: r2(part.plate.blankLengthMm), blankWidthMm: r2(part.plate.blankWidthMm), cutLengthMm: r2(part.plate.cutLengthMm) } : null,
        complete: route.complete,
        options: [
          ...input.barTube.routes.map(option),
          ...relevantBarTubeGaps(input.barTube.gaps).map((g) => ({ route: g.key, label: g.label, complete: false, totalCost: null, reason: g.reason })),
        ],
      },
    } : {}),
  };
}
