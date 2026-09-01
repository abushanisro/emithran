import { selectBestTrueNestCandidate } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/true-nest-costing.engine';

import type { TrueNestCostingSelection } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/true-nest-costing.engine';

function expectSelection(result: TrueNestCostingSelection | null): TrueNestCostingSelection {
  if (!result) throw new Error('expected a non-null selection');
  return result;
}

describe('selectBestTrueNestCandidate — true-shape sheet selection (no rectangle pre-filter)', () => {
  // The core architectural guarantee: a smaller sheet with fewer raw
  // placements can still be the cheaper choice if it interlocks the real
  // part shape more efficiently. A rectangle-grid ranking would pick
  // whichever sheet packs the most bounding-rectangle copies (here, the
  // larger 2500x5000mm sheet at 100 parts) -- but true-shape nesting must
  // select by lowest gross weight/part, which the SMALLER 1500x3000mm sheet
  // wins here despite placing fewer raw parts (60 < 100).
  const netWeightKg = 1.0;

  it('selects the smaller sheet when it has a lower gross weight/part, even with fewer raw placements', () => {
    const candidates = [
      // 1500x3000x1.6mm SECC: sheetWeightKg = 1.5*3*1.6/1000*7850 = 56.52
      { sheetWidthMm: 1500, sheetLengthMm: 3000, partsPerSheet: 60, sheetWeightKg: 56.52 },
      // 2500x5000x1.6mm SECC: sheetWeightKg = 2.5*5*1.6/1000*7850 = 157.0
      { sheetWidthMm: 2500, sheetLengthMm: 5000, partsPerSheet: 100, sheetWeightKg: 157.0 },
    ];
    // Gross weight/part: 1500x3000 -> 56.52/60 = 0.942 kg; 2500x5000 -> 157.0/100 = 1.57 kg.
    // The smaller sheet has the LOWER gross weight/part despite fewer raw parts --
    // a rectangle-grid-style "most parts wins" rule would wrongly pick the larger sheet.
    const result = expectSelection(selectBestTrueNestCandidate(candidates, netWeightKg));
    expect(result.sheetWidthMm).toBe(1500);
    expect(result.sheetLengthMm).toBe(3000);
    expect(result.partsPerSheet).toBe(60);
  });

  it('selects the larger sheet when IT has the lower gross weight/part (not always the smaller one)', () => {
    const candidates = [
      { sheetWidthMm: 1500, sheetLengthMm: 3000, partsPerSheet: 24, sheetWeightKg: 56.52 }, // 2.355 kg/part
      { sheetWidthMm: 2500, sheetLengthMm: 5000, partsPerSheet: 77, sheetWeightKg: 157.0 },  // 2.039 kg/part
    ];
    const result = expectSelection(selectBestTrueNestCandidate(candidates, netWeightKg));
    expect(result.sheetWidthMm).toBe(2500);
    expect(result.sheetLengthMm).toBe(5000);
  });

  it('recomputes utilization from real mass, never trusts a passed-in area-based percentage', () => {
    const candidates = [{ sheetWidthMm: 2500, sheetLengthMm: 5000, partsPerSheet: 70, sheetWeightKg: 157.0 }];
    const result = expectSelection(selectBestTrueNestCandidate(candidates, 1.234));
    // gross/part = 157.0/70 = 2.243kg; utilization = 1.234/2.243 = 55.0%
    expect(result.utilisationPct).toBeCloseTo(55.0, 1);
  });

  it('skips candidates with zero/invalid partsPerSheet (part did not fit that sheet) rather than throwing', () => {
    const candidates = [
      { sheetWidthMm: 1000, sheetLengthMm: 2000, partsPerSheet: 0, sheetWeightKg: 25.12 },
      { sheetWidthMm: 2500, sheetLengthMm: 5000, partsPerSheet: 77, sheetWeightKg: 157.0 },
    ];
    const result = expectSelection(selectBestTrueNestCandidate(candidates, netWeightKg));
    expect(result.sheetWidthMm).toBe(2500);
  });

  it('returns null when every candidate is invalid (all true-shape nests genuinely failed)', () => {
    const candidates = [
      { sheetWidthMm: 1000, sheetLengthMm: 2000, partsPerSheet: 0, sheetWeightKg: 25.12 },
      { sheetWidthMm: 1250, sheetLengthMm: 2500, partsPerSheet: 0, sheetWeightKg: 39.25 },
    ];
    expect(selectBestTrueNestCandidate(candidates, netWeightKg)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(selectBestTrueNestCandidate([], netWeightKg)).toBeNull();
  });
});
