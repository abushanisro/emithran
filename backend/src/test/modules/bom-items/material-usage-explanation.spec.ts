import type { CalculatorRunDto } from '../../../modules/bom-items/dto/cost-breakdown.dto';
import { explainMaterialUsage, type UsageJustification } from '../../../modules/bom-items/costing/shared/material-usage-explanation';

const base = { blankSpec: null, isSheetMetal: false, engineGrossKg: null, engineNetKg: null, itemVolumeMm3: null, densityKgM3: null, cadWeightKg: null };
const step = (kind: 'input' | 'calculated', fieldName: string, value: number, extra: object = {}) => ({ fieldName, displayLabel: fieldName, kind, value, ...extra });
const run = (name: string, output: string, value: number, trace: object[]): CalculatorRunDto =>
  ({ calculatorId: `id-${name}`, calculatorVersion: 2, name, output, value, trace, lookupMatches: {}, missing: [] }) as CalculatorRunDto;
const steps = (j: UsageJustification) => j.trace.map((t) => `${t.displayLabel}=${t.value}`);
const last = (j: UsageJustification) => j.trace[j.trace.length - 1]!;

// Every working must end in the figure it explains: that is what makes it a justification of the record and not a second opinion.
const reconciles = (e: ReturnType<typeof explainMaterialUsage>) => {
  expect(last(e.net).value).toBeCloseTo(e.netUsage, 3);
  expect(last(e.gross).value).toBeCloseTo(e.grossUsage, 3);
  expect(last(e.scrap).value).toBeCloseTo(e.scrapPct, 2);
};

