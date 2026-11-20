// A Multi-Spindle Machining part priced on each route (multi-spindle-quote.ts), on memory/'s bar data and machines: the bar each part takes
// (the Bar Stock calculator of migration 1095), the route's lines in the location's currency, and what is named instead of priced.
import { multiSpindleMachinesFromMemory, splitRulesFromMemory, stockReferenceFromMemory } from './multi-spindle-fixtures';
import { loadMultiSpindleCalculatorSpec, multiSpindleCalculatorsByName } from '../../../../../modules/bom-items/costing/multi-spindle/calculators/multi-spindle-calculator-spec';
import { quoteMultiSpindle, type MultiSpindleMaterial } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-quote';
import { multiSpindleStockReference, selectBar, type SelectedBar } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-stock';

import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

const ZERO_CONTEXT = { qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };
const line = (process: string, minutes: number, cost: number, gap?: string): ProcessLineCost => ({
  process, processGroup: 'Machining', processRoute: process, operation: process, setupCost: 0, runCost: cost, totalCost: cost,
  cycleTimeMin: minutes, hourlyRate: 60, rateSource: 'mhr_database', machineClass: 'manual_deburr', machineName: 'timing', commodityCode: null, labourRate: null,
  ...(gap ? { physicsGap: { gapType: 'unsupported_operation', process, machineClass: 'simultaneous_turning', reason: gap } } : {}),
});

// A Ø14 x 32 mm steel part (AISI 1006 round bar 1.473 USD/kg, 7850 kg/m³), as migration 1095's hand-worked check.
const part = { lengthMm: 32, volumeMm3: (Math.PI / 4) * 14 ** 2 * 32, turnedDiameterMm: 14, turnedLengthMm: 32 };
const steel: MultiSpindleMaterial = { id: 'm1', name: 'AISI 1006', densityKgM3: 7850, pricePerKgUsd: 1.473, priceSource: 'AISI 1006: its round bar price at USA (Raw Materials)' };
const engineLines = (gap?: string) => [
  line('Rough Turning', 0.5, 0.9), line('Finish Turning', 0.2, 0.36), line('Parting', gap ? 0 : 0.1, 0.18, gap), line('Deburring', 0.3, 0.25), line('Inspection', 0.2, 0.4),
];
const barFor = (system: 'US' | 'metric'): SelectedBar => {
  const b = selectBar({ outsideMm: 14, form: 'round', lengthMm: 32 }, multiSpindleStockReference(stockReferenceFromMemory()).reference!, system);
  if ('missing' in b) throw new Error(b.missing);
  return b;
};
const quote = (over: Partial<Parameters<typeof quoteMultiSpindle>[0]> = {}) => quoteMultiSpindle({
  ref: stockReferenceFromMemory(), spec: loadMultiSpindleCalculatorSpec(), calculators: multiSpindleCalculatorsByName(),
  machines: multiSpindleMachinesFromMemory(), rules: splitRulesFromMemory(), bar: barFor('US'), part, material: steel,
  engine: { lines: engineLines(), holes: [] }, chosen: null, batchSize: 1000, costContext: ZERO_CONTEXT, usdToLocal: 1, ...over,
});

describe('quoteMultiSpindle', () => {
  it('each part takes its 123rd of a 4500 mm 5/8" bar (the 6 in remnant shared out), priced at the bar\'s USD/kg', () => {
    const q = quote();
    const area = (Math.PI / 4) * 15.875 ** 2;
    const mass = (4500 * area * 7850) / 1e9 / 123;
    expect(q.stock).toMatchObject({ partsPerBar: 123, pricePerKgUsd: 1.473, missing: null });
    expect(q.stock.massPerPartKg).toBeCloseTo(mass, 12);
    expect(q.stock.cost).toBeCloseTo(mass * 1.473, 12);
    expect(q.stock.partKg).toBeCloseTo((part.volumeMm3 / 1e9) * 7850, 12);
    // The bar the machines are checked against is the calculator's own Length per Part.
    expect(q.stock.run!.outputs['Length per Part']).toBeCloseTo(barFor('US').lengthPerPartMm, 12);
  });

  it('quotes the cheapest complete route: its Simultaneous Turning line, then the lines off the machine', () => {
    const q = quote();
    expect(q.complete).toBe(true);
    expect(q.routes.map((r) => r.key)).toEqual(['6', '8', 'twin']);
    const cheapest = Math.min(...q.routes.filter((r) => r.complete).map((r) => r.total));
    expect(q.route!.total).toBe(cheapest);
    expect(q.route!.lines.map((l) => l.process)).toEqual(['Simultaneous Turning', 'Deburring', 'Inspection']);
    const sum = q.route!.lines.reduce((s, l) => s + l.totalCost, 0) + q.stock.cost!;
    expect(q.route!.total).toBeCloseTo(Math.round(sum * 100) / 100, 9);
  });

  it('quotes the route set in the Cost Guide', () => {
    expect(quote({ chosen: 'twin' }).route!.key).toBe('twin');
  });

  it('in India: metric bar, and the machine line and the bar in the local currency (the turning engine\'s lines already are)', () => {
    const usd = quote({ bar: barFor('metric') });
    const inr = quote({ bar: barFor('metric'), usdToLocal: 84 });
    expect(barFor('metric').sizeLabel).toBe('16 mm round bar');
    const machineLine = (q: typeof usd) => q.routes.find((r) => r.key === '6')!.lines[0];
    expect(machineLine(inr).totalCost).toBeCloseTo(machineLine(usd).totalCost * 84, 0);
    expect(inr.stock.cost).toBeCloseTo(usd.stock.cost! * 84, 9);
    expect(inr.routes[0].lines.find((l) => l.process === 'Deburring')!.totalCost).toBe(0.25);
  });

  it('never fails: a bar with no price is named and left out of the total, and every route is still priced', () => {
    const q = quote({ material: { ...steel, pricePerKgUsd: null } });
    expect(q.stock).toMatchObject({ cost: null, missing: expect.stringContaining('Price per kg') });
    expect(q.complete).toBe(false);
    expect(q.routes.every((r) => r.complete)).toBe(true);
    expect(q.warnings).toEqual(expect.arrayContaining([expect.stringContaining('The bar is not priced')]));
  });

  it('never fails: an operation the data cannot time is a named gap line, and the route keeps the rest', () => {
    const q = quote({ engine: { lines: engineLines('Not priced — missing real input: tblVirtualPartoffInsertCutData row.'), holes: [] } });
    expect(q.complete).toBe(false);
    const gapLine = q.route!.lines.find((l) => l.process === 'Parting')!;
    expect(gapLine).toMatchObject({ totalCost: 0, processGroup: 'Multi-Spindle Machining', physicsGap: { reason: expect.stringContaining('tblVirtualPartoffInsertCutData') } });
    expect(q.warnings).toEqual(expect.arrayContaining(['Not timed on the machine: Parting. The total excludes them.']));
  });
});
