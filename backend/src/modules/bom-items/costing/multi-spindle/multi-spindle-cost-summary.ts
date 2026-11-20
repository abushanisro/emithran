// Cost Summary of a Multi-Spindle Machining part, from its quote (multi-spindle-quote.ts) in the location's currency. Pure. A part that could
// not be priced is one named, uncosted line saying why; never priced as another process.
import { BAR_REMNANT_MM } from './multi-spindle-research';
import { MULTI_SPINDLE_CALC, MULTI_SPINDLE_MACHINE_CLASS, MULTI_SPINDLE_PROCESS_GROUP, MULTI_SPINDLE_ROUTES } from './multi-spindle-route';
import { runView } from '../casting/casting-calculator-seeds';
import { computeSustainability } from '../shared/core/cost-engine';

import type { MultiSpindleCostResult } from './multi-spindle-cost.service';
import type { MultiSpindleRouteQuote } from './multi-spindle-quote';
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function uncosted(reason: string): ProcessLineCost {
  return {
    process: MULTI_SPINDLE_PROCESS_GROUP, processGroup: MULTI_SPINDLE_PROCESS_GROUP, processRoute: MULTI_SPINDLE_PROCESS_GROUP, operation: MULTI_SPINDLE_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: MULTI_SPINDLE_MACHINE_CLASS, machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: MULTI_SPINDLE_PROCESS_GROUP, machineClass: MULTI_SPINDLE_MACHINE_CLASS, reason },
  };
}

/** Why a route has no machine for the part: its Simultaneous Turning line's gap. */
const routeReason = (r: MultiSpindleRouteQuote): string | null => {
  const g = r.lines[0]?.physicsGap;
  return r.complete ? null : g && 'reason' in g ? g.reason : 'no machine of the route can make the part';
};

export function buildMultiSpindleCostSummary(input: {
  multiSpindle: MultiSpindleCostResult;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  warnings: string[];
  ratesSource: string;
}): CostSummaryDto {
  const { quote, bar } = input.multiSpindle;
  const route = quote?.route ?? null;
  const why = input.multiSpindle.missing.join('; ') || 'no route could be built';
  const warnings = [...input.warnings, ...input.multiSpindle.warnings];
  if (!route) warnings.push(`Multi-Spindle Machining cannot be costed: ${why}`);
  const processLines = route ? route.lines : [uncosted(`Multi-Spindle Machining cannot be costed: ${why}`)];
  if (route && !quote!.complete) warnings.push('The multi-spindle route is incomplete: what cannot be costed is shown as a named gap, and the total excludes it.');
  const stock = quote?.stock ?? null;
  const materialCost = stock?.cost ?? 0;
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const grossKg = stock?.massPerPartKg ?? 0;
  const partKg = stock?.partKg ?? 0;
  const perKg = grossKg > 0 && stock?.cost != null ? stock.cost / grossKg : input.materialCostPerKg;
  const calculatorRuns: Record<string, ReturnType<typeof runView>> = stock?.run ? { 'Multi-spindle bar stock': runView(MULTI_SPINDLE_CALC.stock, 'Material Cost', stock.run) } : {};
  const plan = route?.plan ?? null;
  return {
    materialCost: r2(materialCost),
    materialGrade: input.materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossKg),
    materialCostPerKg: perKg,
    materialSource: input.materialSource,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(materialCost + totalProcessCost),
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: r3(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)) },
    batchSize: input.batchSize,
    family: 'turned',
    sustainability: computeSustainability(input.materialGrade, perKg, grossKg, partKg || grossKg, input.batchSize, processLines),
    warnings: [...new Set(warnings.filter(Boolean))],
    ratesSource: input.ratesSource,
    ...(Object.keys(calculatorRuns).length ? { calculatorRuns } : {}),
    // The bar as the Cost tab's blank stock and the material Apply records (material-usage.ts stock_blank): the bar bought per part (its
    // share of a whole bar) and the part's own mass.
    ...(bar && grossKg > 0 ? {
      blankSpec: {
        form: `${bar.form}_bar` as const, sizeLabel: bar.sizeLabel, grossWeightKg: r3(grossKg), netWeightKg: r3(partKg),
        utilizationPct: partKg > 0 ? Math.round((partKg / grossKg) * 1000) / 10 : 0,
        wasteKg: r3(Math.max(0, grossKg - partKg)), wasteCost: r2(Math.max(0, grossKg - partKg) * perKg),
        stockVolumeMm3: Math.round(bar.sectionAreaMm2 * bar.lengthPerPartMm),
      },
    } : {}),
    ...(route && bar && quote ? {
      multiSpindle: {
        route: route.key, routeLabel: route.label,
        machineName: route.machine?.name ?? null,
        spindles: MULTI_SPINDLE_ROUTES.find((r) => r.key === route.key)!.spindles,
        cycleSec: route.cycleSec != null ? r2(route.cycleSec) : null,
        indexSec: route.indexSec != null ? r2(route.indexSec) : null,
        stations: (plan?.stations ?? []).map((st) => ({
          spindle: st.spindle, backWork: st.back, seconds: r2(st.seconds), slowest: st === plan!.slowest,
          operations: st.ops.map((o) => ({ name: o.name, slide: o.slide, seconds: r2(o.seconds) })),
        })),
        splits: route.splits,
        bar: {
          form: bar.form, sizeMm: r3(bar.sizeMm), sizeLabel: bar.sizeLabel, unitSystem: bar.unitSystem, snapped: bar.snapped,
          requiredMm: r3(bar.requiredMm), allowancePerSideMm: r3(bar.allowancePerSideMm), partingWidthMm: bar.partingWidthMm,
          facingStockMm: r3(bar.facingStockMm), lengthPerPartMm: r3(bar.lengthPerPartMm), barLengthMm: bar.barLengthMm, remnantMm: BAR_REMNANT_MM,
        },
        partsPerBar: stock?.partsPerBar ?? null,
        materialMassKg: stock?.massPerPartKg != null ? r3(stock.massPerPartKg) : null,
        partMassKg: stock?.partKg != null ? r3(stock.partKg) : null,
        stockPricePerKg: stock?.pricePerKgUsd != null ? r3(stock.pricePerKgUsd) : null,
        stockMissing: stock?.missing ?? null,
        complete: quote.complete,
        options: quote.routes.map((r) => ({ route: r.key, label: r.label, complete: r.complete, totalCost: r.complete ? r.total : null, reason: routeReason(r) })),
      },
    } : {}),
  };
}
