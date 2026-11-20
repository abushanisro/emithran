// The Cost Summary of a Multi-Spindle Machining part (multi-spindle-cost-summary.ts), its route comparison entries
// (multi-spindle-route-comparison.ts), its route ids on Apply and its process group.
import { multiSpindleMachinesFromMemory, splitRulesFromMemory, stockReferenceFromMemory } from './multi-spindle-fixtures';
import { loadMultiSpindleCalculatorSpec, multiSpindleCalculatorsByName } from '../../../../../modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculator-spec';
import { buildMultiSpindleCostSummary } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-cost-summary';
import { quoteMultiSpindle } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-quote';
import { MULTI_SPINDLE_ROUTE_IDS, multiSpindleRouteFor } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route-comparison';
import { multiSpindleStockReference, selectBar, type SelectedBar } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-stock';
import { familiesOfProcessGroup } from '../../../../../modules/bom-items/costing/shared/core/part-family-process-group';
import { VALID_ROUTE_IDS } from '../../../../../modules/bom-items/dto/apply-route.dto';

import type { MultiSpindleCostResult } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-cost.service';
import type { CostSummaryResponseDto, ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const ZERO_CONTEXT = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const deburr: ProcessLineCost = {
  process: 'Deburring', processGroup: 'Machining', processRoute: 'Deburring', operation: 'Deburring', setupCost: 0, runCost: 0.25, totalCost: 0.25,
  cycleTimeMin: 0.3, hourlyRate: 50, rateSource: 'mhr_database', machineClass: 'manual_deburr', machineName: 'Manual Deburr', commodityCode: null, labourRate: null,
};
const turning = (process: string, minutes: number): ProcessLineCost => ({ ...deburr, process, processRoute: process, operation: process, cycleTimeMin: minutes });
const part = { lengthMm: 32, volumeMm3: (Math.PI / 4) * 14 ** 2 * 32, turnedDiameterMm: 14, turnedLengthMm: 32 };
const bar = (): SelectedBar => selectBar({ outsideMm: 14, form: 'round', lengthMm: 32 }, multiSpindleStockReference(stockReferenceFromMemory()).reference!, 'US') as SelectedBar;

/** The result MultiSpindleCostService returns for the Ø14 x 32 mm part, priced on `chosen` (the cheapest when null). */
function priced(chosen: string | null): MultiSpindleCostResult {
  const quote = quoteMultiSpindle({
    ref: stockReferenceFromMemory(), spec: loadMultiSpindleCalculatorSpec(), calculators: multiSpindleCalculatorsByName(),
    machines: multiSpindleMachinesFromMemory(), rules: splitRulesFromMemory(), bar: bar(), part,
    material: { id: 'm1', name: 'AISI 1006', densityKgM3: 7850, pricePerKgUsd: 1.473, priceSource: 'test' },
    engine: { lines: [turning('Rough Turning', 0.5), turning('Finish Turning', 0.2), turning('Parting', 0.1), deburr], holes: [], threads: [] },
    chosen, batchSize: 1000, costContext: ZERO_CONTEXT, usdToLocal: 1,
  });
  return { quote, bar: bar(), part, missing: [], warnings: quote.warnings };
}
const summaryOf = (r: MultiSpindleCostResult) => buildMultiSpindleCostSummary({
  multiSpindle: r, materialGrade: 'AISI 1006', materialCostPerKg: 1.473, materialSource: 'db', batchSize: 1000, warnings: [], ratesSource: 'test',
});

describe('buildMultiSpindleCostSummary', () => {
  it('is the quoted route: its lines, the bar as material and blank stock, and the station plan with its slowest station', () => {
    const r = priced(null);
    const s = summaryOf(r);
    const q = r.quote!;
    expect(s.family).toBe('turned');
    expect(s.processLines).toBe(q.route!.lines);
    expect(s.materialCost).toBe(Math.round(q.stock.cost! * 100) / 100);
    expect(s.totalCost).toBeCloseTo(s.materialCost + s.totalProcessCost, 2);
    expect(s.blankSpec).toMatchObject({ form: 'round_bar', sizeLabel: '5/8" round bar', grossWeightKg: Math.round(q.stock.massPerPartKg! * 1000) / 1000 });
    expect(s.blankSpec!.netWeightKg).toBeLessThan(s.blankSpec!.grossWeightKg);
    const ms = s.multiSpindle!;
    expect(ms).toMatchObject({ route: q.route!.key, machineName: q.route!.machine!.name, complete: true, partsPerBar: 123, stockMissing: null });
    expect(ms.bar).toMatchObject({ sizeLabel: '5/8" round bar', unitSystem: 'US', partingWidthMm: 2.5, barLengthMm: 4500, remnantMm: 152.4 });
    expect(ms.stations.filter((st) => st.slowest)).toHaveLength(1);
    expect(ms.cycleSec).toBeCloseTo(ms.stations.find((st) => st.slowest)!.seconds + ms.indexSec!, 1);
    expect(ms.options.map((o) => [o.route, o.complete])).toEqual([['6', true], ['8', true], ['twin', true]]);
    expect(s.calculatorRuns?.['Multi-spindle bar stock']?.value).toBeCloseTo(q.stock.cost!, 9);
  });

  it('a part that cannot be priced is one named, uncosted Multi-Spindle Machining line', () => {
    const s = summaryOf({ quote: null, bar: null, part: null, missing: ['the part\'s turned diameter and length (press Refresh analysis so the part is measured)'], warnings: [] });
    expect(s.processLines).toHaveLength(1);
    expect(s.processLines[0]).toMatchObject({ process: 'Multi-Spindle Machining', totalCost: 0, physicsGap: { reason: expect.stringContaining('press Refresh analysis') } });
    expect(s.warnings).toEqual([expect.stringContaining('Multi-Spindle Machining cannot be costed')]);
    expect(s.multiSpindle).toBeUndefined();
  });
});

describe('the multi-spindle route comparison', () => {
  const asResponse = (r: MultiSpindleCostResult) => summaryOf(r) as unknown as CostSummaryResponseDto;

  it('each route is its own quote: feasible with that quote\'s total; another route\'s quote is not this route', () => {
    const on6 = asResponse(priced('6'));
    expect(multiSpindleRouteFor('6', on6)).toMatchObject({ routeId: 'multispindle-6', isFeasible: true, totalCost: on6.totalCost, processLines: on6.processLines });
    expect(multiSpindleRouteFor('8', on6)).toMatchObject({ routeId: 'multispindle-8', isFeasible: false, totalCost: null, processLines: [] });
  });

  it('a route with no machine for the part says why', () => {
    const none = { quote: null, bar: null, part: null, missing: ['HR Rates has no multi-spindle machines (class simultaneous_turning) for USA'], warnings: [] };
    expect(multiSpindleRouteFor('twin', asResponse(none)).capability.warnings).toEqual([expect.stringContaining('HR Rates has no multi-spindle machines')]);
  });

  it('its route ids are valid on Apply and are not multi-shot\'s (ms-)', () => {
    expect(MULTI_SPINDLE_ROUTE_IDS).toEqual(['multispindle-6', 'multispindle-8', 'multispindle-twin']);
    for (const id of MULTI_SPINDLE_ROUTE_IDS) expect(VALID_ROUTE_IDS).toContain(id);
  });

  it('Multi-Spindle Machining is costed as a turned part (its CAD analysis and its material are a turned part\'s)', () => {
    expect(familiesOfProcessGroup('Multi-Spindle Machining')).toEqual(['turned']);
  });
});
