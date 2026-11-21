import { chooseNestBlank, gridNest, GRID_PLACEMENT_CAP } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/nest-blank-source';

// The Nest view never fails: it nests the true outline when there is one, else the best blank there is, and says which (display only).
const SQUARE = [[0, 0], [100, 0], [100, 50], [0, 50]];
const WHY = 'No flat-pattern outline is stored for this part.';

describe('the blank the Nest view nests', () => {
  it('the unfolded outline with its holes, as before', () => {
    const c = chooseNestBlank({ blankIndex: 0, flatOutline: SQUARE, flatHoles: [{ cxMm: 10, cyMm: 10, diameterMm: 5 }], whyNoOutline: WHY });
    expect(c).toMatchObject({ source: 'wire_walk', note: null, outlinePointsMm: SQUARE, holesMm: [{ cxMm: 10 }], blankCount: 1 });
  });

  it('a hydroformed part: its measured blank (what its quote nests), before the unfold', () => {
    const blank = [[0, 0], [80, 0], [40, 60]];
    expect(chooseNestBlank({ blankIndex: 0, flatOutline: SQUARE, hydroformBlank: { outline: blank, lengthMm: 80, widthMm: 60 }, whyNoOutline: WHY }))
      .toMatchObject({ source: 'hydroform_blank', outlinePointsMm: blank, note: null });
  });

  it('no outline measured: the blank\'s rectangle, then the flat pattern\'s, each said with why', () => {
    expect(chooseNestBlank({ blankIndex: 0, hydroformBlank: { outline: null, lengthMm: 30.29, widthMm: 30 }, flatRect: { lengthMm: 99, widthMm: 9 }, whyNoOutline: WHY }))
      .toMatchObject({ source: 'blank_rectangle', outlinePointsMm: [[0, 0], [30.29, 0], [30.29, 30], [0, 30]], note: `${WHY} Nested as the hydroform blank's rectangle, 30.3 x 30 mm.` });
    expect(chooseNestBlank({ blankIndex: 0, flatRect: { lengthMm: 60, widthMm: 140 }, whyNoOutline: WHY }))
      .toMatchObject({ source: 'blank_rectangle', outlinePointsMm: [[0, 0], [140, 0], [140, 60], [0, 60]] });
  });

  it('no flat pattern at all (a part that is not a sheet): its footprint, as an estimate; nothing measured, nothing to nest', () => {
    // R_M-0230-032 LEAD NUT HOUSING: 24.5 x 30 x 21 mm, its Process Sheet Metal while its geometry reads as machining.
    const conflict = 'No flat pattern for this part: its geometry reads as Machining (milled).';
    expect(chooseNestBlank({ blankIndex: 0, partSizesMm: [24.5, 30, 21], whyNoOutline: conflict })).toMatchObject({
      source: 'part_footprint', outlinePointsMm: [[0, 0], [30, 0], [30, 24.5], [0, 24.5]],
      note: `${conflict} No flat pattern was measured, so the part's footprint, 30 x 24.5 mm, is nested as an estimate.`,
    });
    expect(chooseNestBlank({ blankIndex: 0, partSizesMm: [null, 0], whyNoOutline: WHY })).toBeNull();
  });

  it('a part cut from several blanks: the one asked for, its outline, else its rectangle', () => {
    const blanks = [
      { areaMm2: 1, boundingLengthMm: 100, boundingWidthMm: 50, outlinePointsMm: SQUARE, holesMm: [{ cx_mm: 1, cy_mm: 2, diameter_mm: 3 }], outlineSource: 'wire_walk' as const },
      { areaMm2: 1, boundingLengthMm: 40, boundingWidthMm: 20, outlinePointsMm: null, holesMm: [], outlineSource: 'unavailable' as const },
    ];
    expect(chooseNestBlank({ blanks, blankIndex: 0, whyNoOutline: WHY })).toMatchObject({ source: 'wire_walk', holesMm: [{ cxMm: 1, cyMm: 2, diameterMm: 3 }], blankIndex: 0, blankCount: 2 });
    expect(chooseNestBlank({ blanks, blankIndex: 9, whyNoOutline: WHY })).toMatchObject({ source: 'blank_rectangle', blankIndex: 1, blankCount: 2, outlinePointsMm: [[0, 0], [40, 0], [40, 20], [0, 20]] });
  });
});

describe('the grid the Nest view falls back to when the cad-engine cannot nest the outline', () => {
  it('places the rectangle kerf apart inside the edge margin, in the orientation that fits more', () => {
    // 1000 x 500 sheet, 10 mm edge, 5 mm kerf: a 100 x 50 blank upright fits 9 x 8 = 72, turned (50 x 100) 17 x 4 = 68.
    const g = gridNest(SQUARE, 1000, 500, 5, 10, 200);
    expect(g.partsPerSheet).toBe(72);
    expect(g.placements[1]).toEqual({ xMm: 115, yMm: 10, rotationDeg: 0 });
    expect(g.utilizationPct).toBeCloseTo((72 * 5000 * 100) / 500000, 2);
    expect(g.sheetsRequired).toBe(3);
    // A tall sheet turns it: 500 x 1000, the same blank fits 4 x 17 = 68 upright, 8 x 9 = 72 turned (its outline is turned a quarter).
    const t = gridNest(SQUARE, 500, 1000, 5, 10, 1);
    expect(t.partsPerSheet).toBe(72);
    expect(t.outlinePointsMm).toEqual([[50, 0], [50, 100], [0, 100], [0, 0]]);
  });

  it('a blank larger than the sheet: none fit, no sheets; a tiny one: the count in full, the placements sent capped', () => {
    expect(gridNest(SQUARE, 90, 40, 0, 0, 1)).toMatchObject({ partsPerSheet: 0, placements: [], sheetsRequired: null, capped: false });
    const tiny = gridNest([[0, 0], [1, 0], [1, 1], [0, 1]], 1000, 1000, 0, 0, 1);
    expect(tiny.partsPerSheet).toBe(1000000);
    expect(tiny.placements).toHaveLength(GRID_PLACEMENT_CAP);
    expect(tiny.capped).toBe(true);
  });
});
