import { deriveMaterialUsage, isStockDrivenBlank } from '../../../modules/bom-items/costing/shared/material-usage';

const base = { blankSpec: undefined, isSheetMetal: false, engineGrossKg: null, engineNetKg: null, itemVolumeMm3: null, densityKgM3: null, cadWeightKg: null };

describe('deriveMaterialUsage (moved from the front end unchanged)', () => {
  it('sheet metal: the real nesting yield', () => {
    expect(deriveMaterialUsage({ ...base, isSheetMetal: true, engineGrossKg: 1, engineNetKg: 0.6 })).toEqual({ grossUsage: 1, netUsage: 0.6, scrapPct: 40, source: 'sheet_nesting' });
  });

  it('die casting: the metal charged against the part metal', () => {
    expect(deriveMaterialUsage({ ...base, castingMetal: { partKg: 2, chargedKg: 2.5 } })).toMatchObject({ grossUsage: 2.5, netUsage: 2, scrapPct: 20, source: 'casting_charge' });
  });

  it('machining: the stock the blank optimizer selected, only when it is real and at least as heavy as the part', () => {
    const blankSpec = { form: 'round_bar', grossWeightKg: 3, netWeightKg: 2 } as never;
    expect(deriveMaterialUsage({ ...base, blankSpec })).toMatchObject({ source: 'stock_blank', grossUsage: 3, netUsage: 2 });
    expect(isStockDrivenBlank({ form: 'round_bar', grossWeightKg: 1, netWeightKg: 2 })).toBe(false);
    expect(isStockDrivenBlank({ form: 'sheet', grossWeightKg: 3, netWeightKg: 2 })).toBe(false);
  });

  it('a disclosed 10% scrap allowance only when no real stock or nesting exists', () => {
    expect(deriveMaterialUsage({ ...base, itemVolumeMm3: 1e6, densityKgM3: 1000 })).toMatchObject({ netUsage: 1, scrapPct: 10, source: 'scrap_allowance_fallback' });
    expect(deriveMaterialUsage({ ...base, cadWeightKg: 0.9 })).toMatchObject({ netUsage: 0.9, source: 'scrap_allowance_fallback' });
    expect(deriveMaterialUsage(base)).toMatchObject({ source: 'none', grossUsage: 0 });
  });
});
