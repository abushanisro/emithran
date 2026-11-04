import { computeNesting, computeMassBasedUtilizationPct } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { selectBestTrueNestCandidate } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/true-nest-costing.engine';

// Sheet-Metal-Cost-Model-Algorithm.md sections 1-3.
describe('computeNesting — reference algorithm', () => {
  it('sheet weight: 1250 x 2500 x 1.5 mm at 7850 kg/m3 = 36.797 kg (reference 36,796.88 g)', () => {
    const r = computeNesting({
      flatPatternLengthMm: 100, flatPatternWidthMm: 50, thicknessMm: 1.5,
      netWeightKg: 0.088, densityKgM3: 7850, materialPricePerKg: 0.98,
      partAllowanceMm: 2, sheets: [{ widthMm: 1250, lengthMm: 2500 }],
    });
    expect(r.sheetWeightKg).toBeCloseTo(36.797, 3);
  });

  it('grid count: floor(usable / (blank + allowance)) in the better orientation, edge allowance 2 mm', () => {
    // usable 1246 x 2496, part cell 102 x 52:
    //   upright  floor(1246/52)=23 x floor(2496/102)=24 = 552
    //   rotated  floor(1246/102)=12 x floor(2496/52)=48 = 576
    const r = computeNesting({
      flatPatternLengthMm: 100, flatPatternWidthMm: 50, thicknessMm: 1.5,
      netWeightKg: 0.088, densityKgM3: 7850, materialPricePerKg: 1,
      partAllowanceMm: 2, sheets: [{ widthMm: 1250, lengthMm: 2500 }],
    });
    expect(r.partsPerSheet).toBe(576);
  });

  it('gross/scrap/utilisation/material cost follow sections 1.3 and 2', () => {
    const r = computeNesting({
      flatPatternLengthMm: 100, flatPatternWidthMm: 50, thicknessMm: 1.5,
      netWeightKg: 0.04, densityKgM3: 7850, materialPricePerKg: 100,
      scrapPricePerKg: 40, scrapRecoveryPct: 0.9,
      partAllowanceMm: 2, sheets: [{ widthMm: 1250, lengthMm: 2500 }],
    });
    const gross = 36.796875 / 576;
    const scrap = gross - 0.04;
    expect(r.grossWeightPerPartKg).toBeCloseTo(gross, 3);
    expect(r.scrapWeightPerPartKg).toBeCloseTo(scrap, 3);
    expect(r.utilisationPct).toBeCloseTo((0.04 / gross) * 100, 1);
    expect(r.grossMaterialCost).toBeCloseTo(gross * 100, 2);
    expect(r.scrapRecoveryCost).toBeCloseTo(scrap * 40 * 0.9, 2);
    expect(r.netMaterialCost).toBeCloseTo(gross * 100 - scrap * 40 * 0.9, 2);
  });

  it('batch consumption: sheets = ceil(lot / parts per sheet) (section 3.2: ceil(100/2) = 50)', () => {
    const r = computeNesting({
      flatPatternLengthMm: 1200, flatPatternWidthMm: 1000, thicknessMm: 1.5,
      netWeightKg: 10, densityKgM3: 7850, materialPricePerKg: 1,
      partAllowanceMm: 2, quantityRequired: 100, sheets: [{ widthMm: 1250, lengthMm: 2500 }],
    });
    expect(r.partsPerSheet).toBe(2);
    expect(r.sheetsRequired).toBe(50);
    expect(r.plannedParts).toBe(100);
    expect(r.excessPositions).toBe(0);
  });

  it('REGRESSION: a sheet recorded long-side-as-width still nests a part that fits only rotated', () => {
    // 2000 x 500 part on a 1250 x 3000 sheet recorded as width 3000 / length 1250.
    // It used to be skipped for that sheet and silently costed as 1 part per sheet.
    const r = computeNesting({
      flatPatternLengthMm: 2000, flatPatternWidthMm: 500, thicknessMm: 2,
      netWeightKg: 15, densityKgM3: 7850, materialPricePerKg: 1,
      partAllowanceMm: 2, sheets: [{ widthMm: 3000, lengthMm: 1250 }],
    });
    // usable 2996 x 1246, cell 2002 x 502: floor(2996/2002)=1 x floor(1246/502)=2
    expect(r.partsPerSheet).toBe(2);
    const same = computeNesting({
      flatPatternLengthMm: 2000, flatPatternWidthMm: 500, thicknessMm: 2,
      netWeightKg: 15, densityKgM3: 7850, materialPricePerKg: 1,
      partAllowanceMm: 2, sheets: [{ widthMm: 1250, lengthMm: 3000 }],
    });
    expect(same.partsPerSheet).toBe(r.partsPerSheet);
  });

  it('picks the sheet with more parts when several fit', () => {
    const r = computeNesting({
      flatPatternLengthMm: 100, flatPatternWidthMm: 50, thicknessMm: 1,
      netWeightKg: 0.04, densityKgM3: 7850, materialPricePerKg: 1,
      partAllowanceMm: 2,
      sheets: [{ widthMm: 1000, lengthMm: 2000 }, { widthMm: 1500, lengthMm: 3000 }],
    });
    expect(r.sheetLengthMm).toBe(3000);
  });
});

describe('selectBestTrueNestCandidate — MIN(gross weight per part)', () => {
  it('chooses the lowest gross weight/part and recomputes utilisation from mass', () => {
    const best = selectBestTrueNestCandidate([
      { sheetWidthMm: 1000, sheetLengthMm: 2000, partsPerSheet: 100, sheetWeightKg: 31.4 },
      { sheetWidthMm: 1250, sheetLengthMm: 2500, partsPerSheet: 170, sheetWeightKg: 49.06 },
    ], 0.25)!;
    expect(best.sheetWidthMm).toBe(1250);
    expect(best.grossWeightPerPartKg).toBeCloseTo(49.06 / 170, 6);
    expect(best.utilisationPct).toBeCloseTo((0.25 / (49.06 / 170)) * 100, 0);
  });
  it('ignores zero-part candidates and returns null when none are usable', () => {
    expect(selectBestTrueNestCandidate([{ sheetWidthMm: 1, sheetLengthMm: 1, partsPerSheet: 0, sheetWeightKg: 1 }], 0.1)).toBeNull();
  });
  it('utilisation is capped at 100 and 0 on non-positive input', () => {
    expect(computeMassBasedUtilizationPct(2, 1)).toBe(100);
    expect(computeMassBasedUtilizationPct(0, 1)).toBe(0);
  });
});

describe('computeNesting: a part that fits no sheet', () => {
  const base = { thicknessMm: 2, netWeightKg: 5, densityKgM3: 7850, materialPricePerKg: 1, partAllowanceMm: 2 };
  it('says so instead of passing a floor of one part off as a nest', () => {
    const r = computeNesting({ ...base, flatPatternLengthMm: 4000, flatPatternWidthMm: 3000, sheets: [{ widthMm: 1250, lengthMm: 2500 }] });
    expect(r.fitsSheet).toBe(false);
    expect(r.partsPerSheet).toBe(1);
  });
  it('reports a real fit', () => {
    const r = computeNesting({ ...base, flatPatternLengthMm: 200, flatPatternWidthMm: 100, sheets: [{ widthMm: 1250, lengthMm: 2500 }] });
    expect(r.fitsSheet).toBe(true);
  });
});