describe('explainMaterialUsage', () => {
  it('die casting: the two reference calculators that ran, each cut at the figure it yields', () => {
    const e = explainMaterialUsage({
      ...base, castingMetal: { partKg: 0.0154, chargedKg: 0.0169 },
      calculatorRuns: {
        'Net Material Usage': run('Die Casting - Net Material Usage', 'Net Usage', 0.01536, [step('input', 'Part Volume', 5506.91), step('input', 'Density', 2790), step('calculated', 'Net Usage', 0.0154)]),
        'Gross Material Usage': run('Die Casting - Gross Material Usage', 'Gross Usage', 0.0169, [step('input', 'Net Usage', 0.0154), step('input', 'Yield Loss Factor', 1.1), step('calculated', 'Gross Usage', 0.0169), step('calculated', 'Scrap', 9.1)]),
      },
    });
    expect(e.source).toBe('casting_charge');
    expect(e.net).toMatchObject({ title: 'Die Casting - Net Material Usage', calculatorId: 'id-Die Casting - Net Material Usage', calculatorVersion: 2, estimate: false });
    expect(steps(e.gross)).toEqual(['Net Usage=0.0154', 'Yield Loss Factor=1.1', 'Gross Usage=0.0169']);
    reconciles(e);
  });

  it('sand casting: the gross usage is the Bought Weight of the material-cost calculator, not the poured weight', () => {
    const metal = run('Sand Casting - Metal per casting', 'Poured Weight', 0.0802, [step('input', 'Volume', 14488.11), step('input', 'Density', 2700), step('calculated', 'Net Weight', 0.0391), step('calculated', 'Poured Weight', 0.0802)]);
    const cost = run('Sand Casting - Material cost', 'Material Cost', 0.2327, [step('input', 'Net Weight', 0.0391), step('input', 'Poured Weight', 0.0802), step('calculated', 'Melt Loss', 0.0016), step('calculated', 'Bought Weight', 0.0408), step('calculated', 'Material Cost', 0.2327)]);
    const e = explainMaterialUsage({ ...base, castingMetal: { partKg: 0.0391, chargedKg: 0.040754 }, calculatorRuns: { 'Sand metal per casting': metal, 'Sand material cost': cost } });
    expect(e.net.title).toBe('Sand Casting - Metal per casting');
    expect(steps(e.net)).toEqual(['Volume=14488.11', 'Density=2700', 'Net Weight=0.0391']);
    expect(e.gross.title).toBe('Sand Casting - Material cost');
    expect(last(e.gross).displayLabel).toBe('Bought Weight');
    reconciles(e);
  });

  it('never shows a calculator whose result is not the recorded figure: it falls back to the rule in words', () => {
    const stale = run('Die Casting - Gross Material Usage', 'Gross Usage', 0.5, [step('calculated', 'Gross Usage', 0.5)]);
    const e = explainMaterialUsage({ ...base, itemVolumeMm3: 10000, densityKgM3: 2700, castingMetal: { partKg: 0.027, chargedKg: 0.03 }, calculatorRuns: { 'Gross Material Usage': stale } });
    expect(e.gross).toMatchObject({ title: 'Metal charged per casting', calculatorId: null });
    expect(steps(e.net)).toEqual(['Part Volume=10000', 'Material Density=2700', 'Net Usage=0.027']);
    reconciles(e);
  });

  it('machining: the stock the part is cut from, with its size, volume and density', () => {
    const e = explainMaterialUsage({
      ...base, itemVolumeMm3: 5178.74, densityKgM3: 2900,
      blankSpec: { form: 'billet', sizeLabel: '35×26×24 billet', grossWeightKg: 0.066, netWeightKg: 0.015, stockVolumeMm3: 22803, densityKgM3: 2900 } as never,
    });
    expect(e.source).toBe('stock_blank');
    expect(steps(e.gross)).toEqual(['Stock=35×26×24 billet', 'Stock Volume=22803', 'Material Density=2900', 'Gross Usage=0.066']);
    expect(last(e.gross).formula).toBe('{Stock Volume} × {Material Density} ÷ 1,000,000,000');
    reconciles(e);
  });

  it('sheet metal: the sheet, its weight and the parts nested on it', () => {
    const e = explainMaterialUsage({
      ...base, isSheetMetal: true, engineGrossKg: 0.082, engineNetKg: 0.038,
      blankSpec: { form: 'sheet', sizeLabel: '1500×3000×1.5mm', grossWeightKg: 0.082, netWeightKg: 0.038, sheetWidthMm: 1500, sheetLengthMm: 3000, sheetWeightKg: 52.988, partsPerSheet: 643, nestingMethod: 'true_shape', nestingDimensionConfidence: 'verified', sheetSource: 'Nominal sheet of the laser' } as never,
    });
    expect(e.source).toBe('sheet_nesting');
    expect(e.gross.title).toBe('Sheet nesting (true shape)');
    expect(steps(e.gross)).toEqual(['Sheet=1500 × 3000 mm', 'Sheet Weight=52.988', 'Parts per Sheet=643', 'Gross Usage=0.082']);
    reconciles(e);
  });

  it("plastic molding: the molding engine's own gross weight, as the part plus its runner allowance (not a second 10% guess)", () => {
    const e = explainMaterialUsage({ ...base, itemVolumeMm3: 18844.74, densityKgM3: 1412, moldingGrossKg: 0.028737, runnerSystem: 'cold' });
    expect(e).toMatchObject({ source: 'molding_allowance', netUsage: 0.026609, grossUsage: 0.028737, scrapPct: 7.41 });
    expect(steps(e.gross)).toEqual(['Net Usage=0.026609', 'Runner Allowance=8', 'Gross Usage=0.028737']);
    expect(e.gross.estimate).toBe(false);
    reconciles(e);
  });

  it('with no stock, nest or charge the gross usage is the stated 10% allowance, and is marked as an estimate', () => {
    const e = explainMaterialUsage({ ...base, cadWeightKg: 0.4314 });
    expect(e.source).toBe('scrap_allowance_fallback');
    expect(e.gross.estimate).toBe(true);
    expect(e.scrap.estimate).toBe(true);
    expect(steps(e.gross)).toEqual(['Net Usage=0.4314', 'Scrap Allowance=10', 'Gross Usage=0.479333']);
  });

  it('says so when nothing can be derived', () => {
    const e = explainMaterialUsage(base);
    expect(e).toMatchObject({ source: 'none', netUsage: 0, grossUsage: 0 });
    expect(e.net.trace).toEqual([]);
    expect(e.net.title).toMatch(/Not derived/);
  });
});
