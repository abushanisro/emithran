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
    const metal = run('Sand Casting - Metal per casting', 'Poured Weight', 0.0802, [
      step('input', 'Volume', 14488.11), step('input', 'Density', 2700), step('input', 'Gating', 0.0062), step('input', 'Risers', 0.0349),
      step('calculated', 'Net Weight', 0.0391, { formula: '{Volume} / 1e9 * {Density}' }), step('calculated', 'Poured Weight', 0.0802, { formula: '{Net Weight} + {Gating} + {Risers}' }),
    ]);
    const cost = run('Sand Casting - Material cost', 'Material Cost', 0.2327, [
      step('input', 'Net Weight', 0.0391), step('input', 'Poured Weight', 0.0802), step('input', 'Furnace Yield Loss Factor', 0.98), step('input', 'Remelt Allowance', 1),
      step('input', 'Price', 5.711), step('input', 'Final Yield', 1),
      step('calculated', 'Melt Loss', 0.0016, { formula: '{Poured Weight} / {Furnace Yield Loss Factor} - {Poured Weight}' }),
      step('calculated', 'Bought Weight', 0.0408, { formula: '{Net Weight} + {Melt Loss} + ({Poured Weight} - {Net Weight}) * (1 - min(max({Remelt Allowance}, 0), 1))' }),
      step('calculated', 'Material Cost', 0.2327, { formula: '{Bought Weight} * {Price} / {Final Yield}' }),
    ]);
    const e = explainMaterialUsage({ ...base, castingMetal: { partKg: 0.0391, chargedKg: 0.040754 }, calculatorRuns: { 'Sand metal per casting': metal, 'Sand material cost': cost } });
    expect(e.net.title).toBe('Sand Casting - Metal per casting');
    expect(steps(e.net)).toEqual(['Volume=14488.11', 'Density=2700', 'Net Weight=0.0391']);
    expect(e.gross.title).toBe('Sand Casting - Material cost');
    // Only what the weight is computed from: the gating and risers belong to the poured weight, the price and final yield to the cost.
    expect(steps(e.gross)).toEqual(['Net Weight=0.0391', 'Poured Weight=0.0802', 'Furnace Yield Loss Factor=0.98', 'Remelt Allowance=1', 'Melt Loss=0.0016', 'Bought Weight=0.0408']);
    reconciles(e);
  });

  it('investment casting: the net weight of the metal calculator and the Bought Weight of the material-cost calculator', () => {
    const metal = run('Investment Casting - Metal per casting', 'Poured Weight', 0.0665, [
      step('input', 'Part Volume', 5178.74), step('input', 'Density', 7700), step('input', 'Gating Efficiency', 0.6), step('input', 'Patterns per Tree', 40),
      step('calculated', 'Net Weight', 0.0399, { formula: '{Part Volume} * 1e-9 * {Density}' }), step('calculated', 'Poured Weight', 0.0665, { formula: '{Net Weight} / {Gating Efficiency}' }),
      step('calculated', 'Poured per Tree', 2.66, { formula: '{Poured Weight} * {Patterns per Tree}' }),
    ]);
    const cost = run('Investment Casting - Material cost', 'Material Cost', 0.08, [
      step('input', 'Net Weight', 0.0399), step('input', 'Poured Weight', 0.0665), step('input', 'Furnace Yield', 0.95), step('input', 'Remelt Allowance', 97.5), step('input', 'Price', 1.82),
      step('calculated', 'Melt Loss', 0.0035, { formula: '{Poured Weight} / {Furnace Yield} - {Poured Weight}' }),
      step('calculated', 'Bought Weight', 0.044074, { formula: '{Net Weight} + {Melt Loss} + ({Poured Weight} - {Net Weight}) * (1 - min(max({Remelt Allowance} / 100, 0), 1))' }),
      step('calculated', 'Material Cost', 0.08, { formula: '{Bought Weight} * {Price}' }),
    ]);
    const e = explainMaterialUsage({ ...base, castingMetal: { partKg: 0.0399, chargedKg: 0.044074 }, calculatorRuns: { 'Investment metal per casting': metal, 'Investment material cost': cost } });
    expect(e.net.title).toBe('Investment Casting - Metal per casting');
    expect(steps(e.net)).toEqual(['Part Volume=5178.74', 'Density=7700', 'Net Weight=0.0399']);
    expect(e.gross.title).toBe('Investment Casting - Material cost');
    // The price belongs to the cost, not to the weight bought.
    expect(steps(e.gross)).toEqual(['Net Weight=0.0399', 'Poured Weight=0.0665', 'Furnace Yield=0.95', 'Remelt Allowance=97.5', 'Melt Loss=0.0035', 'Bought Weight=0.044074']);
    reconciles(e);
  });

  // Cannula Holder bottom, forged in AA 380.0: the Gross Usage dialog showed "Metal charged per casting, part metal plus the melt loss". A forging
  // buys the bar its mults are sawn from: the forged volume (part, flash, scale) and the bar stock calculators.
  it('a forging: the bar bought, worked from the part through its flash and scale to the mults a bar gives', () => {
    const forged = run('Forging - Forged volume', 'Mult Volume', 13_700, [
      step('input', 'Part Volume', 11_272), step('input', 'Flash Percentage', 21), step('input', 'Scale Loss', 1),
      step('calculated', 'Forged Volume', 13_639, { formula: '{Part Volume} * (1 + {Flash Percentage} / 100)' }),
      step('calculated', 'Mult Volume', 13_775, { formula: '{Forged Volume} * (1 + {Scale Loss} / 100)' }),
    ]);
    const stock = run('Forging - Bar stock', 'Material Cost', 0.25, [
      step('input', 'Mult Volume', 13_775), step('input', 'Bar Diameter', 19.05), step('input', 'Kerf', 3.175), step('input', 'Standard Stock Length', 6096),
      step('input', 'Density', 2760), step('input', 'Bar Price', 5.9),
      step('calculated', 'Bar Area', 285.02, { formula: 'pi * {Bar Diameter} ^ 2 / 4' }),
      step('calculated', 'Mult Length', 48.33, { formula: '{Mult Volume} / {Bar Area}' }),
      step('calculated', 'Mults per Bar', 118, { formula: 'max(1, floor({Standard Stock Length} / ({Mult Length} + {Kerf})))' }),
      step('calculated', 'Bought Length', 51.66, { formula: '{Standard Stock Length} / {Mults per Bar}' }),
      step('calculated', 'Bought Mass', 0.0427, { formula: '{Bar Area} * {Bought Length} * 1e-9 * {Density}' }),
      step('calculated', 'Material Cost', 0.25, { formula: '{Bought Mass} * {Bar Price}' }),
    ]);
    const e = explainMaterialUsage({ ...base, itemVolumeMm3: 11_272, densityKgM3: 2760, castingMetal: { partKg: 0.0311, chargedKg: 0.0427 }, calculatorRuns: { 'Forging forgedVolume': forged, 'Forging stock': stock } });
    expect(e.gross.title).toBe('Forging - Forged volume → Forging - Bar stock');
    expect(steps(e.gross)).toEqual([
      'Part Volume=11272', 'Flash Percentage=21', 'Scale Loss=1', 'Forged Volume=13639', 'Mult Volume=13775',
      'Bar Diameter=19.05', 'Kerf=3.175', 'Standard Stock Length=6096', 'Density=2760',
      'Bar Area=285.02', 'Mult Length=48.33', 'Mults per Bar=118', 'Bought Length=51.66', 'Bought Mass=0.0427',
    ]);
    expect(e.gross.calculatorId).not.toBeNull();
    reconciles(e);
  });

  it('a powder metal part: the part at its green density, and the powder bought over the utilization', () => {
    const powder = run('Powder Metal - Powder', 'Material Cost', 0.13, [
      step('input', 'Part Volume', 10_603), step('input', 'Green Density', 7020), step('input', 'Powder Price', 1.621), step('input', 'Utilization', 0.9),
      step('calculated', 'Part Mass', 0.0744, { formula: '{Part Volume} * {Green Density} * 1e-9' }),
      step('calculated', 'Powder Mass', 0.0827, { formula: '{Part Mass} / {Utilization}' }),
      step('calculated', 'Material Cost', 0.13, { formula: '{Powder Mass} * {Powder Price}' }),
    ]);
    const e = explainMaterialUsage({ ...base, castingMetal: { partKg: 0.0744, chargedKg: 0.0827 }, calculatorRuns: { 'Powder metal powder': powder } });
    expect(e.net.title).toBe('Powder Metal - Powder');
    expect(steps(e.net)).toEqual(['Part Volume=10603', 'Green Density=7020', 'Part Mass=0.0744']);
    expect(steps(e.gross)).toEqual(['Part Volume=10603', 'Green Density=7020', 'Utilization=0.9', 'Part Mass=0.0744', 'Powder Mass=0.0827']);
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
