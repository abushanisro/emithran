import { parseFlatPatternBlanks } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/flat-pattern-blanks';
import { combineBlankNests } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/true-nest-costing.engine';

const SHEET = { sheetWidthMm: 1500, sheetLengthMm: 3000, sheetWeightKg: 60 };

describe('combineBlankNests', () => {
  it('takes, per part, each blank\'s share of a sheet: 1/10 + 1/40 of a 60 kg sheet', () => {
    const s = combineBlankNests(SHEET, [10, 40], 6)!;
    expect(s.grossWeightPerPartKg).toBeCloseTo(60 * (0.1 + 0.025), 9);
    expect(s.partsPerSheet).toBe(8); // floor(1 / 0.125)
    expect(s.utilisationPct).toBeCloseTo(80, 1); // 6 kg net of 7.5 kg gross
  });

  it('is the one-blank result when there is one blank', () => {
    expect(combineBlankNests(SHEET, [25], 1)).toEqual(expect.objectContaining({ partsPerSheet: 25, grossWeightPerPartKg: 60 / 25 }));
  });

  it('declines a blank that does not fit, and a set that needs more than one sheet', () => {
    expect(combineBlankNests(SHEET, [10, 0], 1)).toBeNull();
    expect(combineBlankNests(SHEET, [1, 2], 1)).toBeNull(); // 1 + 1/2 sheets per set
    expect(combineBlankNests(SHEET, [], 1)).toBeNull();
  });
});

describe('parseFlatPatternBlanks', () => {
  it('maps the engine\'s blanks and drops what is not geometry', () => {
    const blanks = parseFlatPatternBlanks([
      { area_mm2: 107942, bounding_length_mm: 400, bounding_width_mm: 359, outline_points_mm: [[0, 0], [1, 0], [1, 1]], holes_mm: [{ cx_mm: 1, cy_mm: 2, diameter_mm: 3 }, { cx_mm: 'x' }], outline_source: 'wire_walk' },
      { area_mm2: 55000, outline_points_mm: null, outline_source: 'unavailable' },
    ])!;
    expect(blanks).toHaveLength(2);
    expect(blanks[0]).toEqual({ areaMm2: 107942, boundingLengthMm: 400, boundingWidthMm: 359, outlinePointsMm: [[0, 0], [1, 0], [1, 1]], holesMm: [{ cx_mm: 1, cy_mm: 2, diameter_mm: 3 }], outlineSource: 'wire_walk' });
    expect(blanks[1]).toEqual(expect.objectContaining({ areaMm2: 55000, outlinePointsMm: null, outlineSource: 'unavailable', holesMm: [] }));
  });

  it('is undefined from an engine that does not send blanks', () => {
    expect(parseFlatPatternBlanks(undefined)).toBeUndefined();
  });
});
